/* ============================================================
   /api/ask — 問題查詢的「合併 RAG」端點（Vercel Serverless）
   ------------------------------------------------------------
   一次同時查兩個來源，再由 Groq 綜合成一個回答、逐點標註來源：
     1) 栽培手冊（Gemini 檢索 kb.json）── 可信、優先
     2) 網路（Tavily 搜尋）──────────── 補充最新資訊、僅供參考
   兩者都是「盡力而為」：某一邊沒金鑰/失敗時，仍用另一邊作答，不整個失敗。

   回傳 { answer, sources:{ manual:[{crop,page}], web:[{title,url}] } }
   金鑰只在伺服器端讀取：GEMINI_API_KEY、TAVILY_API_KEY、GROQ_API_KEY。
   ============================================================ */

const { search, webSearch, generateMerged } = require('./_rag');
const store = require('./_store');

const REC_INDEX = 'rec:z';           // 共享診斷記錄索引（sorted set，分數=時間）
const REC_KEEP  = 300;               // 索引只保留最新 300 筆
const REC_TTL   = 60 * 60 * 24 * 30; // 記錄保存 30 天

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed，請用 POST' });
    return;
  }
  try {
    const { question } = req.body || {};
    if (!question || !question.trim()) {
      res.status(400).json({ error: '缺少 question' });
      return;
    }
    const q = question.trim();
    const key = 'qa:' + store.hashQ(q);

    // ── 1) 快取命中：同樣的問題直接回存好的答案，不再呼叫 RAG/AI ──
    if (store.isConfigured()) {
      try {
        const raw = await store.get(key);
        if (raw) {
          const rec = JSON.parse(raw);
          rec.count = (rec.count || 1) + 1;
          rec.lastTs = Date.now();
          await store.setEx(key, JSON.stringify(rec), REC_TTL);
          await store.zadd(REC_INDEX, await store.incr('rec:seq'), key);
          res.status(200).json({ answer: rec.answer, sources: rec.sources, cached: true, count: rec.count });
          return;
        }
      } catch (e) { console.warn('讀取快取失敗，改走即時查詢：', e.message); }
    }

    // ── 2) 未命中：跑合併 RAG（手冊＋網路並行）──
    const [manualHits, webResults] = await Promise.all([
      search(q, 5).catch((e) => { console.warn('手冊檢索略過：', e.message); return []; }),
      webSearch(q, 4).catch((e) => { console.warn('網路搜尋略過：', e.message); return []; }),
    ]);

    if (!manualHits.length && !webResults.length) {
      // 查無資料不寫入快取（避免把「查不到」也記起來）
      res.status(200).json({
        answer: '目前查不到相關資料（手冊與網路都沒有結果）。換個關鍵字，或用下方關鍵字查詢試試。',
        sources: { manual: [], web: [] },
        cached: false, count: 0,
      });
      return;
    }

    const answer = await generateMerged(q, manualHits, webResults);
    const sources = {
      manual: manualHits.map((h) => ({ crop: h.crop, page: h.page })),
      web: webResults.map((r) => ({ title: r.title, url: r.url })),
    };

    // ── 3) 寫入快取＋共享記錄（失敗不影響回應）──
    if (store.isConfigured()) {
      try {
        const now = Date.now();
        const rec = { type: 'text', question: q, answer, sources, count: 1, firstTs: now, lastTs: now };
        await store.setEx(key, JSON.stringify(rec), REC_TTL);
        await store.zadd(REC_INDEX, await store.incr('rec:seq'), key);
        await store.ztrim(REC_INDEX, REC_KEEP);
      } catch (e) { console.warn('寫入共享記錄失敗：', e.message); }
    }

    res.status(200).json({ answer, sources, cached: false, count: 1 });
  } catch (err) {
    res.status(500).json({ error: '查詢失敗', detail: String(err.message || err) });
  }
};
