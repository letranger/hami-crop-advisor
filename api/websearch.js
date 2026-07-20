/* ============================================================
   /api/websearch — 「上網查最新資訊」端點（Vercel Serverless）
   ------------------------------------------------------------
   與 /api/ask（只查本地手冊）分開：這裡用 Tavily 搜尋網路，
   再由 Groq 綜合整理成繁中回答。答案明確標示「來自網路、僅供參考」。
   前端傳 { question }，回傳 { answer, sources:[{title,url}] }。

   金鑰只在伺服器端讀取：TAVILY_API_KEY（搜尋）、GROQ_API_KEY（生成）。
   ============================================================ */

const { webSearch, generateWeb } = require('./_rag');

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

    const results = await webSearch(question.trim(), 5);
    if (!results.length) {
      res.status(200).json({
        answer: '網路上找不到相關資料，換個關鍵字，或改用「依栽培手冊回答」試試。',
        sources: [],
      });
      return;
    }

    const answer = await generateWeb(question.trim(), results);
    res.status(200).json({
      answer,
      sources: results.map((r) => ({ title: r.title, url: r.url })),
    });
  } catch (err) {
    res.status(500).json({ error: '網路查詢失敗', detail: String(err.message || err) });
  }
};
