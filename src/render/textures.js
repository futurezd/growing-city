// Procedural canvas textures (no external assets).
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Soft radial glow (lamps, headlights, light pools).
export function glowTexture() {
  return canvas(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}

// Fluffy cloud built from overlapping puffs.
export function cloudTexture(seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return canvas(256, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = w * (0.18 + rnd() * 0.64), y = h * (0.42 + rnd() * 0.25), r = 18 + rnd() * 34;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.85)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
}

// Vertical neon shop sign with Chinese characters.
export function neonSignTexture(text, color) {
  return canvas(64, 64 * text.length + 32, (g, w, h) => {
    g.fillStyle = '#120812'; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 4; g.shadowColor = color; g.shadowBlur = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#fff'; g.font = 'bold 46px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    [...text].forEach((ch, i) => { g.shadowBlur = 16; g.fillStyle = color; g.fillText(ch, w / 2, 48 + i * 64); g.shadowBlur = 0; g.fillStyle = '#fff8'; g.fillText(ch, w / 2, 48 + i * 64); });
  });
}

// Metro entrance sign (red "M" disc as used by Shanghai Metro).
export function metroSignTexture() {
  return canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#d7101c'; g.beginPath(); g.arc(w / 2, h / 2, 60, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 84px Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('M', w / 2, h / 2 + 4);
  });
}

// Bus stop sign.
export function busSignTexture() {
  return canvas(64, 64, (g, w, h) => {
    g.fillStyle = '#0a5fb4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold 24px "PingFang SC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('公交', w / 2, h / 2);
  });
}

// Clock face for the Customs House tower.
export function clockTexture() {
  return canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#e8e2cf'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2b2620'; g.lineWidth = 4; g.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(64 + Math.sin(a) * 48, 64 - Math.cos(a) * 48); g.lineTo(64 + Math.sin(a) * 56, 64 - Math.cos(a) * 56); g.stroke(); }
    g.lineWidth = 6; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 26); g.stroke();
    g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(92, 70); g.stroke();
  });
}

// Moon with simple maria.
export function moonTexture() {
  return canvas(128, 128, (g) => {
    const r = g.createRadialGradient(54, 54, 10, 64, 64, 62);
    r.addColorStop(0, '#fffbe8'); r.addColorStop(1, '#d9d3bd');
    g.fillStyle = r; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(150,145,130,0.35)';
    for (const [x, y, s] of [[44, 50, 14], [80, 44, 10], [70, 82, 16], [40, 84, 8]]) { g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); }
  });
}

// Subtle tiling noise for ground / grass / asphalt.
export function noiseTexture(base, spread, size = 256, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const t = canvas(size, size, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = Math.floor((rnd() - 0.5) * spread);
      g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Signboard text for district labels (sprites in god mode / overview).
export function labelTexture(text) {
  const t = canvas(256, 64, (g, w, h) => {
    g.fillStyle = 'rgba(8,16,30,0.72)';
    g.beginPath(); g.roundRect(4, 8, w - 8, h - 16, 14); g.fill();
    g.fillStyle = '#f2e7c9'; g.font = '600 30px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 1);
  });
  return t;
}
