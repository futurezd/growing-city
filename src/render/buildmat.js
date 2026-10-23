// Building material: MeshStandardMaterial patched with per-building state (growth, lit) read from a
// data texture, procedural recessed windows / curtain walls / ribbon windows, shopfronts and night glow.
import * as THREE from 'three';

export const STATE_W = 512;

const VERT_HEAD = /* glsl */`
attribute vec4 aB; attribute vec3 emis; uniform sampler2D uState;
varying vec4 vB; varying vec3 vEmis; varying vec4 vState; varying vec3 vWN; varying float vH;`;
const VERT_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
vState = texture2D(uState, vec2((aB.x + 0.5) / ${STATE_W}.0, 0.5));
// Growth: the building rises from the ground; not-yet-started buildings sink below the ground plane.
transformed.y = vState.r <= 0.001 ? -3.0 : position.y * vState.r;
vB = aB; vEmis = emis; vWN = normal; vH = position.y;`;

const FRAG_HEAD = /* glsl */`
uniform float uNight; uniform float uTime; uniform float uSnow;
varying vec4 vB; varying vec3 vEmis; varying vec4 vState; varying vec3 vWN; varying float vH;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

const FRAG_WINDOWS = /* glsl */`
float glass = 0.0; vec3 winLight = vec3(0.0);
bool built = vState.r >= 0.999;
float mode = mod(vB.y, 10.0);
bool wall = abs(vWN.y) < 0.5;
if (!built) {
  // Construction: bare concrete with floor slab lines.
  float slab = step(0.85, fract(vH / 3.0));
  diffuseColor.rgb = mix(vec3(0.6, 0.58, 0.54), vec3(0.42, 0.41, 0.4), slab);
} else if (!wall && vWN.y > 0.5) {
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), uSnow);   // snow on roofs
} else if (wall && mode > 0.5) {
  vec2 cell = vec2(vUv.x / vB.w, vUv.y / vB.z);
  vec2 f = fract(cell), id = floor(cell);
  float inner = 0.0, frame = 0.0;
  if (mode < 1.5) {           // punched, recessed windows (凹窗): dark reveal around the pane
    float outer = step(0.2, f.x) * step(f.x, 0.8) * step(0.26, f.y) * step(f.y, 0.84);
    inner = step(0.26, f.x) * step(f.x, 0.74) * step(0.32, f.y) * step(f.y, 0.78);
    frame = outer - inner;
  } else if (mode < 2.5) {    // curtain wall with mullions and spandrels
    inner = step(0.07, f.x) * step(0.14, f.y) * step(f.y, 0.94);
  } else {                    // office ribbon windows
    inner = step(0.04, f.x) * step(f.x, 0.96) * step(0.36, f.y) * step(f.y, 0.9);
  }
  bool shop = vB.y >= 10.0 && vH < 4.0;
  if (vH < 1.2 && !shop) inner = 0.0;
  if (shop) inner = step(0.06, fract(vUv.x / 4.0)) * step(0.4, vH);
  diffuseColor.rgb *= 1.0 - frame * 0.5;
  glass = inner;
  vec3 sky = mix(vec3(0.16, 0.22, 0.3), vec3(0.42, 0.52, 0.6), clamp(f.y + 0.2, 0.0, 1.0));
  vec3 g = mode > 1.5 ? mix(diffuseColor.rgb * 0.6, sky, 0.55) : sky * 0.55;
  diffuseColor.rgb = mix(diffuseColor.rgb, g * mix(1.0, 0.35, uNight), inner);
  float r = h21(id + vB.x * 7.31);
  float on = vState.g * step(r, 0.3 + 0.55 * vState.b);
  vec3 warm = mix(vec3(1.0, 0.72, 0.4), vec3(0.85, 0.9, 1.0), step(0.8, h21(id + 3.7)));
  winLight = inner * on * warm * (0.9 + 0.4 * h21(id + 1.3)) * uNight;
  if (shop) winLight = inner * vec3(1.0, 0.82, 0.55) * 1.3 * max(uNight, 0.15);
}`;

const FRAG_EMIS = /* glsl */`
#include <emissivemap_fragment>
if (built) {
  // Floodlighting / LED skins; stronger near the base for the Bund, animated shimmer for neon.
  float flood = vEmis.r > 1.0 ? 0.75 + 0.25 * sin(uTime * 3.0 + vB.x) : 0.55 + 0.45 * exp(-vH / 30.0);
  totalEmissiveRadiance += vEmis * flood * uNight + winLight * 1.6;
  roughnessFactor = mix(roughnessFactor, 0.18, glass);
  metalnessFactor = mix(metalnessFactor, 0.55, glass);
}`;

function patchVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>' + VERT_HEAD)
    .replace('#include <begin_vertex>', VERT_BEGIN);
}

export function makeBuildingMaterials(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });
  mat.defines = { USE_UV: '' };
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>' + FRAG_WINDOWS)
      .replace('#include <emissivemap_fragment>', FRAG_EMIS);
  };
  mat.customProgramCacheKey = () => 'gc-building';
  // Shadow depth pass must follow the same growth transform.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    patchVertex(shader);
  };
  depth.customProgramCacheKey = () => 'gc-building-depth';
  return { mat, depth };
}
