function mulberry32(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(a, b) { return a + (b - a) * next(); },
    int(a, b) { return Math.floor(a + (b - a) * next()); },
    pick(arr) { return arr.length ? arr[this.int(0, arr.length)] : undefined; },
    chance(p) { return p <= 0 ? false : p >= 1 || next() < p; },
  };
}
