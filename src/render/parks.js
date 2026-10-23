// Parks (lawn, paths, benches, fountains with animated jets), mixed tree species and street trees.
// Seasonal foliage colours; appears in the 'amenities' phase.
import * as THREE from 'three';
import { hash } from './util.js';
import { glowTexture } from './textures.js';

const PHASE = [21.5, 24];
const FOLIAGE = {
  spring: ['#7fbf5a', '#f2b8c8', '#9ccc65'], summer: ['#3f7f3a', '#2f6b34', '#4c8a3f'],
  autumn: ['#d08a2e', '#b8492c', '#e0b33e'], winter: ['#6d7363', '#8d8f88', '#5b6655'],
};
const SPECIES = 3; // 0 round broadleaf, 1 cone (conifer), 2 tall poplar

function inst(geo, mat, n) { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.count = 0; m.frustumCulled = false; m.castShadow = true; return m; }

export class ParksView {
  constructor(scene, sim) {
    this.sim = sim; this.group = new THREE.Group(); scene.add(this.group);
    const lawn = new THREE.MeshStandardMaterial({ color: '#5f8f4a', roughness: 1 });
    const plaza = new THREE.MeshStandardMaterial({ color: '#c9c0ae', roughness: 0.9 });
    const path = new THREE.MeshStandardMaterial({ color: '#b5a68a', roughness: 1 });
    this.lawnMat = lawn;
    const trees = [];
    for (const p of sim.parks) {
      const w = p.x1 - p.x0, d = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), p.kind === 'square' ? plaza : lawn);
      base.position.set(cx, 0.2, -cz); base.receiveShadow = true; this.group.add(base);
      // Cross paths
      for (const [pw, pd] of [[w, 4], [4, d]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.45, pd), path); m.position.set(cx, 0.22, -cz); m.receiveShadow = true; this.group.add(m); }
      if (p.kind === 'square') {
        // People's Square: lawn quadrants around the plaza.
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 0.5, d * 0.22), lawn); m.position.set(cx + sx * w * 0.27, 0.25, -(cz + sz * d * 0.36)); this.group.add(m); }
      }
      // Trees: deterministic scatter avoiding the cross paths and the fountain.
      const n = Math.round(w * d / 260);
      for (let i = 0; i < n; i++) {
        const x = p.x0 + 4 + hash(i * 3.1 + cx) * (w - 8), z = p.z0 + 4 + hash(i * 7.7 + cz) * (d - 8);
        if (Math.abs(x - cx) < 5 || Math.abs(z - cz) < 5) continue;
        if (p.fountain && Math.hypot(x - p.fountain.x, z - p.fountain.z) < 12) continue;
        if (p.kind === 'square' && Math.abs(z - cz) < d * 0.25) continue;
        trees.push({ x, z, s: 0.8 + hash(i + cx * 0.1) * 0.6, sp: Math.floor(hash(i * 1.7 + cz) * SPECIES) });
      }
      this._benches(p, cx, cz, w, d);
    }
    // Street trees along avenues (every 25 units, both sides).
    const seen = new Set();
    for (const e of sim.g.edges) {
      if (seen.has(e.reverseId) || (e.kind !== 'avenue' && e.kind !== 'century') || e.bridge) continue; seen.add(e.id);
      const a = e.geometry[0], b = e.geometry[1], L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      for (let dd = 30; dd < L - 25; dd += 25) for (const s of [-1, 1]) trees.push({ x: a.x + ux * dd - uz * 12.5 * s, z: a.z + uz * dd + ux * 12.5 * s, s: 0.7, sp: 0 });
    }
    this._trees(trees);
    this._fountains();
  }

  _benches(p, cx, cz, w, d) {
    const wood = this.benchMat || (this.benchMat = new THREE.MeshStandardMaterial({ color: '#7a5434', roughness: 0.8 }));
    for (const [ox, oz, r] of [[w * 0.2, 3.5, 0], [-w * 0.2, 3.5, 0], [w * 0.2, -3.5, 0], [-w * 0.2, -3.5, 0], [3.5, d * 0.2, 1], [-3.5, -d * 0.2, 1]]) {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 0.8).translate(0, 0.7, 0), wood);
      const backr = new THREE.Mesh(new THREE.BoxGeometry(3, 0.7, 0.12).translate(0, 1.15, -0.4), wood);
      g.add(seat, backr); g.position.set(cx + ox, 0.4, -(cz + oz)); g.rotation.y = r ? Math.PI / 2 : oz > 0 ? Math.PI : 0;
      this.group.add(g);
    }
  }

  _trees(list) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 1 });
    this.leafMat = new THREE.MeshStandardMaterial({ roughness: 0.95, vertexColors: false });
    const crowns = [
      new THREE.IcosahedronGeometry(3.2, 1).translate(0, 6, 0),
      new THREE.ConeGeometry(2.8, 8, 7).translate(0, 7, 0),
      new THREE.CylinderGeometry(1.2, 1.8, 9, 7).translate(0, 8, 0),
    ];
    const trunk = inst(new THREE.CylinderGeometry(0.3, 0.45, 4, 5).translate(0, 2, 0), trunkMat, list.length);
    this.crowns = crowns.map(g => inst(g, this.leafMat, list.length));
    const counts = [0, 0, 0], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    list.forEach((t, i) => {
      const s = new THREE.Vector3(t.s, t.s * (0.9 + hash(i) * 0.3), t.s);
      m4.compose(new THREE.Vector3(t.x, 0.3, -t.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i * 2) * 6), s);
      trunk.setMatrixAt(i, m4);
      const c = this.crowns[t.sp]; c.setMatrixAt(counts[t.sp], m4); c.setColorAt(counts[t.sp], col.setScalar(0.82 + hash(i * 5) * 0.3)); counts[t.sp]++;
    });
    trunk.count = list.length; this.crowns.forEach((c, k) => { c.count = counts[k]; if (c.instanceColor) c.instanceColor.needsUpdate = true; });
    this.trunk = trunk; this.group.add(trunk, ...this.crowns);
    this.treeCount = list.length;
  }

  _fountains() {
    this.jets = [];
    const stone = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.7 });
    const water = new THREE.MeshStandardMaterial({ color: '#4d8fae', roughness: 0.1, metalness: 0.3 });
    const N = 160;
    for (const p of this.sim.parks) if (p.fountain) {
      const f = p.fountain, o = new THREE.Group();
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.5, 1.2, 28), stone); basin.position.y = 0.6;
      const pool = new THREE.Mesh(new THREE.CylinderGeometry(6.3, 6.3, 0.1, 28), water); pool.position.y = 1.15;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 2.6, 10), stone); col.position.y = 1.8;
      o.add(basin, pool, col); o.position.set(f.x, 0.3, -f.z);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture(), size: 1.4, color: '#dff4ff', transparent: true, opacity: 0.8, depthWrite: false }));
      pts.frustumCulled = false; o.add(pts); this.jets.push(pts);
      this.group.add(o);
    }
  }

  update(f) {
    const k = Math.max(0, Math.min(1, (f.build - PHASE[0]) / (PHASE[1] - PHASE[0])));
    this.group.visible = k > 0;
    // Trees grow in during the phase.
    const s = Math.max(0.01, Math.min(1, k * 1.4));
    for (const c of [this.trunk, ...this.crowns]) c.scale.set(1, s, 1);
    const pal = FOLIAGE[f.season] || FOLIAGE.spring, snow = f.weather === 'snow';
    this.leafMat.color.set(snow ? '#e8ecef' : pal[0]);
    this.lawnMat.color.set(snow ? '#e3e7ea' : f.season === 'autumn' ? '#8f8f4a' : f.season === 'winter' ? '#7d8466' : '#5f8f4a');
    // Fountain jets: parabolic particles (central jet + ring).
    for (const pts of this.jets) {
      const a = pts.geometry.attributes.position.array, n = a.length / 3;
      for (let i = 0; i < n; i++) {
        const life = (f.time * 0.6 + i / n) % 1, ang = i * 2.399, ring = i % 2;
        const r = ring ? 1 + life * 4.5 : life * 1.2, v = ring ? 5 : 9;
        a[i * 3] = Math.cos(ang) * r; a[i * 3 + 2] = Math.sin(ang) * r;
        a[i * 3 + 1] = 3 + v * life * 2.2 - 9.8 * life * life * 1.4 * (ring ? 1.4 : 1);
        if (a[i * 3 + 1] < 1.2) a[i * 3 + 1] = 1.2;
      }
      pts.geometry.attributes.position.needsUpdate = true;
      pts.visible = !snow;
    }
  }
}
