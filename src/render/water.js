// Ground, animated river water (Huangpu + Suzhou Creek), embankments and the Bund promenade.
// Phase 'level' (0–2 s) lays the ground, phase 'river' (2–5 s) digs the rivers from their upstream end.
import * as THREE from 'three';
import { noiseTexture } from './textures.js';
import { LANDMARK_POS } from '../sim/geo.js';

const LEVEL = [0, 2], RIVER = [2, 5];
const k01 = (t, [a, b]) => Math.max(0, Math.min(1, (t - a) / (b - a)));

// Ribbon along a polyline (sim coords) with per-point half width; attribute 'along' ∈ [0,1].
function ribbon(pts, extra = 0, y = 0) {
  const pos = [], along = [], uv = [], idx = [];
  let total = 0; const cum = [0];
  for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); cum.push(total); }
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, w = p.hw + extra;
    for (const s of [-1, 1]) { pos.push(p.x + nx * w * s, y, -(p.z + nz * w * s)); along.push(cum[i] / total); uv.push(cum[i] / 40, s * w / 40); }
    if (i) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx); g.computeVertexNormals();
  // Winding may face down depending on direction; force normals up.
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

// Water: MeshStandardMaterial with animated ripple normals, reveal along the channel.
function waterMaterial(shared, reveal) {
  const m = new THREE.MeshStandardMaterial({ color: '#176c88', roughness: 0.2, metalness: 0.3 });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uTime: shared.uTime, uReveal: reveal, uNight: shared.uNight, uRain: shared.uRain });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float along; varying float vAlong; varying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = along; vWP = (modelMatrix * vec4(position,1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uReveal, uNight, uRain; varying float vAlong; varying vec3 vWP;')
      .replace('void main() {', 'void main() {\n  if (vAlong > uReveal) discard;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  vec2 q = vWP.xz * 0.09;
  float w1 = sin(q.x * 1.7 + uTime * 1.3) + sin(q.y * 2.3 - uTime * 1.1) + sin((q.x + q.y) * 3.1 + uTime * 2.0) * 0.5;
  float w2 = cos(q.x * 2.9 - uTime * 1.7) + cos(q.y * 1.9 + uTime * 0.9) + uRain * sin(vWP.x * 2.0 + uTime * 9.0) * sin(vWP.z * 2.0 - uTime * 7.0);
  vec3 bump = vec3(w1, 0.0, w2) * (0.06 + uRain * 0.05);
  normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  // Night: city light reflections shimmer on the river.
  float glint = pow(max(0.0, sin(vWP.x * 0.35 + uTime * 0.8) * sin(vWP.z * 0.9 - uTime * 1.2)), 6.0);
  totalEmissiveRadiance += uNight * (vec3(0.02, 0.035, 0.06) + glint * vec3(0.5, 0.36, 0.2));`);
  };
  m.customProgramCacheKey = () => 'gc-water';
  return m;
}

export class WaterView {
  constructor(scene, sim, shared) {
    this.sim = sim; this.group = new THREE.Group(); scene.add(this.group);
    this.reveal = { value: 0 };
    // Ground: paved city with a dirt underlay that shows while the site is being levelled.
    const groundTex = noiseTexture('#6f7466', 18, 256, 3); groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(40, 32);
    this.groundMat = new THREE.MeshStandardMaterial({ map: groundTex, color: '#8a8f80', roughness: 1 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 2600).rotateX(-Math.PI / 2), this.groundMat);
    this.ground.receiveShadow = true; this.ground.position.y = -0.02;
    this.dirt = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6b5a43', roughness: 1 }));
    this.dirt.position.y = -0.3; this.dirt.receiveShadow = true;
    this.group.add(this.dirt, this.ground);

    const bankMat = new THREE.MeshStandardMaterial({ color: '#77756d', roughness: 0.9 });
    this.waterMat = waterMaterial(shared, this.reveal);
    this.bankMat = bankMat;
    for (const pts of [sim.river.huangpu, sim.river.suzhou]) {
      const bank = new THREE.Mesh(ribbon(pts, 4, 0.01), bankMat); bank.receiveShadow = true;
      const water = new THREE.Mesh(ribbon(pts, 0, 0.04), this.waterMat);
      bank.material = this._revealBank(bankMat); this.group.add(bank, water);
    }
    this._promenade();
  }

  _revealBank(base) {
    const m = base.clone();
    m.onBeforeCompile = (s) => {
      s.uniforms.uReveal = this.reveal;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float along; varying float vAlong;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = along;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uReveal; varying float vAlong;').replace('void main() {', 'void main() {\n  if (vAlong > uReveal) discard;');
    };
    m.customProgramCacheKey = () => 'gc-bank';
    return m;
  }

  // Bund riverside promenade: granite walk, flood wall with balustrade, lamp posts are added by StreetView.
  _promenade() {
    const row = LANDMARK_POS.bundRow, g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: '#b9ae9b', roughness: 0.85 });
    const z0 = row.z0 - 20, z1 = row.z1 + 40, x = -18, w = 14;
    const walk = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, z1 - z0), stone);
    walk.position.set(x, 0.25, -(z0 + z1) / 2); walk.receiveShadow = true;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, z1 - z0), new THREE.MeshStandardMaterial({ color: '#8d8478', roughness: 0.9 }));
    wall.position.set(x + w / 2, 0.8, -(z0 + z1) / 2); wall.castShadow = true;
    g.add(walk, wall);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.1, 0.5), stone, Math.ceil((z1 - z0) / 4));
    let n = 0; const m4 = new THREE.Matrix4();
    for (let z = z0; z < z1; z += 4) posts.setMatrixAt(n++, m4.makeTranslation(x + w / 2, 2.1, -z));
    posts.count = n; g.add(posts);
    this.promenade = g; this.group.add(g);
  }

  update(f) {
    const lv = k01(f.build, LEVEL);
    this.ground.scale.setScalar(Math.max(0.001, lv));
    this.groundMat.color.set(f.season === 'winter' && f.weather === 'snow' ? '#c9ccd0' : '#8a8f80');
    this.reveal.value = k01(f.build, RIVER) * 1.001;
    this.promenade.visible = f.build >= RIVER[1];
  }
}
