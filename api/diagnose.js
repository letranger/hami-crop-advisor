/* ============================================================
   /api/diagnose — 後端診斷端點（Vercel Serverless Function）
   ------------------------------------------------------------
   目前：回傳「模擬結果」，讓前後端能先接起來測試。
   之後接真 AI 時，在下方 TODO 區塊實作：
     1. 視覺辨識（Gemini Vision 或 Claude 視覺）→ 判斷病名 + 信心度
     2. RAG：用病名到知識庫撈出管理建議
   ⚠️ API 金鑰只放在這裡（伺服器端），用環境變數讀取，
      「絕對不要」寫進前端程式或進版控。Vercel 後台：
      Settings → Environment Variables 設定 GEMINI_API_KEY / ANTHROPIC_API_KEY。
   ============================================================ */

// 知識庫（RAG 資料來源，雛形先內建；日後可改讀外部檔或向量庫）
const KNOWLEDGE = {
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
    // const { image } = req.body;   // Vercel 已自動解析 JSON body

    /* ===== TODO：正式版在此實作 =====================================
       1) 視覺辨識（擇一）：
          const key = process.env.GEMINI_API_KEY;      // 或 ANTHROPIC_API_KEY
          呼叫模型，傳入 image，取得 { id, conf }
       2) RAG：const kb = KNOWLEDGE[id]; 取出 name / advice
       完成後回傳 { id, conf }（前端 renderResult 會用 id 去 KNOWLEDGE 找建議）
       =============================================================== */

    // --- 暫時：回傳模擬結果，讓部署後即可看到完整流程 ---
    const demo = [
      { id: 'powdery',  conf: 87 },
      { id: 'downy',    conf: 92 },
      { id: 'nitrogen', conf: 74 },
      { id: 'healthy',  conf: 96 },
    ];
    const pick = demo[Math.floor(Math.random() * demo.length)];

    res.status(200).json({
      ...pick,
      name: KNOWLEDGE[pick.id].name,
      advice: KNOWLEDGE[pick.id].advice,
      mock: true, // 提醒前端：這是模擬結果
    });
  } catch (err) {
    res.status(500).json({ error: '診斷失敗', detail: String(err) });
  }
};
