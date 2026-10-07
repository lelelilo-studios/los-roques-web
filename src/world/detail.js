// Fine detail for the sand and the foam, baked once on the GPU into small tiling textures (as the cloud noise
// is). Noise this fine computed per pixel would shimmer and cost a lot; a mipmapped, anisotropically filtered
// texture does neither, and from afar it averages out to nothing (each layer's mean is read back, so shading
// can divide by it and the far view keeps its brightness).
//
// One array texture, 1024 x 1024 RGBA8, repeating. The tiles divide 64 m, where the detail coordinates wrap:
//   0 grain    0.5 m tile (0.5 mm texels)  rg = slope of the grain surface, b = brightness / 2 (grains, white
//              flakes of Halimeda, dark grains), a = tint (pink specks above 0.5, tan bits of shell below)
//   1 relief   2.667 m tile (2.6 mm texels)  rg = slope, b = height (LR_RELIEF_H metres over 0..1),
//              a = how open to the sky (pits are darker): dry sand that has been walked on
//   2 shore    0.5 m tile  r = the order in which foam dissolves (bubble films: walls go last), g = light on
//              the bubbles, b = holes in wet sand (air holes, the odd crab burrow), a = unevenness of the film
import * as THREE from 'three';
import { FullscreenPass } from '../core/framegraph.js';

const SIZE = 1024, LAYERS = 3;

const bakeFragment = /* glsl */`
precision highp float;
uniform int uLayer;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

float h1(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
// Value noise with 'per' cells across the tile, and a sum of octaves of it: both repeat with the tile.
float vn(vec2 uv, float per) {
  vec2 p = uv * per, i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(mod(i, per)), h1(mod(i + vec2(1.0, 0.0), per)), u.x), mix(h1(mod(i + vec2(0.0, 1.0), per)), h1(mod(i + vec2(1.0, 1.0), per)), u.x), u.y);
}
float fbm(vec2 uv, float per, int octaves) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < octaves; i++) { s += a * vn(uv + float(i) * 0.137, per); n += a; per *= 2.0; a *= 0.5; }
  return s / n;
}
// A jittered lattice of points, 'per' cells across the tile: x = distance to the nearest (in cells), y = to the
// second nearest, zw = the nearest point's cell.
vec4 worley(vec2 uv, float per) {
  vec2 p = uv * per, i = floor(p), f = p - i, id = vec2(0.0);
  float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = mod(i + vec2(x, y), per), r = vec2(x, y) + h2(c) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = c; } else if (d < d2) d2 = d;
  }
  return vec4(sqrt(d1), sqrt(d2), id);
}

// ---- 0: grains. Heights in metres over a 0.5 m tile.
float grainHeight(vec2 uv) {
  vec4 a = worley(uv, 256.0), b = worley(uv + 0.37, 128.0);          // 2 mm grains and clumps, 4 mm coarse bits
  return 0.0003 * (1.0 - smoothstep(0.0, 0.75, a.x)) * (0.4 + 0.6 * h1(a.zw + 3.0))
       + 0.0005 * (1.0 - smoothstep(0.0, 0.7, b.x)) * step(0.55, h1(b.zw + 9.0));
}
vec4 grain(vec2 uv) {
  const float e = 0.5 / ${SIZE}.0, tile = 0.5;
  vec2 slope = vec2(grainHeight(uv + vec2(e, 0.0)) - grainHeight(uv - vec2(e, 0.0)), grainHeight(uv + vec2(0.0, e)) - grainHeight(uv - vec2(0.0, e))) / (2.0 * e * tile);
  // Brightness: every grain a little different, a few dark ones, and white flakes of Halimeda (plates of a
  // calcareous alga, 1-5 mm) lying flat among them.
  vec4 g = worley(uv, 256.0);
  float bright = 0.92 + 0.16 * h1(g.zw) + 0.1 * (h1(floor(uv * ${SIZE}.0)) - 0.5), tint = 0.5;
  bright *= 1.0 - 0.5 * step(0.975, h1(g.zw + 5.0));
  tint += 0.5 * step(0.993, h1(g.zw + 7.0));                                     // pink specks (shells of forams)
  vec4 f = worley(uv + 0.11, 44.0);                                              // a flake every centimetre or so
  float pick = h1(f.zw + 1.0), radius = (0.1 + 0.3 * h1(f.zw + 2.0)) * (0.8 + 0.5 * vn(uv + 0.5, 300.0));
  // (They gather in drifts: thick here, almost none there.)
  float flake = step(0.3 + 0.6 * vn(uv + 0.9, 5.0), pick) * (1.0 - smoothstep(radius - 0.04, radius, f.x));
  bright = mix(bright, 1.42 + 0.25 * h1(f.zw + 4.0), flake);
  slope *= 1.0 - 0.8 * flake;
  // Bits of shell: fewer, larger, curved, tan or pinkish.
  vec4 s = worley(uv + 0.71, 9.0);
  vec2 centre = (s.zw + h2(s.zw)) / 9.0, q = (fract(uv + 0.71 - centre + 0.5) - 0.5) * 9.0;       // in cells, wrapped
  float rs = 0.07 + 0.09 * h1(s.zw + 6.0), ang = 6.2832 * h1(s.zw + 8.0);
  float crescent = (1.0 - smoothstep(rs - 0.012, rs, length(q))) * smoothstep(rs * 0.55, rs * 0.55 + 0.012, length(q - rs * 0.6 * vec2(cos(ang), sin(ang))));
  crescent *= step(0.72, h1(s.zw + 10.0));
  bright = mix(bright, 1.18, crescent);
  tint = mix(tint, h1(s.zw + 12.0) > 0.6 ? 0.8 : 0.15, crescent);
  return vec4(0.5 + 0.5 * slope, bright * 0.5, tint);
}

// ---- 1: dry sand that has been walked on. Heights in metres over a 2.667 m tile.
const float RELIEF_H = 0.07;
float reliefHeight(vec2 uv) {
  // Old footprints and scuffs, slumped into soft craters with a low rim: about one per 30 cm, lying all ways.
  // (Every crater near the point counts, not just the nearest: no seams between them.)
  vec2 p = uv * 9.0, i = floor(p);
  float craters = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = mod(i + vec2(x, y), 9.0), q = (i + vec2(x, y) + h2(c) - p) / 9.0 * (64.0 / 24.0);      // metres to this crater
    float ang = 6.2832 * h1(c + 2.0), ca = cos(ang), sa = sin(ang);
    vec2 l = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca) / (vec2(0.115, 0.07) * (0.75 + 0.5 * h1(c + 3.0)));
    float r = length(l), deep = (0.008 + 0.012 * h1(c + 4.0)) * step(0.3, h1(c + 5.0));
    craters += deep * (0.3 * exp(-4.0 * (r - 1.25) * (r - 1.25)) - exp(-1.3 * r * r));
  }
  // Lumps of every size down to crumbs.
  return craters + 0.02 * (fbm(uv, 6.0, 3) - 0.5) + 0.008 * (fbm(uv + 0.3, 40.0, 3) - 0.5) + 0.0012 * (vn(uv, 400.0) - 0.5);
}
vec4 relief(vec2 uv) {
  const float e = 1.0 / ${SIZE}.0, tile = 64.0 / 24.0;
  float h = reliefHeight(uv);
  vec2 slope = vec2(reliefHeight(uv + vec2(e, 0.0)) - reliefHeight(uv - vec2(e, 0.0)), reliefHeight(uv + vec2(0.0, e)) - reliefHeight(uv - vec2(0.0, e))) / (2.0 * e * tile);
  // How much sand stands above this point round about (over 2.5 and 7 cm): pits see less sky.
  float above = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = 0.7854 * float(i);
    vec2 dir = vec2(cos(a), sin(a));
    above += max(reliefHeight(uv + dir * 0.025 / tile) - h, 0.0) / 0.025 + max(reliefHeight(uv + dir * 0.07 / tile) - h, 0.0) / 0.07;
  }
  return vec4(0.5 + 0.5 * slope, clamp(h / RELIEF_H + 0.5, 0.0, 1.0), clamp(1.0 - 0.075 * above, 0.3, 1.0));
}

// ---- 2: the shore. Foam is a raft of bubbles; as it dies, holes open in the middle of the big ones and the
// walls between them are the last to go.
vec4 shore(vec2 uv) {
  vec4 big = worley(uv, 12.0), mid = worley(uv + 0.23, 40.0), small = worley(uv + 0.61, 150.0);
  float wallBig = smoothstep(0.0, 0.2, big.y - big.x), wallMid = smoothstep(0.0, 0.25, mid.y - mid.x), wallSmall = smoothstep(0.0, 0.3, small.y - small.x);
  float order = 0.6 * wallBig * (0.55 + 0.45 * h1(big.zw)) + 0.26 * wallMid * (0.5 + 0.5 * h1(mid.zw)) + 0.08 * wallSmall + 0.06 * vn(uv, 64.0);
  // Light on the bubbles: each small one a bright dome with a darker rim.
  float shade = 0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.55, small.x)) - 0.25 * (1.0 - wallSmall) + 0.15 * (vn(uv, 24.0) - 0.5);
  // Holes in wet sand: air escaping leaves pin holes 1-3 mm across, in loose groups; now and then a crab's burrow.
  vec4 pins = worley(uv + 0.43, 150.0), crab = worley(uv + 0.83, 2.0);
  float group = smoothstep(0.52, 0.75, vn(uv + 0.2, 7.0));
  float holes = step(0.55, h1(pins.zw + 1.0)) * group * (1.0 - smoothstep(0.12, 0.3 + 0.25 * h1(pins.zw + 2.0), pins.x));
  holes = max(holes, step(0.6, h1(crab.zw + 3.0)) * (1.0 - smoothstep(0.035, 0.05, crab.x)));
  return vec4(clamp(order, 0.0, 1.0), clamp(shade, 0.0, 1.0), holes, 0.25 + 0.5 * fbm(uv, 16.0, 3));
}

void main() {
  outColor = uLayer == 0 ? grain(vUv) : uLayer == 1 ? relief(vUv) : shore(vUv);
}`;

const meanFragment = /* glsl */`
precision highp float;
uniform mediump sampler2DArray tDetail;
uniform int uLayer;
layout(location = 0) out vec4 outColor;
void main() { outColor = textureLod(tDetail, vec3(0.5, 0.5, float(uLayer)), 20.0); }`;

/** GLSL for reading the detail (needs lr_common). Slopes come back in metres per metre, in world axes. */
export const detailGLSL = /* glsl */`
uniform mediump sampler2DArray tDetail;
uniform vec4 uDetailMean[${LAYERS}];
const float LR_RELIEF_H = 0.07;
// Each layer is read twice, the second time through a whole-number rotation (30 degrees, nearly the same
// scale) that still repeats in 64 m, and the two are blended by a slow noise: no repeat shows.
const mat2 LR_GRAIN_A = mat2(128.0, 0.0, 0.0, 128.0) / 64.0, LR_GRAIN_B = mat2(112.0, -64.0, 64.0, 112.0) / 64.0;
const mat2 LR_RELIEF_A = mat2(24.0, 0.0, 0.0, 24.0) / 64.0, LR_RELIEF_B = mat2(21.0, -12.0, 12.0, 21.0) / 64.0;
vec4 lrDetailTap(vec2 d, mat2 m, float layer, vec2 ddx, vec2 ddy) { return textureGrad(tDetail, vec3(m * d, layer), m * ddx, m * ddy); }
// (Slopes read through the rotated copy, turned back to world axes.)
vec2 lrUnturn(vec2 s) { return vec2(0.8682 * s.x - 0.4961 * s.y, 0.4961 * s.x + 0.8682 * s.y); }

// Foam at p (detail coordinates) where 'amount' (0..1) of the raft of bubbles is left: x = how much of the
// pixel it covers, y = the light on its bubbles (about 1). As foam dies, holes open in the big bubbles and
// the walls between them go last. From afar (pixel footprint px) only the average is left.
vec2 lrFoam(vec2 p, float amount, float px, vec2 ddx, vec2 ddy) {
  vec4 a = lrDetailTap(p, LR_GRAIN_A, 2.0, ddx, ddy), b = lrDetailTap(p, LR_GRAIN_B, 2.0, ddx, ddy);
  float turn = smoothstep(0.35, 0.65, lrNoiseTile(p * 0.375 + 3.0, 24.0)), order = mix(a.r, b.r, turn);
  float cover = smoothstep(0.0, 0.1, amount * 1.05 - order);
  return vec2(mix(cover, amount * amount, smoothstep(0.02, 0.14, px)), 0.55 + 0.6 * mix(a.g, b.g, turn));
}
`;

export class Detail {
  constructor(renderer) {
    this.target = new THREE.WebGLArrayRenderTarget(SIZE, SIZE, LAYERS, { depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace });
    Object.assign(this.target.texture, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, anisotropy: Math.min(16, renderer.capabilities.getMaxAnisotropy()) });
    this.texture = this.target.texture;
    /** Mean of each layer's four channels (what the texture comes to from afar). */
    this.means = Array.from({ length: LAYERS }, () => new THREE.Vector4(0.5, 0.5, 0.5, 0.5));
    const previous = renderer.getRenderTarget();
    const bake = new FullscreenPass(bakeFragment, { uLayer: { value: 0 } });
    for (let layer = 0; layer < LAYERS; layer++) { bake.material.uniforms.uLayer.value = layer; bake.render(renderer, this.target, layer); }
    // The means: the last mip of each layer, drawn into one pixel and read back.
    const pixel = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, colorSpace: THREE.NoColorSpace });
    const mean = new FullscreenPass(meanFragment, { tDetail: { value: this.texture }, uLayer: { value: 0 } }), px = new Uint8Array(4);
    for (let layer = 0; layer < LAYERS; layer++) {
      mean.material.uniforms.uLayer.value = layer;
      mean.render(renderer, pixel);
      renderer.readRenderTargetPixels(pixel, 0, 0, 1, 1, px);
      this.means[layer].set(px[0] / 255, px[1] / 255, px[2] / 255, px[3] / 255);
    }
    renderer.setRenderTarget(previous);
    pixel.dispose(); bake.material.dispose(); mean.material.dispose();
  }
}
