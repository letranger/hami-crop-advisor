/* ============================================================
   api/records — 讀取全體使用者共享的診斷記錄（Vercel Serverless）
   ------------------------------------------------------------
   GET /api/records?limit=60  →  { configured, records:[…] }（最新在前）
   · 文字問答記錄自帶 count（被問次數）
   · 影像記錄補上「該病症目前社群累計次數」（即時值）
   未設定 Redis 時回 { configured:false, records:[] }，前端退回本機記錄。
   ============================================================ */
const store = require('./_store');

const REC_INDEX = 'rec:z';

module.exports = async (req, res) => {
  if (!store.isConfigured()) {
    res.status(200).json({ configured: false, records: [] });
    return;
  }
  try {
    const limit = Math.min(parseInt((req.query && req.query.limit) || '60', 10) || 60, 100);
    const ids = await store.zrevrange(REC_INDEX, 0, limit - 1);   // 最新在前
    if (!ids || !ids.length) {
      res.status(200).json({ configured: true, records: [] });
      return;
    }
    const vals = await store.mget(ids);
    const records = [];
    const condIds = new Set();
    vals.forEach((v) => {
      if (!v) return;
      try {
        const r = JSON.parse(v);
        records.push(r);
        if (r.type === 'image' && r.condId) condIds.add(r.condId);
      } catch (e) { /* 略過壞資料 */ }
    });

    // 影像記錄補上即時的病症累計次數
    if (condIds.size) {
      const cids = [...condIds];
      const counts = await store.mget(cids.map((c) => 'imgc:' + c));
      const map = {};
      cids.forEach((c, i) => { map[c] = parseInt(counts[i] || '0', 10) || 0; });
      records.forEach((r) => {
        if (r.type === 'image' && r.condId) r.count = map[r.condId] || r.count || 1;
      });
    }

    res.status(200).json({ configured: true, records });
  } catch (err) {
    res.status(500).json({ error: '讀取失敗', detail: String(err.message || err) });
  }
};
