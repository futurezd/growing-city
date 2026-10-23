// Ordinary building massing: walls (windows are shaded procedurally), belt courses, cornices,
// shop awnings, balconies, chimneys and roofs. Everything lands in one Builder (three-space).
import * as THREE from 'three';
import { mat4 } from './util.js';
import { addRoof } from './roofs.js';
import { FLOOR_H } from '../sim/layout.js';

export const FACADE = {
  'residential-a': ['#d8cab2', 1], 'residential-b': ['#c4ced3', 1], brick: ['#9a5a44', 1],
  shikumen: ['#86817b', 1], 'classical-stone': ['#d6caae', 1], 'classical-granite': ['#bdb4a2', 1],
  'shop-modern': ['#b7afa4', 1], 'office-grid': ['#a7b0b7', 3], 'office-band': ['#8c9dab', 3],
  'glass-blue': ['#5b7c9c', 2], 'glass-green': ['#668f88', 2], 'glass-silver': ['#97a5b0', 2],
  factory: ['#a6a299', 1], timber: ['#7a3a2a', 1], 'temple-gold': ['#d8b259', 1],
  pearl: ['#d9d4cf', 0], jinmao: ['#8f969c', 2],
};
// Per-district material character (tint applied on top of the facade colour).
const DISTRICT_TINT = {
  bund: [1.04, 1.0, 0.92], nanjing: [1.03, 0.98, 0.95], renmin: [1, 1, 1], yuyuan: [0.95, 0.92, 0.9],
  'west-residential': [1.02, 0.98, 0.94], lujiazui: [0.94, 0.99, 1.06], pudong: [0.98, 1.0, 1.02],
};
const AWNING = ['#b8322c', '#2f6f4f', '#2d5d9a', '#c9822b', '#7b3f8c'];
const NEON = [[1, 0.2, 0.55], [0.2, 0.9, 1], [1, 0.75, 0.2], [0.6, 0.3, 1]];

export function setColor(B, hex, mul = [1, 1, 1], k = 1) {
  const c = new THREE.Color(hex);
  B.set('color', c.r * mul[0] * k, c.g * mul[1] * k, c.b * mul[2] * k);
}

// Building record → geometry. Returns { top, chimneys:[{x,y,z}] } in three-space.
export function buildOrdinary(B, b, idx) {
  const [hex, mode] = FACADE[b.facadeVariant] || ['#b0aaa0', 1];
  const tint = DISTRICT_TINT[b.district] || [1, 1, 1], k = 0.9 + b.tint * 0.2;
  const cx = b.x, cz = -b.z, hw = b.w / 2, hd = b.d / 2, H = b.height;
  const bay = mode === 2 ? 2.2 : b.type === 'factory' ? 5 : 3.2;
  B.set('aB', idx, mode + (b.awning ? 10 : 0), FLOOR_H * (b.type === 'factory' ? 3 : b.type === 'office' ? 1.15 : 1) * 2.3, bay);
  const em = b.district === 'bund' ? [0.55, 0.38, 0.14] : b.district === 'lujiazui' && b.type === 'office' ? [0.05, 0.12, 0.22] : [0, 0, 0];
  B.set('emis', ...em);
  setColor(B, hex, tint, k);
  const chimneys = [];
  let x0 = cx - hw, x1 = cx + hw, z0 = cz - hd, z1 = cz + hd, top = H;
  if (b.setback) {
    const h1 = H * 0.62;
    B.box(x0, 0, z0, x1, h1, z1);
    setColor(B, hex, tint, k * 0.9); B.box(x0 - 0.3, h1, z0 - 0.3, x1 + 0.3, h1 + 0.6, z1 + 0.3);
    setColor(B, hex, tint, k);
    const ix = b.w * 0.14, iz = b.d * 0.14;
    x0 += ix; x1 -= ix; z0 += iz; z1 -= iz;
    B.box(x0, h1, z0, x1, H, z1);
  } else B.box(x0, 0, z0, x1, H, z1);

  // Belt courses (腰线) and cornice on masonry facades.
  if (mode !== 2) {
    B.set('aB', idx, 0, 1, 1);
    const classical = b.facadeVariant.startsWith('classical');
    setColor(B, classical ? '#e8dfc6' : hex, tint, classical ? 1 : k * 0.82);
    const every = classical ? 2 : b.type === 'residential' ? 5 : 4, fh = FLOOR_H * 2.3;
    for (let f = every; f * fh < H - 2; f += every) {
      const y = f * fh - 0.25;
      B.box(cx - hw - 0.25, y, cz - hd - 0.25, cx + hw + 0.25, y + 0.4, cz + hd + 0.25, { top: true });
    }
    if (classical) { // rusticated plinth + heavy cornice
      setColor(B, '#9d9483', tint); B.box(cx - hw - 0.2, 0, cz - hd - 0.2, cx + hw + 0.2, 4.4, cz + hd + 0.2);
      setColor(B, '#efe6cf', tint); B.box(x0 - 0.6, top - 0.9, z0 - 0.6, x1 + 0.6, top, z1 + 0.6);
    }
  }
  B.set('aB', idx, 0, 1, 1); B.set('emis', 0, 0, 0);

  // Ground floor shop awnings (雨棚) on the two long faces.
  if (b.awning) {
    setColor(B, AWNING[Math.floor(b.tint * AWNING.length) % AWNING.length]);
    const long = b.w >= b.d;
    for (const s of [-1, 1]) {
      const g = long ? new THREE.BoxGeometry(b.w * 0.86, 0.25, 2.2) : new THREE.BoxGeometry(2.2, 0.25, b.d * 0.86);
      const m = long ? mat4(cx, 4.1, cz + s * (hd + 1.0)) : mat4(cx + s * (hw + 1.0), 4.1, cz);
      m.multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(long ? 1 : 0, 0, long ? 0 : 1), (long ? 0.22 : -0.22) * s));
      B.add(g, m);
    }
  }
  // Neon strips on Nanjing Road shopfronts (glow at night through the emissive channel).
  if (b.neon) {
    const n = NEON[Math.floor(b.tint * 97) % NEON.length];
    B.set('emis', n[0] * 1.6, n[1] * 1.6, n[2] * 1.6); setColor(B, '#3a3036');
    const y = Math.min(H - 1.5, 9 + b.tint * 6);
    B.box(cx - hw - 0.15, y, cz - hd - 0.15, cx + hw + 0.15, y + 0.5, cz + hd + 0.15);
    B.box(cx - hw - 0.15, H - 1.2, cz - hd - 0.15, cx + hw + 0.15, H - 0.8, cz + hd + 0.15);
    B.set('emis', 0, 0, 0);
  }
  // Balconies (阳台) on the south face (three +z), sampled rows/bays to stay within budget.
  if (b.balconies) {
    setColor(B, '#e9e6df');
    const fh = FLOOR_H * 2.3, floors = Math.floor(H / fh), rowStep = Math.max(2, Math.ceil(floors / 10));
    const bays = Math.min(8, Math.floor(b.w / 6));
    for (let f = 1; f < floors; f += rowStep) for (let i = 0; i < bays; i++) {
      const x = cx - hw + (i + 0.5) * (b.w / bays), y = f * fh;
      B.box(x - 1.4, y, z1, x + 1.4, y + 0.95, z1 + 1.1);
    }
  }
  // Roof (≥3 types across the city) and factory chimneys.
  const roofSeed = (b.tint * 13.7) % 1;
  const rh = addRoof(B, b.roofType, x0, z0, x1, z1, top, roofSeed, b.facadeVariant === 'shikumen' ? '#4c4a4e' : null);
  if (b.chimney) {
    setColor(B, '#8d4e3c');
    const px = cx + hw * 0.6, pz = cz - hd * 0.5, ch = H + 16;
    B.add(new THREE.CylinderGeometry(1.0, 1.6, ch, 10), mat4(px, ch / 2, pz));
    setColor(B, '#e9e6df'); B.add(new THREE.CylinderGeometry(1.05, 1.05, 1.2, 10), mat4(px, ch - 2.5, pz));
    chimneys.push({ x: px, y: ch, z: pz });
  }
  return { top: Math.max(top + rh, b.chimney ? H + 16 : 0), chimneys };
}
