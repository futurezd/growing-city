// Incidents and announcements. Accident lifecycle: breakdown → queue → tow truck → cleared.
const T_TOW_ARRIVE = 10, T_TOW_LEAVE = 20, T_CLEAR = 24;

export class Incidents {
  constructor(sim, rng) {
    this.sim = sim; this.rng = rng;
    this.log = []; this.active = []; this.nextId = 1; this._randomAcc = 0;
  }

  announce(message, type = 'info', extra = {}) {
    const t = this.sim.time;
    const ev = { id: `ev${this.nextId++}`, type, message, t: this.sim.simT, clock: `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`, ...extra };
    this.log.push(ev);
    if (this.log.length > 60) this.log.shift();
    return ev;
  }

  accident(edgeId) {
    const sim = this.sim, g = sim.g, e = g.edge(edgeId);
    if (!e || e.pedOnly || e.blocked) return null;
    // Use a car already on the edge if there is one; otherwise a car breaks down mid-edge.
    let car = sim.traffic.cars.find(c => c.edge === e.id && !c.parked && !c.broken);
    if (!car) {
      const blocking = sim.traffic.cars.filter(c => c.edge === e.id);
      let off = e.length * 0.45;
      for (let i = 0; i < 8 && blocking.some(c => Math.abs(c.offset - off) < 8); i++) off = e.length * (0.2 + 0.08 * i);
      const id = sim.traffic.spawn({ edge: e.id, offset: off, speed: 0, kind: 'car' });
      car = id && sim.traffic.get(id);
    }
    if (!car) return null;
    car.broken = true; car.speed = 0; car.committed = false;
    e.blocked = true;
    const node = g.node(e.from);
    const inc = { id: `acc${this.nextId}`, edgeId: e.id, carId: car.id, age: 0, phase: 'breakdown', x: car.x, z: car.z, heading: car.heading, towFrom: node ? { x: node.x, z: node.z } : { x: car.x, z: car.z } };
    this.active.push(inc);
    const ev = this.announce(`交通事故：车辆抛锚，道路 ${e.id} 临时封闭，后方车辆排队/绕行`, 'accident', { edgeId: e.id, incidentId: inc.id, phase: 'breakdown' });
    inc.eventId = ev.id;
    return ev.id;
  }

  step(dt) {
    const sim = this.sim;
    for (const inc of [...this.active]) {
      inc.age += dt;
      const car = sim.traffic.get(inc.carId);
      if (car) { inc.x = car.x; inc.z = car.z; inc.heading = car.heading; }
      if (inc.phase === 'breakdown' && inc.age >= T_TOW_ARRIVE) { inc.phase = 'towing'; this.announce('拖车已到达事故现场，正在拖离', 'accident', { edgeId: inc.edgeId, incidentId: inc.id, phase: 'towing' }); }
      if (inc.phase === 'towing' && inc.age >= T_TOW_LEAVE) { inc.phase = 'clearing'; if (car) sim.traffic.remove(car.id); }
      if (inc.age >= T_CLEAR) {
        const e = sim.g.edge(inc.edgeId);
        if (e) e.blocked = false;
        if (car && sim.traffic.get(car.id)) sim.traffic.remove(car.id);
        this.active.splice(this.active.indexOf(inc), 1);
        this.announce('事故已处理完毕，道路恢复通行', 'accident', { edgeId: inc.edgeId, incidentId: inc.id, phase: 'cleared' });
      }
    }
    // Occasional random breakdowns once the city runs.
    if (sim.construction.done && !this.active.length) {
      this._randomAcc += dt;
      if (this._randomAcc > 30) {
        this._randomAcc = 0;
        if (sim.traffic.cars.length > 30 && this.rng.chance(0.08)) {
          const c = this.rng.pick(sim.traffic.cars.filter(x => !x.parked && !x.broken && !sim.g.edge(x.edge).bridge));
          if (c) this.accident(c.edge);
        }
      }
    }
  }

  view() { return this.active.map(i => ({ ...i, towProgress: Math.max(0, Math.min(1, (i.age - (T_TOW_ARRIVE - 6)) / 6)) })); }
}
