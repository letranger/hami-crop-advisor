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

    // 手冊檢索與網路搜尋並行；任一邊失敗就當作空結果（不讓整體失敗）。
    const [manualHits, webResults] = await Promise.all([
      search(q, 5).catch((e) => { console.warn('手冊檢索略過：', e.message); return []; }),
      webSearch(q, 4).catch((e) => { console.warn('網路搜尋略過：', e.message); return []; }),
    ]);

    if (!manualHits.length && !webResults.length) {
      res.status(200).json({
        answer: '目前查不到相關資料（手冊與網路都沒有結果）。換個關鍵字，或用下方關鍵字查詢試試。',
        sources: { manual: [], web: [] },
      });
      return;
    }

    const answer = await generateMerged(q, manualHits, webResults);
    res.status(200).json({
      answer,
      sources: {
        manual: manualHits.map((h) => ({ crop: h.crop, page: h.page })),
        web: webResults.map((r) => ({ title: r.title, url: r.url })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: '查詢失敗', detail: String(err.message || err) });
  }
};
