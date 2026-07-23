/* ============================================================
   api/admin-clean — 一次性維護：刪除「測試用」影像記錄（縮圖極短者）
   ------------------------------------------------------------
   透過 curl 灌入的測試資料縮圖只有幾十字元（如 base64,AAAA），
   真實拍照縮圖為數 KB。本端點刪除 thumb 長度 < 200 的影像記錄，
   並修正對應病症計數。用完即刪除本檔。
   需帶 ?key=purge-test-7f3a 才會執行。
   ============================================================ */
const store = require('./_store');

module.exports = async (req, res) => {
  if (!store.isConfigured()) { res.status(200).json({ ok: false, reason: 'store 未設定' }); return; }
  if ((req.query && req.query.key) !== 'purge-test-7f3a') { res.status(403).json({ error: '需要正確的 key' }); return; }
  try {
    const ids = await store.zrevrange('rec:z', 0, 299);
    const vals = await store.mget(ids);
    const removed = [];
    const condDec = {};
    for (let i = 0; i < ids.length; i++) {
      const v = vals[i]; if (!v) continue;
      let r; try { r = JSON.parse(v); } catch (e) { continue; }
      if (r.type === 'image' && (r.thumb || '').length < 200) {
        await store.cmd(['ZREM', 'rec:z', ids[i]]);
        await store.cmd(['DEL', ids[i]]);
        removed.push({ cond: r.cond, conf: r.conf, thumbLen: (r.thumb || '').length });
        if (r.condId) condDec[r.condId] = (condDec[r.condId] || 0) + 1;
      }
    }
    for (const c in condDec) await store.cmd(['DECRBY', 'imgc:' + c, String(condDec[c])]);
    res.status(200).json({ ok: true, removedCount: removed.length, removed, condDec });
  } catch (err) {
    res.status(500).json({ error: '清理失敗', detail: String(err.message || err) });
  }
};
