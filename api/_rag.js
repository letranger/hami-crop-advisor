/* ============================================================
   _rag.js — RAG 共用工具（給 api/ask.js 與 api/diagnose.js 使用）
   ------------------------------------------------------------
   職責：
     1. 載入 kb.json（由 scripts/build_kb.py 離線產生）
     2. 用 Gemini text-embedding-004 把「查詢字串」轉成向量
     3. 以 cosine similarity 找出最相關的 top-k 塊
     4. 用 gemini-2.0-flash 依檢索到的內容產生繁中回答（附引用）

   ⚠️ 金鑰只在伺服器端讀取（process.env.GEMINI_API_KEY），
      絕對不要把金鑰或本檔邏輯搬到前端。
   ============================================================ */

const fs = require('fs');
const path = require('path');

const EMBED_MODEL = 'gemini-embedding-001'; // 需與 build_kb.py 一致
const EMBED_DIM = 768;                       // 需與 build_kb.py 一致
const GEN_MODEL = 'gemini-2.0-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

function apiKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('伺服器未設定 GEMINI_API_KEY 環境變數。');
  return k;
}

// 共用：POST 到 Gemini，對 429 / 5xx 做少量退避重試；免費額度超量時給農友看得懂的訊息。
async function postGemini(url, body, label) {
  const delays = [800, 2000];   // 最多重試 2 次（serverless 有逾時，不宜太久）
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      throw new Error(`${label}：AI 使用量暫時達到免費額度上限，請稍候一分鐘再試。`);
    }
    throw new Error(`${label}失敗 (${status})：${txt.slice(0, 200)}`);
  }
}

// 把一段查詢字串轉成向量（taskType 用 RETRIEVAL_QUERY，和建索引時的 DOCUMENT 對稱）。
async function embedQuery(text) {
  const url = `${API_BASE}/${EMBED_MODEL}:embedContent?key=${apiKey()}`;
  const data = await postGemini(url, {
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

// 用檢索到的內容請 Gemini 產生繁中回答。回傳純文字。
async function generate(question, contexts) {
  const refs = contexts
    .map((c, i) => `【資料${i + 1}｜${c.crop} 第${c.page}頁】\n${c.text}`)
    .join('\n\n');
  const prompt =
    `你是台灣溫室栽培的農業專家助理，服務對象是麥寮高中的學生與在地農友。\n` +
    `請「只根據下列參考資料」用繁體中文（zh-TW）回答問題，語氣簡單、步驟清楚、避免艱澀術語。\n` +
    `若參考資料不足以回答，請誠實說明並建議可諮詢農業改良場，不要杜撰。\n` +
    `回答結尾用一行標註引用來源，例如：（來源：洋香瓜 第12頁）。\n\n` +
    `參考資料：\n${refs}\n\n問題：${question}\n\n回答：`;

  const url = `${API_BASE}/${GEN_MODEL}:generateContent?key=${apiKey()}`;
  const data = await postGemini(url, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
  }, '生成');
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 未回傳內容。');
  return text.trim();
}

module.exports = { loadKB, embedQuery, cosine, retrieve, search, generate };
