/* ============================================================
   溫室植栽專家系統 · AI Smart Crop Advisor — PWA 雛形邏輯
   目前診斷為「模擬資料」。之後接 Gemini Vision + RAG 時，只要改 diagnose() 一個函式。
   ============================================================ */

/* ---------- 知識庫（RAG 的資料來源，雛形先用內建 JSON）---------- */
const KNOWLEDGE = [
  { id:'powdery', name:'白粉病',      cat:'病害', symptom:'葉面白色粉狀物、逐漸擴散影響光合作用',
    advice:'建議先檢查葉面、通風與濕度，必要時採取防治措施。',
    tags:['病害','葉片','需留意'] },
  { id:'downy',   name:'露菌病',      cat:'病害', symptom:'葉背灰白霉層、葉面出現黃斑',
    advice:'摘除病葉並帶離溫室銷毀，降低夜間濕度、加強通風，發病初期輪替施用合格防治資材。',
    tags:['病害','葉片','需留意'] },
  { id:'nitrogen',name:'葉片黃化 / 缺肥', cat:'營養', symptom:'植株矮小、葉色淡黃、生長緩慢，如何改善？',
    advice:'適量追施氮肥、少量多次，檢查根系與排水，並對照環境數據確認並非水分逆境。',
    tags:['營養','葉片'] },
  { id:'crack',   name:'果實龜裂 / 裂果', cat:'生理障礙', symptom:'接近採收期時果實出現裂紋，影響外觀與品質。',
    advice:'穩定土壤水分、避免忽乾忽濕，採收前適度控水，補充鈣質強化果皮。',
    tags:['生理障礙','果實'] },
  { id:'curl',    name:'葉片捲曲',    cat:'蟲害', symptom:'新葉捲曲變形，可能與環境或病蟲害有關。',
    advice:'檢查葉背是否有薊馬 / 蚜蟲，懸掛黏蟲板監測，並確認高溫日照是否造成生理捲葉。',
    tags:['蟲害','葉片'] },
  { id:'pest',    name:'薊馬 / 蚜蟲', cat:'蟲害', symptom:'葉面銀白斑點、新芽捲縮',
    advice:'懸掛黏蟲板監測密度、清除周邊雜草減少寄主，必要時輪替使用合格藥劑。',
    tags:['蟲害','需留意'] },
  { id:'healthy', name:'植株健康',    cat:'管理', symptom:'葉色正常、無明顯病徵',
    advice:'維持現行栽培管理，持續記錄環境數據，定期巡檢、早期發現。',
    tags:['管理'] },
];

/* 雛形展示用：輪流回傳幾個示範案例（模擬 AI 判讀結果）*/
const DEMO_CASES = [
  { id:'powdery',  conf:87 },
  { id:'downy',    conf:92 },
  { id:'nitrogen', conf:74 },
  { id:'healthy',  conf:96 },
];
let demoIdx = 0;

/* ---------- 導覽 ---------- */
function go(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id===id));
  // 問題查詢(search)歸在「建議」分頁底下，維持底部高亮
  const navId = id==='search' ? 'advice' : id;
  document.querySelectorAll('nav .tab[data-view]').forEach(t=>t.classList.toggle('active', t.dataset.view===navId));
  window.scrollTo(0,0);
}
function toast(msg){
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2200);
}

/* ---------- 拍照 ---------- */
function openCamera(){ document.getElementById('camInput').click(); }

function onPhoto(e){
  const file=e.target.files&&e.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>runDiagnosis(reader.result);
  reader.readAsDataURL(file);
  e.target.value='';
}

/* ---------- 診斷流程 ---------- */
async function runDiagnosis(imgDataUrl){
  go('diag');
  document.getElementById('vfPhoto').src = imgDataUrl;      // 取景框顯示拍到的照片
  const card=document.getElementById('diagCard');
  card.innerHTML = `<div class="spinner"></div>
    <p style="text-align:center;color:var(--muted);font-size:13px;margin:0">AI 分析中，請稍候…</p>`;

  const result = await diagnose(imgDataUrl);
  renderResult(card, result);
}

/* ============================================================
   diagnose() — 目前回傳模擬結果。
   ↓↓↓ 接真正的 Gemini Vision + RAG 時，把這裡換成 API 呼叫即可 ↓↓↓
   ============================================================ */
async function diagnose(imgDataUrl){
  await new Promise(r=>setTimeout(r,1400));               // 模擬網路延遲
  const demo = DEMO_CASES[demoIdx % DEMO_CASES.length];
  demoIdx++;
  return demo;

  /* --- 未來正式版參考（需在「後端」呼叫，勿把金鑰放前端）---
  const res = await fetch('/api/diagnose', {              // 你的後端 serverless function
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ image: imgDataUrl })
  });
  return await res.json();   // 後端內部：Gemini Vision 判症狀 → RAG 查 KNOWLEDGE → 回傳
  */
}

function renderResult(card, r){
  const k = KNOWLEDGE.find(x=>x.id===r.id) || KNOWLEDGE[0];
  const conf = r.conf;
  const isHealthy = r.id==='healthy';
  const now = timeStamp();
  card.innerHTML = `
    <div class="diag-head"><b>🌿 AI 初步判斷</b><time>分析時間 ${now} ↻</time></div>
    <div class="diag-main">
      <div class="txt">
        <div class="cond">${isHealthy?'':'<span class="dotr">🔴</span>'}${isHealthy?'植株健康':'疑似'+k.name}</div>
        <div class="prob">可能性 <b>${conf}%</b></div>
      </div>
      ${gauge(conf)}
    </div>
    <div class="advice-box">
      <div class="h">🌱 管理建議</div>
      <p>${k.advice}</p>
    </div>
    <div class="tags">${k.tags.map(t=>`<span class="t ${t==='需留意'?'warn':''}">${t}</span>`).join('')}</div>
  `;
  toast(isHealthy?'診斷完成：植株健康 ✓':`診斷完成：疑似${k.name} ${conf}%`);
}

/* 半圓儀表（SVG）— 依信心度上色（紅→黃→綠漸層弧）*/
function gauge(pct){
  const cx=48, cy=52, r=38, sw=8;
  const a0=Math.PI, a1=0;                                  // 180° → 0°（半圓，由左至右）
  const ang=a0 + (a1-a0)*(pct/100);
  const pt=( a)=>[cx+r*Math.cos(a), cy+r*Math.sin(a)*-1];  // y 反向讓半圓朝上
  const [sx,sy]=pt(a0), [ex,ey]=pt(a1), [px,py]=pt(ang);
  const large = pct>50 ? 0 : 0;                            // 半圓弧永遠 <180°
  const color = pct>=80?'#d9534f': pct>=55?'#e8912f':'#2f9e5a';
  return `<svg class="gauge" viewBox="0 0 96 60">
    <defs><linearGradient id="gg" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#2f9e5a"/><stop offset="0.55" stop-color="#e8b62f"/><stop offset="1" stop-color="#d9534f"/>
    </linearGradient></defs>
    <path d="M${sx},${sy} A${r},${r} 0 0 1 ${ex},${ey}" fill="none" stroke="#eef3ee" stroke-width="${sw}" stroke-linecap="round"/>
    <path d="M${sx},${sy} A${r},${r} 0 ${large} 1 ${px},${py}" fill="none" stroke="url(#gg)" stroke-width="${sw}" stroke-linecap="round"/>
    <circle cx="${px}" cy="${py}" r="4.5" fill="#fff" stroke="${color}" stroke-width="2.5"/>
    <text x="${cx}" y="46" text-anchor="middle" font-size="17" font-weight="900" fill="${color}">${pct}%</text>
    <text x="${cx}" y="57" text-anchor="middle" font-size="8.5" font-weight="700" fill="#7c8b81">可能性</text>
  </svg>`;
}

function timeStamp(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return `${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- 問題查詢（症狀選單 / 知識庫）---------- */
const HOT = [
  {t:'葉片黃化',ic:'🌿'},{t:'白粉病',ic:'🍈'},{t:'葉片捲曲',ic:'🌱'},{t:'果實裂果',ic:'🍈'},
  {t:'生長停滯',ic:'🌱'},{t:'蟲害',ic:'🐛'},{t:'缺肥',ic:'🧪'},{t:'灌溉問題',ic:'💧'},
];
const CATS = ['全部','病害','蟲害','營養','環境','管理'];
let curCat = '全部';

function renderSearch(){
  document.getElementById('hotChips').innerHTML =
    HOT.map(h=>`<span class="hc" onclick="quickSearch('${h.t}')">${h.ic} ${h.t}</span>`).join('');
  document.getElementById('filterRow').innerHTML =
    CATS.map(c=>`<button class="f ${c===curCat?'on':''}" onclick="setCat('${c}')">${c}</button>`).join('');
  filterQA();
}
function setCat(c){ curCat=c; renderSearch(); }
function quickSearch(t){ document.getElementById('searchInput').value=t; filterQA(); }

function filterQA(){
  const q=(document.getElementById('searchInput').value||'').trim();
  const rows = KNOWLEDGE.filter(k=>k.id!=='healthy')
    .filter(k=> curCat==='全部' || k.cat.includes(curCat) || (curCat==='病害'&&k.cat==='病害') || (curCat==='環境'&&/環境|灌溉/.test(k.symptom)))
    .filter(k=> !q || (k.name+k.symptom+k.cat).includes(q));
  const icon = c => c==='蟲害'?'🐛': c==='營養'?'🌱': c.includes('生理')?'🍈':'🌿';
  const list = document.getElementById('qaList');
  list.innerHTML = rows.length ? rows.map(k=>`
    <div class="qa" onclick="toast('${k.name}：${k.advice}')">
      <div class="ic">${icon(k.cat)}</div>
      <div class="txt"><b>${qaTitle(k)}</b><span>${k.symptom}</span><span class="pill ${k.cat==='管理'?'ok':k.cat==='營養'?'mid':'warn'}" style="display:inline-block">${k.cat}</span></div>
      <span class="chev">›</span>
    </div>`).join('')
    : `<div class="card" style="text-align:center;color:var(--muted);font-size:13px">找不到符合「${q}」的結果，換個關鍵字試試。</div>`;
}
function qaTitle(k){
  const map={powdery:'葉片出現白色粉狀物怎麼辦？',downy:'葉背發霉、葉面黃斑是什麼病？',
    nitrogen:'植株長勢變弱是否缺肥？',crack:'果實表面龜裂可能原因？',
    curl:'哈密瓜葉片捲曲要先檢查什麼？',pest:'葉面出現銀白斑點怎麼處理？'};
  return map[k.id] || k.name;
}

/* ============================================================
   askAI() — 問題查詢的 RAG：把問題送到 /api/ask，
   由後端檢索 8 本栽培手冊 + Gemini 產生繁中回答（附引用來源）。
   後端未部署 / 未建索引時會回傳錯誤，這裡以提示訊息優雅退回。
   ============================================================ */
function esc(s){ return (s||'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

/* 點進搜尋框準備問新問題時：若上一題的 AI 回答還在，自動清空舊輸入與舊回答，
   不必手動刪除。（還沒問過、沒有回答卡時不動作，避免干擾一般編輯／關鍵字查詢。）*/
function onSearchFocus(){
  const box = document.getElementById('aiAnswer');
  if(box && box.querySelector('.ai-card')){
    document.getElementById('searchInput').value = '';
    box.innerHTML = '';
    filterQA();
  }
}

async function askAI(){
  const q = (document.getElementById('searchInput').value||'').trim();
  const box = document.getElementById('aiAnswer');
  if(!q){ toast('請先輸入問題'); return; }

  box.innerHTML = `<div class="ai-card"><div class="ai-spin">
    <span class="dot"></span>AI 正在查閱栽培手冊…</div></div>`;

  try{
    const res = await fetch('/api/ask', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ question:q })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.detail || data.error || ('HTTP '+res.status));

    const src = (data.sources||[])
      .map(s=>`<span class="src-chip">${esc(s.crop)}·第${s.page}頁</span>`).join('');
    box.innerHTML = `<div class="ai-card">
      <div class="ai-head">🤖 AI 依手冊回答</div>
      <div class="ai-body">${esc(data.answer)}</div>
      ${src?`<div class="ai-src"><b>參考來源</b><br>${src}</div>`:''}
    </div>`;
  }catch(err){
    box.innerHTML = `<div class="ai-card">
      <div class="ai-head">🤖 AI 問答</div>
      <div class="ai-body" style="color:var(--muted)">目前無法取得 AI 回答：${esc(String(err.message||err))}<br><br>請稍後再試，或用下方關鍵字查詢。</div>
    </div>`;
  }
}

/* ============================================================
   askWeb() — 「上網查」模式：把問題送到 /api/websearch，
   由後端用 Tavily 搜尋網路 + Groq 綜合整理。答案標示「來自網路、僅供參考」，
   並附可點擊的網路來源連結（與依手冊回答分開，避免混淆可信度）。
   ============================================================ */
async function askWeb(){
  const q = (document.getElementById('searchInput').value||'').trim();
  const box = document.getElementById('aiAnswer');
  if(!q){ toast('請先輸入問題'); return; }

  box.innerHTML = `<div class="ai-card web"><div class="ai-spin">
    <span class="dot"></span>AI 正在上網查詢…</div></div>`;

  try{
    const res = await fetch('/api/websearch', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ question:q })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.detail || data.error || ('HTTP '+res.status));

    const src = (data.sources||[])
      .map(s=>`<a class="src-link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join('');
    box.innerHTML = `<div class="ai-card web">
      <div class="ai-head">🌐 網路查詢結果（僅供參考，非栽培手冊）</div>
      <div class="ai-body">${esc(data.answer)}</div>
      ${src?`<div class="ai-src"><b>網路來源</b><br>${src}</div>`:''}
    </div>`;
  }catch(err){
    box.innerHTML = `<div class="ai-card web">
      <div class="ai-head">🌐 網路查詢</div>
      <div class="ai-body" style="color:var(--muted)">目前無法上網查詢：${esc(String(err.message||err))}<br><br>請稍後再試，或改用「依栽培手冊回答」。</div>
    </div>`;
  }
}

/* ---------- 溫度 / 濕度雙線趨勢圖（SVG）---------- */
function renderChartTH(){
  const temp=[22.6,21.9,21.5,22.2,24.1,26.8,28.4,29.1,28.6,27.4,26.0,24.6,23.4];
  const humi=[62,64,66,63,58,54,67,71,74,70,66,63,60];
  const w=440,h=150,padL=30,padR=30,padT=10,padB=22, n=temp.length;
  const tMin=15,tMax=35, hMin=0,hMax=100;
  const x=i=>padL + i*(w-padL-padR)/(n-1);
  const yT=v=>padT + (tMax-v)/(tMax-tMin)*(h-padT-padB);
  const yH=v=>padT + (hMax-v)/(hMax-hMin)*(h-padT-padB);
  const path=(arr,yf)=>arr.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${yf(v).toFixed(1)}`).join(' ');
  const grid=[15,20,25,30,35].map(t=>{
    const yy=yT(t);
    return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#eef3ee" stroke-width="1"/>
      <text x="4" y="${yy+3}" font-size="8" fill="#9caaa1">${t}°C</text>`;
  }).join('');
  const rAxis=[0,25,50,75,100].map(hv=>`<text x="${w-padR+3}" y="${yH(hv)+3}" font-size="8" fill="#9caaa1">${hv}%</text>`).join('');
  const xlab=['00:00','04:00','08:00','12:00','16:00','20:00','24:00'];
  const xax=xlab.map((l,i)=>`<text x="${padL + i*(w-padL-padR)/6}" y="${h-6}" font-size="8" fill="#9caaa1" text-anchor="middle">${l}</text>`).join('');
  // 高亮 08:30（index 6 附近）
  const hi=6;
  document.getElementById('chartTH').innerHTML=`
    <svg viewBox="0 0 ${w} ${h}">
      ${grid}${rAxis}
      <line x1="${x(hi)}" y1="${padT}" x2="${x(hi)}" y2="${h-padB}" stroke="#cdd8d0" stroke-width="1" stroke-dasharray="3 3"/>
      <path d="${path(humi,yH)}" fill="none" stroke="#3b82c4" stroke-width="2" stroke-linejoin="round"/>
      <path d="${path(temp,yT)}" fill="none" stroke="#2f9e5a" stroke-width="2.4" stroke-linejoin="round"/>
      <circle cx="${x(hi)}" cy="${yT(temp[hi])}" r="3.5" fill="#2f9e5a" stroke="#fff" stroke-width="1.5"/>
      <circle cx="${x(hi)}" cy="${yH(humi[hi])}" r="3.5" fill="#3b82c4" stroke="#fff" stroke-width="1.5"/>
      <g transform="translate(${x(hi)-24},${padT-2})">
        <rect x="0" y="0" width="66" height="34" rx="7" fill="#fff" stroke="#e5ece6"/>
        <text x="8" y="14" font-size="8.5" fill="#7c8b81">08:30</text>
        <text x="8" y="25" font-size="9" font-weight="800" fill="#2f9e5a">🟢 ${temp[hi]}°C</text>
        <text x="40" y="25" font-size="9" font-weight="800" fill="#3b82c4">🔵 ${humi[hi]}%</text>
      </g>
      ${xax}
    </svg>`;
}

/* ---------- 土壤水分趨勢（面積圖 + 灌溉標記）---------- */
function renderChartSoil(){
  const data=[50,48,45,43,41,39,37,45,42,39,36,33,30,28,26];  // %，中間灌溉後回升
  const w=440,h=140,padL=30,padR=12,padT=10,padB=22, n=data.length;
  const min=0,max=60;
  const x=i=>padL + i*(w-padL-padR)/(n-1);
  const y=v=>padT + (max-v)/(max-min)*(h-padT-padB);
  const line=data.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area=`${line} L${x(n-1)},${y(min)} L${x(0)},${y(min)} Z`;
  const grid=[0,20,40,60].map(g=>{const yy=y(g);
    return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#eef3ee"/>
      <text x="4" y="${yy+3}" font-size="8" fill="#9caaa1">${g}%</text>`;}).join('');
  const irrig=[7,11].map(i=>`<line x1="${x(i)}" y1="${padT}" x2="${x(i)}" y2="${h-padB}" stroke="#3b82c4" stroke-width="1.2" stroke-dasharray="3 3"/>`).join('');
  const xlab=['00:00','04:00','08:00','12:00','16:00','20:00','24:00'];
  const xax=xlab.map((l,i)=>`<text x="${padL + i*(w-padL-padR)/6}" y="${h-6}" font-size="8" fill="#9caaa1" text-anchor="middle">${l}</text>`).join('');
  document.getElementById('chartSoil').innerHTML=`
    <svg viewBox="0 0 ${w} ${h}">
      <defs><linearGradient id="gs" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4a9d55" stop-opacity=".32"/><stop offset="1" stop-color="#4a9d55" stop-opacity="0"/></linearGradient></defs>
      ${grid}${irrig}
      <path d="${area}" fill="url(#gs)"/>
      <path d="${line}" fill="none" stroke="#3f9a52" stroke-width="2.4" stroke-linejoin="round"/>
      ${xax}
    </svg>`;
}

/* ============================================================
   定位 + 當地天氣（純前端、免金鑰）
   · 定位：navigator.geolocation
   · 地名：BigDataCloud 反向地理編碼（免金鑰、支援中文）
   · 天氣：Open-Meteo（免金鑰、支援 CORS）
   ⚠️ 需在 HTTPS 下才可定位（GitHub Pages / Vercel / localhost 皆可；
      用區網 IP 的 http 測試會被瀏覽器擋住）。
   ============================================================ */

/* WMO 天氣代碼 → 中文 + emoji */
function weatherInfo(code){
  const m = {
    0:['晴','☀️'], 1:['晴時多雲','🌤️'], 2:['多雲','⛅'], 3:['陰','☁️'],
    45:['有霧','🌫️'], 48:['霧淞','🌫️'],
    51:['毛毛雨','🌦️'], 53:['小雨','🌦️'], 55:['毛毛雨','🌧️'],
    56:['凍雨','🌧️'], 57:['凍雨','🌧️'],
    61:['小雨','🌧️'], 63:['中雨','🌧️'], 65:['大雨','🌧️'],
    66:['凍雨','🌧️'], 67:['凍雨','🌧️'],
    71:['小雪','🌨️'], 73:['中雪','🌨️'], 75:['大雪','❄️'], 77:['霰','🌨️'],
    80:['陣雨','🌦️'], 81:['陣雨','🌧️'], 82:['強陣雨','⛈️'],
    85:['陣雪','🌨️'], 86:['大陣雪','❄️'],
    95:['雷雨','⛈️'], 96:['雷雨伴冰雹','⛈️'], 99:['強雷雨','⛈️'],
  };
  return m[code] || ['—','🌡️'];
}

/* 依天氣給農務提醒（呼應 白粉病 / 露菌病 / 高溫 主題）*/
function farmTip(w){
  const hum = w.humidity, rain = w.rainProb, temp = w.temp, wind = w.wind, code = w.code;
  if(rain>=60 || code>=61){
    return '降雨機率偏高，注意溫室排水與通風；雨後濕度上升，慎防露菌病、白粉病。';
  }
  if(hum>=85){
    return '空氣濕度偏高，白粉病、露菌病風險上升，建議加強通風並巡檢葉背。';
  }
  if(temp>=34){
    return '氣溫偏高，留意植株水分與遮陰，避免高溫造成落花或日燒。';
  }
  if(wind>=40){
    return '風速較強，請檢查棚架與防蟲網固定，並注意植株倒伏。';
  }
  return '天氣狀況穩定，維持日常巡檢與環境紀錄即可。';
}

async function initLocationWeather(){
  const chip = document.getElementById('locChip');
  if(!('geolocation' in navigator)){
    document.getElementById('wxText').textContent = '此裝置不支援定位';
    return;
  }
  chip.textContent = '📍 定位中…';
  document.getElementById('wxText').textContent = '取得當地天氣中…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude:lat, longitude:lon } = pos.coords;
      reverseGeocode(lat, lon);
      fetchWeather(lat, lon);
    },
    err => {
      chip.textContent = '📍 雲林縣 · 斗六市（預設）';
      document.getElementById('wxText').textContent =
        err.code===1 ? '未授權定位，點膠囊可再試一次' : '無法取得位置';
    },
    { enableHighAccuracy:false, timeout:8000, maximumAge:600000 }
  );
}

async function reverseGeocode(lat, lon){
  const chip = document.getElementById('locChip');
  try{
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`);
    const d = await r.json();
    const parts = [d.principalSubdivision || d.city, d.locality || d.city].filter(Boolean);
    // 去掉重複（有時 city 與 locality 相同）
    const uniq = [...new Set(parts)];
    chip.textContent = '📍 ' + (uniq.join(' · ') || '目前位置');
  }catch(e){
    chip.textContent = '📍 目前位置';
  }
}

async function fetchWeather(lat, lon){
  try{
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m'
      + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + '&timezone=auto';
    const r = await fetch(url);
    const d = await r.json();
    const c = d.current, day = d.daily;
    const [text, icon] = weatherInfo(c.weather_code);
    const w = {
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      humidity: Math.round(c.relative_humidity_2m),
      wind: Math.round(c.wind_speed_10m),
      rainProb: day.precipitation_probability_max?.[0] ?? 0,
      hi: Math.round(day.temperature_2m_max?.[0]),
      lo: Math.round(day.temperature_2m_min?.[0]),
      code: c.weather_code, text, icon,
    };
    renderWeather(w);
  }catch(e){
    document.getElementById('wxText').textContent = '無法取得天氣資料';
    document.getElementById('wxSub').textContent = '請確認網路連線';
  }
}

function renderWeather(w){
  document.getElementById('wxIcon').textContent = w.icon;
  document.getElementById('wxTemp').innerHTML = `${w.temp}<small>°C</small>`;
  document.getElementById('wxText').textContent = w.text;
  document.getElementById('wxSub').textContent = `體感 ${w.feels}° · 濕度 ${w.humidity}%`;
  document.getElementById('wxRain').textContent = `${w.rainProb}%`;
  document.getElementById('wxWind').textContent = `${w.wind} km/h`;
  document.getElementById('wxRange').textContent = `${w.hi}° / ${w.lo}°`;
  document.getElementById('wxTipText').textContent = farmTip(w);
  document.getElementById('wxTip').classList.add('show');
}

/* ---------- 啟動 ---------- */
document.getElementById('homeUpd').textContent = '更新時間 ' + timeStamp();
renderSearch();
renderChartTH();
renderChartSoil();
initLocationWeather();                    // 進入即嘗試定位 + 取天氣（使用者會看到授權提示）
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
