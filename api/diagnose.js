/* ============================================================
   /api/diagnose — 後端診斷端點（Vercel Serverless Function）
   ------------------------------------------------------------
   資料流：照片 → (1) 視覺辨識判病名 → (2) RAG 依病名撈管理建議 → 回傳
     · (1) 視覺辨識目前仍為「模擬」：隨機挑一個示範病名 + 信心度。
           要接真 AI 時，只需在下方 TODO 換成 Gemini Vision 呼叫。
     · (2) RAG 已接上：用病名到 kb.json（8 本栽培手冊）檢索、由 Gemini
           產生管理建議。若尚未建索引 / 未設金鑰，退回內建 FALLBACK 建議。

   ⚠️ API 金鑰只在此（伺服器端）以 process.env.GEMINI_API_KEY 讀取，
      絕對不要寫進前端或進版控。
   ============================================================ */

const { search, generate } = require('./_rag');

// 沒有 kb.json / 未設金鑰時的保底建議（讓部署後仍可展示完整流程）。
const FALLBACK = {
  powdery:  { name: '白粉病',   advice: '建議先檢查葉面、通風與濕度，必要時採取防治措施。' },
  downy:    { name: '露菌病',   advice: '摘除病葉並帶離溫室銷毀，降低夜間濕度、加強通風，發病初期輪替施用合格防治資材。' },
  nitrogen: { name: '葉片黃化', advice: '適量追施氮肥、少量多次，檢查根系與排水，並對照環境數據確認並非水分逆境。' },
  healthy:  { name: '植株健康', advice: '維持現行栽培管理，持續記錄環境數據，定期巡檢、早期發現。' },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed，請用 POST' });
    return;
  }

  try {
    // 前端會傳來 { image: "data:image/...;base64,..." }
    // const { image } = req.body;

    /* ===== (1) 視覺辨識 — 目前為模擬 ================================
       正式版：呼叫 Gemini Vision，傳入 image，取得 { id, conf, name }。
       完成後把下面這段隨機挑選換掉即可，其餘 (2) RAG 流程可原封不動。 */
    const demo = [
      { id: 'powdery',  conf: 87 },
      { id: 'downy',    conf: 92 },
      { id: 'nitrogen', conf: 74 },
      { id: 'healthy',  conf: 96 },
    ];
    const pick = demo[Math.floor(Math.random() * demo.length)];
    const name = FALLBACK[pick.id].name;

    /* ===== (2) RAG — 依病名撈管理建議 ============================== */
    let advice = FALLBACK[pick.id].advice;
    let sources = [];
    let rag = false;
    try {
      const hits = await search(`${name} 的成因與管理防治建議`, 4);
      advice = await generate(`哈密瓜（或溫室作物）出現「${name}」，請給農友具體的管理與防治建議。`, hits);
      sources = hits.map((h) => ({ crop: h.crop, page: h.page }));
      rag = true;
    } catch (e) {
      // kb.json 未建 / 未設金鑰 → 用 FALLBACK 建議，不讓整個診斷失敗。
      console.warn('RAG 建議退回內建版本：', e.message);
    }

    res.status(200).json({
      id: pick.id,
      conf: pick.conf,
      name,
      advice,
      sources,
      visionMock: true,   // 提醒前端：病名判讀目前仍是模擬
      ragAdvice: rag,     // true = 建議來自手冊檢索；false = 內建保底建議
    });
  } catch (err) {
    res.status(500).json({ error: '診斷失敗', detail: String(err.message || err) });
  }
};
