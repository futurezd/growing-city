// City buildings: one merged mesh (growth + lighting driven by a per-building state texture),
// construction sites (fences + tower cranes), Nanjing Road neon signs, clock faces, chimney smoke.
import * as THREE from 'three';
import { Builder } from './util.js';
import { buildOrdinary } from './facade.js';
import { buildSpecial } from './landmarks.js';
import { makeBuildingMaterials, STATE_W } from './buildmat.js';
import { clockTexture, neonSignTexture, glowTexture } from './textures.js';

const MAX_CRANES = 40, MAX_SITES = 90, SMOKE_PER = 14;
const NEON_TEXT = ['永安百货', '第一百货', '新世界', '老凤祥', '华联商厦', '先施公司', '南京路', '恒源祥'];
const NEON_COL = ['#ff3d8b', '#33e6ff', '#ffcc33', '#9a5cff'];

export class BuildingsView {
  constructor(scene, sim, uniforms) {
    this.scene = scene; this.sim = sim; this.group = new THREE.Group(); scene.add(this.group);
    this.stateData = new Uint8Array(STATE_W * 4);
    this.stateTex = new THREE.DataTexture(this.stateData, STATE_W, 1, THREE.RGBAFormat);
    this.stateTex.magFilter = this.stateTex.minFilter = THREE.NearestFilter;
    this.uniforms = Object.assign(uniforms, { uState: { value: this.stateTex } });
    const { mat, depth } = makeBuildingMaterials(this.uniforms);
    this.mat = mat; this.depth = depth;
    this._sitesAndCranes();
    this._smoke();
    this.rebuild();
  }

  rebuild() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.geometry?.dispose(); }
    const B = new Builder({ color: 3, aB: 4, emis: 3 });
    const decals = []; this.chimneys = []; this.tops = new Map();
    this.sim.buildings.forEach((b, i) => {
      const r = b.special ? buildSpecial(B, b, i, decals) : buildOrdinary(B, b, i);
      this.tops.set(b.id, r.top);
      for (const c of r.chimneys) this.chimneys.push({ ...c, b });
    });
    const mesh = new THREE.Mesh(B.geometry(), this.mat);
    mesh.customDepthMaterial = this.depth; mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this._decals(decals);
    this._neon();
  }

  _decals(decals) {
    const tex = clockTexture();
    this.clockMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffe0a0', emissiveIntensity: 0 });
    for (const d of decals) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(d.size / 2, 24), this.clockMat);
      m.position.set(d.x, d.y, d.z); m.rotation.y = d.ry; m.userData.b = this.sim.buildings.find(b => b.special === 'customs');
      this.group.add(m);
    }
  }

  _neon() {
    this.signs = [];
    const neon = this.sim.buildings.filter(b => b.neon).slice(0, 16);
    neon.forEach((b, i) => {
      const text = NEON_TEXT[i % NEON_TEXT.length], col = NEON_COL[i % NEON_COL.length];
      const mat = new THREE.MeshBasicMaterial({ map: neonSignTexture(text, col), transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
      const h = 2.6 * text.length + 1.3, m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, h), mat);
      const face = b.z < 100 ? 1 : -1;                 // sign faces the street (sim z = 100)
      m.position.set(b.x + (i % 2 ? 6 : -6), Math.min(b.height - h / 2 - 1, 8 + h / 2), -(b.z + face * (b.d / 2 + 1.4)));
      m.rotation.y = Math.PI / 2;
      m.userData.b = b; this.signs.push(m); this.group.add(m);
    });
  }

  _sitesAndCranes() {
    const yellow = new THREE.MeshStandardMaterial({ color: '#e8b326', roughness: 0.6 });
    const mast = new THREE.BoxGeometry(1.4, 1, 1.4).translate(0, 0.5, 0);
    const jib = new THREE.BoxGeometry(1, 1, 1);
    // Jib: long arm + counter-jib + counterweight + cab merged into one geometry (unit length along +x).
    const J = new Builder({});
    J.box(-0.3, 0, -0.5, 1, 1, 0.5); J.box(-0.32, -1.6, -0.7, -0.22, 0.2, 0.7);
    const jibGeo = J.geometry(); jib.dispose();
    this.mast = new THREE.InstancedMesh(mast, yellow, MAX_CRANES);
    this.jib = new THREE.InstancedMesh(jibGeo, yellow, MAX_CRANES);
    this.cable = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: '#333' }), MAX_CRANES);
    const fenceMat = new THREE.MeshStandardMaterial({ color: '#3d7fbf', roughness: 0.9 });
    this.fence = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), fenceMat, MAX_SITES);
    this.dirt = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8a7358', roughness: 1 }), MAX_SITES);
    for (const m of [this.mast, this.jib, this.cable, this.fence, this.dirt]) { m.count = 0; m.frustumCulled = false; this.scene.add(m); }
    this.mast.castShadow = this.jib.castShadow = true;
  }

  _smoke() {
    const n = 40 * SMOKE_PER, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    this.smokeMat = new THREE.PointsMaterial({ map: glowTexture(), size: 9, color: '#9a9a96', transparent: true, opacity: 0.45, depthWrite: false });
    this.smoke = new THREE.Points(g, this.smokeMat); this.smoke.frustumCulled = false;
    this.scene.add(this.smoke);
  }

  update(t, night) {
    const sim = this.sim, data = this.stateData, m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const sites = [];
    sim.buildings.forEach((b, i) => {
      const p = Math.max(0, Math.min(1, b.progress ?? 1));
      data[i * 4] = Math.round(p * 255); data[i * 4 + 1] = b.lit ? 255 : 0; data[i * 4 + 2] = Math.round((b.litSeed ?? 0.5) * 255); data[i * 4 + 3] = 255;
      if (p > 0 && p < 1 && !b.special?.match(/huxinting/)) sites.push(b);
    });
    this.stateTex.needsUpdate = true;
    // Construction sites: fence + dirt for every active site; cranes for the tallest ones.
    const ns = Math.min(MAX_SITES, sites.length);
    for (let k = 0; k < ns; k++) {
      const b = sites[k];
      m4.compose(new THREE.Vector3(b.x, 0.05, -b.z), q.identity(), new THREE.Vector3(b.w + 8, 1, b.d + 8)); this.dirt.setMatrixAt(k, m4);
      m4.compose(new THREE.Vector3(b.x, 0, -b.z), q, new THREE.Vector3(b.w + 6, 2.2, b.d + 6)); this.fence.setMatrixAt(k, m4);
    }
    this.fence.count = this.dirt.count = ns;
    const craned = sites.filter(b => b.height > 12).sort((a, b) => b.height - a.height).slice(0, MAX_CRANES);
    craned.forEach((b, k) => {
      const top = this.tops.get(b.id) || b.height, h = Math.max(b.height * b.progress, 6) + 14, L = Math.max(22, Math.min(60, top * 0.35));
      const x = b.x + b.w / 2 + 3, z = -(b.z - b.d / 2 - 3), a = t * 0.15 + b.tint * 6;
      m4.compose(new THREE.Vector3(x, 0, z), q.identity(), new THREE.Vector3(1, h, 1)); this.mast.setMatrixAt(k, m4);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      m4.compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(L, 1.4, 1.2)); this.jib.setMatrixAt(k, m4);
      const r = L * (0.45 + 0.3 * Math.sin(t * 0.3 + k));
      m4.compose(new THREE.Vector3(x + Math.cos(a) * r, h, z - Math.sin(a) * r), q.identity(), new THREE.Vector3(1, 8 + 6 * Math.sin(t * 0.5 + k), 1)); this.cable.setMatrixAt(k, m4);
    });
    this.mast.count = this.jib.count = this.cable.count = craned.length;
    for (const im of [this.mast, this.jib, this.cable, this.fence, this.dirt]) im.instanceMatrix.needsUpdate = true;
    this._updateSmoke(t);
    this.clockMat.emissiveIntensity = night * 1.2;
    for (const s of this.signs) { s.visible = s.userData.b.progress >= 1; s.material.opacity = 0.35 + night * 0.65; }
  }

  _updateSmoke(t) {
    const pos = this.smoke.geometry.attributes.position, arr = pos.array, wind = this.sim.weather === 'snow' ? 0.5 : 1;
    let n = 0;
    for (const c of this.chimneys) {
      if (n >= 40 * SMOKE_PER) break;
      const on = c.b.progress >= 1;
      for (let i = 0; i < SMOKE_PER; i++, n++) {
        const life = ((t * 0.25 + i / SMOKE_PER + c.x * 0.013) % 1), j = n * 3;
        arr[j] = c.x + life * 14 * wind + Math.sin(i * 2.1 + t) * life * 2;
        arr[j + 1] = on ? c.y + life * 26 : -50;
        arr[j + 2] = c.z - life * 5 * wind;
      }
    }
    for (let j = n * 3; j < arr.length; j++) arr[j] = -50;
    pos.needsUpdate = true;
  }
}
