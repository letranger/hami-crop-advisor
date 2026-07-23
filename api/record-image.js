/* ============================================================
   api/record-image — 拍照診斷結果上傳到共享記錄（Vercel Serverless）
   ------------------------------------------------------------
   前端每次拍照診斷完 POST { condId, cond, conf, healthy, thumb }。
   · 對該病症計次（imgc:<condId>）→ 卡片顯示「社群已診斷 N 次」
   · 存單筆事件（含縮圖）並加入共享索引 rec:z
   未設定 Redis 時回 { ok:false, skipped:true }，前端照常用本機記錄。
   ============================================================ */
const store = require('./_store');

const REC_INDEX = 'rec:z';
const REC_KEEP  = 300;
const REC_TTL   = 60 * 60 * 24 * 30; // 30 天
const THUMB_MAX = 40000;             // 縮圖上限（約 40KB base64），保護儲存空間

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed，請用 POST' });
    return;
  }
  if (!store.isConfigured()) {
    res.status(200).json({ ok: false, skipped: true });
    return;
  }
  try {
    const { condId, cond, conf, healthy, thumb, advice } = req.body || {};
    if (!condId || !cond) {
      res.status(400).json({ error: '缺少 condId / cond' });
      return;
    }
    const count = await store.incr('imgc:' + condId);   // 該病症社群累計次數
    const now = Date.now();
    const id = 'img:' + now.toString(36) + Math.random().toString(36).slice(2, 6);
    const rec = {
      type: 'image', condId, cond,
      conf: Number(conf) || 0,
      healthy: !!healthy,
      advice: String(advice || '').slice(0, 500),
      thumb: (thumb || '').slice(0, THUMB_MAX),
      count, ts: now,
    };
    await store.setEx(id, JSON.stringify(rec), REC_TTL);
    await store.zadd(REC_INDEX, await store.incr('rec:seq'), id);
    await store.ztrim(REC_INDEX, REC_KEEP);
    res.status(200).json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: '儲存失敗', detail: String(err.message || err) });
  }
};
