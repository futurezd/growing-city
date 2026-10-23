// Collapsible control panel (top-left): camera presets, follow, speed, time of day + auto cycle,
// weather, seasons, festival fireworks, accident injection, god mode (click two nodes to add a road).
const PRESET_SUB = { overview: 'OVERVIEW', bund: 'THE BUND', lujiazui: 'LUJIAZUI', nanjing: 'NANJING RD', yuyuan: 'YUYUAN', night: 'RIVER NIGHT' };

export function mountPanel(root, sim, view, hud) {
  const presets = Object.entries(sim.presets).map(([k, p]) => `<button class="preset" type="button" data-preset="${k}"><b>${p.label}</b><small>${PRESET_SUB[k] || k}</small></button>`).join('');
  root.insertAdjacentHTML('beforeend', `
  <button class="panel-toggle" id="panel-toggle" type="button" aria-expanded="true" aria-controls="control-panel" aria-label="收起控制面板">‹</button>
  <aside class="control-panel glass" id="control-panel" aria-label="控制面板">
    <div class="panel-heading"><div><div class="eyebrow">CONTROL</div><h2>城市控制台</h2></div><span class="status-pill"><i></i><span id="pn-status">BUILDING</span></span></div>
    <section class="control-section"><div class="section-title">镜头视角<span>2s EASE</span></div>
      <div class="preset-grid">${presets}</div>
      <div class="button-row"><button type="button" id="pn-follow-car">跟随车辆</button><button type="button" id="pn-follow-ped">跟随行人</button><button type="button" id="pn-unfollow">自由镜头</button></div>
    </section>
    <section class="control-section"><div class="section-title">时间流速<span id="pn-clock">06:50</span></div>
      <div class="segmented" role="group" aria-label="时间流速">${[1, 2, 4].map(k => `<button type="button" data-speed="${k}">${k}x</button>`).join('')}</div>
      <div class="button-row" role="group" aria-label="时段">${[['day', '白天'], ['dusk', '黄昏'], ['night', '夜晚']].map(([k, t]) => `<button type="button" data-tod="${k}">${t}</button>`).join('')}</div>
      <label class="switch-line">昼夜自动循环<input type="checkbox" id="pn-auto" checked><i></i></label>
    </section>
    <section class="control-section"><div class="section-title">天气 · 季节</div>
      <div class="button-row weather-row" role="group" aria-label="天气">${[['clear', '☀', '晴'], ['rain', '☂', '雨'], ['snow', '❄', '雪']].map(([k, s, t]) => `<button type="button" data-weather="${k}"><span>${s}</span>${t}</button>`).join('')}</div>
      <div class="button-row" role="group" aria-label="季节">${[['spring', '春'], ['summer', '夏'], ['autumn', '秋'], ['winter', '冬']].map(([k, t]) => `<button type="button" data-season="${k}">${t}</button>`).join('')}</div>
    </section>
    <section class="control-section compact"><div class="section-title">事件</div>
      <div class="event-actions">
        <button class="action-button" type="button" id="pn-accident"><span class="action-icon">!</span><span><b>制造交通事故</b><small>抛锚 → 排队 → 拖车 → 恢复</small></span><span class="action-arrow">›</span></button>
        <button class="action-button" type="button" id="pn-fest"><span class="action-icon firework-icon">✦</span><span><b>节日烟花</b><small>夜间黄浦江两岸</small></span><span class="action-arrow" id="pn-fest-state">关</span></button>
        <button class="action-button" type="button" id="pn-god"><span class="action-icon">⚒</span><span><b>上帝模式</b><small id="pn-god-sub">点击两个路口新建道路</small></span><span class="action-arrow" id="pn-god-state">关</span></button>
      </div>
    </section>
    <div class="panel-footer"><span class="footer-live"></span><span>拖拽旋转 · 右键平移 · 滚轮缩放 · 点击聚焦/跟随</span><span class="seed-label">SEED ${sim.seed}</span></div>
  </aside>
  <div class="selection-chip hidden" id="pn-chip"><span id="pn-chip-txt"></span><button type="button" id="pn-chip-x">取消</button></div>`);
  const $ = id => document.getElementById(id), panel = $('control-panel'), toggle = $('panel-toggle');
  toggle.onclick = () => {
    const c = panel.classList.toggle('collapsed');
    toggle.classList.toggle('is-collapsed', c); toggle.textContent = c ? '›' : '‹';
    toggle.setAttribute('aria-expanded', String(!c)); toggle.setAttribute('aria-label', c ? '展开控制面板' : '收起控制面板');
  };
  const on = (sel, fn) => panel.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => fn(b)));
  on('[data-preset]', b => sim.setCameraPreset(b.dataset.preset));
  on('[data-speed]', b => { sim.setManual(false); sim.setSpeed(+b.dataset.speed); });
  on('[data-tod]', b => sim.setTimeOfDay(b.dataset.tod));
  on('[data-weather]', b => sim.setWeather(b.dataset.weather));
  on('[data-season]', b => sim.setSeason(b.dataset.season));
  $('pn-auto').onchange = e => sim.setAutoCycle(e.target.checked);
  const notify = message => hud?.toast?.({ type: 'info', message });
  const pick = list => list.length ? list[Math.floor(Math.random() * list.length)] : null;
  $('pn-follow-car').onclick = () => { const c = pick(sim.traffic.cars.filter(c => !c.parked)); if (c && sim.followCar(c.id)) chip(`正在跟随车辆 ${c.id}`); else notify('当前没有可跟随的车辆'); };
  $('pn-follow-ped').onclick = () => { const p = pick(sim.peds.list); if (p && sim.followPedestrian(p.id)) chip(`正在跟随行人 ${p.id}`); else notify('当前没有可跟随的行人'); };
  $('pn-unfollow').onclick = () => sim.followCar(null);
  $('pn-accident').onclick = () => {
    if (!sim.construction.done) return notify('城市建造中，完成后可制造事故');
    // Prefer a busy street segment so the queue is visible; focus the camera on it.
    const busy = sim.traffic.cars.filter(c => { const e = sim.g.edge(c.edge); return !c.parked && !c.broken && e && !e.bridge && !e.blocked && !e.pedOnly; });
    const c = pick(busy);
    if (!c) return notify('当前没有可用车辆，请稍后再试');
    if (sim.injectAccident(c.edge)) sim.focusOn(c.x, c.z); else notify('该路段无法制造事故，请重试');
  };
  $('pn-fest').onclick = () => { sim.setFestival(!sim.festival); if (sim.festival && sim.lighting.night < 0.3) sim.setTimeOfDay('night'); };

  // God mode: first click picks node A, second picks node B → addRoad(a, b).
  let godA = null, simVersion = sim.version;
  function chip(txt) { $('pn-chip').classList.toggle('hidden', !txt); $('pn-chip-txt').textContent = txt || ''; }
  $('pn-god').onclick = () => { view.godMode = !view.godMode; godA = null; chip(view.godMode ? '上帝模式：点击第一个路口' : ''); };
  // Single cancel handler: first stops following, otherwise leaves god mode.
  $('pn-chip-x').onclick = () => {
    if (sim.camera.following) { sim.followCar(null); chip(view.godMode ? '上帝模式：点击第一个路口' : ''); return; }
    view.godMode = false; godA = null; chip('');
  };
  const nearest = (x, z) => { let best = null, d = 60; for (const n of sim.g.nodes) { const k = Math.hypot(n.x - x, n.z - z); if (k < d) { d = k; best = n; } } return best; };
  view.on('pick', p => {
    if (p.type === 'car') chip(`正在跟随车辆 ${p.id}`);
    else if (p.type === 'ped') chip(`正在跟随行人 ${p.id}`);
    if (!p.god) return;
    const n = nearest(p.x, p.z);
    if (!n) { chip('上帝模式：附近没有路口，请靠近路口点击'); return; }
    if (!godA) { godA = n; chip(`上帝模式：已选 ${n.id}，再点击第二个路口`); return; }
    if (n.id === godA.id) { chip(`上帝模式：已选 ${n.id}，请点击另一个路口`); return; }
    const id = sim.addRoad(godA.id, n.id);
    chip(id ? `已新建道路 ${id}（${godA.id} → ${n.id}），继续点击可再建` : '无法建造：跨越黄浦江或两路口间已有道路');
    godA = null;
  });

  const sel = (q, test) => panel.querySelectorAll(q).forEach(b => b.classList.toggle(b.classList.contains('preset') ? 'active' : 'selected', test(b)));
  const pad = n => String(n).padStart(2, '0');
  const loop = () => {
    const cam = sim.camera.state, t = sim.time;
    if (sim.version !== simVersion) { simVersion = sim.version; godA = null; if (view.godMode) chip('上帝模式：点击第一个路口'); }
    const acc = $('pn-accident'); acc.disabled = !sim.construction.done; acc.title = acc.disabled ? '城建完成后可用' : '';
    sel('[data-preset]', b => cam.preset === b.dataset.preset);
    sel('[data-speed]', b => !sim.manual && sim.timeScale === +b.dataset.speed);
    sel('[data-tod]', b => sim.timeOfDay === b.dataset.tod);
    sel('[data-weather]', b => sim.weather === b.dataset.weather);
    sel('[data-season]', b => sim.season === b.dataset.season);
    $('pn-auto').checked = sim.autoCycle;
    $('pn-clock').textContent = `${pad(t.hour)}:${pad(t.minute)}`;
    $('pn-status').textContent = sim.construction.done ? (cam.following ? 'FOLLOW' : 'LIVE') : 'BUILDING';
    $('pn-fest-state').textContent = sim.festival ? '开' : '关';
    $('pn-god-state').textContent = view.godMode ? '开' : '关';
    if (!cam.following && /^正在跟随/.test($('pn-chip-txt').textContent)) chip('');
    requestAnimationFrame(loop);
  };
  loop();
}
