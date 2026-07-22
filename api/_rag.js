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

// 網路搜尋：Tavily（專為 LLM 設計、免費額度、免綁卡）。用於「上網查」模式，與手冊 RAG 分開。
const TAVILY_URL = 'https://api.tavily.com/search';

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
function tavilyKey() {
  const k = process.env.TAVILY_API_KEY;
  if (!k) throw new Error('伺服器未設定 TAVILY_API_KEY 環境變數（到 tavily.com 建立，免費）。');
  return k;
}

/* ---- 429（額度上限）解析：把供應商回傳的「要等多久／哪一種上限」翻成農友看得懂的話 ----
   Groq 的 429 內文長這樣：
     ... on tokens per minute (TPM): Limit 12000, ... Please try again in 4.891s. ...
   並帶 `retry-after` 標頭（秒）。我們解析出秒數與限制類型（每分鐘 / 每日），顯示確切等待時間。 */

// 把 "2h30m12.34s" / "4.891s" / "1m30s" 這種時間字串轉成秒數；解析不到回傳 null。
function parseDurationToSeconds(str) {
  let total = 0, matched = false;
  const re = /([\d.]+)\s*(h|m|s)/gi;
  let m;
  while ((m = re.exec(str))) {
    matched = true;
    const v = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    total += u === 'h' ? v * 3600 : u === 'm' ? v * 60 : v;
  }
  return matched ? total : null;
}

// 從 429 內文抓出「Please try again in ...」的等待秒數。
function extractWaitSeconds(txt) {
  const m = /try again in ([0-9hms.\s]+)/i.exec(txt || '');
  return m ? parseDurationToSeconds(m[1]) : null;
}

// 判斷是「每日」還是「每分鐘」上限。
function limitDimension(txt) {
  const t = (txt || '').toLowerCase();
  if (/per day|\(tpd\)|\(rpd\)/.test(t)) return 'day';
  if (/per minute|\(tpm\)|\(rpm\)/.test(t)) return 'minute';
  return null;
}

// 秒數 → 中文（不含「約」字，模板再自行加）："8 秒" / "3 分鐘" / "2 小時 30 分鐘"。
function humanizeWait(sec) {
  const s = Math.ceil(sec);
  if (s < 90) return `${s} 秒`;
  const mins = Math.round(s / 60);
  if (mins < 90) return `${mins} 分鐘`;
  const h = Math.floor(s / 3600), mm = Math.round((s % 3600) / 60);
  return mm ? `${h} 小時 ${mm} 分鐘` : `${h} 小時`;
}

// 目前時間 + sec 秒 = 台灣時間時鐘（給「等比較久」時附上大概幾點恢復）。
function taipeiClock(sec) {
  const d = new Date(Date.now() + sec * 1000);
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

// 組出接在「AI 使用量暫時達到上限」後面的說明字串。
function describeRateLimit(txt, headers) {
  let seconds = extractWaitSeconds(txt);
  if (seconds == null && headers && typeof headers.get === 'function') {
    const ra = parseFloat(headers.get('retry-after'));
    if (!isNaN(ra)) seconds = ra;
  }
  const dim = limitDimension(txt);

  if (seconds == null || seconds <= 0) {
    if (dim === 'day') return '（今日免費額度已用完），需等到台灣時間隔天早上 8 點後才會恢復，請先用下方關鍵字查詢。';
    return '，請稍候片刻再試。';
  }
  const human = humanizeWait(seconds);
  const clock = seconds >= 300 ? `（約 ${taipeiClock(seconds)} 恢復）` : '';
  if (dim === 'day') return `（今日免費額度已用完），預計 ${human}後恢復${clock}，可先用下方關鍵字查詢。`;
  if (dim === 'minute') return `（每分鐘額度用完），約 ${human}後恢復，稍等再按一次即可。`;
  return `，預計 ${human}後恢復${clock}，請再試一次。`;
}

// 429 是否「一時半刻好不了」（每日上限、或等待 > 5 秒）——是的話重試也沒用，直接報明確訊息。
function isLongWait(txt) {
  const s = extractWaitSeconds(txt);
  if (s != null) return s > 5;
  return limitDimension(txt) === 'day';
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
    // 5xx 一律退避重試；429 只有在「幾秒內可恢復」時才重試（每日/長等待重試也沒用，直接報明確訊息）。
    const retriable = attempt < delays.length &&
      (status >= 500 || (status === 429 && !isLongWait(txt)));
    if (retriable) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
      continue;
    }
    if (status === 429) {
      throw new Error(`${label}：AI 使用量暫時達到上限${describeRateLimit(txt, res.headers)}`);
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

/* ===== 「上網查」模式：Tavily 搜尋 → Groq 綜合整理（與手冊 RAG 分開）===== */

// 用 Tavily 搜尋網路，回傳 [{title, url, content}]。
async function webSearch(query, k = 5) {
  const key = tavilyKey();
  // 這是農業 App：替查詢補上領域關鍵字，讓結果更貼近台灣栽培／病蟲害防治，
  // 而非一般百科／品種介紹（避免抓到離題頁面）。
  const agriQuery = `${query} 台灣 溫室栽培 病蟲害 防治`;
  const data = await postJSON(TAVILY_URL, {
    api_key: key,               // 相容舊式：金鑰放 body
    query: agriQuery,
    max_results: k,
    search_depth: 'advanced',   // 進階搜尋，抓到更相關的內容片段
    include_answer: false,
    topic: 'general',
  }, '網路搜尋', { Authorization: `Bearer ${key}` }); // 相容新式：金鑰放 header
  return (data.results || []).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    content: (r.content || '').slice(0, 1200),
  }));
}

// 用網路搜尋結果請 Groq 綜合整理成繁中回答（明確標示來自網路、僅供參考）。
async function generateWeb(question, results) {
  const refs = results
    .map((r, i) => `【來源${i + 1}｜${r.title}】${r.url}\n${r.content}`)
    .join('\n\n');
  const system =
    `你是台灣溫室栽培的農業助理，服務對象是麥寮高中的學生與在地農友。\n` +
    `以下是「網路搜尋結果」，請用繁體中文（台灣用語，zh-TW）綜合整理出實用答案，語氣簡單、步驟清楚。\n` +
    `注意：網路資訊未必正確或不一定適用台灣，若有不確定請提醒使用者查證、或諮詢當地農業改良場。\n` +
    `只根據下列搜尋結果作答，不要杜撰；資訊不足就說明。`;
  const user = `網路搜尋結果：\n${refs}\n\n問題：${question}`;
  const data = await postJSON(GROQ_URL, {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    max_tokens: 900,
  }, '生成', { Authorization: `Bearer ${groqKey()}` });
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq 未回傳內容。');
  return text.trim();
}

/* ===== 合併模式：手冊(優先) + 網路(補充) → 一個回答，逐點標註來源 ===== */
async function generateMerged(question, manualHits, webResults) {
  const manualRefs = (manualHits || [])
    .map((c, i) => `【手冊${i + 1}｜${c.crop} 第${c.page}頁】\n${c.text}`)
    .join('\n\n');
  const webRefs = (webResults || [])
    .map((r, i) => `【網路${i + 1}｜${r.title}】${r.url}\n${r.content}`)
    .join('\n\n');

  const system =
    `你是台灣溫室栽培的農業專家助理，服務對象是麥寮高中的學生與在地農友。\n` +
    `用繁體中文（台灣用語，zh-TW）回答，語氣簡單、步驟清楚、避免艱澀術語。\n` +
    `你會拿到兩種資料：「栽培手冊」（可信，優先採用）與「網路搜尋結果」（僅供參考、可能不準或不一定適用台灣）。\n` +
    `規則：\n` +
    `1) 優先根據手冊回答；手冊沒有、或需要補充較新資訊時，才引用網路。\n` +
    `2) 每個重點結尾用括號標註依據，例如（手冊：洋香瓜 第12頁）或（網路：來源標題）。\n` +
    `3) 只根據下列提供的資料作答，不要杜撰；若兩邊都沒有相關資訊，就誠實說明並建議諮詢當地農業改良場。`;
  const user =
    `【栽培手冊】\n${manualRefs || '（無相關手冊段落）'}\n\n` +
    `【網路搜尋結果】\n${webRefs || '（無網路結果）'}\n\n` +
    `問題：${question}`;

  const data = await postJSON(GROQ_URL, {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    max_tokens: 1000,
  }, '生成', { Authorization: `Bearer ${groqKey()}` });
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq 未回傳內容。');
  return text.trim();
}

module.exports = {
  loadKB, embedQuery, cosine, retrieve, search, generate,
  webSearch, generateWeb, generateMerged,
};
