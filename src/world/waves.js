// The sea state: four tiling "cascades" of wave detail, each the sum of 16 trochoidal waves, redrawn every frame
// into small array textures (displacement, slopes, curvature). The water mesh, its shading, the caustics on the
// seabed and the boats all read the same waves.
//
//   cascade 0   499 m tile   20-120 m waves   ocean swell and wind sea outside the reef
//   cascade 1    97 m tile    4-20 m          lagoon chop
//   cascade 2    19 m tile    0.6-4 m         small chop: this is what draws the caustics
//   cascade 3   3.7 m tile    6-60 cm         ripples (shading only)
//
// Each cascade's pattern has unit height variance. How tall it really is at a place comes from the wave map
// (how much ocean swell gets there, and the upwind fetch) through a small lookup texture built from the wind:
// a saturation spectrum B k^-3 above the local peak, the peak set by fetch (JONSWAP) or by full development
// (Pierson-Moskowitz). So the lee of a cay is glassy and the open sea outside rolls, with no hand painting.
import * as THREE from 'three';
import { FullscreenPass } from '../core/framegraph.js';
import { shared } from '../core/uniforms.js';

const G = 9.81, TAU = 2 * Math.PI;
const B_SAT = 0.0046;                    // slope variance per e-fold of wavenumber in the saturation range
export const CASCADES = [
  { tile: 499, lambda: [20, 120], spread: 0.45 },
  { tile: 97, lambda: [4, 20], spread: 0.75 },
  { tile: 19, lambda: [0.6, 4], spread: 1.0 },
  { tile: 3.7, lambda: [0.06, 0.6], spread: 1.3 },
];
export const WAVES_PER_CASCADE = 32, CASCADE_SIZE = 256;
const LUT_W = 64, LUT_H = 16;

function mulberry(seed) {
  return () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Peak wavenumber of a fully developed sea (Pierson-Moskowitz) and of a fetch-limited one (JONSWAP). */
export const peakOcean = U => 0.769 * G / (U * U);
export function peakFetch(U, fetch) {
  const fp = 3.5 * (G / U) * (G * fetch / (U * U)) ** -0.33;      // Hz
  return Math.max(peakOcean(U), (TAU * fp) ** 2 / G);
}
/** Height variance (m^2) of the wind sea between wavenumbers k1 < k2 when the spectral peak is at kp. */
export function bandVariance(k1, k2, kp, B = B_SAT) {
  const a = 1.25 * kp * kp;
  return B / (2 * a) * (Math.exp(-a / (k2 * k2)) - Math.exp(-a / (k1 * k1)));
}
/** Short waves need wind: almost none below 2 m/s, growing with it (after Cox & Munk's slope statistics). */
const shortWaveB = U => B_SAT * Math.min(1.6, Math.max(0, (U - 1) / 6));

function buildComponents(c, index, wind) {
  const rng = mulberry(1234 + index * 977), dk = TAU / c.tile, kMin = TAU / c.lambda[1], kMax = TAU / c.lambda[0];
  // Wind blows FROM `wind.from` (degrees clockwise from north); waves travel the other way. x east, z south.
  const az = (wind.from + 180) * Math.PI / 180, dir = Math.atan2(-Math.cos(az), Math.sin(az)), kp = peakOcean(Math.max(wind.speed, 1));
  const used = new Set(), list = [];
  for (let n = 0; n < WAVES_PER_CASCADE; n++) {
    for (let tries = 0; tries < 60; tries++) {
      const k = kMin * (kMax / kMin) ** ((n + rng()) / WAVES_PER_CASCADE);
      const ang = dir + c.spread * (rng() + rng() + rng() - 1.5) * 0.9;
      const i = Math.round(k * Math.cos(ang) / dk), j = Math.round(k * Math.sin(ang) / dk), kk = Math.hypot(i, j) * dk, key = `${i},${j}`;
      if ((i === 0 && j === 0) || used.has(key) || kk < kMin * 0.85 || kk > kMax * 1.2) continue;
      used.add(key);
      // Amplitude ~ 1/k (equal slope per octave), cut off below the ocean's spectral peak for the swell cascades.
      const a = Math.exp(-0.625 * (kp / kk) ** 2 * (index < 2 ? 1 : 0)) / kk;
      // Deep-water dispersion with surface tension, so the ripples move like ripples.
      list.push({ kx: i * dk, kz: j * dk, k: kk, a, omega: Math.sqrt(G * kk + 7.4e-5 * kk ** 3), phase: rng() * TAU });
      break;
    }
  }
  const norm = Math.sqrt(list.reduce((s, w) => s + w.a * w.a / 2, 0)) || 1;
  for (const w of list) w.a /= norm;
  return list;
}

const cascadeFragment = mode => /* glsl */`
#define MODE ${mode}
uniform vec4 uWave[${WAVES_PER_CASCADE}];     // kx, kz, amplitude, phase now (advanced on the CPU in doubles)
uniform float uTile;
uniform float uChop;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 x = vUv * uTile;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${WAVES_PER_CASCADE}; i++) {
    vec4 w = uWave[i];
    float th = dot(w.xy, x) + w.w, c = cos(th), s = sin(th), k = max(length(w.xy), 1e-6);
#if MODE == 0
    // Displacement (trochoid: crests sharpen as points drift towards them) and its horizontal divergence.
    acc += vec4(-w.x / k * s * uChop, c, -w.y / k * s * uChop, -uChop * k * c) * w.z;
#elif MODE == 1
    acc.xy += -w.xy * w.z * s;                                  // slopes dh/dx, dh/dz
#else
    acc += vec4(-w.x * w.x, -w.y * w.y, -w.x * w.y, 0.0) * w.z * c;   // curvature: hxx, hzz, hxz
#endif
  }
#if MODE == 1
  acc.zw = acc.xy * acc.xy;                                     // squared slopes: their mips give the sub-pixel roughness
#endif
  outColor = acc;
}`;

export class Waves {
  constructor(renderer) {
    this.renderer = renderer;
    this.wind = { speed: 7, from: 75 };
    const target = aniso => {
      const t = new THREE.WebGLArrayRenderTarget(CASCADE_SIZE, CASCADE_SIZE, CASCADES.length, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace,
      });
      Object.assign(t.texture, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, anisotropy: aniso });
      return t;
    };
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.targets = [target(1), target(Math.min(8, maxAniso)), target(1)];     // displacement, slopes, curvature
    this.passes = [0, 1, 2].map(mode => new FullscreenPass(cascadeFragment(mode), {
      uWave: { value: Array.from({ length: WAVES_PER_CASCADE }, () => new THREE.Vector4()) }, uTile: { value: 1 }, uChop: { value: 0.75 },
    }));
    this.lutData = new Uint16Array(LUT_W * LUT_H * 4);
    this.lut = new THREE.DataTexture(this.lutData, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
    Object.assign(this.lut, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    shared.tWaveA.value = this.targets[0].texture;
    shared.tWaveB.value = this.targets[1].texture;
    shared.tWaveC.value = this.targets[2].texture;
    shared.tWaveLUT.value = this.lut;
    shared.uWaveTile.value.set(...CASCADES.map(c => c.tile));
    this.setWind(this.wind.speed, this.wind.from);
  }

  /** Wind speed in m/s at 10 m and the direction it blows from (degrees clockwise from north). */
  setWind(speed, from) {
    this.wind = { speed, from };
    this.components = CASCADES.map((c, i) => buildComponents(c, i, this.wind));
    shared.uWaveCurve.value.set(...this.components.map(list => Math.sqrt(list.reduce((s, w) => s + w.a * w.a / 2 * w.k ** 4, 0))));
    // Lookup: u = upwind fetch (log, 10 m .. 20 km as in the wave map), v = share of ocean swell arriving.
    // Each texel holds the standard deviation in metres of the four cascades.
    const U = Math.max(speed, 0.5), kOcean = peakOcean(U), weights = this.weights = new Float32Array(LUT_W * LUT_H * 4);
    for (let v = 0; v < LUT_H; v++) {
      for (let u = 0; u < LUT_W; u++) {
        const fetch = 10 * 2000 ** (u / (LUT_W - 1)), swell = v / (LUT_H - 1), kp = peakFetch(U, fetch);
        CASCADES.forEach((c, i) => {
          const k1 = TAU / c.lambda[1], k2 = TAU / c.lambda[0], B = i < 2 ? B_SAT : shortWaveB(U);
          const m0 = swell * swell * bandVariance(k1, k2, kOcean, B) + bandVariance(k1, k2, kp, B);
          const o = (v * LUT_W + u) * 4 + i;
          weights[o] = Math.sqrt(Math.max(m0, 0));
          this.lutData[o] = THREE.DataUtils.toHalfFloat(weights[o]);
        });
      }
    }
    this.lut.needsUpdate = true;
    shared.uWind.value.set(Math.sin((from + 180) * Math.PI / 180), -Math.cos((from + 180) * Math.PI / 180), speed);
  }

  /** Standard deviation (m) of each cascade for a wave-map sample: `fetchLog` and `swell` in 0..1 as stored there. */
  weightsAt(fetchLog, swell, out = [0, 0, 0, 0]) {
    // Between the entries of the table, as the shader's (linear) lookup does: the nearest entry alone is up to
    // a third out in a sheltered lagoon, and what floats on these numbers would ride a different sea.
    const u = Math.min(1, Math.max(0, fetchLog)) * (LUT_W - 1), v = Math.min(1, Math.max(0, swell)) * (LUT_H - 1);
    const u0 = Math.min(LUT_W - 2, Math.floor(u)), v0 = Math.min(LUT_H - 2, Math.floor(v)), fu = u - u0, fv = v - v0, w = this.weights;
    for (let i = 0; i < 4; i++) {
      const a = (v0 * LUT_W + u0) * 4 + i, b = a + LUT_W * 4;
      out[i] = (w[a] * (1 - fu) + w[a + 4] * fu) * (1 - fv) + (w[b] * (1 - fu) + w[b + 4] * fu) * fv;
    }
    return out;
  }

  /** Draws the cascades for time `t` (seconds) and sets the per-frame wave uniforms. */
  update(t, cam) {
    const { renderer } = this, mod = shared.uWaveCamMod.value;
    CASCADES.forEach((c, i) => {
      const list = this.components[i];
      for (const pass of this.passes) {
        const u = pass.material.uniforms;
        u.uTile.value = c.tile;
        list.forEach((w, n) => u.uWave.value[n].set(w.kx, w.kz, w.a, (w.phase - w.omega * t) % TAU));
        for (let n = list.length; n < WAVES_PER_CASCADE; n++) u.uWave.value[n].set(0, 0, 0, 0);
      }
      this.passes.forEach((pass, m) => {
        if (m === 0 && i === 3) return;                     // ripples do not move the mesh
        if (m === 2 && i === 0) return;                     // the swell is too long to focus light on the bed
        pass.render(renderer, this.targets[m], i);
      });
      // Camera position wrapped to each tile (in doubles), so tile coordinates stay exact far from the origin.
      mod[i].set(((cam.x % c.tile) + c.tile) % c.tile, ((cam.z % c.tile) + c.tile) % c.tile);
    });
  }

  /**
   * Sea surface height (m, relative to sea level) at world x/z from the first `cascades` cascades: two for what
   * boats float on, three for the chop around a swimmer's head.
   */
  heightAt(x, z, t, weights, cascades = 2) {
    let h = 0;
    for (let i = 0; i < cascades; i++) {
      let s = 0;
      for (const w of this.components[i]) s += w.a * Math.cos(w.kx * x + w.kz * z + w.phase - w.omega * t);
      h += s * weights[i];
    }
    return h;
  }
}

/** GLSL: where a point is on each cascade's tile, and the local wave heights. Needs the uniforms listed in WAVE_UNIFORMS. */
export const wavesGLSL = /* glsl */`
uniform highp sampler2DArray tWaveA;   // per cascade: displacement xyz, divergence
uniform highp sampler2DArray tWaveB;   // slope x, slope z and their squares
uniform highp sampler2DArray tWaveC;   // curvature hxx, hzz, hxz
uniform sampler2D tWaveLUT;
uniform sampler2D tWaveMap;
uniform vec4 uWaveTile;                // tile size of each cascade, metres
uniform vec2 uWaveCamMod[4];           // camera xz wrapped to each tile
uniform vec3 uWind;                    // xy = direction the wind blows towards (east, south), z = speed m/s
uniform vec4 uWaveCurve;               // rms curvature (1/m) of each cascade's pattern at unit height

// Tile coordinates of cascade i for a point 'rel' metres from the camera.
vec2 lrWaveUV(vec2 rel, int i) { return (rel + uWaveCamMod[i]) / uWaveTile[i]; }

// The wave map at a world position: r = share of ocean swell arriving, g = upwind fetch (log), b = distance to
// the nearest breaker line (sqrt-encoded, 0..250 m), a = breaker strength. Beyond the map: open sea.
vec4 lrWaveMap(vec2 wxz) {
  vec2 uv = lrMapUV(wxz), e = abs(uv - 0.5) * 2.0;
  // (Blended in over the outer tenth of the map, so the sea state has no edge where the data ends.)
  return mix(vec4(1.0, 1.0, 1.0, 0.0), textureLod(tWaveMap, uv, 0.0), 1.0 - smoothstep(0.8, 0.99, max(e.x, e.y)));
}
// Standard deviation in metres of each cascade for a wave-map sample (deep water).
vec4 lrWaveWeightsRaw(vec4 wm) {
  return textureLod(tWaveLUT, vec2(wm.g, wm.r) * vec2(63.0 / 64.0, 15.0 / 16.0) + vec2(0.5 / 64.0, 0.5 / 16.0), 0.0);
}
// A wave cannot stand much taller than the water is deep (crest ~ 2 sigma, breaking at ~0.4 of the depth).
// The ripples are small enough to live in a hand's breadth of water: they are capped on their own.
vec4 lrWaveCap(vec4 w, float depth) {
  float room = 0.2 * max(depth, 0.0);
  return vec4(w.xyz * min(1.0, room / max(length(w.xyz), 1e-4)), w.w * min(1.0, room / max(w.w, 1e-5)));
}
vec4 lrWaveWeights(vec2 wxz, float depth) { return lrWaveCap(lrWaveWeightsRaw(lrWaveMap(wxz)), depth); }
// Significant wave height of the sea arriving at a place (before the shallows take it down).
float lrWaveHs(vec4 raw) { return 4.0 * length(raw.xyz); }

// Ripples come in gusts: patches of ruffled water drifting downwind with glassy streaks between them.
float lrGust(vec2 wxz) { return 0.5 + lrNoise(wxz / 7.0 - uWind.xy * uTime * 0.4) * 0.6 + lrNoise(wxz / 2.3 - uWind.xy * uTime * 0.55) * 0.4; }

// Ripples finer than the last cascade: its pattern is read twice more through whole-number similarity
// transforms (2.24 and 5 times smaller, turned 27 and 53 degrees), which still tile and keep the slopes.
const mat2 LR_FINE_1 = mat2(2.0, -1.0, 1.0, 2.0), LR_FINE_2 = mat2(3.0, -4.0, 4.0, 3.0);
const vec2 LR_FINE_GAIN = vec2(0.8, 0.6);                    // their slope against the cascade's own
vec2 lrFineTurn1(vec2 s) { return vec2(2.0 * s.x - s.y, s.x + 2.0 * s.y) * 0.4472; }      // slopes read through them, turned back
vec2 lrFineTurn2(vec2 s) { return vec2(3.0 * s.x - 4.0 * s.y, 4.0 * s.x + 3.0 * s.y) * 0.2; }
`;
export const WAVE_UNIFORMS = ['tWaveA', 'tWaveB', 'tWaveC', 'tWaveLUT', 'tWaveMap', 'uWaveTile', 'uWaveCamMod', 'uWind', 'uWaveCurve'];
