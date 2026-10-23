// Camera rig kept in sim coordinates (+x east, +y up, +z north) so presets/follow are testable headless.
export const PRESETS = {
  overview: { label: '全景俯瞰', pos: { x: -700, y: 720, z: -1050 }, target: { x: 0, y: 0, z: 0 } },
  bund: { label: '外滩', pos: { x: 160, y: 40, z: -120 }, target: { x: -70, y: 18, z: 20 } },
  lujiazui: { label: '陆家嘴', pos: { x: -120, y: 110, z: -160 }, target: { x: 260, y: 70, z: 30 } },
  nanjing: { label: '南京路', pos: { x: -470, y: 45, z: 70 }, target: { x: -220, y: 10, z: 100 } },
  yuyuan: { label: '豫园', pos: { x: -90, y: 55, z: -330 }, target: { x: -150, y: 4, z: -250 } },
  night: { label: '浦江夜景', pos: { x: 100, y: 60, z: -420 }, target: { x: 150, y: 50, z: 60 } },
};
export const EASE_SECONDS = 2;

const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(sim) {
    this.sim = sim;
    const p = PRESETS.overview;
    this.pos = { ...p.pos }; this.target = { ...p.target };
    this.anim = null; this.following = null; this.activePreset = 'overview';
  }

  _go(pos, target) {
    this.anim = { from: { pos: { ...this.pos }, target: { ...this.target } }, to: { pos: { ...pos }, target: { ...target } }, t: 0 };
  }

  preset(name) {
    const p = PRESETS[name];
    if (!p) return false;
    this.following = null; this.activePreset = name;
    this._go(p.pos, p.target);
    return true;
  }

  focus(x, z) {
    if (!Number.isFinite(+x) || !Number.isFinite(+z)) return false;
    this.following = null; this.activePreset = null;
    const dx = this.pos.x - this.target.x, dz = this.pos.z - this.target.z;
    const d = Math.hypot(dx, dz) || 1, dist = Math.min(260, Math.max(90, d));
    const target = { x: +x, y: 0, z: +z };
    this._go({ x: target.x + (dx / d) * dist * 0.75, y: Math.max(60, dist * 0.6), z: target.z + (dz / d) * dist * 0.75 }, target);
    return true;
  }

  follow(ref) {
    if (!ref) { this.following = null; return true; }
    const ok = ref.type === 'car' ? this.sim.traffic.get(ref.id) : this.sim.peds.get(ref.id);
    if (!ok) return false;
    this.following = { ...ref }; this.activePreset = null; this.anim = null;
    return true;
  }

  // Orbit controls write back user changes; this cancels animations.
  setFromUser(pos, target) {
    this.anim = null;
    this.pos = { ...pos }; this.target = { ...target };
  }

  step(dt) {
    if (this.following) {
      const f = this.following;
      const obj = f.type === 'car' ? this.sim.traffic.get(f.id) : this.sim.peds.get(f.id);
      if (!obj) { this.following = null; }
      else {
        const back = f.type === 'car' ? 26 : 14, up = f.type === 'car' ? 12 : 7;
        const hx = Math.sin(obj.heading), hz = Math.cos(obj.heading);
        const want = { x: obj.x - hx * back, y: up, z: obj.z - hz * back };
        const k = Math.min(1, dt * 4);
        this.pos = lerpV(this.pos, want, k);
        this.target = lerpV(this.target, { x: obj.x + hx * 6, y: 2, z: obj.z + hz * 6 }, Math.min(1, dt * 8));
        return;
      }
    }
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / EASE_SECONDS);
      const e = ease(a.t);
      this.pos = lerpV(a.from.pos, a.to.pos, e);
      this.target = lerpV(a.from.target, a.to.target, e);
      if (a.t >= 1) this.anim = null;
    }
  }

  get state() { return { pos: { ...this.pos }, target: { ...this.target }, animating: !!this.anim, following: this.following ? { ...this.following } : null, preset: this.activePreset }; }
}
