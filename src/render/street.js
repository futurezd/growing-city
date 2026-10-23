// Street furniture: lamp posts (+ night glow), 3D traffic signals driven by sim.lights,
// bus shelters and metro entrances. Appears in the 'amenities' phase (21.5–24 s).
import * as THREE from 'three';
import { ROAD_HALF_WIDTH } from '../sim/graph.js';
import { glowTexture, metroSignTexture, busSignTexture } from './textures.js';

const PHASE = [21.5, 24];
const LAMP_STEP = 34, LAMP_H = 7, SIG_H = 5.2;
const COL = { red: new THREE.Color('#ff2a1f'), yellow: new THREE.Color('#ffc21a'), green: new THREE.Color('#1fff6a'), off: new THREE.Color('#1b1d1f') };

function inst(geo, mat, n) { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.count = 0; m.frustumCulled = false; return m; }

export class StreetView {
  constructor(scene, sim) {
    this.scene = scene; this.sim = sim; this.group = new THREE.Group(); scene.add(this.group);
    this.metal = new THREE.MeshStandardMaterial({ color: '#2d3236', roughness: 0.5, metalness: 0.6 });
    this.bulbMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.glowMat = new THREE.PointsMaterial({ map: glowTexture(), size: 16, color: '#ffd9a0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.version = -1;
  }

  _clear() { for (const o of [...this.group.children]) { this.group.remove(o); o.geometry?.dispose(); } }

  rebuild() {
    this._clear();
    const g = this.sim.g, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    // ---- lamps along both sides of every road (not Huangpu decks) ----
    const lamps = [], seen = new Set();
    const busStops = [];
    for (const e of g.edges) {
      if (seen.has(e.reverseId) || e.river === 'huangpu') continue; seen.add(e.id);
      const a = e.geometry[0], b = e.geometry[1], L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const off = ROAD_HALF_WIDTH + 1.6;
      for (let d = 22; d < L - 18; d += LAMP_STEP) for (const s of [-1, 1]) lamps.push({ x: a.x + ux * d - uz * off * s, z: a.z + uz * d + ux * off * s, ang: Math.atan2(uz, ux) + (s > 0 ? Math.PI / 2 : -Math.PI / 2) });
      if ((e.kind === 'avenue' || e.kind === 'century') && L >= 80 && (parseInt(e.id.slice(1), 10) % 3 === 0)) busStops.push({ x: a.x + ux * L * 0.5 + uz * (off + 1), z: a.z + uz * L * 0.5 - ux * (off + 1), ang: Math.atan2(uz, ux) });
    }
    const pole = inst(new THREE.CylinderGeometry(0.15, 0.22, LAMP_H, 6).translate(0, LAMP_H / 2, 0), this.metal, lamps.length);
    const arm = inst(new THREE.BoxGeometry(2.2, 0.18, 0.5).translate(1.0, LAMP_H, 0), this.metal, lamps.length);
    const glowPos = [];
    lamps.forEach((l, i) => {
      q.setFromAxisAngle(Y, l.ang); m4.compose(new THREE.Vector3(l.x, 0, -l.z), q, one);
      pole.setMatrixAt(i, m4); arm.setMatrixAt(i, m4);
      glowPos.push(l.x + Math.cos(l.ang) * 2, LAMP_H - 0.3, -(l.z + Math.sin(l.ang) * 2));
    });
    pole.count = arm.count = lamps.length; pole.castShadow = true;
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
    this.glow = new THREE.Points(gg, this.glowMat); this.glow.frustumCulled = false;
    this.group.add(pole, arm, this.glow);
    this.lampCount = lamps.length;

    // ---- traffic signals: one pole + 3-lens head per incoming arm ----
    this.heads = [];
    for (const l of this.sim.signals.list) for (const e of g.in(l.nodeId)) {
      if (e.pedOnly) continue;
      const a = e.geometry[0], b = e.geometry[1], L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      // Far-right corner as seen by the approaching driver; head faces back toward the traffic.
      const x = b.x - ux * (ROAD_HALF_WIDTH + 2) + uz * (ROAD_HALF_WIDTH + 1.4), z = b.z - uz * (ROAD_HALF_WIDTH + 2) - ux * (ROAD_HALF_WIDTH + 1.4);
      this.heads.push({ light: l, axis: e.approach, x, z, ang: Math.atan2(-uz, -ux) });
    }
    const H = this.heads.length;
    const sPole = inst(new THREE.CylinderGeometry(0.16, 0.16, SIG_H, 6).translate(0, SIG_H / 2, 0), this.metal, H);
    const sBox = inst(new THREE.BoxGeometry(0.5, 2.1, 0.7).translate(0, SIG_H + 0.6, 0), new THREE.MeshStandardMaterial({ color: '#15181b', roughness: 0.6 }), H);
    this.bulbs = inst(new THREE.SphereGeometry(0.24, 8, 6), this.bulbMat, H * 3);
    this.heads.forEach((h, i) => {
      // Head's local +x faces the drivers (rotation maps local x onto the approach-back direction).
      q.setFromAxisAngle(Y, -h.ang); m4.compose(new THREE.Vector3(h.x, 0, -h.z), q, one);
      sPole.setMatrixAt(i, m4); sBox.setMatrixAt(i, m4);
      const fx = Math.cos(h.ang) * 0.3, fz = Math.sin(h.ang) * 0.3;
      for (let k = 0; k < 3; k++) this.bulbs.setMatrixAt(i * 3 + k, new THREE.Matrix4().makeTranslation(h.x + fx, SIG_H + 1.25 - k * 0.65, -(h.z + fz)));
    });
    sPole.count = sBox.count = H; this.bulbs.count = H * 3;
    this.bulbs.setColorAt(0, COL.off);
    this.group.add(sPole, sBox, this.bulbs);

    this._busAndMetro(busStops);
    this.version = g.version;
  }

  _busAndMetro(stops) {
    const shelter = new THREE.Group(), glass = new THREE.MeshStandardMaterial({ color: '#9fc6d6', transparent: true, opacity: 0.45, roughness: 0.1 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(7, 0.25, 2.4).translate(0, 3, 0), this.metal);
    const back = new THREE.Mesh(new THREE.BoxGeometry(7, 2.6, 0.12).translate(0, 1.5, -1.1), glass);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(5, 0.2, 0.7).translate(0, 0.6, -0.6), this.metal);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).translate(3.8, 3.8, 0), new THREE.MeshBasicMaterial({ map: busSignTexture(), side: THREE.DoubleSide }));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4).translate(3.8, 2, 0), this.metal);
    shelter.add(roof, back, bench, sign, post);
    for (const s of stops) { const o = shelter.clone(); o.position.set(s.x, 0, -s.z); o.rotation.y = s.ang; this.group.add(o); }
    // Metro entrances: canopy box + glowing "M" totem.
    const mTex = metroSignTexture();
    for (const m of this.sim.amenities.metro) {
      const o = new THREE.Group();
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 4).translate(0, 1.6, 0), new THREE.MeshStandardMaterial({ color: '#d7dade', roughness: 0.4, metalness: 0.3 }));
      const stairs = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 3.6).translate(0, 0.2, 0.3), new THREE.MeshStandardMaterial({ color: '#222' }));
      const totem = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5, 0.9).translate(3.4, 2.5, 0), new THREE.MeshStandardMaterial({ color: '#bb1d2a' }));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).translate(3.4, 5.6, 0), new THREE.MeshBasicMaterial({ map: mTex, side: THREE.DoubleSide, toneMapped: false }));
      canopy.castShadow = totem.castShadow = true;
      o.add(canopy, stairs, totem, face); o.position.set(m.x, 0, -m.z);
      this.group.add(o);
    }
  }

  update(f) {
    if (this.version !== this.sim.g.version) this.rebuild();
    const k = Math.max(0, Math.min(1, (f.build - PHASE[0]) / (PHASE[1] - PHASE[0])));
    this.group.visible = k > 0;
    this.group.scale.y = Math.max(0.01, Math.min(1, k * 1.6));
    this.glowMat.opacity = f.night * 0.9;
    this.glow.visible = f.night > 0.02;
    // Signal lenses: red (top) / yellow / green (bottom); dark unless active.
    const map = new Map(this.sim.signals.list.map(l => [l, l]));
    this.heads.forEach((h, i) => {
      const c = map.get(h.light)[h.axis];
      this.bulbs.setColorAt(i * 3, c === 'red' ? COL.red : COL.off);
      this.bulbs.setColorAt(i * 3 + 1, c === 'yellow' ? COL.yellow : COL.off);
      this.bulbs.setColorAt(i * 3 + 2, c === 'green' ? COL.green : COL.off);
    });
    this.bulbs.instanceColor.needsUpdate = true;
  }
}
