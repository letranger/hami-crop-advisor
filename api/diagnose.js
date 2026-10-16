/* ============================================================
   /api/diagnose — 後端診斷端點（Vercel Serverless Function）
   ------------------------------------------------------------
   資料流：照片 → (1) 視覺辨識判病名 → (2) RAG 依病名撈管理建議 → 回傳
     · (1) 視覺辨識：_rag.classifyImage — Gemini Vision 看圖，失敗時退到
           Groq Llama 4 Scout。回傳類別 id、信心度、實際看到的病徵。
     · (2) RAG：用病名＋病徵到 kb.json（栽培手冊）檢索、由 Groq 產生管理建議。
           若尚未建索引 / 未設金鑰，退回內建 FALLBACK 建議。

   ⚠️ API 金鑰只在此（伺服器端）以 process.env 讀取，絕對不要寫進前端或進版控。
   ============================================================ */

const { search, generate, classifyImage } = require('./_rag');

// 沒有 kb.json / 未設金鑰時的保底建議（讓部署後仍可展示完整流程）。
const FALLBACK = {
  powdery:  { name: '白粉病',   advice: '建議先檢查葉面、通風與濕度，必要時採取防治措施。' },
  downy:    { name: '露菌病',   advice: '摘除病葉並帶離溫室銷毀，降低夜間濕度、加強通風，發病初期輪替施用合格防治資材。' },
  nitrogen: { name: '葉片黃化 / 缺肥', advice: '適量追施氮肥、少量多次，檢查根系與排水，並對照環境數據確認並非水分逆境。' },
  crack:    { name: '果實龜裂 / 裂果', advice: '穩定土壤水分、避免忽乾忽濕，採收前適度控水，補充鈣質強化果皮。' },
  curl:     { name: '葉片捲曲', advice: '檢查葉背是否有薊馬 / 蚜蟲，懸掛黏蟲板監測，並確認高溫日照是否造成生理捲葉。' },
  pest:     { name: '薊馬 / 蚜蟲', advice: '懸掛黏蟲板監測密度、清除周邊雜草減少寄主，必要時輪替使用合格藥劑。' },
  healthy:  { name: '植株健康', advice: '維持現行栽培管理，持續記錄環境數據，定期巡檢、早期發現。' },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed，請用 POST' });
    return;
  }

  try {
    // 前端會傳來 { image: "data:image/...;base64,..." }（前端已縮到長邊 1024px）
    const { image } = req.body || {};
    if (!image || !/^data:image\//.test(image)) {
      res.status(400).json({ error: '缺少 image（需為 data:image/...;base64 格式）' });
      return;
    }

    /* ===== (1) 視覺辨識：看圖判病 ================================= */
    const v = await classifyImage(image);   // { id, name, conf, symptom, provider }

    if (v.id === 'none') {
      // 照片裡沒有植物：不跑 RAG、不給病名
      res.status(200).json({ id: 'none', conf: v.conf, name: v.name, symptom: v.symptom,
        advice: '', sources: [], visionMock: false, ragAdvice: false, provider: v.provider });
      return;
    }

    const name = (FALLBACK[v.id] || {}).name || v.name;

    /* ===== (2) RAG — 依病名＋看到的病徵撈管理建議 ===================== */
    let advice = (FALLBACK[v.id] || {}).advice || '';
    let sources = [];
    let rag = false;
    try {
      const hits = await search(`${name} 的成因與管理防治建議`, 4);
      const seen = v.symptom ? `照片中看到：${v.symptom}。` : '';
      advice = await generate(
        v.id === 'healthy'
          ? `哈密瓜（或溫室瓜果）植株目前看起來健康。${seen}請給農友維持健康、預防病蟲害的日常管理建議，精簡 3～5 點。`
          : `哈密瓜（或溫室瓜果）疑似「${name}」。${seen}請給農友具體的管理與防治建議，精簡 3～5 點。`,
        hits);
      sources = hits.map((h) => ({ crop: h.crop, page: h.page }));
      rag = true;
    } catch (e) {
      console.warn('RAG 建議退回內建版本：', e.message);
    }

    res.status(200).json({
      id: v.id,
      conf: v.conf,
      name,
      symptom: v.symptom,   // 模型在照片裡實際看到的病徵（一句話）
      advice,
      sources,
      visionMock: false,    // 病名判讀已是真實視覺模型
      provider: v.provider, // gemini | groq（哪一家看的圖）
      ragAdvice: rag,       // true = 建議來自手冊檢索；false = 內建保底建議
    });
  } catch (err) {
    res.status(500).json({ error: '診斷失敗', detail: String(err.message || err) });
  }
};
