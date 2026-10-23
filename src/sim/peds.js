// Pedestrians: walk on sidewalks, cross at zebra crossings only on the parallel green phase.
import { ROAD_HALF_WIDTH } from './graph.js';
export const SIDE = ROAD_HALF_WIDTH + 3; // sidewalk centre offset from road centre
const CORNER = SIDE;                    // corner/crosswalk distance from the node

const dirOf = e => { const [a, b] = e.geometry; const l = e.length || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };

export class Pedestrians {
  constructor(graph, signals, rng) {
    this.graph = graph; this.signals = signals; this.rng = rng;
    this.list = []; this.byId = new Map(); this.nextId = 1;
  }

  clear() { this.list = []; this.byId.clear(); }
  get(id) { return this.byId.get(id) || null; }
  remove(id) { const p = this.byId.get(id); if (!p) return; this.byId.delete(id); this.list.splice(this.list.indexOf(p), 1); }

  spawn({ edge, offset = null, auto = false, side = null } = {}) {
    const e = this.graph.edge(edge);
    if (!e || (e.river === 'huangpu')) return null;
    const lo = Math.min(CORNER, e.length / 2), hi = Math.max(lo, e.length - CORNER);
    const off = offset == null ? this.rng.range(lo, hi) : Math.max(lo, Math.min(hi, +offset || 0));
    const p = {
      id: `p${this.nextId++}`, edge: e.id, offset: off, side: side ?? (this.rng.chance(0.5) ? 1 : -1),
      speed: this.rng.range(1.9, 2.6), state: 'walk', crossing: null, cross: null,
      lane: e.pedOnly ? this.rng.range(-6, 6) : 0, legs: auto ? this.rng.int(3, 9) : Infinity,
      auto, x: 0, z: 0, heading: 0, waited: 0, color: this.rng.int(0, 10), fade: 1, leaving: false,
    };
    this._pose(p);
    this.list.push(p); this.byId.set(p.id, p);
    return p.id;
  }

  _lateral(p, e) { return e.pedOnly ? p.lane : p.side * SIDE; }

  _pose(p) {
    if (p.cross) {
      const c = p.cross, t = Math.min(1, c.t / c.len);
      p.x = c.a.x + (c.b.x - c.a.x) * t; p.z = c.a.z + (c.b.z - c.a.z) * t;
      p.heading = Math.atan2(c.b.x - c.a.x, c.b.z - c.a.z);
      return;
    }
    const e = this.graph.edge(p.edge); if (!e) return;
    const d = dirOf(e), a = e.geometry[0], lat = this._lateral(p, e);
    p.x = a.x + d.x * p.offset + d.z * lat; p.z = a.z + d.z * p.offset - d.x * lat;
    p.heading = Math.atan2(d.x, d.z);
  }

  // Outgoing arm at node lying on the walker's side (right for side=+1).
  _sideArm(e, side) {
    const d = dirOf(e), r = { x: d.z * side, z: -d.x * side };
    for (const o of this.graph.out(e.to)) {
      const od = dirOf(o);
      if (od.x * r.x + od.z * r.z > 0.7) return o;
    }
    return null;
  }

  _straight(e) {
    const d = dirOf(e);
    for (const o of this.graph.out(e.to)) { const od = dirOf(o); if (od.x * d.x + od.z * d.z > 0.7 && o.river !== 'huangpu') return o; }
    return null;
  }

  // True when a pedestrian is on (or committed to) the crosswalk over arm nodeId→armTo.
  isCrossing(nodeId, armTo) {
    for (const p of this.list) if (p.crossing && p.crossing.node === nodeId && p.crossing.arm === armTo) return true;
    return false;
  }

  _decide(p, e) {
    const straight = this._straight(e), arm = this._sideArm(e, p.side);
    const rev = this.graph.edge(e.reverseId);
    const r = this.rng.next();
    if (straight && r < 0.6) return { kind: 'straight', next: straight, arm };
    if (arm && r < 0.9 && arm.river !== 'huangpu') return { kind: 'turn', next: arm };
    if (straight) return { kind: 'straight', next: straight, arm };
    if (arm && arm.river !== 'huangpu') return { kind: 'turn', next: arm };
    return { kind: 'reverse', next: rev };
  }

  step(dt, { carNear } = {}) {
    for (const p of [...this.list]) {
      if (p.leaving) { p.fade -= dt * 1.5; if (p.fade <= 0) this.remove(p.id); continue; }
      if (p.cross) {
        p.cross.t += p.speed * dt;
        if (p.cross.t >= p.cross.len) {
          const n = p.cross.next; p.cross = null; p.crossing = null; p.state = 'walk';
          p.edge = n.id; p.offset = Math.min(CORNER, n.length / 2);
        }
        this._pose(p); continue;
      }
      const e = this.graph.edge(p.edge);
      if (!e) { this.remove(p.id); continue; }
      const end = e.length - Math.min(CORNER, e.length / 2);
      if (p.state === 'walk') {
        p.offset += p.speed * dt;
        if (p.offset >= end) {
          p.offset = end;
          if (p.auto && --p.legs <= 0) { p.leaving = true; continue; }
          p.plan = this._decide(p, e); p.state = 'wait'; p.waited = 0;
        }
      }
      if (p.state === 'wait') {
        const plan = p.plan;
        if (!plan || !plan.next || !this.graph.edge(plan.next.id)) { p.plan = this._decide(p, e); this._pose(p); continue; }
        if (plan.kind === 'turn') { this._enter(p, plan.next, p.side); }
        else if (plan.kind === 'reverse') { this._enter(p, plan.next, -p.side); }
        else if (!plan.arm || e.pedOnly && !this.signals.get(e.to)) {
          this._enter(p, plan.next, p.side, 0);
        } else {
          // Zebra crossing over the side arm: needs the parallel (same-axis) green with enough time left.
          const light = this.signals.get(e.to);
          const width = CORNER * 2, need = width / p.speed + 1;
          const ok = !light || this.signals.greenRemaining(e.to, e.approach) >= need;
          const blocked = carNear && carNear(e.to, plan.arm.to);
          p.waited += dt;
          if (ok && !blocked) {
            const d = dirOf(e), node = this.graph.node(e.to), lat = this._lateral(p, e);
            const rx = d.z, rz = -d.x;
            const a = { x: node.x - d.x * CORNER + rx * lat, z: node.z - d.z * CORNER + rz * lat };
            const b = { x: node.x + d.x * CORNER + rx * lat, z: node.z + d.z * CORNER + rz * lat };
            p.cross = { a, b, t: 0, len: width, next: plan.next };
            p.crossing = { node: e.to, arm: plan.arm.to, axis: e.approach, edge: e.id };
            p.state = 'cross';
          } else if (p.waited > 200) { p.plan = { kind: 'turn', next: plan.arm }; }
        }
      }
      this._pose(p);
    }
  }

  _enter(p, next, side) {
    p.edge = next.id; p.side = side; p.state = 'walk'; p.plan = null;
    p.offset = Math.min(CORNER, next.length / 2);
    if (next.pedOnly) p.lane = this.rng.range(-6, 6);
  }

  view() {
    return this.list.map(p => ({
      id: p.id, edge: p.edge, offset: p.offset, x: p.x, z: p.z, heading: p.heading, state: p.state,
      crossing: p.crossing ? { ...p.crossing } : null, color: p.color, fade: p.fade, speed: p.speed,
    }));
  }
}
