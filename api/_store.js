/* ============================================================
   api/_store.js — 極簡 Upstash Redis(REST) 用戶端
   ------------------------------------------------------------
   · native fetch、零 npm 相依（與本專案其餘後端一致）
   · 支援 Upstash 原生 或 Vercel KV 兩種環境變數命名
   · 未設定金鑰時 isConfigured()=false → 呼叫端優雅退回，
     維持「每次即時查詢、單機 localStorage」的原行為，App 不會壞
   ============================================================ */
/* 自動偵測 Upstash/KV 的環境變數：先認常見名稱，找不到再掃描任何
   以 REST_URL / REST_API_URL 結尾的鍵（token 同理，且排除唯讀 token）。
   如此無論 Vercel 整合用什麼前綴都能接上。 */
function envBy(re, avoid) {
  const k = Object.keys(process.env).find(
    (k) => re.test(k) && (!avoid || !avoid.test(k)) && process.env[k]
  );
  return k ? process.env[k] : '';
}
const BASE =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL ||
  envBy(/(^|_)REST_API_URL$/) || envBy(/(^|_)REST_URL$/) || '';
const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN ||
  envBy(/(^|_)REST_API_TOKEN$/, /READ_ONLY/) || envBy(/(^|_)REST_TOKEN$/, /READ_ONLY/) || '';

function isConfigured() { return !!(BASE && TOKEN); }

async function cmd(args) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`Redis ${args[0]} 失敗 (${r.status})`);
  return (await r.json()).result;
}

const get       = (k)         => cmd(['GET', k]);
const set       = (k, v)      => cmd(['SET', k, v]);
const setEx     = (k, v, sec) => cmd(['SET', k, v, 'EX', String(sec)]);
const incr      = (k)         => cmd(['INCR', k]);
const zadd      = (k, sc, m)  => cmd(['ZADD', k, String(sc), m]);
const zrevrange = (k, a, b)   => cmd(['ZREVRANGE', k, String(a), String(b)]);
const ztrim     = (k, keepN)  => cmd(['ZREMRANGEBYRANK', k, '0', String(-keepN - 1)]); // 只留分數最高(最新)的 keepN 筆
const mget      = (keys)      => (keys.length ? cmd(['MGET', ...keys]) : Promise.resolve([]));

/* 問題正規化：去頭尾空白、去所有內部空白、小寫、去尾端標點 →
   讓「小黃瓜 多久澆水？」與「小黃瓜多久澆水」視為同一題 */
function normalizeQ(q) {
  return String(q || '').trim().toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[?？。！!，,、；;：:.]+$/u, '');
}
/* djb2 → base36 短雜湊，當 Redis key（避免中文/標點進 key 造成問題）*/
function hashQ(q) {
  const s = normalizeQ(q);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

module.exports = {
  isConfigured, cmd, get, set, setEx, incr, zadd, zrevrange, ztrim, mget,
  normalizeQ, hashQ,
};
