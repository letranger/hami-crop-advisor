#!/usr/bin/env python3
# ============================================================
#  build_kb.py — 離線建立 RAG 知識庫索引（跑一次即可）
# ------------------------------------------------------------
#  流程：docs/*.pdf → 抽取每頁文字（PyMuPDF）→ 切塊 → 用 Gemini
#        embedding 產生向量 → 寫出 prototype/api/kb.json
#
#  之後 api/ask.js、api/diagnose.js 會讀這個 kb.json 做語意檢索。
#  PDF 是靜態資料，內容有更動才需要重跑；平常 kb.json 進版控即可。
#
#  ── 這是「進階／偶爾才做」的離線步驟，需要在本機跑 Python，
#     跟學生日常「網頁改碼 → Vercel 自動部署」的流程無關。
#     手冊 PDF 因體積大、有版權疑慮，不進 git；重建時自備 PDF。──
#
#  用法（在 prototype/ 目錄下）：
#    export GEMINI_API_KEY=你的金鑰        # 在 https://aistudio.google.com/api-keys 建立
#    pip install -r scripts/requirements.txt
#    # 把手冊 PDF 放進 prototype/docs/（或用 KB_DOCS_DIR 指定資料夾）
#    python3 scripts/build_kb.py
#
#  docs 資料夾的尋找順序：
#    1) 環境變數 KB_DOCS_DIR 指定的路徑
#    2) prototype/docs/
#    3) 專案根目錄/docs/（本機開發時 PDF 放這裡）
#
#  金鑰只在「你本機建索引時」用到，不會進版控、也不會放進前端。
# ============================================================

import os
import sys
import json
import time
import urllib.request
import urllib.error

import fitz  # PyMuPDF

# ---- 路徑（相對於這個腳本所在位置，不受目前工作目錄影響）----
HERE = os.path.dirname(os.path.abspath(__file__))   # prototype/scripts
REPO = os.path.dirname(HERE)                          # prototype
OUT_PATH = os.path.join(REPO, "api", "kb.json")


def resolve_docs_dir():
    """依序尋找放手冊 PDF 的資料夾；找不到就給清楚的提示後結束。"""
    candidates = []
    env = os.environ.get("KB_DOCS_DIR")
    if env:
        candidates.append(env)
    candidates.append(os.path.join(REPO, "docs"))                    # prototype/docs
    candidates.append(os.path.join(os.path.dirname(REPO), "docs"))   # 專案根/docs
    for d in candidates:
        if d and os.path.isdir(d):
            return d
    sys.exit(
        "❌ 找不到 docs 資料夾（放手冊 PDF 的地方）。\n"
        "   請把 PDF 放進 prototype/docs/，或設定環境變數：\n"
        "     export KB_DOCS_DIR=/你的/手冊資料夾"
    )


# ---- 參數 ----
# 產品為繁中、農友面向，回答一律繁中輸出，故預設「只索引中文手冊」：
#   · 索引更精準（不會被英文段落稀釋 top-k）、kb.json 更小（約 2MB vs 23MB）
#   · 想連英文手冊(檔名含「英」)一起納入 → 設環境變數 INCLUDE_ENGLISH=1
INCLUDE_ENGLISH = os.environ.get("INCLUDE_ENGLISH") == "1"

EMBED_MODEL = "gemini-embedding-001"    # Gemini 目前的 embedding 模型
EMBED_DIM = 768                         # 降到 768 維：kb.json 更小、檢索一樣好
CHUNK_CHARS = 700                       # 每塊約 700 字（中文 ≈ token 數）
CHUNK_OVERLAP = 120                     # 相鄰塊重疊，避免切斷語意
API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# 檔名 → 作物標籤（讓引用來源更好讀；找不到就用檔名）
CROP_LABEL = {
    "溫室蕃茄栽培手冊": "番茄", "温室蕃茄栽培手冊": "番茄", "小蕃茄栽培手冊": "小番茄",
    "溫室番茄_英": "番茄(英)", "小黃瓜栽培手冊": "小黃瓜", "溫室小黃瓜_英文": "小黃瓜(英)",
    "洋香瓜手冊": "洋香瓜", "甜椒栽培手冊": "甜椒", "溫室甜椒_英": "甜椒(英)",
}


def clean(text: str) -> str:
    """壓縮空白、去掉頁碼式的孤立數字行，讓切塊更乾淨。"""
    lines = []
    for ln in text.splitlines():
        s = " ".join(ln.split())
        if not s:
            continue
        if s.isdigit() and len(s) <= 4:   # 純頁碼行
            continue
        lines.append(s)
    return "\n".join(lines)


def chunk_page(text: str):
    """把一頁文字切成有重疊的塊。回傳 list[str]。"""
    text = text.strip()
    if len(text) <= CHUNK_CHARS:
        return [text] if text else []
    out, i = [], 0
    step = CHUNK_CHARS - CHUNK_OVERLAP
    while i < len(text):
        piece = text[i:i + CHUNK_CHARS].strip()
        if len(piece) >= 60:              # 太短的尾塊沒檢索價值
            out.append(piece)
        i += step
    return out


def extract_chunks(docs_dir):
    """走訪所有 PDF，回傳 list[dict(source, crop, page, text)]。"""
    pdfs = sorted(f for f in os.listdir(docs_dir) if f.lower().endswith(".pdf"))
    if not pdfs:
        sys.exit(f"❌ 在 {docs_dir} 找不到任何 PDF。")
    if not INCLUDE_ENGLISH:
        skipped = [f for f in pdfs if "英" in f]
        pdfs = [f for f in pdfs if "英" not in f]
        for f in skipped:
            print(f"  · （略過英文手冊）{f}  ← 設 INCLUDE_ENGLISH=1 可納入")
    chunks = []
    for fn in pdfs:
        stem = os.path.splitext(fn)[0]
        crop = CROP_LABEL.get(stem, stem)
        doc = fitz.open(os.path.join(docs_dir, fn))
        pages = len(doc)
        n = 0
        for pno in range(pages):
            page_text = clean(doc[pno].get_text("text"))
            for piece in chunk_page(page_text):
                chunks.append({"source": stem, "crop": crop,
                               "page": pno + 1, "text": piece})
                n += 1
        doc.close()
        print(f"  · {fn}: {pages} 頁 → {n} 塊")
    return chunks


def embed_one(text, api_key, task_type="RETRIEVAL_DOCUMENT"):
    """呼叫 embedContent（單筆），回傳 list[float]。含 429/5xx 退避重試。"""
    url = f"{API_BASE}/{EMBED_MODEL}:embedContent?key={api_key}"
    body = {
        "model": f"models/{EMBED_MODEL}",
        "content": {"parts": [{"text": text}]},
        "taskType": task_type,
        "outputDimensionality": EMBED_DIM,
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read())
            return data["embedding"]["values"]
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            if e.code in (429, 500, 503) and attempt < 5:
                wait = 2 ** attempt
                print(f"    ⚠ {e.code}，{wait}s 後重試…")
                time.sleep(wait)
                continue
            sys.exit(f"❌ Embedding 失敗（HTTP {e.code}）：{detail[:300]}")
        except urllib.error.URLError as e:
            if attempt < 5:
                time.sleep(2 ** attempt)
                continue
            sys.exit(f"❌ 網路錯誤：{e}")
    return []


def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("❌ 請先設定環境變數 GEMINI_API_KEY（在 aistudio.google.com/api-keys 取得）。")

    docs_dir = resolve_docs_dir()
    print(f"① 抽取 PDF 文字並切塊…（來源：{docs_dir}）")
    chunks = extract_chunks(docs_dir)
    print(f"   共 {len(chunks)} 塊，開始產生向量（模型：{EMBED_MODEL}）…")

    print(f"② 呼叫 Gemini 產生向量（逐筆 embedContent，{EMBED_DIM} 維）…")
    vectors = []
    for i, c in enumerate(chunks, 1):
        vectors.append(embed_one(c["text"], api_key))
        if i % 25 == 0 or i == len(chunks):
            print(f"   {i}/{len(chunks)}")
        time.sleep(0.15)   # 對免費額度溫柔一點

    if len(vectors) != len(chunks):
        sys.exit(f"❌ 向量數({len(vectors)}) 與塊數({len(chunks)}) 不符。")

    records = [
        {"id": i, "source": c["source"], "crop": c["crop"],
         "page": c["page"], "text": c["text"], "embedding": v}
        for i, (c, v) in enumerate(zip(chunks, vectors))
    ]
    payload = {
        "model": EMBED_MODEL,
        "dim": len(vectors[0]) if vectors else 0,
        "count": len(records),
        "chunks": records,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    size_mb = os.path.getsize(OUT_PATH) / 1e6
    print(f"③ 完成 → {OUT_PATH}（{len(records)} 塊，{payload['dim']} 維，{size_mb:.1f} MB）")
    print("   把 kb.json 一起 commit，前端/後端就能做語意檢索了。")


if __name__ == "__main__":
    main()
