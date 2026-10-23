export const HUANGPU_CTRL = [
  { x: 60, z: -900, hw: 70 }, { x: 110, z: -600, hw: 68 },
  { x: 150, z: -350, hw: 66 }, { x: 120, z: -150, hw: 64 },
  { x: 75, z: 0, hw: 60 }, { x: 50, z: 120, hw: 60 },
  { x: 90, z: 260, hw: 62 }, { x: 220, z: 380, hw: 65 },
  { x: 380, z: 520, hw: 68 }, { x: 560, z: 640, hw: 70 },
  { x: 700, z: 760, hw: 70 },
];

export const SUZHOU_CTRL = [
  { x: -900, z: 360, hw: 12 }, { x: -600, z: 320, hw: 12 },
  { x: -350, z: 350, hw: 12 }, { x: -150, z: 300, hw: 12 },
  { x: -30, z: 240, hw: 12 }, { x: 60, z: 200, hw: 12 },
];

function distance(a, b) { return Math.hypot(b.x - a.x, b.z - a.z); }

export function sampleCurve(ctrl, step = 10) {
  if (ctrl.length < 2) return ctrl.slice();
  const result = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i];
    const p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const segmentLength = distance(p1, p2);
    const count = Math.max(1, Math.ceil(segmentLength / step));
    for (let j = 0; j < count; j++) {
      const t = j / count, t2 = t * t, t3 = t2 * t;
      result.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
        hw: p1.hw + (p2.hw - p1.hw) * t,
      });
    }
  }
  result.push({ ...ctrl[ctrl.length - 1] });
  return result;
}

export const HUANGPU = sampleCurve(HUANGPU_CTRL);
export const SUZHOU = sampleCurve(SUZHOU_CTRL);

export function distToPolyline(x, z, pts) {
  let best = { d: Infinity, hw: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, hw: a.hw + (b.hw - a.hw) * t };
  }
  return best;
}

export function isHuangpu(x, z, margin = 0) {
  return distToPolyline(x, z, HUANGPU).d <= distToPolyline(x, z, HUANGPU).hw + margin;
}

export function isSuzhou(x, z, margin = 0) {
  return distToPolyline(x, z, SUZHOU).d <= distToPolyline(x, z, SUZHOU).hw + margin;
}

export function isWater(x, z, margin = 0) {
  return isHuangpu(x, z, margin) || isSuzhou(x, z, margin);
}

export function segmentCrossesHuangpu(a, b) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (isHuangpu(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return true;
  }
  return false;
}

export function isPudong(x, z) {
  let best = { d: Infinity, cross: -1 };
  for (let i = 0; i < HUANGPU.length - 1; i++) {
    const a = HUANGPU[i], b = HUANGPU[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, cross: dx * (z - pz) - dz * (x - px) };
  }
  return best.cross < 0;
}

export const DISTRICTS = {
  lujiazui: { x0: 120, x1: 560, z0: -160, z1: 320 },
  bund: { x0: -80, x1: 10, z0: -300, z1: 230 },
  nanjing: { x0: -560, x1: -80, z0: 60, z1: 130 },
  renmin: { x0: -720, x1: -480, z0: -60, z1: 140 },
  yuyuan: { x0: -450, x1: -80, z0: -500, z1: -100 },
  'west-residential': { x0: -1400, x1: -560, z0: -800, z1: 700 },
  pudong: { x0: 150, x1: 1400, z0: -800, z1: 760 },
};

function inBox(x, z, box) { return x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1; }

export function districtOf(x, z) {
  for (const name of ['bund', 'nanjing', 'renmin', 'yuyuan', 'lujiazui']) {
    if (inBox(x, z, DISTRICTS[name])) return name;
  }
  return isPudong(x, z) ? 'pudong' : 'west-residential';
}

// Landmark anchors are placed inside road blocks of the 100-unit grid (see graph.js).
export const LANDMARK_POS = {
  orientalPearl: { x: 142, z: 150, h: 156 }, jinmao: { x: 255, z: 45, h: 140 },
  swfc: { x: 330, z: 22, h: 164 }, shanghaiTower: { x: 268, z: -38, h: 211 },
  museum: { x: -600, z: -38 }, peoplesSquare: { x: -600, z: 40 },
  yuyuan: { x: -150, z: -250 }, jingan: { x: -1050, z: 145 },
  nanjingRoad: { z: 100, x0: -500, x1: -100 }, bundRow: { x: -66, z0: -190, z1: 190 },
};

// Century Avenue (世纪大道): diagonal boulevard from the Pearl tower towards inland Pudong.
export const CENTURY_AVENUE = [
  { x: 200, z: 200 }, { x: 300, z: 100 }, { x: 400, z: 0 }, { x: 500, z: -100 },
  { x: 600, z: -200 }, { x: 700, z: -300 }, { x: 800, z: -400 }, { x: 900, z: -500 },
];

export const BRIDGE_DEFS = [{ name: '南浦大桥', z: -600 }, { name: '杨浦大桥', z: 520 }];
