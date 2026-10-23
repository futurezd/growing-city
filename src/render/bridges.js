// Huangpu cable-stayed bridges (deck, railings, piers, H-towers, stay cables) and Suzhou Creek bridge railings.
// Built during the 'bridges' phase (10.5–12.5 s): piers rise, then the deck extends from both banks.
import * as THREE from 'three';
import { makeHeightFn, BRIDGE_PEAK } from './util.js';
import { ROAD_HALF_WIDTH } from '../sim/graph.js';

const PHASE = [10.5, 12.5];
const W = ROAD_HALF_WIDTH + 1.5;

export function bridgeSpans(sim) {
  return sim.bridges.map(b => ({ ...b, a: sim.g.node(b.nodeA), b: sim.g.node(b.nodeB) })).filter(b => b.a && b.b);
}

export class BridgesView {
  constructor(scene, sim) {
    this.scene = scene; this.sim = sim; this.group = new THREE.Group(); scene.add(this.group);
    this.mats = {
      deck: new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.85 }),
      concrete: new THREE.MeshStandardMaterial({ color: '#b8b6ae', roughness: 0.8 }),
      rail: new THREE.MeshStandardMaterial({ color: '#d9dcdf', roughness: 0.5, metalness: 0.4 }),
      cable: new THREE.LineBasicMaterial({ color: '#e9edf0', transparent: true, opacity: 0.85 }),
      tower: new THREE.MeshStandardMaterial({ color: '#c9c6bd', roughness: 0.7 }),
    };
    this.version = -1;
  }

  rebuild() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.geometry?.dispose(); }
    this.spans = bridgeSpans(this.sim);
    this.height = makeHeightFn(this.spans);
    this.parts = [];
    for (const s of this.spans) this._huangpu(s);
    this._suzhou();
    this.version = this.sim.g.version;
  }

  _huangpu(s) {
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    const ang = Math.atan2(dz, dx), N = Math.ceil(L / 6);
    const pt = (t, off = 0, y = 0) => new THREE.Vector3(s.a.x + ux * L * t + nx * off, this.height(s.a.x + ux * L * t, s.a.z + uz * L * t) + y, -(s.a.z + uz * L * t + nz * off));
    // Deck: a curved slab following the height profile (top + sides), built as a ribbon.
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      for (const [o, y] of [[-W, 0], [W, 0], [W, -1.6], [-W, -1.6]]) { const p = pt(t, o, y); pos.push(p.x, p.y, p.z); }
      if (i) { const a = (i - 1) * 4, b = i * 4; for (const [p, q] of [[0, 1], [1, 2], [3, 0]]) idx.push(a + p, b + p, a + q, a + q, b + p, b + q); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const deck = new THREE.Mesh(g, this.mats.deck); deck.castShadow = deck.receiveShadow = true;
    deck.material = this.mats.deck.clone(); deck.material.side = THREE.DoubleSide;
    this._add(deck, 'deck');
    // Railings: posts every 3 units + continuous handrail on both sides.
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 1.2, 0.25).translate(0, 0.6, 0), this.mats.rail, 2 * Math.ceil(L / 3) + 2);
    let n = 0; const m4 = new THREE.Matrix4();
    for (let d = 0; d <= L; d += 3) for (const o of [-W + 0.3, W - 0.3]) { const p = pt(d / L, o); posts.setMatrixAt(n++, m4.makeTranslation(p.x, p.y, p.z)); }
    posts.count = n; this._add(posts, 'deck');
    for (const o of [-W + 0.3, W - 0.3]) {
      const curve = new THREE.CatmullRomCurve3(Array.from({ length: 25 }, (_, i) => pt(i / 24, o, 1.2)));
      this._add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.12, 4), this.mats.rail), 'deck');
    }
    // Piers: two main piers under the towers + approach piers.
    for (const t of [0.12, 0.25, 0.35, 0.65, 0.75, 0.88]) {
      const p = pt(t), h = p.y + 1;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(3, h, W * 1.4), this.mats.concrete);
      pier.position.set(p.x, h / 2 - 1.6, p.z); pier.rotation.y = -ang; pier.castShadow = true;
      this._add(pier, 'pier');
    }
    // H-shaped towers with fan of stay cables (cable-stayed like Nanpu / Yangpu bridges).
    const TH = 46 + BRIDGE_PEAK;
    for (const t of [0.3, 0.7]) {
      const base = pt(t), tower = new THREE.Group();
      for (const o of [-W - 1, W + 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(2.2, TH, 2.2), this.mats.tower);
        leg.position.set(0, TH / 2 - 2, o); leg.castShadow = true; tower.add(leg);
      }
      for (const y of [TH * 0.45, TH - 4]) { const beam = new THREE.Mesh(new THREE.BoxGeometry(2, 2, W * 2 + 4), this.mats.tower); beam.position.y = y; tower.add(beam); }
      tower.position.copy(base).setY(0); tower.rotation.y = -ang;
      this._add(tower, 'tower');
      const lines = [];
      for (const side of [-1, 1]) for (let k = 1; k <= 9; k++) {
        const tt = t + side * k * 0.022; if (tt <= 0.02 || tt >= 0.98) continue;
        for (const o of [-W - 1, W + 1]) {
          const top = pt(t, o); top.y = TH - 6 - k * 1.6;
          const deckP = pt(tt, o * 0.95, 0.2);
          lines.push(top.x, top.y, top.z, deckP.x, deckP.y, deckP.z);
        }
      }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      this._add(new THREE.LineSegments(lg, this.mats.cable), 'cable');
    }
  }

  // Suzhou Creek crossings are part of the street grid; give them balustrades so they read as bridges.
  _suzhou() {
    const list = [], seen = new Set();
    for (const e of this.sim.g.edges) if (e.river === 'suzhou' && !seen.has(e.reverseId)) { seen.add(e.id); list.push(e); }
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.1, 0.5).translate(0, 0.55, 0), this.mats.concrete, list.length * 2 + 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const e of list) {
      const a = e.geometry[0], b = e.geometry[1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, nx = -dz / L, nz = dx / L;
      q.setFromAxisAngle(Y, Math.atan2(dz, dx));
      for (const s of [-1, 1]) { m4.compose(new THREE.Vector3(mx + nx * W * s, 0.1, -(mz + nz * W * s)), q, new THREE.Vector3(34, 1, 1)); m.setMatrixAt(n++, m4); }
    }
    m.count = n; this._add(m, 'deck');
  }

  _add(o, kind) { this.group.add(o); this.parts.push({ o, kind }); }

  update(f) {
    if (this.version !== this.sim.g.version) this.rebuild();
    const k = Math.max(0, Math.min(1, (f.build - PHASE[0]) / (PHASE[1] - PHASE[0])));
    for (const { o, kind } of this.parts) {
      if (kind === 'pier') { o.visible = k > 0; o.scale.y = Math.max(0.01, Math.min(1, k * 3)); }
      else if (kind === 'tower') { o.visible = k > 0.15; o.scale.y = Math.max(0.01, Math.min(1, (k - 0.15) * 2.5)); }
      else o.visible = k >= (kind === 'cable' ? 0.85 : 0.55);
    }
  }
}
