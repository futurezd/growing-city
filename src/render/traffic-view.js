// Vehicles (car/taxi/bus/tow), head/tail lights, pedestrians, boats and accident markers as instanced meshes.
// Reads sim.traffic.cars / sim.peds.list directly each frame (read-only).
import * as THREE from 'three';
import { makeHeightFn } from './util.js';
import { bridgeSpans } from './bridges.js';
import { glowTexture } from './textures.js';

const MAX_CARS = 140, MAX_PEDS = 180;
const CAR_COLS = ['#c8ccd0', '#1d2124', '#9b1c1c', '#24497a', '#e6e6e0', '#5d6b73', '#2f5a3a', '#b88a2c'].map(c => new THREE.Color(c));
const PED_COLS = ['#d64545', '#3b6bd6', '#e0b33e', '#3fa56b', '#efefef', '#2a2a2a', '#c45fb0', '#ff8a3d', '#6dd3e0', '#8a6a4a'].map(c => new THREE.Color(c));
const KIND_COL = { taxi: new THREE.Color('#e9c22e'), bus: new THREE.Color('#2d8f5a'), tow: new THREE.Color('#f07d1a') };
const BOAT = { cargo: [26, 7, 3, '#7a3b2a'], cruise: [30, 8, 6, '#f0f0ea'], ferry: [16, 6, 4, '#2c6e9e'], barge: [22, 7, 1.6, '#4b4b46'] };

function inst(geo, mat, n, shadow = true) { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.castShadow = shadow; return m; }

export class TrafficView {
  constructor(scene, sim) {
    this.sim = sim; this.group = new THREE.Group(); scene.add(this.group);
    const paint = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: '#1c2a33', roughness: 0.1, metalness: 0.8 });
    // Unit body length 1 (scaled by car.len); local +z = forward.
    this.body = inst(new THREE.BoxGeometry(1.7, 1.0, 1).translate(0, 0.75, 0), paint, MAX_CARS);
    this.cabin = inst(new THREE.BoxGeometry(1.5, 0.8, 0.55).translate(0, 1.6, -0.05), glass, MAX_CARS);
    this.wheels = inst(new THREE.BoxGeometry(1.86, 0.55, 0.22).translate(0, 0.3, 0), new THREE.MeshStandardMaterial({ color: '#111' }), MAX_CARS * 2, false);
    // Lights: additive points; head (warm white) and tail (red).
    const pm = (c, s) => new THREE.PointsMaterial({ map: glowTexture(), color: c, size: s, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.headMat = pm('#fff1cc', 5); this.tailMat = pm('#ff2a2a', 3.2); this.beaconMat = pm('#ffaa00', 7);
    this.head = this._points(MAX_CARS * 2, this.headMat); this.tail = this._points(MAX_CARS * 2, this.tailMat); this.beacon = this._points(16, this.beaconMat);
    // Pedestrians: body + head.
    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.pBody = inst(new THREE.CylinderGeometry(0.32, 0.38, 1.3, 6).translate(0, 0.95, 0), cloth, MAX_PEDS);
    this.pHead = inst(new THREE.SphereGeometry(0.26, 6, 5).translate(0, 1.85, 0), new THREE.MeshStandardMaterial({ color: '#e0b896' }), MAX_PEDS);
    this.pUmb = inst(new THREE.ConeGeometry(0.85, 0.35, 8).translate(0, 2.45, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), MAX_PEDS, false);
    this.group.add(this.body, this.cabin, this.wheels, this.pBody, this.pHead, this.pUmb);
    this._boats();
    // Accident warning cones.
    this.cones = inst(new THREE.ConeGeometry(0.45, 1.1, 8).translate(0, 0.55, 0), new THREE.MeshStandardMaterial({ color: '#ff6a00' }), 64, false);
    this.group.add(this.cones);
    this.version = -1;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.Y = new THREE.Vector3(0, 1, 0);
  }

  _points(n, mat) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    const p = new THREE.Points(g, mat); p.frustumCulled = false; this.group.add(p); return p;
  }

  _boats() {
    this.boatMeshes = new Map();
    for (const b of this.sim.boats) {
      const [L, W, H, col] = BOAT[b.kind] || BOAT.cargo, o = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(W, 2, L), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
      hull.position.y = 0.4;
      const bow = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, 2, 3, 1, false, 0, Math.PI).rotateY(Math.PI / 2), hull.material);
      bow.position.set(0, 0.4, L / 2); bow.scale.z = 0.8;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, H, L * 0.4), new THREE.MeshStandardMaterial({ color: b.kind === 'cruise' ? '#ffffff' : '#c9c4b8', emissive: '#ffcf80', emissiveIntensity: 0 }));
      deck.position.set(0, 1.4 + H / 2, -L * 0.15);
      hull.castShadow = deck.castShadow = true;
      o.add(hull, bow, deck); o.userData.deck = deck;
      if (b.kind === 'cargo' || b.kind === 'barge') for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 2, 4), new THREE.MeshStandardMaterial({ color: ['#c0392b', '#2471a3', '#d4ac0d'][i] }));
        c.position.set(0, 2.4, L * 0.08 + i * 4.4); o.add(c);
      }
      this.group.add(o); this.boatMeshes.set(b.id, o);
    }
  }

  update(f) {
    const sim = this.sim, m4 = this.m4, q = this.q, Y = this.Y;
    if (this.version !== sim.g.version) { this.height = makeHeightFn(bridgeSpans(sim)); this.version = sim.g.version; }
    const H = this.height, night = f.night, cars = sim.traffic.cars, n = Math.min(MAX_CARS, cars.length);
    const hp = this.head.geometry.attributes.position.array, tp = this.tail.geometry.attributes.position.array, bp = this.beacon.geometry.attributes.position.array;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      const c = cars[i], y = H(c.x, c.z), L = c.len, h = c.heading, sx = Math.sin(h), cz = Math.cos(h);
      const tall = c.kind === 'bus' ? 1.9 : 1;
      q.setFromAxisAngle(Y, Math.PI - h);   // sim heading atan2(dx,dz) → three yaw (z flipped)
      m4.compose(new THREE.Vector3(c.x, y, -c.z), q, new THREE.Vector3(c.kind === 'bus' ? 1.3 : 1, tall, L)); this.body.setMatrixAt(i, m4);
      this.body.setColorAt(i, KIND_COL[c.kind] || CAR_COLS[c.color % CAR_COLS.length]);
      m4.compose(new THREE.Vector3(c.x, y + (tall - 1) * 0.9, -c.z), q, new THREE.Vector3(c.kind === 'bus' ? 1.3 : 1, c.kind === 'bus' ? 1.2 : 1, c.kind === 'bus' ? L * 1.6 : L)); this.cabin.setMatrixAt(i, m4);
      for (const s of [0, 1]) {
        const o = (s ? 0.32 : -0.32) * L;
        m4.compose(new THREE.Vector3(c.x + sx * o, y, -(c.z + cz * o)), q, new THREE.Vector3(c.kind === 'bus' ? 1.3 : 1, 1, 1)); this.wheels.setMatrixAt(i * 2 + s, m4);
      }
      // Light positions: front corners / rear corners (right vector in sim = (cz, -sx)).
      const rx = cz * 0.65, rz = -sx * 0.65, fx = sx * L / 2, fz = cz * L / 2;
      for (const k of [0, 1]) {
        const side = k ? 1 : -1, j = (i * 2 + k) * 3;
        hp[j] = c.x + fx + rx * side; hp[j + 1] = y + 0.8; hp[j + 2] = -(c.z + fz + rz * side);
        tp[j] = c.x - fx + rx * side; tp[j + 1] = y + 0.9; tp[j + 2] = -(c.z - fz + rz * side);
      }
      if ((c.broken || c.kind === 'tow') && nb < 16) { const j = nb++ * 3; bp[j] = c.x; bp[j + 1] = y + 2.6 * tall; bp[j + 2] = -c.z; }
    }
    this.body.count = this.cabin.count = n; this.wheels.count = n * 2;
    this.head.geometry.setDrawRange(0, night > 0.05 ? n * 2 : 0); this.tail.geometry.setDrawRange(0, n * 2);
    this.tailMat.opacity = 0.35 + night * 0.65; this.headMat.opacity = night;
    // Hazard / tow beacons blink.
    this.beacon.geometry.setDrawRange(0, Math.sin(f.time * 8) > 0 ? nb : 0);
    for (const p of [this.head, this.tail, this.beacon]) p.geometry.attributes.position.needsUpdate = true;
    for (const im of [this.body, this.cabin, this.wheels]) im.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    this._peds(f, H);
    this._boatsUpdate(f);
    this._accidents(H);
  }

  _peds(f, H) {
    const list = this.sim.peds.list, n = Math.min(MAX_PEDS, list.length), m4 = this.m4, q = this.q, rain = f.weather !== 'clear';
    let nu = 0;
    for (let i = 0; i < n; i++) {
      const p = list[i], y = H(p.x, p.z) + 0.2, s = Math.max(0.01, p.fade ?? 1);
      // Walking bob.
      const bob = p.state === 'wait' ? 0 : Math.abs(Math.sin(f.time * 7 + i)) * 0.12;
      q.setFromAxisAngle(this.Y, Math.PI - p.heading);
      m4.compose(new THREE.Vector3(p.x, y + bob, -p.z), q, new THREE.Vector3(s, s, s));
      this.pBody.setMatrixAt(i, m4); this.pHead.setMatrixAt(i, m4);
      this.pBody.setColorAt(i, PED_COLS[p.color % PED_COLS.length]);
      if (rain && i % 3 !== 2) { this.pUmb.setMatrixAt(nu, m4); this.pUmb.setColorAt(nu, PED_COLS[(p.color + 3) % PED_COLS.length]); nu++; }
    }
    this.pBody.count = this.pHead.count = n; this.pUmb.count = nu;
    for (const im of [this.pBody, this.pHead, this.pUmb]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }

  _boatsUpdate(f) {
    for (const b of this.sim.boats) {
      const o = this.boatMeshes.get(b.id); if (!o) continue;
      o.position.set(b.x, -0.6 + Math.sin(f.time * 1.3 + b.s * 0.01) * 0.15, -b.z);
      o.rotation.y = Math.PI - b.heading;
      o.rotation.z = Math.sin(f.time * 0.9 + b.s) * 0.02;
      o.userData.deck.material.emissiveIntensity = f.night * (b.kind === 'cruise' ? 1.4 : 0.5);
      o.visible = f.build >= 5;
    }
  }

  _accidents(H) {
    let n = 0;
    for (const inc of this.sim.incidents.active) {
      const car = this.sim.traffic.get(inc.carId); if (!car) continue;
      const sx = Math.sin(car.heading), cz = Math.cos(car.heading);
      for (const d of [-6, -9, -12]) {
        if (n >= 64) break;
        const x = car.x + sx * d + cz * (d === -9 ? 1.5 : 0), z = car.z + cz * d - sx * (d === -9 ? 1.5 : 0);
        this.cones.setMatrixAt(n++, this.m4.makeTranslation(x, H(x, z), -z));
      }
    }
    this.cones.count = n; this.cones.instanceMatrix.needsUpdate = true;
  }
}
