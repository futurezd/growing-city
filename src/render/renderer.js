// Render root: WebGL renderer + bloom, OrbitControls synced with sim.camera (sim coords, z flipped),
// view composition, click-to-focus / click-to-follow, and the frame loop that advances the sim.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { WaterView } from './water.js';
import { RoadsView } from './roads.js';
import { BridgesView } from './bridges.js';
import { StreetView } from './street.js';
import { ParksView } from './parks.js';
import { BuildingsView } from './buildings.js';
import { TrafficView } from './traffic-view.js';
import { Environment } from './environment.js';
import { WeatherFX } from './fx.js';

const toV = p => new THREE.Vector3(p.x, p.y, -p.z);
const toSim = v => ({ x: v.x, y: v.y, z: -v.z });

export class CityRenderer {
  constructor(container, sim) {
    this.sim = sim; this.listeners = { pick: [] };
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio)); r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 9000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: Math.PI * 0.495, minDistance: 8, maxDistance: 2600, screenSpacePanning: false });
    this.uniforms = { uNight: { value: 0 }, uTime: { value: 0 }, uSnow: { value: 0 }, uRain: { value: 0 } };
    this.env = new Environment(this.scene, sim);
    this.fx = new WeatherFX(this.scene);
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.6, 0.85);
    this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    this._buildWorld();
    this._bindInput();
    addEventListener('resize', () => this._resize());
    this.clock = new THREE.Clock(); this.t = 0; this.godMode = false;
    this._applySimCamera();
  }

  // All city geometry lives under one root so a reset (replay construction) can rebuild everything.
  _buildWorld() {
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse(o => { o.geometry?.dispose(); });
    }
    const root = this.root = new THREE.Group(); this.scene.add(root);
    const s = this.sim;
    this.views = [
      new WaterView(root, s, this.uniforms), new RoadsView(root, s), new BridgesView(root, s),
      new StreetView(root, s), new ParksView(root, s), new TrafficView(root, s),
    ];
    this.buildings = new BuildingsView(root, s, this.uniforms);
    this.trafficView = this.views[5];
    this.simVersion = s.version;
  }

  _bindInput() {
    const el = this.renderer.domElement, c = this.controls;
    this.userDriving = false;
    c.addEventListener('start', () => { this.userDriving = true; if (this.sim.camera.following) this.sim.camera.follow(null); });
    c.addEventListener('end', () => { this.userDriving = false; });
    // Also persist residual damping after release (unless a preset ease / follow owns the camera).
    c.addEventListener('change', () => {
      const rig = this.sim.camera;
      if (this.userDriving || (!rig.anim && !rig.following)) rig.setFromUser(toSim(this.camera.position), toSim(c.target));
    });
    let down = null;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      this._click(e);
    });
  }

  _click(e) {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    // Vehicles / pedestrians first → follow. InstancedMesh bounds can be stale as
    // instance transforms and counts change, so refresh them before raycasting.
    const tv = this.trafficView;
    tv.body.computeBoundingSphere();
    tv.pBody.computeBoundingSphere();
    const hit = ray.intersectObjects([tv.body, tv.pBody], false)[0];
    if (hit && hit.instanceId != null && !this.godMode) {
      if (hit.object === tv.body) { const c = this.sim.traffic.cars[hit.instanceId]; if (c) { this.sim.followCar(c.id); this._emit('pick', { type: 'car', id: c.id }); return; } }
      else { const p = this.sim.peds.list[hit.instanceId]; if (p) { this.sim.followPedestrian(p.id); this._emit('pick', { type: 'ped', id: p.id }); return; } }
    }
    const pt = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt)) return;
    const x = pt.x, z = -pt.z;
    if (this.godMode) { this._emit('pick', { type: 'ground', x, z, god: true }); return; }
    this.sim.focusOn(x, z);
    this._emit('pick', { type: 'ground', x, z });
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  _emit(name, data) { for (const fn of this.listeners[name] || []) fn(data); }

  _resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight);
  }

  _applySimCamera() {
    const c = this.sim.camera;
    this.camera.position.copy(toV(c.pos)); this.controls.target.copy(toV(c.target));
    this.camera.lookAt(this.controls.target);
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta()), s = this.sim;
    this.t += dt;
    if (!s.manual) s._advance(s.timeScale);
    else s.camera.step(dt);                         // manual mode: keep camera easing alive
    if (s.version !== this.simVersion) this._buildWorld();
    if (!this.userDriving) this._applySimCamera();
    this.controls.update();
    const night = s.lighting.night, snowing = s.weather === 'snow';
    const u = this.uniforms;
    u.uNight.value = night; u.uTime.value = this.t;
    u.uSnow.value += ((snowing ? 0.85 : 0) - u.uSnow.value) * dt * 0.25;
    u.uRain.value = s.weather === 'rain' ? 1 : 0;
    const f = {
      build: s.construction.done ? 1e9 : s.construction.elapsed, night, weather: s.weather,
      season: s.season, festival: s.festival, time: this.t, dt,
    };
    for (const v of this.views) v.update(f);
    this.buildings.update(this.t, night);
    this.env.update(f, { position: this.camera.position, target: this.controls.target });
    this.fx.update(f, this.camera);
    this.bloom.strength = 0.15 + night * 0.75;
    this.bloom.threshold = 0.9 - night * 0.25;
    this.renderer.toneMappingExposure = 1.0 + night * 0.25;
    this.composer.render();
  }

  start() {
    const loop = () => { this.frame(); this.raf = requestAnimationFrame(loop); };
    loop();
  }
}
