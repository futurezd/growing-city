// Traffic signals: one light per intersection node (light.id === node id).
// Cycle: ns green 30s → ns yellow 3s → all red 2s → ew green 30s → ew yellow 3s → all red 2s.
export const CYCLE = 70;
const NS_G = 30, NS_Y = 33, EW_S = 35, EW_G = 65, EW_Y = 68;
export const MANUAL_HOLD = 60;

function autoColors(c) {
  return {
    ns: c < NS_G ? 'green' : c < NS_Y ? 'yellow' : 'red',
    ew: c >= EW_S && c < EW_G ? 'green' : c >= EW_G && c < EW_Y ? 'yellow' : 'red',
  };
}

export class Signals {
  constructor(graph) {
    this.graph = graph; this.t = 0; this.map = new Map(); this.list = [];
    this.rebuild();
  }

  rebuild() {
    const old = this.map; this.map = new Map();
    for (const id of this.graph.lightNodes()) {
      const n = this.graph.node(id);
      const prev = old.get(id);
      const light = prev || {
        id, nodeId: id, x: n.x, z: n.z,
        offset: (parseInt(id.slice(1), 10) * 13) % CYCLE,
        ns: 'red', ew: 'red', override: null,
      };
      this.map.set(id, light);
    }
    this.list = [...this.map.values()];
    this.update(this.t);
  }

  cyclePos(light, t = this.t) { return (((t + light.offset) % CYCLE) + CYCLE) % CYCLE; }

  update(t) {
    this.t = t;
    for (const l of this.list) {
      const ov = l.override;
      if (ov && t >= ov.until) {
        // Resume the automatic cycle at the clearance phase of whichever axis was green.
        const target = ov.ns === 'green' ? NS_G : ov.ew === 'green' ? EW_G : NS_Y;
        l.offset = (((target - t) % CYCLE) + CYCLE) % CYCLE;
        l.override = null;
      }
      const c = l.override ? l.override : autoColors(this.cyclePos(l, t));
      l.ns = c.ns; l.ew = c.ew;
    }
  }

  get(nodeId) { return this.map.get(nodeId) || null; }

  // Color shown to traffic travelling on the given axis into nodeId; null if the node has no light.
  color(nodeId, axis) { const l = this.map.get(nodeId); return l ? l[axis] : null; }

  // Seconds of green left for an axis (0 if not green).
  greenRemaining(nodeId, axis) {
    const l = this.map.get(nodeId);
    if (!l) return Infinity;
    if (l[axis] !== 'green') return 0;
    if (l.override) return l.override.until - this.t;
    const c = this.cyclePos(l);
    return axis === 'ns' ? NS_G - c : EW_G - c;
  }

  set(id, axis, color) {
    const l = this.map.get(id);
    if (!l || (axis !== 'ns' && axis !== 'ew') || !['green', 'yellow', 'red'].includes(color)) return false;
    const other = axis === 'ns' ? 'ew' : 'ns';
    const ov = l.override || { ns: l.ns, ew: l.ew };
    ov[axis] = color;
    if (color !== 'red') ov[other] = 'red';
    ov.until = this.t + MANUAL_HOLD;
    l.override = ov;
    l.ns = ov.ns; l.ew = ov.ew;
    return true;
  }

  view() { return this.list.map(l => ({ id: l.id, nodeId: l.nodeId, x: l.x, z: l.z, ns: l.ns, ew: l.ew, manual: !!l.override })); }
}
