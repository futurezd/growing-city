// Vehicle dynamics: IDM car-following, signal compliance, intersection permission, turning.
// Pure logic; positions are in sim coordinates (+x east, +z north).
export const LANE_OFFSET = 3.5;      // lane centre to the right of the road centre line
export const STOP_DIST = 14;         // stop line distance before the node
export const TURN_R = 8;             // half-length of the turning curve (inside the junction box)
export const MIN_GAP = 1.2;          // hard minimum bumper-to-bumper gap
const IDM = { a: 1.6, b: 2.6, s0: 2.5, T: 1.2 };
const KINDS = { car: 3.4, taxi: 3.4, bus: 7.5, tow: 5 };
export const TURN_SPEED = 5;

const dirOf = e => { const [a, b] = e.geometry; const l = e.length || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
export function turnType(e1, e2) {
  const a = dirOf(e1), b = dirOf(e2);
  const dot = a.x * b.x + a.z * b.z, cross = a.x * b.z - a.z * b.x;
  if (dot > 0.7) return 'straight';
  if (dot < -0.7) return 'uturn';
  return cross > 0 ? 'left' : 'right';
}

function lanePoint(e, s) {
  const d = dirOf(e), a = e.geometry[0];
  return { x: a.x + d.x * s + d.z * LANE_OFFSET, z: a.z + d.z * s - d.x * LANE_OFFSET };
}

export class Traffic {
  constructor(graph, signals, rng) {
    this.graph = graph; this.signals = signals; this.rng = rng;
    this.cars = []; this.byId = new Map(); this.nextId = 1;
    this.crossings = { crossEast: 0, crossWest: 0 };
    this.onCross = null; // callback(edge, car)
  }

  clear() { this.cars = []; this.byId.clear(); }

  spawn({ edge, offset = 0, speed = 0, destEdge = null, kind = null, auto = false } = {}) {
    const e = this.graph.edge(edge);
    if (!e) return null;
    const k = kind || (this.rng.chance(0.08) ? 'bus' : this.rng.chance(0.27) ? 'taxi' : 'car');
    const dest = destEdge && this.graph.edge(destEdge) ? destEdge : null;
    const car = {
      id: `c${this.nextId++}`, kind: k, len: KINDS[k] || 3.4,
      edge: e.id, prevEdge: null, offset: Math.max(0, Math.min(e.length, +offset || 0)),
      speed: Math.max(0, Math.min(+speed || 0, e.speedLimit)), accel: 0,
      destEdge: dest, route: [], committed: false, broken: false, parked: false,
      auto, parkedFor: 0, waited: 0, color: this.rng.int(0, 8), x: 0, z: 0, heading: 0,
    };
    this._plan(car);
    this._pose(car);
    this.cars.push(car); this.byId.set(car.id, car);
    return car.id;
  }

  remove(id) {
    const c = this.byId.get(id); if (!c) return;
    this.byId.delete(id); this.cars.splice(this.cars.indexOf(c), 1);
  }

  get(id) { return this.byId.get(id) || null; }

  // Choose the route after the current edge (towards destEdge, or wander).
  _plan(car) {
    const g = this.graph, e = g.edge(car.edge);
    car.route = [];
    if (!e) return;
    if (car.destEdge && car.destEdge !== car.edge) {
      const r = g.edgePath(car.edge, car.destEdge);
      if (r) { car.route = r; return; }
    }
    if (car.destEdge === car.edge) return;
    const outs = g.out(e.to).filter(x => !x.blocked && !x.pedOnly && x.id !== e.reverseId);
    const pick = outs.length ? this.rng.pick(outs) : g.edge(e.reverseId);
    if (pick && !pick.blocked) car.route = [pick.id];
  }

  _next(car) { return car.route.length ? this.graph.edge(car.route[0]) : null; }

  _pose(car) {
    const e = this.graph.edge(car.edge); if (!e) return;
    const s = car.offset, next = this._next(car);
    let p, h;
    const prev = car.prevEdge && this.graph.edge(car.prevEdge);
    if (next && s > e.length - TURN_R && turnType(e, next) !== 'straight') {
      ({ p, h } = this._curve(e, next, (s - (e.length - TURN_R)) / (2 * TURN_R)));
    } else if (prev && prev.to === e.from && s < TURN_R && turnType(prev, e) !== 'straight') {
      ({ p, h } = this._curve(prev, e, 0.5 + s / (2 * TURN_R)));
    } else {
      p = lanePoint(e, s); const d = dirOf(e); h = Math.atan2(d.x, d.z);
    }
    car.x = p.x; car.z = p.z; car.heading = h;
  }

  // Cubic Bézier between lane points of two edges meeting at a junction.
  _curve(e1, e2, t) {
    const d1 = dirOf(e1), d2 = dirOf(e2), k = TURN_R * 0.55;
    const p0 = lanePoint(e1, e1.length - TURN_R), p3 = lanePoint(e2, TURN_R);
    const p1 = { x: p0.x + d1.x * k, z: p0.z + d1.z * k }, p2 = { x: p3.x - d2.x * k, z: p3.z - d2.z * k };
    const u = 1 - t;
    const p = {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      z: u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z,
    };
    const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
    const dz = 3 * u * u * (p1.z - p0.z) + 6 * u * t * (p2.z - p1.z) + 3 * t * t * (p3.z - p2.z);
    return { p, h: Math.atan2(dx, dz) };
  }

  // Is the car allowed to pass the stop line now?
  _permission(car, e, next, byEdge, pedCrossing) {
    const n = this.graph.node(e.to);
    const color = this.signals.color(e.to, e.approach);
    const dStop = e.length - STOP_DIST - car.offset;
    if (color === 'red') return false;
    if (color === 'yellow' && dStop > (car.speed * car.speed) / (2 * 3.0) + 0.5) return false;
    if (!next || next.blocked) return false;
    // Do not block the box: the exit edge must have room for us.
    const exitCars = byEdge.get(next.id) || [];
    let need = car.len + MIN_GAP + 2;
    for (const c of this.cars) if (c !== car && c.committed && c.route[0] === next.id) need += c.len + MIN_GAP + 2;
    const last = exitCars[exitCars.length - 1];
    if (last && last.offset - last.len < need) return false;
    if (!last && next.length < need) return false;
    const tt = turnType(e, next);
    if (tt === 'left' || tt === 'uturn') {
      // Permissive left: yield to oncoming traffic that shares the phase.
      for (const inc of this.graph.in(e.to)) {
        if (inc.id === e.id || turnType(e, inc) !== 'uturn') continue;
        for (const c of byEdge.get(inc.id) || []) {
          const d = inc.length - c.offset;
          if (c.broken || c.parked) continue;
          const cn = this._next(c);
          if (cn && turnType(inc, cn) === 'left') continue;
          if (c.committed || (d < 45 && (c.speed > 0.5 || d < STOP_DIST + 2) && this.signals.color(e.to, inc.approach) !== 'red')) return false;
        }
      }
    }
    if (tt !== 'straight' && n && pedCrossing && pedCrossing(e.to, next.to)) return false;
    return true;
  }

  step(dt, env) {
    const g = this.graph;
    const byEdge = new Map();
    for (const c of this.cars) {
      if (!g.edge(c.edge)) continue;
      if (!byEdge.has(c.edge)) byEdge.set(c.edge, []);
      byEdge.get(c.edge).push(c);
    }
    for (const list of byEdge.values()) list.sort((a, b) => b.offset - a.offset);
    const weatherF = env.weatherFactor ?? 1;

    // Phase 1: compute new speed/offset from the start-of-step snapshot.
    const plans = [];
    for (const car of this.cars) {
      const e = g.edge(car.edge);
      if (!e) { plans.push(null); continue; }
      if (car.broken) { car.speed = 0; plans.push({ car, off: car.offset, v: 0 }); continue; }
      if (car.parked) { car.parkedFor += dt; car.speed = 0; plans.push({ car, off: car.offset, v: 0 }); continue; }
      let next = this._next(car);
      if (next && (next.blocked || !g.edge(next.id)) && !car.committed) { this._plan(car); next = this._next(car); }
      const list = byEdge.get(e.id), idx = list.indexOf(car);
      const dense = list.length / Math.max(30, e.length);
      const densityF = Math.max(0.3, 1 - dense / 0.2);
      let v0 = e.speedLimit * weatherF * densityF * (car.kind === 'bus' ? 0.85 : 1);
      // Slow for turns.
      const toNode = e.length - car.offset;
      if (next && turnType(e, next) !== 'straight') {
        const tv = TURN_SPEED * weatherF;
        if (toNode < 35) v0 = Math.min(v0, tv + (v0 - tv) * Math.max(0, (toNode - TURN_R) / (35 - TURN_R)));
      }
      // Pre-brake when the next edge has a lower speed limit.
      if (next && next.speedLimit < v0 && toNode < 40) v0 = Math.min(v0, next.speedLimit + (v0 - next.speedLimit) * Math.max(0, (toNode - 10) / 30));
      const prev = car.prevEdge && g.edge(car.prevEdge);
      if (prev && car.offset < TURN_R && turnType(prev, e) !== 'straight') v0 = Math.min(v0, TURN_SPEED * weatherF);
      v0 = Math.max(0.5, Math.min(v0, e.speedLimit));

      // Leader search (gap measured bumper to bumper, along our path).
      let gap = Infinity, lv = 0;
      if (idx > 0) { const L = list[idx - 1]; gap = L.offset - L.len - car.offset; lv = L.speed; }
      else if (next) {
        const nl = byEdge.get(next.id);
        if (nl && nl.length) { const L = nl[nl.length - 1]; gap = toNode + L.offset - L.len; lv = L.speed; }
        // Committed cars from other approaches merging into the same exit.
        for (const c of this.cars) {
          if (c === car || !c.committed || c.route[0] !== next.id || c.edge === car.edge) continue;
          const ce = g.edge(c.edge); if (!ce) continue;
          const cv = c.offset - ce.length, mine = car.offset - e.length;
          if (cv > mine) { const gp = cv - c.len - mine; if (gp < gap) { gap = gp; lv = c.speed; } }
        }
      }
      // Destination: pull over at mid-edge.
      const arriving = car.destEdge === car.edge || (!next && !car.destEdge);
      const parkAt = car.destEdge === car.edge ? Math.max(car.offset, Math.min(e.length - STOP_DIST - 2, e.length * 0.5)) : e.length - STOP_DIST;
      // Stop line as a virtual stationary leader when we may not proceed.
      const stopPos = e.length - STOP_DIST;
      let stopLimit = Infinity;
      if (arriving) {
        const gp = parkAt - car.offset; if (gp < gap) { gap = gp; lv = 0; }
        stopLimit = parkAt;
      } else if (!car.committed && car.offset <= stopPos + 0.01) {
        const ok = this._permission(car, e, next, byEdge, env.pedCrossing);
        if (ok && car.offset + Math.max(car.speed, 1) * dt * 2 >= stopPos - 6) car.committed = true;
        if (!ok) { const gp = stopPos - car.offset; if (gp < gap) { gap = gp; lv = 0; } stopLimit = stopPos; }
      }
      // IDM acceleration.
      const v = car.speed, T = IDM.T / Math.max(0.6, weatherF);
      const sStar = IDM.s0 + Math.max(0, v * T + (v * (v - lv)) / (2 * Math.sqrt(IDM.a * IDM.b)));
      const s = Math.max(0.05, gap);
      let acc = IDM.a * (1 - Math.pow(v / v0, 4) - (gap === Infinity ? 0 : (sStar / s) ** 2));
      acc = Math.max(-9, Math.min(IDM.a, acc));
      let nv = Math.max(0, v + acc * dt);
      if (nv > e.speedLimit) nv = e.speedLimit;
      let off = car.offset + nv * dt;
      // Hard safety clamps: never pass a leader or an un-permitted stop line.
      if (gap !== Infinity && off > car.offset + Math.max(0, gap - MIN_GAP)) { off = car.offset + Math.max(0, gap - MIN_GAP); nv = Math.min(nv, lv); }
      if (off > stopLimit) { off = Math.max(car.offset, stopLimit); nv = 0; }
      car.accel = acc;
      plans.push({ car, off, v: nv, arriving, parkAt });
    }

    // Phase 2: apply, handle edge transitions.
    for (const p of plans) {
      if (!p) continue;
      const { car } = p;
      if (car.broken || car.parked) continue;
      car.speed = p.v; car.offset = p.off;
      car.waited = car.speed < 0.2 ? car.waited + dt : 0;
      let e = g.edge(car.edge);
      if (p.arriving && car.offset >= p.parkAt - 0.05 && car.speed < 0.6) {
        if (car.destEdge === car.edge || !car.destEdge) { car.parked = true; car.speed = 0; }
      }
      while (e && car.offset >= e.length) {
        const next = this._next(car);
        if (!next) { car.offset = e.length; car.speed = 0; break; }
        car.offset -= e.length;
        car.prevEdge = e.id; car.edge = next.id; car.committed = false;
        if (next.river === 'huangpu') {
          const east = next.geometry[1].x > next.geometry[0].x;
          if (east) this.crossings.crossEast++; else this.crossings.crossWest++;
          if (this.onCross) this.onCross(next, car, east);
        }
        e = next;
        if (car.speed > e.speedLimit) car.speed = e.speedLimit;
        this._plan(car);
      }
      // Deadlock breaker: long waits trigger a re-plan.
      if (car.waited > 90 && !car.committed) { this._plan(car); car.waited = 45; }
      this._pose(car);
    }
    for (const c of this.cars) if (c.broken || c.parked) this._pose(c);
  }

  avgSpeed() {
    const moving = this.cars.filter(c => !c.broken && !c.parked);
    return moving.length ? moving.reduce((s, c) => s + c.speed, 0) / moving.length : 0;
  }

  view() {
    return this.cars.map(c => ({
      id: c.id, kind: c.kind, edge: c.edge, offset: c.offset, speed: c.speed, destEdge: c.destEdge,
      x: c.x, z: c.z, heading: c.heading, broken: c.broken, parked: c.parked, color: c.color, len: c.len,
      route: c.route.slice(), committed: c.committed,
    }));
  }
}
