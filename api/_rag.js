/* ============================================================
   _rag.js — RAG 共用工具（給 api/ask.js 與 api/diagnose.js 使用）
   ------------------------------------------------------------
   職責：
     1. 載入 kb.json（由 scripts/build_kb.py 離線產生）
     2. 用 Gemini gemini-embedding-001 把「查詢字串」轉成向量（免費）
     3. 以 cosine similarity 找出最相關的 top-k 塊
     4. 用 Groq（Llama）依檢索到的內容產生繁中回答（附引用）

   供應商拆成兩家：嵌入用 Gemini（免費、額度充足），生成用 Groq（免費、穩定），
   因為 Gemini 免費層的「生成」配額不敷 demo 使用。

   ⚠️ 兩把金鑰都只在伺服器端讀取：
        GEMINI_API_KEY（嵌入）、GROQ_API_KEY（生成）
      絕對不要把金鑰或本檔邏輯搬到前端。
   ============================================================ */

const fs = require('fs');
const path = require('path');

// 嵌入：Gemini（需與 build_kb.py 一致）
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 生成：Groq（OpenAI 相容）。可到 console.groq.com 看可用模型；zh-TW 品質佳、免費穩定。
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// kb.json 可能有數 MB；用 require 快取，冷啟動載入一次後常駐記憶體。
let _kb = null;
function loadKB() {
  if (_kb) return _kb;
  const p = path.join(__dirname, 'kb.json');
  if (!fs.existsSync(p)) {
    throw new Error('kb.json 不存在，請先在本機執行 scripts/build_kb.py 產生知識庫索引。');
  }
  _kb = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return _kb;
}

function geminiKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('伺服器未設定 GEMINI_API_KEY 環境變數。');
  return k;
}
function groqKey() {
  const k = process.env.GROQ_API_KEY;
  if (!k) throw new Error('伺服器未設定 GROQ_API_KEY 環境變數（到 console.groq.com/keys 建立）。');
  return k;
}

// 共用：POST JSON，對 429 / 5xx 做少量退避重試；額度/尖峰時給農友看得懂的訊息。
async function postJSON(url, body, label, extraHeaders = {}) {
  const delays = [800, 2000];   // 最多重試 2 次（serverless 有逾時，不宜太久）
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const status = res.status;
    const txt = await res.text();
    if ((status === 429 || status >= 500) && attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
      continue;
    }
    if (status === 429) {
      throw new Error(`${label}：AI 使用量暫時達到上限，請稍候片刻再試。`);
    }
    throw new Error(`${label}失敗 (${status})：${txt.slice(0, 200)}`);
  }
}

// 把一段查詢字串轉成向量（Gemini；taskType 用 RETRIEVAL_QUERY，和建索引時的 DOCUMENT 對稱）。
async function embedQuery(text) {
  const url = `${GEMINI_BASE}/${EMBED_MODEL}:embedContent?key=${geminiKey()}`;
  const data = await postJSON(url, {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: EMBED_DIM,
  }, '檢索');
  return data.embedding.values;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

// 找出與 queryVec 最相關的 top-k 塊（附相似度分數）。
function retrieve(queryVec, k = 5) {
  const kb = loadKB();
  return kb.chunks
    .map((c) => ({ ...c, score: cosine(queryVec, c.embedding) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map(({ embedding, ...rest }) => rest); // 丟掉向量，回傳精簡結果
}

// 便利函式：字串查詢 → 檢索結果。
async function search(query, k = 5) {
  return retrieve(await embedQuery(query), k);
}

// 用檢索到的內容請 Groq（Llama）產生繁中回答。回傳純文字。
async function generate(question, contexts) {
  const refs = contexts
    .map((c, i) => `【資料${i + 1}｜${c.crop} 第${c.page}頁】\n${c.text}`)
    .join('\n\n');
  const system =
    `你是台灣溫室栽培的農業專家助理，服務對象是麥寮高中的學生與在地農友。\n` +
    `務必用「繁體中文（台灣用語，zh-TW）」回答，語氣簡單、步驟清楚、避免艱澀術語。\n` +
    `只能根據使用者提供的「參考資料」回答；若資料不足，誠實說明並建議諮詢當地農業改良場，不要杜撰。\n` +
    `回答結尾用一行標註引用來源，例如：（來源：洋香瓜 第12頁）。`;
  const user = `參考資料：\n${refs}\n\n問題：${question}`;

  const data = await postJSON(GROQ_URL, {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    max_tokens: 800,
  }, '生成', { Authorization: `Bearer ${groqKey()}` });

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq 未回傳內容。');
  return text.trim();
}

module.exports = { loadKB, embedQuery, cosine, retrieve, search, generate };
