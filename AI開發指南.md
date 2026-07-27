# 用 ChatGPT 繼續開發本專案 · 學生上手指南

這份說明教你在**完全不用安裝任何軟體**的情況下，用 ChatGPT 幫你改程式、並讓網站自動更新上線。

> 一句話流程：
> **想要改什麼 → 問 ChatGPT 給你程式碼 → 貼回 GitHub → 網站幾十秒後自動更新。**

---

## 〇、你需要準備的三個帳號

| 服務 | 用途 | 誰負責 |
|------|------|--------|
| **GitHub** | 存放全部程式碼；在網頁上直接改檔案 | 你（請老師把你加為 repo 的 Collaborator）|
| **Vercel** | 自動把 GitHub 的程式碼變成網站 | 老師已設定好、金鑰也在這裡 |
| **ChatGPT（Plus）** | 幫你寫／改程式碼 | 你 |

repo 網址：`https://github.com/letranger/hami-crop-advisor`

> 🔑 **金鑰（API Key）你完全不用碰。** 所有金鑰（Gemini、Groq 等）都放在 Vercel 後台，
> 只有伺服器看得到。**絕對不要把任何金鑰寫進程式碼**，否則會外流。

---

## 一、先讓 ChatGPT「認識」這個專案（只需做一次）

ChatGPT 看不到你的 GitHub，所以要先把專案介紹給它。用 **ChatGPT 的「Projects」** 功能：

1. 在 ChatGPT 左側點 **「Projects」→ 新增一個 Project**（例如叫「哈密瓜 App」）。
2. 打開這個 Project 的 **「Instructions（指示）」**，把 `ChatGPT-Project-指示.md`
   這個檔案的全部內容**貼進去**。（這段文字告訴 ChatGPT 專案架構、規則。）
3. 把下列**原始碼檔案上傳**到 Project 當作參考資料（在 GitHub 上每個檔案點
   「Download raw file」下載，再拖進 ChatGPT）：
   - `index.html`、`app.js`、`sw.js`、`manifest.json`
   - `api/` 裡的 7 支 `.js`（`diagnose.js`、`ask.js`、`_rag.js`、`_store.js`、
     `records.js`、`record-image.js`、`websearch.js`）
   - `package.json`、`vercel.json`
   - ⚠️ **不要上傳** `api/kb.json`（3MB、機器產生的、看不懂也不用改）
     和任何 `.env`（那是金鑰）。

做完後，之後每次在這個 Project 裡開新對話，ChatGPT 都會自帶專案背景，
你直接說「我想加一個 XXX 功能」就好。

---

## 二、日常開發流程（改一次做一次）

### 步驟 1｜跟 ChatGPT 說你要改什麼
在你的 Project 裡開對話，講清楚：**要改哪個畫面／功能、想變成怎樣**。
例如：
> 「首頁的六宮格，我想把『環境紀錄』改成綠色底、加一個溫度計圖示。請給我完整改好的 `app.js`（或告訴我改哪幾行）。」

小技巧：
- 一次只改**一件事**，改完測好再改下一件，出錯比較好找。
- 請 ChatGPT「**給我整個檔案**」或「**只給要改的那一段，並標明前後文**」，看哪種你貼起來順。
- 看不懂就問它「這段在做什麼？」——它會解釋。

### 步驟 2｜把程式碼貼回 GitHub（網頁上就能改）
1. 到 repo 找到那個檔案（例如 `app.js`）→ 點右上角**鉛筆圖示（Edit）**。
2. 把 ChatGPT 給的內容貼上去（取代原本的，或改對應的段落）。
3. 拉到最下面 → **Commit changes**（填一句說明，例如「首頁改綠色」）→ 確認。

### 步驟 3｜等 Vercel 自動更新
Commit 後 Vercel 會**自動重新部署**，大約 **30 秒～1 分鐘**，
打開網站（`https://…vercel.app`）重新整理就能看到結果。

> 手機上看：用 Safari／Chrome 開網址 → 分享 → **加入主畫面**，
> 從桌面圖示打開就像一個 App（沒有網址列）。

### 步驟 4｜壞掉了怎麼辦？
- **回到上一版**：GitHub repo →「Commits」→ 找到上一個好的版本，
  可以還原（revert）。程式在 GitHub 有完整歷史，**改壞了永遠救得回來**。
- 把**錯誤訊息**（畫面上的、或手機瀏覽器的 console）整段複製給 ChatGPT，
  它會幫你找原因。

---

## 三、這個 App 的組成（給你和 ChatGPT 的地圖）

```
index.html      整個畫面 + 樣式（CSS 直接寫在裡面）
app.js          前端邏輯：切換頁面、診斷、圖表、定位＋天氣、問答
manifest.json   PWA 設定（App 名稱、圖示、顏色）
sw.js           離線快取
icons/          App 圖示
api/            後端（只在 Vercel 上會執行，本機打不開）
  diagnose.js     拍照診斷端點  ← 影像辨識目前是「假的（模擬）」
  ask.js          問題查詢端點  ← 真的：依手冊回答（RAG）
  _rag.js         RAG 共用邏輯（語意檢索 + 產生回答）
  _store.js       診斷記錄 / 快取（Upstash Redis，選用）
  records.js      讀寫診斷記錄
  record-image.js 上傳診斷照片
  websearch.js    「上網查最新資訊」（Tavily，選用）
  kb.json         手冊的向量索引（機器產生，別手改）
```

**三種能力別搞混**（很重要，改功能時想清楚你在動哪一塊）：
1. **影像辨識（拍照診斷）** → 用多模態模型看照片猜病害。**目前是模擬的**，
   還沒接真模型（要接的話看 `api/diagnose.js` 裡的 `TODO`）。
2. **RAG（依手冊回答）** → 「問題查詢」和診斷的建議，都是去 `kb.json`
   （手冊內容）裡找最相關的段落再請 AI 統整。**這塊是真的、會運作。**
3. **感測器邏輯** → 環境數據儀表板與異常預警，**沒有用到 AI**，是單純的數字判斷。

---

## 四、可以放心做 vs. 要先問老師

✅ **放心改**：文字、顏色、版面、圖示、頁面順序、新增一個純顯示的畫面、
調整感測器的警戒數值——這些都在 `index.html` / `app.js`，改壞了也能還原。

⚠️ **先問老師**：動到 `api/` 後端、金鑰、Vercel 設定、把影像辨識接成真的
（要花 API 額度、可能有費用與安全考量）。

---

## 五、常見問題

**Q：我一定要裝 Python／Node 之類的嗎？**
不用。日常改碼只需要瀏覽器（GitHub 網頁 + ChatGPT）。
只有「**重建手冊知識庫**」這種進階工作才需要本機跑 Python，
說明在 `scripts/build_kb.py` 檔案開頭——那不是你平常會碰的。

**Q：改了 GitHub，網站沒變？**
先等 1 分鐘再重新整理；手機上把 App 從主畫面「關掉重開」（快取關係）。
還是不對就到 Vercel 後台看該次部署有沒有紅字（Failed）。

**Q：ChatGPT 給的程式碼可以直接信嗎？**
先貼上去、部署、**自己實際點點看**對不對。AI 會出錯，
所以我們才用 GitHub 記錄每一版——測不過就還原，再請它修。
