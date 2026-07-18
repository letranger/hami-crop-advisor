/* ============================================================
   /api/ask — 問題查詢的 RAG 端點（Vercel Serverless Function）
   ------------------------------------------------------------
   前端傳來 { question: "植株葉片黃化怎麼辦？" }
   流程：query → embedding → 檢索 kb.json → Gemini 生成繁中回答
   回傳 { answer, sources:[{crop, page, snippet}] }

   金鑰只在此（伺服器端）以 process.env.GEMINI_API_KEY 讀取。
   ============================================================ */

const { search, generate } = require('./_rag');

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

    const hits = await search(question.trim(), 5);
    const answer = await generate(question.trim(), hits);

    res.status(200).json({
      answer,
      sources: hits.map((h) => ({
        crop: h.crop,
        page: h.page,
        snippet: h.text.slice(0, 80),
        score: Number(h.score.toFixed(3)),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: '查詢失敗', detail: String(err.message || err) });
  }
};
