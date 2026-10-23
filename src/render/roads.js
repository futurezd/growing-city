// Road surfaces, sidewalks and markings (centre lines, stop lines, zebra crossings) as instanced meshes.
// Arterials appear during the 'arterial' phase, the street grid during 'streets', markings afterwards.
import * as THREE from 'three';
import { ROAD_HALF_WIDTH } from '../sim/graph.js';
import { STOP_DIST } from '../sim/traffic.js';

const KIND_COLOR = { avenue: '#34373c', century: '#303338', street: '#3d4046', pedestrian: '#9b7f6c', bridge: '#3a3d42' };
const PHASE = { arterial: [5, 8], streets: [8, 10.5] };
const CROSS_D = 10.5;           // zebra crossing centre distance from the junction centre

const unitPlane = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function inst(geo, mat, n) { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.count = 0; m.receiveShadow = true; m.frustumCulled = false; return m; }

export class RoadsView {
  constructor(scene, sim) {
    this.scene = scene; this.sim = sim; this.group = new THREE.Group(); scene.add(this.group);
    this.version = -1;
    this.mats = {
      road: new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
      walk: new THREE.MeshStandardMaterial({ color: '#8d8a84', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }),
      white: new THREE.MeshStandardMaterial({ color: '#e9e9e2', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }),
      yellow: new THREE.MeshStandardMaterial({ color: '#e0b43a', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }),
    };
    this.wet = 0;
  }

  // Undirected, renderable edges (Huangpu bridge decks are drawn by BridgesView).
  _segments() {
    const seen = new Set(), out = [];
    for (const e of this.sim.g.edges) {
      if (seen.has(e.reverseId) || e.river === 'huangpu') continue;
      seen.add(e.id);
      const a = e.geometry[0], b = e.geometry[e.geometry.length - 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      out.push({ e, a, b, L, ux: dx / L, uz: dz / L, ang: Math.atan2(dz, dx), arterial: e.kind === 'avenue' || e.kind === 'century', mx: (a.x + b.x) / 2, mz: (a.z + b.z) / 2 });
    }
    // Construction order: arterials first, then streets; each ring grows outward from the centre.
    out.sort((p, q) => (p.arterial === q.arterial ? Math.hypot(p.mx, p.mz) - Math.hypot(q.mx, q.mz) : p.arterial ? -1 : 1));
    return out;
  }

  rebuild() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.dispose?.(); }
    const segs = this._segments(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    this.road = inst(unitPlane(), this.mats.road, segs.length);
    this.walk = inst(unitPlane(), this.mats.walk, segs.length);
    this.nArterial = segs.filter(s => s.arterial).length;
    const place = (im, i, x, y, z, ang, len, wid) => {
      q.setFromAxisAngle(Y, ang); m4.compose(new THREE.Vector3(x, y, -z), q, new THREE.Vector3(len, 1, wid)); im.setMatrixAt(i, m4);
    };
    segs.forEach((s, i) => {
      const hw = s.arterial ? ROAD_HALF_WIDTH + 1 : ROAD_HALF_WIDTH;
      place(this.road, i, s.mx, 0.12, s.mz, s.ang, s.L + hw * 2, hw * 2);
      place(this.walk, i, s.mx, 0.07, s.mz, s.ang, s.L + hw * 2 + 6, hw * 2 + 7);
      this.road.setColorAt(i, col.set(KIND_COLOR[s.e.kind] || KIND_COLOR.street));
    });
    this.road.instanceColor.needsUpdate = true;
    this.segCount = segs.length;

    // ---- markings ----
    const marks = { white: [], yellow: [] };
    const lightNodes = new Set(this.sim.signals.list.map(l => l.nodeId));
    for (const s of segs) {
      if (s.e.pedOnly) continue;
      const nx = -s.uz, nz = s.ux, start = 16, end = s.L - 16;   // keep junction boxes clear
      if (end <= start) continue;
      if (s.arterial) {
        for (const off of [-0.25, 0.25]) marks.yellow.push([s.mx + nx * off, s.mz + nz * off, s.ang, end - start, 0.18]);
      } else {
        for (let d = start; d < end; d += 6) { const c = d + 1.5; marks.white.push([s.a.x + s.ux * c, s.a.z + s.uz * c, s.ang, 3, 0.18]); }
      }
    }
    for (const e of this.sim.g.edges) {
      if (!lightNodes.has(e.to) || e.pedOnly) continue;
      const a = e.geometry[0], b = e.geometry[e.geometry.length - 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, rx = uz, rz = -ux, ang = Math.atan2(uz, ux);
      if (e.river !== 'huangpu') {
        // Stop line across the incoming lanes (right half of the road).
        const sx = b.x - ux * STOP_DIST + rx * ROAD_HALF_WIDTH / 2, sz = b.z - uz * STOP_DIST + rz * ROAD_HALF_WIDTH / 2;
        marks.white.push([sx, sz, ang + Math.PI / 2, ROAD_HALF_WIDTH - 0.6, 0.55]);
      }
      if (!e.crosswalk) continue;
      // Zebra crossing over this arm: stripes parallel to traffic, spread across the full width.
      const cx = b.x - ux * CROSS_D, cz = b.z - uz * CROSS_D;
      // Each arm has exactly one incoming edge, so it paints the full road width.
      for (let k = -ROAD_HALF_WIDTH + 1; k <= ROAD_HALF_WIDTH - 1; k += 1.6) marks.white.push([cx + rx * k, cz + rz * k, ang, 3.6, 0.8]);
    }
    for (const [key, list] of Object.entries(marks)) {
      const im = inst(unitPlane(), this.mats[key], list.length);
      list.forEach((m, i) => place(im, i, m[0], 0.16, m[1], m[2], m[3], m[4]));
      im.count = list.length; im.receiveShadow = true;
      this[key] = im; this.group.add(im);
    }
    this.group.add(this.walk, this.road);
    this.version = this.sim.g.version;
  }

  update(f) {
    if (this.version !== this.sim.g.version) this.rebuild();
    const t = f.build;
    const k = (p) => Math.max(0, Math.min(1, (t - p[0]) / (p[1] - p[0])));
    const n = Math.round(this.nArterial * k(PHASE.arterial) + (this.segCount - this.nArterial) * k(PHASE.streets));
    this.road.count = this.walk.count = n;
    this.white.visible = this.yellow.visible = t >= PHASE.streets[1] - 0.6;
    // Wet asphalt in rain/snow: darker and glossier.
    const wet = f.weather === 'clear' ? 0 : 1;
    this.wet += (wet - this.wet) * 0.03;
    this.mats.road.roughness = 0.92 - this.wet * 0.55;
    this.mats.road.metalness = this.wet * 0.25;
    this.mats.walk.color.set(f.weather === 'snow' ? '#c9ccd0' : '#8d8a84');
  }
}
