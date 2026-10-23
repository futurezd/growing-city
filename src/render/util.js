// Shared render helpers. Sim coords (+x east, +z north) map to three as (x, y, -z).
import * as THREE from 'three';

export const toThree = (x, y, z) => new THREE.Vector3(x, y, -z);
export const BRIDGE_PEAK = 8;

// Geometry accumulator working in three-space. Extra per-vertex attributes are set via `set()`.
export class Builder {
  constructor(extra = {}) {
    this.pos = []; this.nor = []; this.uv = []; this.index = [];
    this.extra = {}; this.cur = {};
    for (const [k, size] of Object.entries(extra)) { this.extra[k] = { size, data: [] }; this.cur[k] = new Array(size).fill(0); }
  }
  get count() { return this.pos.length / 3; }
  set(name, ...vals) { this.cur[name] = vals; return this; }
  vert(x, y, z, nx, ny, nz, u = 0, v = 0) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v);
    for (const [k, a] of Object.entries(this.extra)) a.data.push(...this.cur[k]);
    return this.count - 1;
  }
  // Quad from 4 corner points (counter-clockwise seen from the front), flat normal.
  quad(p0, p1, p2, p3, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const e1 = new THREE.Vector3().subVectors(p1, p0), e2 = new THREE.Vector3().subVectors(p3, p0);
    const n = e1.cross(e2).normalize();
    const b = this.count;
    [p0, p1, p2, p3].forEach((p, i) => this.vert(p.x, p.y, p.z, n.x, n.y, n.z, uvs[i][0], uvs[i][1]));
    this.index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // Axis-aligned box in three-space with world-unit UVs (su horizontal, sv vertical).
  box(x0, y0, z0, x1, y1, z1, { su = 1, sv = 1, top = true, bottom = false, sides = true } = {}) {
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    const w = x1 - x0, d = z1 - z0, h0 = y0 / sv, h1 = y1 / sv;
    if (sides) {
      this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [[x0 / su, h0], [x1 / su, h0], [x1 / su, h1], [x0 / su, h1]]);
      this.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), [[-x1 / su, h0], [-x0 / su, h0], [-x0 / su, h1], [-x1 / su, h1]]);
      this.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), [[-z1 / su, h0], [-z0 / su, h0], [-z0 / su, h1], [-z1 / su, h1]]);
      this.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), [[z0 / su, h0], [z1 / su, h0], [z1 / su, h1], [z0 / su, h1]]);
    }
    if (top) this.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), [[x0 / su, z1 / su], [x1 / su, z1 / su], [x1 / su, z0 / su], [x0 / su, z0 / su]]);
    if (bottom) this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1));
    return this;
  }
  // Append a THREE.BufferGeometry transformed by matrix (uses its own uv/normal).
  add(geom, matrix) {
    const g = geom.index ? geom : geom;
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(matrix), vn = new THREE.Vector3();
    const b = this.count;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      if (n) vn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); else vn.set(0, 1, 0);
      // worldUV: horizontal coordinate along the surface tangent, vertical = height (for window shading).
      if (this.worldUV) this.vert(v.x, v.y, v.z, vn.x, vn.y, vn.z, Math.atan2(v.z - this.worldUV.z, v.x - this.worldUV.x) * this.worldUV.r, v.y);
      else this.vert(v.x, v.y, v.z, vn.x, vn.y, vn.z, t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.index.push(b + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.index.push(b + i);
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const [k, a] of Object.entries(this.extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(a.data, a.size));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.index, 1) : new THREE.Uint16BufferAttribute(this.index, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export const mat4 = (x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

// Deck height for Huangpu bridges (sim coords). bridges: [{a:{x,z}, b:{x,z}}]
export function makeHeightFn(bridges) {
  return (x, z) => {
    for (const br of bridges) {
      const dx = br.b.x - br.a.x, dz = br.b.z - br.a.z, L2 = dx * dx + dz * dz;
      const t = ((x - br.a.x) * dx + (z - br.a.z) * dz) / L2;
      if (t < 0 || t > 1) continue;
      const px = br.a.x + dx * t, pz = br.a.z + dz * t;
      if (Math.hypot(x - px, z - pz) > 12) continue;
      const L = Math.sqrt(L2), ramp = Math.min(t, 1 - t) * L / Math.min(70, L * 0.3);
      const s = Math.min(1, ramp);
      return 0.15 + (BRIDGE_PEAK - 0.15) * s * s * (3 - 2 * s);
    }
    return 0;
  };
}

export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp01 = x => Math.max(0, Math.min(1, x));
export function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
