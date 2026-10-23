// Sky & lighting: sun (shadow-casting), hemisphere fill, sky colour/fog by sun elevation,
// moon, star field, drifting clouds and flocks of birds.
import * as THREE from 'three';
import { cloudTexture, moonTexture, glowTexture } from './textures.js';
import { hash } from './util.js';

const SKY = {
  day: new THREE.Color('#8fc3e6'), dusk: new THREE.Color('#e3936a'), night: new THREE.Color('#070d1c'),
  overcast: new THREE.Color('#8a949c'), overNight: new THREE.Color('#0b1018'),
};

export class Environment {
  constructor(scene, sim) {
    this.scene = scene; this.sim = sim;
    scene.background = new THREE.Color(); scene.fog = new THREE.Fog('#8fc3e6', 900, 3200);
    this.sun = new THREE.DirectionalLight('#fff3dd', 2.4);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = -900; sc.right = 900; sc.top = 900; sc.bottom = -900; sc.near = 10; sc.far = 4000;
    this.sun.shadow.mapSize.set(4096, 4096); this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#cfe6ff', '#4a4636', 0.9); scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight('#9fb4ff', 0); scene.add(this.moonLight);

    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, fog: false, depthWrite: false }));
    this.moon.scale.setScalar(140); scene.add(this.moon);
    this._stars(); this._clouds(); this._birds();
  }

  _stars() {
    const n = 1800, pos = [];
    for (let i = 0; i < n; i++) {
      const u = hash(i * 1.3), v = hash(i * 7.1) * 0.9 + 0.08, th = u * Math.PI * 2, ph = Math.acos(1 - v);
      pos.push(Math.sin(ph) * Math.cos(th) * 3800, Math.cos(ph) * 3800, Math.sin(ph) * Math.sin(th) * 3800);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat); this.stars.frustumCulled = false; this.scene.add(this.stars);
  }

  _clouds() {
    this.clouds = [];
    for (let i = 0; i < 22; i++) {
      const m = new THREE.SpriteMaterial({ map: cloudTexture(i + 1), transparent: true, opacity: 0.8, depthWrite: false, fog: false });
      const s = new THREE.Sprite(m), w = 260 + hash(i * 3) * 320;
      s.scale.set(w, w * 0.42, 1);
      s.userData = { x: -1800 + hash(i) * 3600, z: -1500 + hash(i * 9) * 3000, y: 380 + hash(i * 5) * 260, v: 4 + hash(i * 2) * 6 };
      this.clouds.push(s); this.scene.add(s);
    }
  }

  _birds() {
    // Simple V-shaped birds; wings flap by scaling y.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1.6, 0.5, 0, 0, 0, 0.4, 0, 0, -0.4, 1.6, 0.5, 0, 0, 0, 0.4, 0, 0, -0.4], 3));
    g.computeVertexNormals();
    this.birds = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#222831', side: THREE.DoubleSide }), 36);
    this.birds.frustumCulled = false; this.scene.add(this.birds);
  }

  update(f, camera) {
    const L = this.sim.lighting, h = this.sim.hourFloat, night = L.night, elev = L.sunElevation;
    const wet = f.weather !== 'clear';
    // Sun path: rises in the east (+x), sets west, leaning south (−z sim → +z three).
    const az = ((h - 6) / 12) * Math.PI;
    const dir = new THREE.Vector3(Math.cos(az) * 0.8, Math.max(0.05, Math.sin(az)), 0.45).normalize();
    const c = camera.target || new THREE.Vector3();
    this.sun.position.copy(c).addScaledVector(dir, 1600); this.sun.target.position.copy(c);
    this.sun.intensity = L.sunIntensity * 2.8;
    const warm = Math.max(0, 1 - Math.abs(elev) * 3);  // golden hour tint
    this.sun.color.setRGB(1, 0.93 - warm * 0.3, 0.85 - warm * 0.5);
    this.sun.castShadow = L.sunIntensity > 0.02;
    this.hemi.intensity = 0.25 + Math.max(0, elev) * 0.8 * (wet ? 0.8 : 1);
    this.hemi.color.set(night > 0.5 ? '#5068a8' : '#cfe6ff');
    this.moonLight.intensity = night * 0.5;
    this.moonLight.position.set(-600, 900, 400);

    // Sky colour: day → dusk (sun near horizon) → night; overcast in rain/snow.
    const sky = this.scene.background;
    if (elev > 0.25) sky.copy(SKY.day); else if (elev > -0.15) sky.copy(SKY.dusk).lerp(SKY.day, (elev + 0.15) / 0.4);
    else sky.copy(SKY.night).lerp(SKY.dusk, Math.max(0, (elev + 0.45) / 0.3));
    if (wet) sky.lerp(night > 0.5 ? SKY.overNight : SKY.overcast, 0.65);
    this.scene.fog.color.copy(sky);
    this.scene.fog.near = wet ? 300 : 900; this.scene.fog.far = wet ? 1900 : 3400;

    // Moon opposite the sun; stars fade in at night (hidden by clouds when wet).
    const md = dir.clone().multiplyScalar(-1); md.y = Math.max(0.25, md.y);
    this.moon.position.copy(camera.position).addScaledVector(md.normalize(), 3000);
    this.moon.material.opacity = night * (wet ? 0.2 : 1);
    this.stars.position.copy(camera.position);
    this.starMat.opacity = night * (wet ? 0.05 : 0.9);

    for (const s of this.clouds) {
      const u = s.userData; u.x += u.v * f.dt * (wet ? 1.8 : 1); if (u.x > 1900) u.x = -1900;
      s.position.set(u.x, u.y, u.z);
      s.material.opacity = (wet ? 0.95 : 0.7) * (1 - night * 0.75);
      s.material.color.set(wet ? '#7d858c' : night > 0.5 ? '#3a4154' : elev < 0.25 ? '#ffd2b0' : '#ffffff');
    }

    // Birds: three flocks circling over the river by day, absent at night and in bad weather.
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    const show = night < 0.4 && !wet;
    this.birds.count = show ? 36 : 0;
    if (show) for (let i = 0; i < 36; i++) {
      const flock = i % 3, a = f.time * 0.08 + flock * 2.1 + Math.floor(i / 3) * 0.035, R = 180 + flock * 90;
      const cx = [100, -300, 400][flock], cz = [-100, 200, 50][flock];
      const x = cx + Math.cos(a) * R + hash(i) * 14, z = cz + Math.sin(a) * R + hash(i * 3) * 14;
      q.setFromAxisAngle(Y, -a);
      m4.compose(new THREE.Vector3(x, 120 + flock * 25 + hash(i * 7) * 10, -z), q, new THREE.Vector3(1.6, 1.6 * (0.4 + Math.abs(Math.sin(f.time * 9 + i))), 1.6));
      this.birds.setMatrixAt(i, m4);
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }
}

export { glowTexture };
