// Weather particles (rain streaks, snowflakes) following the camera, and festival fireworks over the Huangpu.
import * as THREE from 'three';
import { glowTexture } from './textures.js';
import { hash } from './util.js';

const RAIN_N = 6000, SNOW_N = 4000, BOX = 420, FW_SHELLS = 8, FW_SPARKS = 90;
const FW_COLS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#ffffff'].map(c => new THREE.Color(c));

export class WeatherFX {
  constructor(scene) {
    this.scene = scene;
    // Rain: line segments (2 verts each).
    const rp = new Float32Array(RAIN_N * 6);
    for (let i = 0; i < RAIN_N; i++) { rp[i * 6] = (hash(i) - 0.5) * BOX * 2; rp[i * 6 + 1] = hash(i * 3.3) * 300; rp[i * 6 + 2] = (hash(i * 7.7) - 0.5) * BOX * 2; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#b8c8d8', transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    const sp = new Float32Array(SNOW_N * 3);
    for (let i = 0; i < SNOW_N; i++) { sp[i * 3] = (hash(i * 1.1) - 0.5) * BOX * 2; sp[i * 3 + 1] = hash(i * 5.3) * 300; sp[i * 3 + 2] = (hash(i * 9.1) - 0.5) * BOX * 2; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ map: glowTexture(), color: '#ffffff', size: 2.4, transparent: true, opacity: 0.9, depthWrite: false }));
    this.snow.frustumCulled = false; this.snow.visible = false;
    scene.add(this.rain, this.snow);
    this._fireworks();
  }

  _fireworks() {
    const n = FW_SHELLS * FW_SPARKS, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.fw = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture(), size: 7, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.fw.frustumCulled = false; this.fw.visible = false; this.scene.add(this.fw);
  }

  update(f, camera) {
    const cx = camera.position.x, cz = camera.position.z, top = Math.max(0, camera.position.y - 150);
    this.rain.visible = f.weather === 'rain'; this.snow.visible = f.weather === 'snow';
    if (this.rain.visible) {
      const a = this.rain.geometry.attributes.position.array, fall = f.dt * 260;
      for (let i = 0; i < RAIN_N; i++) {
        const j = i * 6;
        let y = a[j + 1] - fall; if (y < 0) y += 300;
        a[j + 1] = y; a[j + 4] = y + 5; a[j + 3] = a[j] + 0.6; a[j + 5] = a[j + 2];
      }
      this.rain.position.set(cx - (cx % 1), top, cz - (cz % 1));
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.snow.visible) {
      const a = this.snow.geometry.attributes.position.array;
      for (let i = 0; i < SNOW_N; i++) {
        const j = i * 3; let y = a[j + 1] - f.dt * (12 + (i % 7));
        if (y < 0) y += 300;
        a[j + 1] = y; a[j] += Math.sin(f.time + i) * f.dt * 3;
      }
      this.snow.position.set(cx, top, cz);
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
    this._updateFireworks(f);
  }

  // Each shell: launch (0–1 s) then explode into a sphere of sparks with gravity and fade (1–3.5 s).
  _updateFireworks(f) {
    const on = f.festival && f.night > 0.3;
    this.fw.visible = on; if (!on) return;
    const pos = this.fw.geometry.attributes.position.array, col = this.fw.geometry.attributes.color.array;
    for (let s = 0; s < FW_SHELLS; s++) {
      const period = 4 + hash(s) * 2, t = (f.time + s * 0.73) % period, cycle = Math.floor((f.time + s * 0.73) / period);
      const seed = s * 31 + cycle * 7, ox = 40 + (hash(seed) - 0.5) * 300, oz = -60 + hash(seed + 1) * 260, oy = 160 + hash(seed + 2) * 90;
      const c = FW_COLS[Math.floor(hash(seed + 3) * FW_COLS.length)];
      for (let i = 0; i < FW_SPARKS; i++) {
        const j = (s * FW_SPARKS + i) * 3;
        let x = ox, y, z = oz, k;
        if (t < 1) { y = oy * t; k = i < 6 ? 1 : 0; }               // rising trail (few sparks)
        else {
          const e = t - 1, u = hash(i * 1.7 + seed), v = hash(i * 3.1 + seed), th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), sp = 45;
          x += Math.sin(ph) * Math.cos(th) * sp * e; z += Math.sin(ph) * Math.sin(th) * sp * e;
          y = oy + Math.cos(ph) * sp * e - 9 * e * e; k = Math.max(0, 1 - e / 2.5);
        }
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = -z;
        col[j] = c.r * k; col[j + 1] = c.g * k; col[j + 2] = c.b * k;
      }
    }
    this.fw.geometry.attributes.position.needsUpdate = true; this.fw.geometry.attributes.color.needsUpdate = true;
  }
}
