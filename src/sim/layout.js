// City layout: buildings (incl. landmarks), parks, amenities and the construction schedule.
// Deterministic for a given rng; pure data, no rendering.
import { isWater, districtOf, distToPolyline, LANDMARK_POS, CENTURY_AVENUE } from './geo.js';
import { GRID } from './graph.js';

export const FLOOR_H = 1.3;
export const BUILD_DURATION = 25;
// Construction phases (seconds of the 25 s animation). Captions carry no dates.
export const PHASES = [
  { key: 'level', t0: 0, t1: 2, label: '平整场地' },
  { key: 'river', t0: 2, t1: 5, label: '开挖河道：黄浦江与苏州河' },
  { key: 'arterial', t0: 5, t1: 8, label: '修建主干道' },
  { key: 'streets', t0: 8, t1: 10.5, label: '铺设次干道网格' },
  { key: 'bridges', t0: 10.5, t1: 12.5, label: '架设跨江大桥' },
  { key: 'buildings', t0: 12.5, t1: 21.5, label: '分区建设：外滩 · 南京路 · 人民广场 · 豫园 · 陆家嘴' },
  { key: 'amenities', t0: 21.5, t1: 24, label: '布设路灯 · 红绿灯 · 公交站 · 公园 · 地铁站 · 树木' },
  { key: 'done', t0: 24, t1: 25, label: '城市建造完成' },
];

const CENTURY_PTS = CENTURY_AVENUE.map(p => ({ ...p, hw: 0 }));
const CELL_RESERVED = new Set();
const cellKey = (x, z) => `${Math.floor(x / 100) * 100},${Math.floor(z / 100) * 100}`;

export const PARKS = [
  { id: 'park-renmin', name: '人民广场', x0: -688, x1: -512, z0: -88, z1: 88, kind: 'square', fountain: { x: -600, z: 45 } },
  { id: 'park-ljz', name: '陆家嘴中心绿地', x0: 312, x1: 388, z0: 112, z1: 188, kind: 'park', fountain: { x: 350, z: 150 } },
  { id: 'park-fuxing', name: '复兴公园', x0: -488, x1: -412, z0: -288, z1: -212, kind: 'park', fountain: { x: -450, z: -250 } },
  { id: 'park-jingan', name: '静安公园', x0: -988, x1: -912, z0: 112, z1: 188, kind: 'park', fountain: null },
  { id: 'park-century', name: '世纪公园', x0: 912, x1: 1088, z0: -388, z1: -312, kind: 'park', fountain: { x: 1000, z: -350 } },
  { id: 'park-west1', name: '社区绿地', x0: -888, x1: -812, z0: -488, z1: -412, kind: 'garden', fountain: null },
  { id: 'park-west2', name: '社区绿地', x0: -1188, x1: -1112, z0: -288, z1: -212, kind: 'garden', fountain: null },
  { id: 'park-pd1', name: '滨江绿地', x0: 612, x1: 688, z0: 212, z1: 288, kind: 'garden', fountain: null },
];
for (const p of PARKS) for (let x = p.x0; x < p.x1; x += 100) for (let z = p.z0; z < p.z1; z += 100) CELL_RESERVED.add(cellKey(x, z));
for (const k of ['orientalPearl', 'jinmao', 'swfc', 'shanghaiTower', 'yuyuan', 'jingan']) CELL_RESERVED.add(cellKey(LANDMARK_POS[k].x, LANDMARK_POS[k].z));

const BUND_NAMES = [
  ['亚细亚大楼', 'flat'], ['上海总会', 'dome'], ['有利大楼', 'hip'],
  ['日清大楼', 'flat'], ['招商局大楼', 'hip'], ['汇丰银行大楼', 'dome'],
  ['海关大楼', 'clock'], ['交通银行大楼', 'flat'], ['台湾银行大楼', 'hip'],
  ['和平饭店', 'pyramid'], ['中国银行大楼', 'pyramid'], ['怡和洋行大楼', 'flat'],
];

function rect(x, z, w, d) {
  return [{ x: x - w / 2, z: z - d / 2 }, { x: x + w / 2, z: z - d / 2 }, { x: x + w / 2, z: z + d / 2 }, { x: x - w / 2, z: z + d / 2 }];
}

function lotOk(x, z, w, d, avoidCentury = true) {
  for (const p of [...rect(x, z, w, d), { x, z }]) if (isWater(p.x, p.z, 5)) return false;
  if (avoidCentury && distToPolyline(x, z, CENTURY_PTS).d < Math.max(w, d) * 0.72 + 14) return false;
  return true;
}

export function generateLayout(rng) {
  const out = [];
  let n = 0;
  const add = (o) => {
    const h = o.height;
    const b = {
      id: `b${n++}`, name: o.name || null, type: o.type, height: h, floors: Math.max(1, Math.round(h / FLOOR_H)),
      facadeVariant: o.facadeVariant, roofType: o.roofType, isLandmark: !!o.landmarkType,
      landmarkType: o.landmarkType || null, district: o.district || districtOf(o.x, o.z),
      x: o.x, z: o.z, w: o.w, d: o.d, polygon: rect(o.x, o.z, o.w, o.d),
      litSeed: rng.next(), awning: !!o.awning, balconies: !!o.balconies, chimney: !!o.chimney,
      neon: !!o.neon, setback: o.setback || 0, special: o.special || null, tint: rng.next(),
      buildStart: 0, buildDur: 2, priority: o.priority || 0,
    };
    out.push(b);
    return b;
  };

  // ---- Landmarks (Lujiazui towers in historical order) ----
  const L = LANDMARK_POS;
  add({ name: '东方明珠广播电视塔', type: 'landmark', landmarkType: '三球塔', roofType: 'spire', facadeVariant: 'pearl', x: L.orientalPearl.x, z: L.orientalPearl.z, w: 32, d: 32, height: L.orientalPearl.h, district: 'lujiazui', priority: 3, special: 'pearl' });
  add({ name: '金茂大厦', type: 'landmark', landmarkType: '退台塔', roofType: 'stepped', facadeVariant: 'jinmao', x: L.jinmao.x, z: L.jinmao.z, w: 28, d: 28, height: L.jinmao.h, district: 'lujiazui', priority: 3, special: 'jinmao' });
  add({ name: '上海环球金融中心', type: 'landmark', landmarkType: '顶部开洞塔', roofType: 'aperture', facadeVariant: 'glass-silver', x: L.swfc.x, z: L.swfc.z, w: 30, d: 30, height: L.swfc.h, district: 'lujiazui', priority: 3, special: 'swfc' });
  add({ name: '上海中心大厦', type: 'landmark', landmarkType: '螺旋塔', roofType: 'twist', facadeVariant: 'glass-blue', x: L.shanghaiTower.x, z: L.shanghaiTower.z, w: 34, d: 34, height: L.shanghaiTower.h, district: 'lujiazui', priority: 3, special: 'shanghaiTower' });

  // ---- Bund: 12 classical buildings in a continuous row (south → north) ----
  let bi = 0;
  for (const zr of [-200, -100, 0, 100]) {
    for (const zc of [zr + 26, zr + 50, zr + 74]) {
      const [name, roof] = BUND_NAMES[bi++];
      add({ name, type: 'classical', roofType: roof, facadeVariant: bi % 2 ? 'classical-stone' : 'classical-granite', x: -73, z: zc, w: 30, d: 22, height: 24 + ((bi * 7) % 5) * 1.5, district: 'bund', priority: 2, special: roof === 'clock' ? 'customs' : null });
    }
  }

  // ---- People's Square: Shanghai Museum (天圆地方) ----
  add({ name: '上海博物馆', type: 'museum', roofType: 'dome', facadeVariant: 'classical-granite', x: L.museum.x, z: L.museum.z, w: 44, d: 44, height: 20, district: 'renmin', priority: 2, special: 'museum' });

  // ---- Yuyuan garden & old town ----
  const Y = L.yuyuan;
  add({ name: '豫园湖心亭', type: 'pavilion', roofType: 'flying-eave', facadeVariant: 'timber', x: Y.x + 8, z: Y.z + 10, w: 12, d: 10, height: 6, district: 'yuyuan', priority: 2, special: 'huxinting' });
  add({ name: '城隍庙大殿', type: 'temple', roofType: 'flying-eave', facadeVariant: 'timber', x: Y.x - 22, z: Y.z - 24, w: 26, d: 16, height: 8, district: 'yuyuan', priority: 2 });
  add({ name: '豫园点春堂', type: 'pavilion', roofType: 'pavilion', facadeVariant: 'timber', x: Y.x + 26, z: Y.z - 18, w: 9, d: 9, height: 5, district: 'yuyuan', priority: 2 });
  add({ name: '豫园望江亭', type: 'pavilion', roofType: 'pavilion', facadeVariant: 'timber', x: Y.x - 26, z: Y.z + 22, w: 8, d: 8, height: 5, district: 'yuyuan', priority: 2 });
  add({ name: '豫园玉华堂', type: 'pavilion', roofType: 'flying-eave', facadeVariant: 'timber', x: Y.x + 28, z: Y.z + 26, w: 14, d: 9, height: 6, district: 'yuyuan', priority: 2 });

  // ---- Jing'an Temple (optional landmark) ----
  add({ name: '静安寺', type: 'temple', roofType: 'flying-eave', facadeVariant: 'temple-gold', x: L.jingan.x, z: L.jingan.z, w: 30, d: 22, height: 12, district: 'west-residential', priority: 2, special: 'jingan' });

  // ---- Nanjing Road: shopfronts on both sides of the pedestrian street ----
  const NJ = L.nanjingRoad;
  for (let x = NJ.x0; x < NJ.x1; x += 100) {
    for (const xc of [x + 26, x + 50, x + 74]) {
      for (const side of [-1, 1]) {
        const d = rng.range(14, 20), h = rng.range(16, 42);
        const z = NJ.z + side * (12 + d / 2);
        const classical = rng.chance(0.45);
        if (lotOk(xc, z, 22, d)) add({ name: null, type: 'commercial', roofType: classical ? rng.pick(['flat', 'hip', 'dome']) : 'flat', facadeVariant: classical ? 'classical-stone' : 'shop-modern', x: xc, z, w: 22, d, height: h, district: 'nanjing', awning: true, neon: true, priority: 1 });
      }
    }
  }

  // ---- Generic blocks ----
  const generic = [];
  const { step, x0, x1, z0, z1 } = GRID;
  for (let cz = z0; cz < z1; cz += step) {
    for (let cx = x0; cx < x1; cx += step) {
      const key = cellKey(cx, cz);
      if (CELL_RESERVED.has(key)) continue;
      const mx = cx + 50, mz = cz + 50, dist = districtOf(mx, mz);
      if (dist === 'bund' || (cz === NJ.z || cz + 100 === NJ.z) && cx >= NJ.x0 && cx < NJ.x1) continue;
      if (cx >= -700 && cx < -500 && cz >= -100 && cz < 100) continue; // People's Square
      const ix0 = cx + 14, ix1 = cx + 86, iz0 = cz + 14, iz1 = cz + 86;
      const lots = [];
      if (dist === 'lujiazui') {
        const cnt = rng.int(2, 4);
        const spots = [[ix0 + 15, iz0 + 15], [ix1 - 15, iz1 - 15], [ix0 + 15, iz1 - 15], [ix1 - 15, iz0 + 15]];
        for (let i = 0; i < cnt; i++) {
          const [x, z] = spots[i], s = rng.range(18, 26);
          lots.push({ type: 'office', x, z, w: s, d: s, height: rng.range(55, 110), facadeVariant: rng.pick(['glass-blue', 'glass-green', 'glass-silver', 'office-band']), roofType: rng.pick(['spire', 'crown', 'flat', 'stepped']), setback: rng.chance(0.5) ? 1 : 0 });
        }
      } else if (dist === 'yuyuan') {
        const near = Math.hypot(mx - L.yuyuan.x, mz - L.yuyuan.z) < 170;
        for (const [x, z] of [[ix0 + 16, iz0 + 16], [ix1 - 16, iz0 + 16], [ix0 + 16, iz1 - 16], [ix1 - 16, iz1 - 16]]) {
          if (rng.chance(0.15)) continue;
          lots.push(near
            ? { type: 'commercial', x, z, w: 24, d: 16, height: rng.range(8, 13), facadeVariant: 'timber', roofType: 'flying-eave', awning: true }
            : { type: 'residential', x, z, w: 28, d: 14, height: rng.range(7, 10), facadeVariant: 'shikumen', roofType: 'gable' });
        }
      } else if (dist === 'renmin' || dist === 'nanjing') {
        lots.push({ type: 'office', x: mx, z: mz, w: 30, d: 26, height: rng.range(40, 80), facadeVariant: rng.pick(['office-grid', 'glass-green', 'office-band']), roofType: rng.pick(['crown', 'flat', 'stepped']), setback: 1 });
      } else if (dist === 'pudong') {
        if (cx >= 700 && cz <= -500) {
          lots.push({ type: 'factory', x: mx - 14, z: mz, w: 38, d: 30, height: rng.range(11, 16), facadeVariant: 'factory', roofType: 'sawtooth', chimney: true });
          if (rng.chance(0.6)) lots.push({ type: 'factory', x: mx + 26, z: mz + 14, w: 18, d: 26, height: rng.range(9, 13), facadeVariant: 'factory', roofType: 'gable', chimney: rng.chance(0.5) });
        } else if (distToPolyline(mx, mz, CENTURY_PTS).d < 140 && rng.chance(0.6)) {
          lots.push({ type: 'office', x: mx, z: mz, w: 26, d: 26, height: rng.range(45, 85), facadeVariant: rng.pick(['glass-blue', 'office-band', 'glass-green']), roofType: rng.pick(['spire', 'crown', 'flat']) });
        } else {
          for (const z of [iz0 + 10, iz1 - 10]) lots.push({ type: 'residential', x: mx, z, w: rng.range(40, 56), d: 13, height: rng.range(28, 70), facadeVariant: rng.pick(['residential-a', 'residential-b']), roofType: rng.pick(['flat', 'gable', 'flat']), balconies: true });
        }
      } else {
        const jing = Math.hypot(mx - L.jingan.x, mz - L.jingan.z) < 220;
        if (jing && rng.chance(0.6)) {
          lots.push({ type: 'office', x: mx, z: mz, w: 28, d: 24, height: rng.range(50, 95), facadeVariant: rng.pick(['glass-green', 'office-grid', 'glass-silver']), roofType: rng.pick(['crown', 'spire', 'flat']), setback: 1 });
        } else if (rng.chance(0.25)) {
          for (const x of [ix0 + 14, ix1 - 14]) lots.push({ type: 'residential', x, z: mz, w: 24, d: 15, height: rng.range(9, 14), facadeVariant: 'shikumen', roofType: 'gable' });
          lots.push({ type: 'commercial', x: mx, z: iz0 + 9, w: 36, d: 12, height: rng.range(6, 9), facadeVariant: 'shop-modern', roofType: 'flat', awning: true });
        } else {
          for (const z of [iz0 + 10, iz1 - 10]) lots.push({ type: 'residential', x: mx, z, w: rng.range(36, 54), d: 13, height: rng.range(18, 60), facadeVariant: rng.pick(['residential-a', 'residential-b', 'brick']), roofType: rng.pick(['flat', 'gable', 'hip']), balconies: true });
        }
      }
      for (const l of lots) if (lotOk(l.x, l.z, l.w, l.d)) generic.push({ ...l, district: districtOf(l.x, l.z) });
    }
  }
  // Keep within the performance budget: drop the farthest generic lots first.
  const budget = 395 - out.length;
  generic.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  for (const g of generic.slice(0, budget)) add(g);

  scheduleConstruction(out, rng);
  return { buildings: out, parks: PARKS.map(p => ({ ...p })), amenities: placeAmenities() };
}

// Construction timeline for buildings (district waves; the four Lujiazui towers in order).
function scheduleConstruction(list, rng) {
  const wave = { bund: [12.5, 15], nanjing: [13.2, 16.2], renmin: [13.5, 16.5], yuyuan: [14, 17], 'west-residential': [14.5, 19], lujiazui: [15, 18.5], pudong: [15.5, 19.5] };
  const towerAt = { pearl: 15.2, jinmao: 16.8, swfc: 18.3, shanghaiTower: 19.3 };
  for (const b of list) {
    if (towerAt[b.special] != null) { b.buildStart = towerAt[b.special]; b.buildDur = 2.2; continue; }
    const [a, z] = wave[b.district] || [15, 19];
    const r = Math.min(1, Math.hypot(b.x, b.z) / 1400);
    b.buildStart = a + (z - a) * (0.7 * r + 0.3 * rng.next());
    b.buildDur = 1.2 + Math.min(1.4, b.height / 70);
  }
}

function placeAmenities() {
  const metro = [
    { id: 'm1', name: '人民广场站', x: -513, z: 113 }, { id: 'm2', name: '南京东路站', x: -213, z: 113 },
    { id: 'm3', name: '陆家嘴站', x: 213, z: 113 }, { id: 'm4', name: '豫园站', x: -113, z: -187 },
    { id: 'm5', name: '静安寺站', x: -1013, z: 113 }, { id: 'm6', name: '世纪大道站', x: 613, z: -187 },
    { id: 'm7', name: '陕西南路站', x: -813, z: -87 }, { id: 'm8', name: '东昌路站', x: 313, z: -187 },
  ];
  return { metro };
}
