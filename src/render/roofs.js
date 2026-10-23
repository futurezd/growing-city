// Roof geometry generators (three-space, appended to a Builder). Returns the roof height added.
import * as THREE from 'three';
import { mat4 } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const ROOF_COLORS = {
  flat: '#6f6b66', gable: '#8a4b38', hip: '#7d4a3c', pyramid: '#5d7f70', dome: '#5f8b78',
  spire: '#a3adb4', crown: '#b9c0c4', stepped: '#9aa3a8', sawtooth: '#8d9297',
  'flying-eave': '#3e4448', pavilion: '#3a4045', clock: '#6f6b66', shikumen: '#4a4a4f',
};

// Connect successive rings of points [[x,y,z],...] (same count, ordered so outward normals result).
// UVs are in world units (u = perimeter distance, v = height) so facade window shading stays regular.
export function loft(B, rings) {
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r], b = rings[r + 1], n = a.length;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const du = Math.max(Math.hypot(a[j][0] - a[i][0], a[j][2] - a[i][2]), Math.hypot(b[j][0] - b[i][0], b[j][2] - b[i][2]));
      B.quad(V(...a[i]), V(...a[j]), V(...b[j]), V(...b[i]), [[u, a[i][1]], [u + du, a[j][1]], [u + du, b[j][1]], [u, b[i][1]]]);
      u += du;
    }
  }
}

// Rectangle ring in canonical order (x0,z0)→(x0,z1)→(x1,z1)→(x1,z0), optional 8-point (with mid-edges).
function ring(x0, z0, x1, z1, y, mids = false, lift = 0, midDrop = 0) {
  const c = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  if (!mids) return c.map(([x, z]) => [x, y + lift, z]);
  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = c[i], q = c[(i + 1) % 4];
    out.push([p[0], y + lift, p[1]], [(p[0] + q[0]) / 2, y - midDrop, (p[1] + q[1]) / 2]);
  }
  return out;
}

const col = (B, hex) => { const c = new THREE.Color(hex); B.set('color', c.r, c.g, c.b); };

export function addRoof(B, type, x0, z0, x1, z1, y, seed = 0.5, colorOverride = null) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, m = Math.min(w, d);
  col(B, colorOverride || ROOF_COLORS[type] || ROOF_COLORS.flat);
  switch (type) {
    case 'gable': case 'hip': {
      const h = Math.min(6, m * 0.42), o = 0.6, alongX = w >= d;
      const inset = type === 'hip' ? m * 0.5 : 0;
      const top = alongX ? ring(x0 + inset, cz, x1 - inset, cz, y + h) : ring(cx, z0 + inset, cx, z1 - inset, y + h);
      loft(B, [ring(x0 - o, z0 - o, x1 + o, z1 + o, y), top]);
      return h;
    }
    case 'pyramid': {
      const h = Math.min(9, m * 0.55);
      B.box(x0 + 0.5, y, z0 + 0.5, x1 - 0.5, y + 1.2, z1 - 0.5);
      loft(B, [ring(x0, z0, x1, z1, y + 1.2), ring(cx, cz, cx, cz, y + 1.2 + h)]);
      return h + 1.2;
    }
    case 'dome': {
      const r = m * 0.3;
      col(B, '#c9bfa6'); B.add(new THREE.CylinderGeometry(r, r, 2.2, 16, 1, true), mat4(cx, y + 1.1, cz));
      col(B, ROOF_COLORS.dome); B.add(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat4(cx, y + 2.2, cz, 0, 1, 0.85, 1));
      B.add(new THREE.CylinderGeometry(0.15, 0.4, 2.5, 6), mat4(cx, y + 2.2 + r * 0.85 + 1.2, cz));
      return 2.2 + r * 0.85 + 2.5;
    }
    case 'spire': {
      const s = 0.7, h = 4 + seed * 4;
      B.box(x0 + w * (1 - s) / 2, y, z0 + d * (1 - s) / 2, x1 - w * (1 - s) / 2, y + h, z1 - d * (1 - s) / 2);
      const sh = 10 + m * 0.6;
      B.add(new THREE.CylinderGeometry(0.1, m * 0.12, sh, 8), mat4(cx, y + h + sh / 2, cz));
      return h + sh;
    }
    case 'crown': {
      const h = 5 + seed * 4;
      loft(B, [ring(x0, z0, x1, z1, y), ring(x0 + w * 0.2, z0 + d * 0.2, x1 - w * 0.2, z1 - d * 0.2, y + h)]);
      B.box(x0 + w * 0.3, y + h, z0 + d * 0.3, x1 - w * 0.3, y + h + 2.5, z1 - d * 0.3);
      return h + 2.5;
    }
    case 'stepped': {
      let yy = y;
      for (let i = 1; i <= 3; i++) {
        const k = i * 0.13, hh = 3 - i * 0.5;
        B.box(x0 + w * k, yy, z0 + d * k, x1 - w * k, yy + hh, z1 - d * k); yy += hh;
      }
      return yy - y;
    }
    case 'sawtooth': {
      const n = Math.max(2, Math.round(d / 7)), td = d / n, h = 3.2;
      for (let i = 0; i < n; i++) {
        const a = z0 + i * td, b = a + td;
        col(B, ROOF_COLORS.sawtooth);
        loft(B, [ring(x0, a, x1, b, y), [[x0, y + h, a], [x0, y + h, a], [x1, y + h, a], [x1, y + h, a]]]);
      }
      return h;
    }
    case 'flying-eave': {
      const o = Math.min(2.2, m * 0.18), h = Math.min(7, m * 0.5), alongX = w >= d;
      const eave = ring(x0 - o, z0 - o, x1 + o, z1 + o, y, true, 1.1, -0.1);
      const mid = ring(x0 + w * 0.2, z0 + d * 0.2, x1 - w * 0.2, z1 - d * 0.2, y + h * 0.42, true, 0.25, 0);
      const ridge = alongX ? ring(x0 + w * 0.3, cz, x1 - w * 0.3, cz, y + h, true) : ring(cx, z0 + d * 0.3, cx, z1 - d * 0.3, y + h, true);
      loft(B, [eave, mid, ridge]);
      col(B, '#2c3134');
      if (alongX) B.box(x0 + w * 0.28, y + h - 0.1, cz - 0.3, x1 - w * 0.28, y + h + 0.6, cz + 0.3);
      else B.box(cx - 0.3, y + h - 0.1, z0 + d * 0.28, cx + 0.3, y + h + 0.6, z1 - d * 0.28);
      return h + 0.6;
    }
    case 'pavilion': {
      const o = Math.min(1.8, m * 0.22), h = Math.min(7, m * 0.75);
      const eave = ring(x0 - o, z0 - o, x1 + o, z1 + o, y, true, 0.9, -0.1);
      const mid = ring(x0 + w * 0.3, z0 + d * 0.3, x1 - w * 0.3, z1 - d * 0.3, y + h * 0.35, true, 0.15, 0);
      loft(B, [eave, mid, ring(cx, cz, cx, cz, y + h, true)]);
      col(B, '#c9a24a');
      B.add(new THREE.SphereGeometry(0.45, 8, 6), mat4(cx, y + h + 0.3, cz));
      B.add(new THREE.CylinderGeometry(0.05, 0.25, 1.4, 6), mat4(cx, y + h + 1.2, cz));
      return h + 1.9;
    }
    default: { // flat: parapet + rooftop plant
      const p = 0.35, ph = 0.9;
      B.box(x0, y, z0, x1, y + ph, z0 + p); B.box(x0, y, z1 - p, x1, y + ph, z1);
      B.box(x0, y, z0 + p, x0 + p, y + ph, z1 - p); B.box(x1 - p, y, z0 + p, x1, y + ph, z1 - p);
      col(B, '#8e8f8c');
      const ux = cx + (seed - 0.5) * w * 0.4, uz = cz + (0.5 - seed) * d * 0.3;
      B.box(ux - w * 0.12, y, uz - d * 0.12, ux + w * 0.12, y + 1.8, uz + d * 0.12);
      if (m > 12) B.add(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10), mat4(x0 + 2.5, y + 1.1, z1 - 2.5));
      return ph;
    }
  }
}
