// Recognisable landmark geometry (three-space). Each returns { top, decals:[{x,y,z,ry,size,tex}] }.
import * as THREE from 'three';
import { mat4 } from './util.js';
import { loft, addRoof } from './roofs.js';
import { setColor, buildOrdinary } from './facade.js';

const UP = new THREE.Vector3(0, 1, 0);
// Cylinder between two points p→q (three-space).
function rod(B, p, q, r0, r1 = r0, seg = 10) {
  const a = new THREE.Vector3(...p), b = new THREE.Vector3(...q), d = b.clone().sub(a), L = d.length();
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1));
  B.add(new THREE.CylinderGeometry(r1, r0, L, seg), m);
}
// Ring of points around (cx,cz); radius function of angle. Clockwise-from-above ordering → outward normals.
function circ(cx, cz, y, n, rFn, rot = 0) {
  const out = [];
  for (let k = 0; k < n; k++) { const a = -k / n * Math.PI * 2 + rot; const r = rFn(a - rot); out.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); }
  return out;
}
const sphere = (B, x, y, z, r) => B.add(new THREE.SphereGeometry(r, 20, 14), mat4(x, y, z));

function pearl(B, b, cx, cz) {          // 东方明珠: three columns, inclined legs, three main spheres
  setColor(B, '#dcd8d4'); B.set('emis', 0.25, 0.3, 0.5);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3, c = Math.cos(a), s = Math.sin(a);
    rod(B, [cx + c * 6, 0, cz + s * 6], [cx + c * 4, 116, cz + s * 4], 2.4, 2.0);
    rod(B, [cx + c * 22, 0, cz + s * 22], [cx + c * 7, 30, cz + s * 7], 1.6);       // inclined leg
  }
  B.set('emis', 0.9, 0.12, 0.45); setColor(B, '#c23a6e');
  sphere(B, cx, 34, cz, 13);                                                       // lower sphere
  for (const y of [58, 70, 82]) sphere(B, cx, y, cz, 3.2);                         // small beads
  sphere(B, cx, 112, cz, 8.5);                                                     // upper sphere
  sphere(B, cx, 134, cz, 3.6);                                                     // space module
  setColor(B, '#dcd8d4'); B.set('emis', 0.3, 0.3, 0.4);
  rod(B, [cx, 112, cz], [cx, 134, cz], 1.6, 1.2); rod(B, [cx, 134, cz], [cx, 156, cz], 0.9, 0.15, 8);
  B.set('emis', 0, 0, 0);
  return 156;
}

function jinmao(B, b, cx, cz) {         // 金茂: tapering stack of pagoda tiers with ledges, crown, spire
  setColor(B, '#8f979e'); B.set('aB', b._idx, 2, 3.4, 2.4);
  let y = 0, r = 15.5;
  for (let i = 0; i < 14; i++) {
    const h = i === 0 ? 30 : Math.max(3.5, 9.5 - i * 0.5);
    B.add(new THREE.CylinderGeometry(r, r, h, 8), mat4(cx, y + h / 2, cz, Math.PI / 8));
    B.set('aB', b._idx, 0, 1, 1); setColor(B, '#c8c9c4');
    B.add(new THREE.CylinderGeometry(r + 1.1, r + 0.4, 0.8, 8), mat4(cx, y + h, cz, Math.PI / 8));   // tier ledge
    setColor(B, '#8f979e'); B.set('aB', b._idx, 2, 3.4, 2.4);
    y += h; r *= i === 0 ? 0.86 : 0.935;
  }
  B.set('aB', b._idx, 0, 1, 1); setColor(B, '#b8bdc0'); B.set('emis', 0.5, 0.42, 0.2);
  B.add(new THREE.CylinderGeometry(r * 0.4, r, 8, 8), mat4(cx, y + 4, cz, Math.PI / 8));
  rod(B, [cx, y + 8, cz], [cx, 140, cz], 1.2, 0.12, 8);
  B.set('emis', 0, 0, 0);
  return 140;
}

function swfc(B, b, cx, cz) {           // 环球金融中心: tapering prism with the trapezoid aperture at the top
  setColor(B, '#9fb0bd'); B.set('aB', b._idx, 2, 3.4, 2.2);
  const W = 15, D0 = 15, D1 = 6, Hb = 128, H = b.height;
  const dAt = y => D0 + (D1 - D0) * (y / H);
  const rect = (y, hx, hz) => [[cx - hx, y, cz - hz], [cx - hx, y, cz + hz], [cx + hx, y, cz + hz], [cx + hx, y, cz - hz]];
  loft(B, [rect(0, dAt(0), W), rect(Hb, dAt(Hb), W * 0.92)]);
  // Two side posts frame the opening (open along x: visible through from Puxi and Pudong).
  const yb = H - 7, hz = W * 0.9, post = 4.2;
  for (const s of [-1, 1]) {
    const zIn = cz + s * (hz - post), zOut = cz + s * hz;
    const za = Math.min(zIn, zOut), zb = Math.max(zIn, zOut);
    loft(B, [[[cx - dAt(Hb), Hb, za], [cx - dAt(Hb), Hb, zb], [cx + dAt(Hb), Hb, zb], [cx + dAt(Hb), Hb, za]],
             [[cx - dAt(yb), yb, za], [cx - dAt(yb), yb, zb], [cx + dAt(yb), yb, zb], [cx + dAt(yb), yb, za]]]);
  }
  B.box(cx - dAt(Hb), Hb - 0.2, cz - hz, cx + dAt(Hb), Hb + 2.5, cz + hz);         // sill of the aperture
  B.box(cx - dAt(yb), yb, cz - hz, cx + dAt(yb), H, cz + hz);                       // top beam
  B.set('aB', b._idx, 0, 1, 1); B.set('emis', 0.2, 0.45, 0.8);
  B.box(cx - dAt(yb) - 0.2, H - 0.5, cz - hz, cx + dAt(yb) + 0.2, H, cz + hz);
  B.set('emis', 0, 0, 0);
  return H;
}

function shanghaiTower(B, b, cx, cz) {  // 上海中心: rounded-triangle plan, tapering and twisting 120°
  setColor(B, '#6f93b3'); B.set('aB', b._idx, 2, 3.4, 2.2);
  const H = b.height - 8, n = 30, rings = [];
  const tri = a => 1 - 0.13 * Math.cos(3 * a);
  for (let i = 0; i <= 26; i++) {
    const t = i / 26, y = t * H, r = 17.5 * (1 - 0.42 * t * t) * (1 - 0.08 * t);
    rings.push(circ(cx, cz, y, n, a => r * tri(a), t * Math.PI * 2 / 3));
  }
  loft(B, rings);
  // Sloped crown: last ring lifted on one side, then capped.
  const last = rings[rings.length - 1];
  const crown = last.map(([x, y, z]) => [x, y + 6 + (x - cx) * 0.35, z]);
  B.set('aB', b._idx, 0, 1, 1); setColor(B, '#9fb7c9'); B.set('emis', 0.15, 0.45, 0.9);
  loft(B, [last, crown, crown.map(() => [cx, H + 8, cz])]);
  B.set('emis', 0, 0, 0);
  return b.height;
}

function museum(B, b, cx, cz) {         // 上海博物馆: 天圆地方 — square base, round top with four arched handles
  setColor(B, '#b7ad99'); B.set('aB', b._idx, 0, 1, 1);
  B.box(cx - 24, 0, cz - 24, cx + 24, 2, cz + 24);
  B.box(cx - 22, 2, cz - 22, cx + 22, 11, cz + 22);
  setColor(B, '#a39985'); B.box(cx - 19, 11, cz - 19, cx + 19, 13, cz + 19);
  setColor(B, '#c8bfaa');
  B.add(new THREE.CylinderGeometry(15, 17, 6, 40), mat4(cx, 16, cz));
  B.add(new THREE.CylinderGeometry(19.5, 15, 2.5, 40), mat4(cx, 20, cz));                    // flared round roof
  for (let i = 0; i < 4; i++) B.add(new THREE.TorusGeometry(5, 0.9, 8, 16, Math.PI), mat4(cx + Math.cos(i * Math.PI / 2) * 17, 21, cz + Math.sin(i * Math.PI / 2) * 17, -i * Math.PI / 2 + Math.PI / 2));
  return 26;
}

function customs(B, b, cx, cz, decals) { // 海关大楼: classical block + clock tower with four faces
  buildOrdinary(B, b, b._idx);
  const H = b.height, t = 5.5;
  setColor(B, '#d4c9ad'); B.set('emis', 0.5, 0.35, 0.12);
  B.box(cx - t, H, cz - t, cx + t, H + 16, cz + t);
  setColor(B, '#c3b89c'); B.box(cx - t - 0.6, H + 16, cz - t - 0.6, cx + t + 0.6, H + 17, cz + t + 0.6);
  addRoof(B, 'pyramid', cx - t + 1, cz - t + 1, cx + t - 1, cz + t - 1, H + 17, 0.5, '#6b7470');
  B.set('emis', 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    decals.push({ x: cx + Math.sin(a) * (t + 0.05), y: H + 11, z: cz + Math.cos(a) * (t + 0.05), ry: a, size: 7.5, tex: 'clock' });
  }
  return H + 26;
}

function huxinting(B, b, cx, cz) {      // 湖心亭 on its pond with the zig-zag bridge, double flying eaves
  setColor(B, '#3b5f63'); B.set('aB', b._idx, 0, 1, 1);
  B.box(cx - 22, -0.2, cz - 18, cx + 22, 0.15, cz + 18, { sides: false });
  setColor(B, '#b9b2a4');
  let px = cx - 22, pz = cz + 10;
  for (let i = 0; i < 6; i++) { const nx = px + 5, nz = pz + (i % 2 ? 3 : -3); B.box(Math.min(px, nx), 0.15, Math.min(pz, nz) - 0.8, Math.max(px, nx) + 0.8, 0.9, Math.max(pz, nz) + 0.8); px = nx; pz = nz; }
  setColor(B, '#7a2e22');
  B.box(cx - 5, 0, cz - 4, cx + 5, 3.5, cz + 4);
  addRoof(B, 'flying-eave', cx - 5, cz - 4, cx + 5, cz + 4, 3.5, 0.5);
  setColor(B, '#7a2e22'); B.box(cx - 3.5, 5.2, cz - 2.8, cx + 3.5, 7.8, cz + 2.8);
  return 7.8 + addRoof(B, 'flying-eave', cx - 3.5, cz - 2.8, cx + 3.5, cz + 2.8, 7.8, 0.5);
}

function jingan(B, b, cx, cz) {         // 静安寺: golden main hall + golden stupa
  const top = buildOrdinary(B, b, b._idx).top;
  B.set('aB', b._idx, 0, 1, 1); B.set('emis', 0.45, 0.32, 0.08); setColor(B, '#d9b24c');
  const sx = cx + b.w / 2 + 6;
  for (let i = 0, y = 0, r = 4; i < 5; i++) { B.add(new THREE.CylinderGeometry(r * 0.8, r, 4, 8), mat4(sx, y + 2, cz)); y += 4; r *= 0.82; }
  rod(B, [sx, 20, cz], [sx, 30, cz], 0.6, 0.1, 8);
  B.set('emis', 0, 0, 0);
  return Math.max(top, 30);
}

const MAKERS = { pearl, jinmao, swfc, shanghaiTower, museum, customs, huxinting, jingan };
export function buildSpecial(B, b, idx, decals) {
  b._idx = idx;
  B.set('aB', idx, 0, 1, 1); B.set('emis', 0, 0, 0);
  const top = MAKERS[b.special](B, b, b.x, -b.z, decals);
  delete b._idx;
  return { top, chimneys: [] };
}
