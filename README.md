# 溫室植栽專家系統 · AI Smart Crop Advisor

導入 GenAI 的植栽專家系統 — PWA 雛形。雲林縣 AI 創意實作計畫 · 麥寮高中。

主要作物：**哈密瓜**（設計可延伸至洋香瓜、花生、稻米、番茄、葉菜類）。
核心流程：**症狀輸入 → 系統判斷 → 診斷建議 → 管理提醒**。

## 功能

- **首頁**：定位 + 當地天氣（含農務提醒）、生育階段、六宮格入口、環境與作物狀態
- **拍照診斷**：相機取景 → AI 初步判斷（半圓信心度）+ 管理建議 ＊目前為模擬
- **環境紀錄**：感測卡（溫濕度／光照／EC／pH）、溫濕度趨勢、土壤水分趨勢、事件時間軸
- **栽培建議**：依生育階段的建議事項與異常預警
- **問題查詢**：症狀 / 病蟲害 / 栽培問題搜尋（知識庫）

## 本機執行

```bash
cd prototype
python3 -m http.server 8747
# 瀏覽器開 http://localhost:8747
```

> ⚠️ **定位／天氣需要 HTTPS 安全來源**才能運作。
> `localhost` 與正式的 https 網址可以；用「區網 IP 的 http」在手機測試會被瀏覽器擋住定位。
> 想在手機看到定位效果，請部署到 GitHub Pages 或 Vercel（皆免費、皆給 https）。

## 部署

### A. GitHub Pages（純靜態，最省）

適合目前「全模擬」版本。

1. 建 GitHub repo 並推上這個資料夾的內容
2. Settings → Pages → Source 選分支（`main`）與根目錄
3. 開啟後即得一個 `https://<帳號>.github.io/<repo>/` 的網址

限制：GitHub Pages **只能託管靜態檔案，不能執行 `api/` 內的後端函式**。
拍照診斷維持模擬即可；要接真 AI 請用下面的 Vercel。

### B. Vercel（靜態 + Serverless，可接真 AI）

1. 把這個資料夾推上 GitHub
2. Vercel → New Project → 匯入該 repo（Root Directory 選這個資料夾）
3. Deploy 後得到 `https://<專案>.vercel.app`
4. 要接真 AI：Settings → Environment Variables 設定 `GEMINI_API_KEY` 或
   `ANTHROPIC_API_KEY`，並在 `api/diagnose.js` 補上視覺辨識 + RAG（檔案內有 TODO）
5. 前端把 `app.js` 的 `diagnose()` 改為呼叫 `/api/diagnose`（檔案內已留參考碼）

## 專案結構

```
index.html      單頁 PWA（inline CSS）
app.js          前端邏輯（導覽、診斷、圖表、定位+天氣）
manifest.json   PWA 設定
sw.js           Service Worker（離線快取；外部 API 走網路）
icons/          PWA 圖示
api/_rag.js     RAG 共用：Gemini embedding 檢索 + 生成（伺服器端）
api/ask.js      問題查詢的 RAG 問答端點（Serverless）
api/diagnose.js 診斷端點（視覺仍模擬；管理建議走 RAG）
api/kb.json     知識庫向量索引（由 scripts/build_kb.py 產生、進版控）
vercel.json     Vercel 設定
../scripts/build_kb.py  離線建立 kb.json（跑一次）
```

## RAG 問答（依栽培手冊回答）

「問題查詢」頁的 **🤖 用 AI 依栽培手冊回答**，以及拍照診斷的管理建議，都用
RAG（檢索增強生成）：把 `docs/` 的栽培手冊建成向量索引，農友提問時先檢索最相關
段落，再由 Gemini 產生繁中回答並附上引用頁碼。

**供應商：嵌入用 Gemini、生成用 Groq（皆免費）**
- 索引/檢索：Gemini `gemini-embedding-001`（免費、額度足）→ 金鑰 `GEMINI_API_KEY`
  （<https://aistudio.google.com/api-keys>）
- 產生回答：Groq `llama-3.3-70b-versatile`（免費、穩定）→ 金鑰 `GROQ_API_KEY`
  （<https://console.groq.com/keys>）
- 為何拆兩家：Gemini 免費層的「**生成**」配額不敷 demo 使用（會 429），故生成改用 Groq；
  嵌入維持 Gemini。兩把金鑰**只放伺服器端**（Vercel 環境變數 / 本機 `.env`），切勿寫進前端。

**建立知識庫索引（跑一次；手冊有更動才需重跑）**

```bash
pip install -r ../scripts/requirements.txt   # 只需 pymupdf
export GEMINI_API_KEY=你的金鑰
python3 ../scripts/build_kb.py               # 產生 prototype/api/kb.json（約 2MB）
```

預設只索引**中文手冊**（回答為繁中、檢索更精準、kb.json 更小）；要連英文手冊
一起納入：`INCLUDE_ENGLISH=1 python3 ../scripts/build_kb.py`。把 `kb.json` 一起
commit，前後端即可做語意檢索。

**本機測試 RAG**：靜態伺服器（`python3 -m http.server`）沒有 `/api/*`，要用
`npx vercel dev` 啟動並在 `.env` 設 `GEMINI_API_KEY` 與 `GROQ_API_KEY`。沒有金鑰 /
沒建索引時，前端會顯示提示、拍照診斷退回內建建議，其餘功能照常。

檔案：`scripts/build_kb.py`（離線建索引）、`api/_rag.js`（檢索+生成共用）、
`api/ask.js`（問答端點）、`api/diagnose.js`（診斷 + RAG 建議）、`api/kb.json`（索引）。

## 技術備註

- **定位**：`navigator.geolocation`（免金鑰）
- **地名**：BigDataCloud 反向地理編碼（免金鑰、支援中文）
- **天氣**：Open-Meteo（免金鑰、支援 CORS，可前端直接呼叫）
- **問答 / 診斷建議**：Gemini embedding 檢索栽培手冊 → Groq（Llama）生成繁中回答；金鑰只放後端
- **診斷病名判讀（規劃）**：Gemini Vision 判病名（目前仍模擬）→ 再走上面的 RAG 建議
- 內容與介面：繁體中文（zh-TW）
