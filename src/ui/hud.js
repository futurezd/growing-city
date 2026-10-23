// Top bar (construction caption, progress, skip / replay), stats panel with history chart, and event toasts.
const WEATHER_TXT = { clear: ['☀', '晴'], rain: ['☂', '雨'], snow: ['❄', '雪'] };
const TOD_TXT = { day: '白天', dusk: '黄昏', night: '夜晚' };
const SEASON_TXT = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const pad = n => String(n).padStart(2, '0');

export function mountHud(root, sim, view) {
  root.insertAdjacentHTML('beforeend', `
  <header class="topbar">
    <div class="brand-mark"><span class="brand-dot"></span><div><strong>生长之城</strong><small>GROWING CITY · SHANGHAI</small></div></div>
    <div class="build-status" aria-live="polite">
      <div class="build-line"><span class="live-dot"></span><span id="build-caption">平整场地</span><strong id="build-pct">0%</strong></div>
      <div class="progress-track" role="progressbar" aria-label="城建进度" aria-valuemin="0" aria-valuemax="100"><i id="build-bar"></i></div>
    </div>
    <div class="build-actions">
      <button class="button quiet" id="btn-skip" type="button">跳过动画</button>
      <button class="button quiet" id="btn-replay" type="button">重放城建</button>
    </div>
  </header>
  <aside class="stats-panel glass" aria-label="城市统计">
    <div class="stats-heading"><div><div class="eyebrow">LIVE METRICS</div><h2>城市脉搏</h2></div><span class="pulse-icon" aria-hidden="true">∿</span></div>
    <div class="stat-grid">
      <div class="stat-card"><span>人口</span><b id="st-pop">0</b><small id="st-clock">06:50 · 第1天</small></div>
      <div class="stat-card"><span>在途车辆</span><b id="st-cars">0</b><small id="st-peds">行人 0</small></div>
      <div class="stat-card speed-card"><span>平均车速</span><b id="st-speed">0<span>km/h</span></b><em id="st-cong">畅通</em></div>
    </div>
    <div class="chart-wrap">
      <div class="chart-caption"><span>车辆 / 均速 历史曲线</span><span><i style="color:#6ce0c1;font-style:normal">—</i> 车辆 · <i style="color:#e2b551;font-style:normal">—</i> 均速</span></div>
      <canvas id="traffic-chart" width="512" height="140" role="img" aria-label="车辆与均速历史曲线"></canvas>
    </div>
    <div class="flow-row"><span>跨江流量 东向 <b id="fl-e">0</b> · 西向 <b id="fl-w">0</b></span><span id="fl-q">桥头排队 0</span></div>
    <div class="weather-readout"><span class="weather-symbol" id="wx-sym">☀</span><div><b id="wx-name">晴 · 白天</b><small id="wx-sub">春季</small></div><span class="weather-tag" id="wx-tag">SIM 1x</span></div>
  </aside>
  <div class="toast-stack" id="toasts" aria-live="polite"></div>`);
  const $ = id => document.getElementById(id);
  $('btn-skip').onclick = () => sim.skipConstruction();
  $('btn-replay').onclick = () => { sim.reset(sim.seed); sim.setManual(false); };

  const chart = $('traffic-chart'), ctx = chart.getContext('2d');
  // Event ids are 'ev<N>'; compare the numeric part (string compare breaks at ev10 vs ev9).
  const evNum = ev => Number(String(ev?.id ?? '').replace(/\D/g, '')) || 0;
  let lastEvent = sim.events.length ? evNum(sim.events[sim.events.length - 1]) : 0, lastVersion = sim.version, tick = 0;

  function toast(ev) {
    const el = document.createElement('div');
    el.className = 'toast';
    const mark = { accident: '!', weather: '☁', festival: '✦', construction: '⚒' }[ev.type] || 'i';
    el.innerHTML = `<span class="toast-mark">${mark}</span><span></span>`;
    el.lastChild.textContent = ev.message;
    $('toasts').prepend(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 5200);
    while ($('toasts').children.length > 4) $('toasts').lastChild.remove();
  }

  function drawChart(hist) {
    // Match the backing store to the displayed size so lines are not stretched.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round((chart.clientWidth || 256) * dpr), ch = Math.round((chart.clientHeight || 78) * dpr);
    if (chart.width !== cw || chart.height !== ch) { chart.width = cw; chart.height = ch; }
    const w = chart.width, h = chart.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(200,224,226,.08)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke(); }
    if (hist.length < 2) return;
    const line = (key, max, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.6 * dpr; ctx.beginPath();
      hist.forEach((p, i) => { const x = i / (hist.length - 1) * w, y = h - 6 - (p[key] / max) * (h - 12); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    };
    line('activeCars', Math.max(20, ...hist.map(p => p.activeCars)), '#6ce0c1');
    line('avgSpeed', 20, '#e2b551');
  }

  function update() {
    if (sim.version !== lastVersion) { lastVersion = sim.version; lastEvent = 0; }
    const c = sim.construction, pct = Math.round(c.elapsed / c.duration * 100);
    $('build-caption').textContent = c.done ? '城市建造完成' : c.phase.label;
    $('build-pct').textContent = `${c.done ? 100 : pct}%`;
    $('build-bar').style.width = `${c.done ? 100 : pct}%`;
    $('build-bar').parentElement.setAttribute('aria-valuenow', c.done ? 100 : pct);
    $('btn-skip').disabled = c.done; $('btn-skip').style.opacity = c.done ? 0.4 : 1;
    // Toasts for new events.
    for (const ev of sim.events) { const k = evNum(ev); if (k > lastEvent) { lastEvent = k; toast(ev); } }
    if (tick++ % 10) return;   // stats at ~6 Hz
    const st = sim.stats, t = sim.time, fl = sim.flowStats;
    $('st-pop').textContent = st.population.toLocaleString('zh-CN');
    $('st-clock').textContent = `${pad(t.hour)}:${pad(t.minute)} · 第${t.day}天`;
    $('st-cars').textContent = st.activeCars;
    $('st-peds').textContent = `行人 ${st.pedestrians}`;
    $('st-speed').innerHTML = `${st.avgSpeedKmh.toFixed(0)}<span>km/h</span>`;
    $('st-cong').textContent = st.congestion > 0.4 ? '拥堵' : st.congestion > 0.2 ? '缓行' : '畅通';
    $('fl-e').textContent = fl.crossEast; $('fl-w').textContent = fl.crossWest;
    $('fl-q').textContent = `桥头排队 ${Object.values(fl.queue).reduce((a, b) => a + b, 0)}`;
    const [sym, wn] = WEATHER_TXT[sim.weather];
    $('wx-sym').textContent = sym;
    $('wx-name').textContent = `${wn} · ${TOD_TXT[sim.timeOfDay]}`;
    $('wx-sub').textContent = `${SEASON_TXT[sim.season]}季${sim.festival ? ' · 节日烟花' : ''}${sim.autoCycle ? '' : ' · 昼夜循环暂停'}`;
    $('wx-tag').textContent = sim.manual ? 'MANUAL' : `SIM ${sim.timeScale}x`;
    drawChart(st.history);
  }
  const loop = () => { update(); requestAnimationFrame(loop); };
  loop();
  return { toast };
}
