// Road network: directed edge pairs on a 100-unit grid shaped by the Huangpu and Suzhou Creek.
// Pure logic (no three.js / DOM) so it can run headless under node.
import {
  HUANGPU, SUZHOU, distToPolyline, segmentCrossesHuangpu, isPudong,
  BRIDGE_DEFS, LANDMARK_POS, CENTURY_AVENUE,
} from './geo.js';

export const GRID = { step: 100, x0: -1200, x1: 1200, z0: -800, z1: 700 };
export const ROAD_HALF_WIDTH = 7;

function crossesSuzhou(a, b) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = distToPolyline(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, SUZHOU);
    if (r.d <= r.hw + 2) return true;
  }
  return false;
}

// Minimal binary heap keyed by priority.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item, p) {
    const a = this.a; a.push({ item, p });
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j].p <= a[i].p) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top.item;
  }
}

export class RoadGraph {
  constructor() { this.clear(); }

  clear() {
    this.nodes = []; this.edges = []; this.bridges = [];
    this.nodeMap = new Map(); this.edgeMap = new Map();
    this.outMap = new Map(); this.inMap = new Map();
    this.version = 0; this._nid = 0; this._eid = 0;
  }

  node(id) { return this.nodeMap.get(id) || null; }
  edge(id) { return this.edgeMap.get(id) || null; }
  out(nodeId) { return (this.outMap.get(nodeId) || []).map(id => this.edgeMap.get(id)); }
  in(nodeId) { return (this.inMap.get(nodeId) || []).map(id => this.edgeMap.get(id)); }
  neighbors(nodeId) {
    const s = new Set();
    for (const e of this.out(nodeId)) s.add(e.to);
    for (const e of this.in(nodeId)) s.add(e.from);
    return [...s];
  }
  degree(nodeId) { return this.neighbors(nodeId).length; }

  addNode(x, z) {
    const n = { id: `n${this._nid++}`, x, z };
    this.nodes.push(n); this.nodeMap.set(n.id, n);
    this.outMap.set(n.id, []); this.inMap.set(n.id, []);
    return n;
  }

  _removeNode(id) {
    for (const e of [...this.out(id), ...this.in(id)]) if (this.edgeMap.has(e.id)) this._deleteEdgePair(e);
    this.nodes = this.nodes.filter(n => n.id !== id);
    this.nodeMap.delete(id); this.outMap.delete(id); this.inMap.delete(id);
  }

  _makeEdge(a, b, o) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dir = Math.abs(dx) >= Math.abs(dz) ? 'ew' : 'ns';
    const e = {
      id: `e${this._eid++}`, from: a.id, to: b.id, dir, approach: dir,
      speedLimit: o.speedLimit ?? 11,
      geometry: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }],
      bridge: !!o.bridge, blocked: false, crosswalk: !o.bridge,
      length: Math.hypot(dx, dz), reverseId: null,
      river: o.river || null, pedOnly: !!o.pedOnly, kind: o.kind || 'street',
    };
    this.edges.push(e); this.edgeMap.set(e.id, e);
    this.outMap.get(a.id).push(e.id); this.inMap.get(b.id).push(e.id);
    return e;
  }

  // Creates a two-way road (two directed edges) and returns the a→b edge.
  _link(a, b, o = {}) {
    const f = this._makeEdge(a, b, o), r = this._makeEdge(b, a, o);
    f.reverseId = r.id; r.reverseId = f.id;
    return f;
  }

  _deleteEdgePair(e) {
    for (const x of [e, this.edgeMap.get(e.reverseId)]) {
      if (!x) continue;
      this.edgeMap.delete(x.id);
      const o = this.outMap.get(x.from); if (o) o.splice(o.indexOf(x.id), 1);
      const i = this.inMap.get(x.to); if (i) i.splice(i.indexOf(x.id), 1);
    }
    const dead = new Set([e.id, e.reverseId]);
    this.edges = this.edges.filter(x => !dead.has(x.id));
  }

  connected(a, b) { return (this.outMap.get(a) || []).some(id => this.edgeMap.get(id).to === b); }

  buildCity() {
    this.clear();
    const { step, x0, x1, z0, z1 } = GRID;
    const at = new Map(), key = (x, z) => `${x},${z}`;
    const square = LANDMARK_POS.peoplesSquare;
    for (let z = z0; z <= z1; z += step) {
      for (let x = x0; x <= x1; x += step) {
        // Zhongshan East-1 Road (the Bund) runs between the classical row and the river at x = -35.
        const nx = x === 0 && z >= -200 && z <= 300 ? -35 : x;
        const h = distToPolyline(nx, z, HUANGPU), s = distToPolyline(nx, z, SUZHOU);
        if (h.d < h.hw + 10 || s.d < s.hw + 8) continue;
        // People's Square park occupies the 2x2 block around (-600, 0).
        if (x === square.x && z === 0) continue;
        at.set(key(x, z), this.addNode(nx, z));
      }
    }
    const nj = LANDMARK_POS.nanjingRoad;
    for (const a of this.nodes.slice()) {
      for (const [bx, bz] of [[a.x + step, a.z], [a.x, a.z + step]]) {
        const b = at.get(key(bx, bz)); if (!b) continue;
        if (segmentCrossesHuangpu(a, b)) continue;
        const horizontal = bz === a.z;
        const artery = horizontal ? a.z % 300 === 0 : a.x % 300 === 0;
        const suz = crossesSuzhou(a, b);
        const pedOnly = horizontal && a.z === nj.z && a.x >= nj.x0 && bx <= nj.x1;
        this._link(a, b, {
          speedLimit: artery ? 15 : 11, bridge: suz, river: suz ? 'suzhou' : null,
          pedOnly, kind: pedOnly ? 'pedestrian' : artery ? 'avenue' : 'street',
        });
      }
    }
    // Century Avenue: diagonal boulevard through grid nodes in Pudong.
    for (let i = 0; i < CENTURY_AVENUE.length - 1; i++) {
      const a = at.get(key(CENTURY_AVENUE[i].x, CENTURY_AVENUE[i].z));
      const b = at.get(key(CENTURY_AVENUE[i + 1].x, CENTURY_AVENUE[i + 1].z));
      if (a && b && !this.connected(a.id, b.id)) this._link(a, b, { speedLimit: 15, kind: 'century' });
    }
    // Huangpu bridges: nearest surviving land nodes on each bank of the chosen grid row.
    for (const def of BRIDGE_DEFS) {
      const rowZ = Math.round(def.z / step) * step;
      const row = this.nodes.filter(n => n.z === rowZ);
      const w = row.filter(n => !isPudong(n.x, n.z)).sort((p, q) => q.x - p.x)[0];
      const e = row.filter(n => isPudong(n.x, n.z)).sort((p, q) => p.x - q.x)[0];
      if (!w || !e) continue;
      const f = this._link(w, e, { speedLimit: 18, bridge: true, river: 'huangpu', kind: 'bridge' });
      this.bridges.push({ id: `bridge${this.bridges.length}`, nodeA: w.id, nodeB: e.id, name: def.name, edgeId: f.id, reverseId: f.reverseId });
    }
    this._keepLargestComponent();
    this.version++;
    return this;
  }

  _keepLargestComponent() {
    const seen = new Set(); let best = [];
    for (const n of this.nodes) {
      if (seen.has(n.id)) continue;
      const comp = [], stack = [n.id]; seen.add(n.id);
      while (stack.length) {
        const id = stack.pop(); comp.push(id);
        for (const m of this.neighbors(id)) if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
      if (comp.length > best.length) best = comp;
    }
    const keep = new Set(best);
    for (const n of this.nodes.slice()) if (!keep.has(n.id)) this._removeNode(n.id);
  }

  lightNodes() { return this.nodes.filter(n => this.degree(n.id) >= 3).map(n => n.id); }

  addRoad(a, b) {
    const na = this.node(a), nb = this.node(b);
    if (!na || !nb || a === b || this.connected(a, b) || this.connected(b, a)) return null;
    if (segmentCrossesHuangpu(na, nb)) return null;
    const suz = crossesSuzhou(na, nb);
    const f = this._link(na, nb, { speedLimit: 11, bridge: suz, river: suz ? 'suzhou' : null });
    this.version++;
    return f.id;
  }

  removeRoad(edgeId) {
    const e = this.edge(edgeId); if (!e) return false;
    this._deleteEdgePair(e);
    this.bridges = this.bridges.filter(b => b.edgeId !== e.id && b.reverseId !== e.id);
    this.version++;
    return true;
  }

  // A* over nodes; cost = travel time. Blocked edges are skipped, pedestrian streets skipped for cars.
  pathfind(a, b, { car = true } = {}) {
    if (!this.nodeMap.has(a) || !this.nodeMap.has(b)) return null;
    if (a === b) return [a];
    const goal = this.nodeMap.get(b);
    const h = id => { const n = this.nodeMap.get(id); return Math.hypot(n.x - goal.x, n.z - goal.z) / 18; };
    const g = new Map([[a, 0]]), prev = new Map(), closed = new Set(), open = new Heap();
    open.push(a, h(a));
    while (open.size) {
      const cur = open.pop();
      if (cur === b) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      const gc = g.get(cur);
      for (const id of this.outMap.get(cur)) {
        const e = this.edgeMap.get(id);
        if (e.blocked || (car && e.pedOnly) || closed.has(e.to)) continue;
        const ng = gc + e.length / e.speedLimit;
        if (ng < (g.get(e.to) ?? Infinity)) { g.set(e.to, ng); prev.set(e.to, cur); open.push(e.to, ng + h(e.to)); }
      }
    }
    if (!prev.has(b)) return null;
    const path = [b];
    for (let at = b; at !== a;) { at = prev.get(at); path.push(at); }
    return path.reverse();
  }

  edgeBetween(from, to, car = true) {
    for (const id of this.outMap.get(from) || []) {
      const e = this.edgeMap.get(id);
      if (e.to === to && !e.blocked && !(car && e.pedOnly)) return e;
    }
    return null;
  }

  // Edge route after leaving fromEdge, ending with toEdge (inclusive). null if unreachable.
  edgePath(fromEdgeId, toEdgeId) {
    const f = this.edge(fromEdgeId), t = this.edge(toEdgeId);
    if (!f || !t || t.blocked || t.pedOnly) return null;
    const nodes = this.pathfind(f.to, t.from);
    if (!nodes) return null;
    const route = [];
    for (let i = 0; i < nodes.length - 1; i++) route.push(this.edgeBetween(nodes[i], nodes[i + 1]).id);
    route.push(t.id);
    return route;
  }

  graphView() {
    return {
      nodes: this.nodes.map(({ id, x, z }) => ({ id, x, z })),
      edges: this.edges.map(e => ({
        id: e.id, from: e.from, to: e.to, dir: e.dir, speedLimit: e.speedLimit,
        geometry: e.geometry.map(p => ({ ...p })), bridge: e.bridge, blocked: e.blocked,
        crosswalk: e.crosswalk, approach: e.approach, pedOnly: e.pedOnly, river: e.river,
      })),
    };
  }
}
