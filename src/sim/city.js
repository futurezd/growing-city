// CitySim core: composes road graph, signals, traffic, pedestrians, layout, clock, weather, events.
// Deterministic (seeded PRNG, fixed step 1/60 s) and independent of rendering / DOM.
import { createRng } from './rng.js';
import { HUANGPU, SUZHOU, isPudong, districtOf } from './geo.js';
import { RoadGraph } from './graph.js';
import { Signals } from './signals.js';
import { Traffic, STOP_DIST } from './traffic.js';
import { Pedestrians } from './peds.js';
import { generateLayout, PHASES, BUILD_DURATION } from './layout.js';
import { PRESETS, CameraRig } from './camera.js';
import { Incidents } from './events.js';

export const DT = 1 / 60;
const GAME_SECONDS_PER_STEP = 2;          // 1 step = 2 game seconds → a full day lasts 12 real minutes at 1x
const WEATHER = { clear: 1, rain: 0.8, snow: 0.65 };
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const TOD_HOUR = { day: [12, 0], dusk: [17, 40], night: [22, 0] };

const between = (h, a, b) => h >= a && h < b;
function carTarget(h) {
  if (h < 5) return 12; if (h < 7) return 34; if (h < 9.5) return 80; if (h < 16.5) return 55;
  if (h < 19.5) return 80; if (h < 22) return 45; return 24;
}
function pedTarget(h) {
  if (h < 5) return 16; if (h < 7) return 45; if (h < 9.5) return 110; if (h < 16.5) return 100;
  if (h < 19.5) return 120; if (h < 22) return 95; return 40;
}

export class CitySim {
  constructor(seed = 20261023) { this.timeScale = 1; this.reset(seed); }

  // ---------- lifecycle ----------
  reset(seed = this.seed) {
    this.seed = (Number(seed) >>> 0) || 1;
    const base = createRng(this.seed);
    const fork = () => createRng(Math.floor(base.next() * 4294967296));
    this.rng = { layout: fork(), traffic: fork(), peds: fork(), events: fork(), demand: fork(), boats: fork() };
    this.g = new RoadGraph().buildCity();
    this.signals = new Signals(this.g);
    this.traffic = new Traffic(this.g, this.signals, this.rng.traffic);
    this.peds = new Pedestrians(this.g, this.signals, this.rng.peds);
    const layout = generateLayout(this.rng.layout);
    this.buildings = layout.buildings;
    this.parks = layout.parks;
    this.amenities = layout.amenities;
    this.river = { huangpu: HUANGPU.map(p => ({ ...p })), suzhou: SUZHOU.map(p => ({ ...p })) };
    this.incidents = new Incidents(this, this.rng.events);
    this.simT = 0; this.frame = 0;
    this.clock = 6 * 3600 + 50 * 60; this.day = 1;
    this.autoCycle = true;
    this.weather = 'clear'; this.season = 'spring'; this.festival = false;
    this.construction = { elapsed: 0, duration: BUILD_DURATION, done: false, phase: PHASES[0] };
    this.flow = { crossEast: 0, crossWest: 0, hourEast: 0, hourWest: 0, lastHourEast: 0, lastHourWest: 0, hourMark: this.hourFloat | 0 };
    this.traffic.onCross = (e, car, east) => { if (east) { this.flow.crossEast++; this.flow.hourEast++; } else { this.flow.crossWest++; this.flow.hourWest++; } };
    this.history = [];
    this._spawnAcc = 0; this._pedAcc = 0;
    this.camera = new CameraRig(this);
    this._indexEdges();
    this._initBoats();
    this._updateBuild();
    this._updateLighting();
    this.listeners = new Set();
    this.version = (this.version || 0) + 1;
    return this;
  }

  _indexEdges() {
    const carEdges = this.g.edges.filter(e => !e.pedOnly && !e.bridge && e.length >= 60);
    const mid = e => ({ x: (e.geometry[0].x + e.geometry[1].x) / 2, z: (e.geometry[0].z + e.geometry[1].z) / 2 });
    const bridgeW = this.g.bridges.map(b => this.g.node(b.nodeA)), bridgeE = this.g.bridges.map(b => this.g.node(b.nodeB));
    const near = (m, nodes, r) => nodes.some(n => n && Math.hypot(m.x - n.x, m.z - n.z) < r);
    this.edgeSets = {
      all: carEdges,
      puxiNearBridge: carEdges.filter(e => { const m = mid(e); return !isPudong(m.x, m.z) && near(m, bridgeW, 520); }),
      puxi: carEdges.filter(e => { const m = mid(e); return !isPudong(m.x, m.z); }),
      work: carEdges.filter(e => { const m = mid(e); const d = districtOf(m.x, m.z); return d === 'lujiazui' || (d === 'pudong' && Math.hypot(m.x - 400, m.z) < 450); }),
      pudongNearBridge: carEdges.filter(e => { const m = mid(e); return isPudong(m.x, m.z) && near(m, bridgeE, 520); }),
    };
    const pedAll = this.g.edges.filter(e => e.river !== 'huangpu' && e.length >= 40);
    const busy = new Set(['nanjing', 'bund', 'yuyuan', 'renmin', 'lujiazui']);
    this.pedSets = { all: pedAll, busy: pedAll.filter(e => busy.has(districtOf((e.geometry[0].x + e.geometry[1].x) / 2, (e.geometry[0].z + e.geometry[1].z) / 2))) };
    this._graphCache = null;
  }

  _initBoats() {
    const pts = HUANGPU; let len = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); cum.push(len); }
    this._riverCum = cum; this._riverLen = len;
    const r = this.rng.boats;
    this.boats = [];
    const kinds = ['cargo', 'cruise', 'ferry', 'cargo', 'cruise', 'barge', 'cargo', 'cruise'];
    kinds.forEach((kind, i) => this.boats.push({ id: `boat${i}`, kind, s: r.range(0, len), dir: i % 2 ? 1 : -1, speed: kind === 'cruise' ? 4 : kind === 'ferry' ? 5 : 3, lane: r.range(14, 32), x: 0, z: 0, heading: 0 }));
    this._moveBoats(0);
  }

  _moveBoats(dt) {
    const pts = HUANGPU, cum = this._riverCum, L = this._riverLen;
    for (const b of this.boats) {
      b.s = (b.s + b.dir * b.speed * dt * (this.weather === 'clear' ? 1 : 0.8) + L) % L;
      let i = 1; while (i < cum.length - 1 && cum[i] < b.s) i++;
      const a = pts[i - 1], c = pts[i], t = (b.s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz) || 1;
      const side = b.dir; // keep right
      b.x = a.x + dx * t + (dz / l) * b.lane * side; b.z = a.z + dz * t - (dx / l) * b.lane * side;
      b.heading = Math.atan2(dx * b.dir, dz * b.dir);
    }
  }

  // ---------- stepping ----------
  // Public stepping switches to manual mode (the render loop stops auto-advancing).
  step(n = 1) {
    this.manual = true;
    return this._advance(n);
  }
  _advance(n = 1) {
    n = Math.max(0, Math.floor(+n || 0));
    for (let i = 0; i < n; i++) this._tick();
    return this;
  }
  setManual(on) { this.manual = !!on; return this.manual; }

  _tick() {
    this.frame++; this.simT += DT;
    if (this.autoCycle) {
      this.clock += GAME_SECONDS_PER_STEP;
      if (this.clock >= 86400) { this.clock -= 86400; this.day++; }
    }
    if (!this.construction.done) {
      this.construction.elapsed = Math.min(this.construction.duration, this.construction.elapsed + DT);
      if (this.construction.elapsed >= this.construction.duration) this._finishConstruction();
    }
    this._updateBuild();
    this.signals.update(this.simT);
    const env = {
      weatherFactor: WEATHER[this.weather],
      pedCrossing: (node, armTo) => this.peds.isCrossing(node, armTo),
    };
    this.traffic.step(DT, env);
    this.peds.step(DT, { carNear: (node, armTo) => this._carNearCrosswalk(node, armTo) });
    this.incidents.step(DT);
    if (this.construction.done) this._demand();
    this._moveBoats(DT);
    this._updateLighting();
    this._flowHour();
    this.camera.step(DT / Math.max(1, this.timeScale));
    if (this.frame % 120 === 0) this._sample();
    if (this.construction.done && this.frame % 1800 === 0) this._renovate();
  }

  // Every 30 s one ordinary building may be torn down and rebuilt (max 3 concurrent worksites).
  _renovate() {
    const r = this.rng.events;
    if (this.buildings.filter(b => b.renovation).length >= 3 || !r.chance(0.7)) return;
    const pool = this.buildings.filter(b => !b.isLandmark && !b.special && b.district !== 'bund' && !b.renovation && b.progress >= 1);
    const b = r.pick(pool); if (!b) return;
    b.renovation = { start: this.simT, dur: 30 + Math.min(30, b.height * 0.4) };
    b.progress = 0;
    const zone = { lujiazui: '陆家嘴', nanjing: '南京路', renmin: '人民广场', yuyuan: '豫园', 'west-residential': '浦西', pudong: '浦东' }[b.district] || '';
    this.incidents.announce(`${zone}一处${b.type === 'residential' ? '住宅' : b.type === 'office' ? '写字楼' : '建筑'}开始翻新施工`, 'construction', { buildingId: b.id });
  }

  _carNearCrosswalk(node, armTo) {
    const out = this.g.edgeBetween(node, armTo, false), inn = this.g.edgeBetween(armTo, node, false);
    for (const c of this.traffic.cars) {
      if (c.broken || c.parked) continue;
      if (out && c.committed && c.route[0] === out.id) return true;
      if (out && c.edge === out.id && c.offset < 16) return true;
      if (inn && c.edge === inn.id && (c.committed || c.offset > inn.length - STOP_DIST + 1)) return true;
    }
    return false;
  }

  _finishConstruction() {
    this.construction.elapsed = this.construction.duration;
    this.construction.done = true;
    this.construction.phase = PHASES[PHASES.length - 1];
    this._updateBuild();
    this._populate();
    this.incidents.announce('城市建造完成，交通与居民开始运转', 'info');
  }

  skipConstruction() {
    if (!this.construction.done) this._finishConstruction();
    return this;
  }

  get constructing() { return !this.construction.done; }

  _updateBuild() {
    const t = this.construction.done ? Infinity : this.construction.elapsed;
    for (const b of this.buildings) {
      if (b.renovation) {
        // Post-construction lifecycle: demolish → worksite with crane → rebuilt.
        const p = (this.simT - b.renovation.start) / b.renovation.dur;
        if (p >= 1) { b.renovation = null; b.progress = 1; } else b.progress = Math.max(0, p);
      } else b.progress = Math.max(0, Math.min(1, (t - b.buildStart) / b.buildDur));
    }
    let ph = PHASES[0];
    for (const p of PHASES) if (Math.min(t, this.construction.duration) >= p.t0) ph = p;
    this.construction.phase = ph;
  }

  // ---------- demand (time-of-day density, tidal OD) ----------
  _od() {
    const h = this.hourFloat, r = this.rng.demand, S = this.edgeSets;
    if (between(h, 7, 9.5)) {
      // Morning tide: Puxi homes → Lujiazui offices.
      if (r.chance(0.72)) return [r.pick(S.puxiNearBridge.length ? S.puxiNearBridge : S.puxi), r.pick(S.work)];
    } else if (between(h, 16.5, 19.5)) {
      if (r.chance(0.72)) return [r.pick(S.work), r.pick(S.puxiNearBridge.length ? S.puxiNearBridge : S.puxi)];
    }
    return [r.pick(S.all), r.pick(S.all)];
  }

  _trySpawnCar() {
    const [o, d] = this._od();
    if (!o || !d || o.id === d.id || o.blocked) return null;
    const off = this.rng.demand.range(6, o.length * 0.45);
    if (this.traffic.cars.some(c => c.edge === o.id && Math.abs(c.offset - off) < 14)) return null;
    return this.traffic.spawn({ edge: o.id, offset: off, speed: Math.min(6, o.speedLimit), destEdge: d.id, auto: true });
  }

  _trySpawnPed() {
    const r = this.rng.demand, P = this.pedSets;
    const e = r.chance(0.6) && P.busy.length ? r.pick(P.busy) : r.pick(P.all);
    return e ? this.peds.spawn({ edge: e.id, auto: true }) : null;
  }

  _populate() {
    const h = this.hourFloat;
    for (let i = 0; i < 400 && this.traffic.cars.length < carTarget(h); i++) this._trySpawnCar();
    for (let i = 0; i < 200 && this.peds.list.length < pedTarget(h); i++) this._trySpawnPed();
  }

  _demand() {
    const h = this.hourFloat, cars = this.traffic.cars;
    for (const c of [...cars]) {
      if (c.auto && c.parked && c.parkedFor > 3) this.traffic.remove(c.id);
      else if (c.auto && c.waited > 240 && !c.broken) this.traffic.remove(c.id);
    }
    this._spawnAcc += DT; this._pedAcc += DT;
    if (this._spawnAcc >= 0.2) { this._spawnAcc = 0; if (cars.length < Math.min(80, carTarget(h))) this._trySpawnCar(); }
    if (this._pedAcc >= 0.25) { this._pedAcc = 0; if (this.peds.list.length < Math.min(120, pedTarget(h))) this._trySpawnPed(); }
  }

  _flowHour() {
    const hr = Math.floor(this.clock / 3600);
    if (hr !== this.flow.hourMark) {
      this.flow.lastHourEast = this.flow.hourEast; this.flow.lastHourWest = this.flow.hourWest;
      this.flow.hourEast = 0; this.flow.hourWest = 0; this.flow.hourMark = hr;
    }
  }

  // ---------- lighting / day-night ----------
  get hourFloat() { return this.clock / 3600; }
  get timeOfDay() { const h = this.hourFloat; return between(h, 7, 17) ? 'day' : (between(h, 17, 19.5) || between(h, 5, 7)) ? 'dusk' : 'night'; }

  _updateLighting() {
    const h = this.hourFloat;
    const elev = Math.sin(((h - 6) / 12) * Math.PI);           // >0 between 06:00 and 18:00
    const cloud = this.weather === 'rain' ? 0.45 : this.weather === 'snow' ? 0.65 : 1;
    const sunIntensity = Math.max(0, elev) * cloud;
    const night = Math.max(0, Math.min(1, (0.22 - elev) / 0.32));
    let lit = 0;
    for (const b of this.buildings) {
      const built = b.progress >= 1;
      let on = false;
      if (built && b.type !== 'landmark') {
        if (b.type === 'residential') on = night > 0.05 + b.litSeed * 0.55 && !(h >= 1 && h < 5 && b.litSeed > 0.3);
        else if (b.type === 'office') on = night > 0.3 && b.litSeed < 0.12;      // offices mostly dark at night
        else on = night > 0.15 + b.litSeed * 0.4;                                 // shops, classical, temples
      } else if (built) on = night > 0.2;                                         // landmark lighting shows
      b.lit = on; if (on) lit++;
    }
    this.lighting = { sunElevation: elev, sunIntensity, night, litBuildingCount: lit };
  }

  // ---------- statistics ----------
  get population() {
    let p = 0;
    for (const b of this.buildings) if (b.type === 'residential' && b.progress > 0) p += b.w * b.d * b.floors * b.progress * 0.62;
    return Math.round(p * 1.9);
  }

  _sample() {
    this.history.push({ t: this.simT, clock: this.clock, population: this.population, activeCars: this.traffic.cars.length, avgSpeed: this.traffic.avgSpeed(), pedestrians: this.peds.list.length });
    if (this.history.length > 150) this.history.shift();
  }

  get stats() {
    return {
      population: this.population, activeCars: this.traffic.cars.length, avgSpeed: this.traffic.avgSpeed(),
      avgSpeedKmh: this.traffic.avgSpeed() * 3 * 3.6, pedestrians: this.peds.list.length,
      lighting: { sunIntensity: this.lighting.sunIntensity, litBuildingCount: this.lighting.litBuildingCount },
      congestion: this.traffic.cars.length ? this.traffic.cars.filter(c => c.speed < 1 && !c.parked).length / this.traffic.cars.length : 0,
      history: this.history.slice(),
    };
  }

  get flowStats() {
    const queue = {};
    for (const b of this.g.bridges) {
      let q = 0;
      for (const node of [b.nodeA, b.nodeB]) for (const e of this.g.in(node)) for (const c of this.traffic.cars) if (c.edge === e.id && c.speed < 1.5 && !c.parked) q++;
      queue[b.id] = q;
    }
    return { crossEast: this.flow.crossEast, crossWest: this.flow.crossWest, lastHourEast: this.flow.lastHourEast, lastHourWest: this.flow.lastHourWest, thisHourEast: this.flow.hourEast, thisHourWest: this.flow.hourWest, queue };
  }

  // ---------- contract accessors ----------
  get graph() {
    if (!this._graphCache || this._graphCache.v !== this.g.version) this._graphCache = { v: this.g.version, view: this.g.graphView() };
    const view = this._graphCache.view;
    for (const e of view.edges) { const live = this.g.edge(e.id); if (live) e.blocked = live.blocked; }
    return view;
  }
  get lights() { return this.signals.view(); }
  get cars() { return this.traffic.view(); }
  get pedestrians() { return this.peds.view(); }
  get bridges() { return this.g.bridges.map(b => ({ id: b.id, nodeA: b.nodeA, nodeB: b.nodeB, name: b.name, edgeId: b.edgeId })); }
  get events() { return this.incidents.log; }
  get time() { const s = Math.floor(this.clock); return { hour: Math.floor(s / 3600), minute: Math.floor((s % 3600) / 60), second: s % 60, day: this.day }; }
  get presets() { return PRESETS; }

  // ---------- contract methods ----------
  setTime(h, m = 0) {
    const hh = Math.max(0, Math.min(23, Math.floor(+h || 0))), mm = Math.max(0, Math.min(59, Math.floor(+m || 0)));
    this.clock = hh * 3600 + mm * 60;
    this.flow.hourMark = hh;
    this._updateLighting();
    return this.time;
  }
  setTimeOfDay(name) {
    if (!(name in TOD_HOUR)) return false;
    this.setTime(TOD_HOUR[name][0], TOD_HOUR[name][1]);
    return true;
  }
  setAutoCycle(on) { this.autoCycle = !!on; return this.autoCycle; }
  setWeather(w) {
    if (!(w in WEATHER)) return false;
    if (w !== this.weather) this.incidents.announce(w === 'rain' ? '降雨开始：车辆减速慢行' : w === 'snow' ? '降雪：道路湿滑，限速降低' : '天气转晴', 'weather');
    this.weather = w; this._updateLighting();
    return true;
  }
  setSeason(s) { if (!SEASONS.includes(s)) return false; this.season = s; return true; }
  setFestival(on) { this.festival = !!on; if (this.festival) this.incidents.announce('节日庆典：黄浦江两岸燃放烟花', 'festival'); return this.festival; }
  setSpeed(k) { this.timeScale = [1, 2, 4].includes(+k) ? +k : 1; return this.timeScale; }

  setLightState(id, axis, color) { return this.signals.set(id, axis, color); }
  setCameraPreset(name) { return this.camera.preset(name); }
  followCar(id) { return this.camera.follow(id == null ? null : { type: 'car', id }); }
  followPedestrian(id) { return this.camera.follow(id == null ? null : { type: 'ped', id }); }
  focusOn(x, z) { return this.camera.focus(x, z); }

  spawnCar({ edge, offset = 0, speed = 0, destEdge = null } = {}) {
    const e = this.g.edge(edge);
    if (!e || e.pedOnly || e.blocked) return null;
    return this.traffic.spawn({ edge, offset, speed, destEdge, kind: 'car' });
  }
  spawnPedestrian({ edge, offset = null } = {}) { return this.peds.spawn({ edge, offset }); }
  injectAccident(edgeId) { return this.incidents.accident(edgeId); }

  addRoad(a, b) {
    const id = this.g.addRoad(a, b);
    if (id) this._graphChanged();
    return id;
  }
  removeRoad(edgeId) {
    const e = this.g.edge(edgeId);
    if (!e) return false;
    const dead = new Set([e.id, e.reverseId]);
    this.g.removeRoad(edgeId);
    for (const c of [...this.traffic.cars]) if (dead.has(c.edge)) this.traffic.remove(c.id);
    for (const p of [...this.peds.list]) if (dead.has(p.edge) || (p.cross && dead.has(p.cross.next.id))) this.peds.remove(p.id);
    for (const c of this.traffic.cars) {
      if (c.prevEdge && dead.has(c.prevEdge)) c.prevEdge = null;
      if (c.destEdge && dead.has(c.destEdge)) c.destEdge = null;
      if (c.route.some(r => dead.has(r))) { c.committed = false; this.traffic._plan(c); }
    }
    this._graphChanged();
    return true;
  }
  _graphChanged() { this.signals.rebuild(); this._indexEdges(); }
  pathfind(a, b) { return this.g.pathfind(a, b); }

  // Convenience for UI: building lookup.
  building(id) { return this.buildings.find(b => b.id === id) || null; }
}
