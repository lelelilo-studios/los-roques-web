// Clouds: bakes the 3D noise textures (a few slices per frame after start-up), draws the cloud layer at half
// resolution for the view, and keeps a map of the layer's shadow on the sea and the land.
import * as THREE from 'three';
import { FullscreenPass } from '../core/framegraph.js';
import { CHUNK_UNIFORMS, shared, uniformsFor } from '../core/uniforms.js';

// Tileable 3D noise: periods divide the texture size, so the textures repeat seamlessly.
const noiseGLSL = /* glsl */`
uniform float uSlice;      // 0..1 depth of the slice being drawn
uniform float uSize;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
vec3 hash3(ivec3 p) {
  uvec3 q = uvec3(p);
  q = q * uvec3(1664525u, 1013904223u, 2654435761u) + q.yzx * 747796405u;
  q = (q ^ (q >> 16u)) * 2246822519u;
  q = q ^ (q >> 13u);
  return vec3(q & uvec3(0xffffffu)) / 16777216.0;
}
ivec3 wrap3(ivec3 c, int period) { return ((c % period) + period) % period; }
// Worley (cellular) noise, 1 - distance to the nearest feature point, 'period' cells across.
float worley(vec3 uvw, int period) {
  vec3 p = uvw * float(period), f = fract(p);
  ivec3 cell = ivec3(floor(p));
  float d = 1e9;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec3 o = ivec3(x, y, z);
    vec3 fp = vec3(o) + hash3(wrap3(cell + o, period)) - f;
    d = min(d, dot(fp, fp));
  }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}
float worleyFbm(vec3 uvw, int period) { return worley(uvw, period) * 0.625 + worley(uvw, period * 2) * 0.25 + worley(uvw, period * 4) * 0.125; }
float perlin(vec3 uvw, int period) {
  vec3 p = uvw * float(period), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 c = ivec3(floor(p));
  float n[8];
  for (int k = 0; k < 8; k++) {
    ivec3 o = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    n[k] = dot(normalize(hash3(wrap3(c + o, period) + ivec3(17, 59, 83)) * 2.0 - 1.0), f - vec3(o));
  }
  return mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y), mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z) * 1.4;
}
float perlinFbm(vec3 uvw, int period) {
  float s = 0.0, a = 0.5;
  for (int o = 0; o < 5; o++) { s += perlin(uvw, period) * a; a *= 0.5; period *= 2; }
  return s * 0.5 + 0.5;
}`;
const shapeFragment = /* glsl */`${noiseGLSL}
void main() {
  vec3 uvw = vec3(vUv, uSlice);
  float w = worleyFbm(uvw, 4), p = perlinFbm(uvw, 4);
  // Perlin-Worley: billowy Worley blobs modulated by Perlin detail.
  float pw = clamp((p - (w - 1.0)) / (2.0 - w), 0.0, 1.0);
  outColor = vec4(pw, worleyFbm(uvw, 8), worleyFbm(uvw, 16), worleyFbm(uvw, 32));
}`;
const detailFragment = /* glsl */`${noiseGLSL}
void main() {
  vec3 uvw = vec3(vUv, uSlice);
  outColor = vec4(worleyFbm(uvw, 2), worleyFbm(uvw, 4), worleyFbm(uvw, 8), 1.0);
}`;

// How much sunlight reaches each point of the sea through the layer (12 steps along the sun's ray).
const shadowFragment = /* glsl */`
#include <lr_common>
#include <lr_atmosphere>
#include <lr_clouds>
uniform vec4 uRegion;      // xy = world xz of the corner, z = size (m)
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  float t = 1.0;
  if (uSunDir.y > 0.03) {
    vec2 xz = uRegion.xy + vUv * uRegion.z - uCamXZ;
    float t0 = uCloudLayer.x / uSunDir.y, dt = (uCloudLayer.y - uCloudLayer.x) / uSunDir.y / 12.0, tau = 0.0;
    for (int i = 0; i < 12; i++) tau += lrCloudDensity(vec3(xz.x, 0.0, xz.y) + uSunDir * (t0 + (float(i) + 0.5) * dt), false, 100.0) * dt;
    // Forward scattering lets some light through even thick cloud.
    t = max(exp(-tau * uCloudLayer.w), 0.2 * exp(-tau * uCloudLayer.w * 0.1));
  }
  outColor = vec4(t, 0.0, 0.0, 1.0);
}`;

const marchFragment = /* glsl */`
#include <lr_common>
#include <lr_atmosphere>
#include <lr_clouds>
uniform sampler2D tDepth;
uniform vec3 uCamRight, uCamUp, uCamFwd;
uniform vec2 uSteps;       // view steps, light steps
uniform float uPixel;      // angle covered by one pixel of this image, radians
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 ray = uCamFwd + (vUv.x * 2.0 - 1.0) * uCamRight + (vUv.y * 2.0 - 1.0) * uCamUp;
  vec3 dir = normalize(ray);
  // Stop at whatever solid thing this pixel shows.
  float depth = texture(tDepth, vUv).r, maxDist = lrIsSky(depth) ? 1e9 : lrViewZ(depth) * length(ray);
  // Interleaved gradient noise: each pixel starts its march at a different offset, which hides the steps.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float dist;
  vec4 c = lrCloudMarch(vec3(0.0, uCamY, 0.0), dir, jitter, int(uSteps.x), int(uSteps.y), maxDist, uPixel, dist);
  if (c.a < 0.999) {
    // The haze between the eye and the cloud.
    vec3 lum, trans;
    lrScatter(lrAtmoPos(uCamY), dir, uSunDir, dist * 1e-3, 4, lum, trans);
    c.rgb = c.rgb * trans + uSunToa * lum * (1.0 - c.a);
  }
  outColor = vec4(min(c.rgb, vec3(6000.0)), c.a);
}`;

export class Clouds {
  /** @param {object|null} quality  { shape: 3D noise size, steps, lightSteps, scale: share of the render size } or null for no clouds */
  constructor(renderer, quality, rect) {
    this.renderer = renderer; this.quality = quality;
    this.enabled = !!quality;
    this.wind = new THREE.Vector2();
    this.cover = 0.22;
    shared.uCloudLayer.value.set(650, 1750, 0, 0.04);
    shared.uCloudWind.value.set(0, 0, 6500, 650);
    if (!quality) return;
    const tex3 = size => {
      const t = new THREE.WebGL3DRenderTarget(size, size, size, { depthBuffer: false, stencilBuffer: false });
      Object.assign(t.texture, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
        wrapR: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, colorSpace: THREE.NoColorSpace });
      return t;
    };
    this.shape = tex3(quality.shape); this.detail = tex3(32);
    this.bake = [
      { target: this.shape, size: quality.shape, slice: 0, pass: new FullscreenPass(shapeFragment, { uSlice: { value: 0 }, uSize: { value: quality.shape } }) },
      { target: this.detail, size: 32, slice: 0, pass: new FullscreenPass(detailFragment, { uSlice: { value: 0 }, uSize: { value: 32 } }) },
    ];
    this.ready = false;
    shared.tCloudShape.value = this.shape.texture; shared.tCloudDetail.value = this.detail.texture;

    // The shadow map covers a fixed square around the archipelago.
    const size = 76800, cx = rect.x + rect.w / 2, cz = rect.z + rect.h / 2;
    this.region = new THREE.Vector4(cx - size / 2, cz - size / 2, size, 0);
    this.shadow = new THREE.WebGLRenderTarget(768, 768, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    const names = [...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.atmosphere, ...CHUNK_UNIFORMS.clouds];
    this.shadowPass = new FullscreenPass(shadowFragment, uniformsFor(names, { uRegion: { value: this.region } }));
    this.march = new FullscreenPass(marchFragment, uniformsFor([...names, 'uCamRight', 'uCamUp', 'uCamFwd'],
      { tDepth: { value: null }, uSteps: { value: new THREE.Vector2(quality.steps, quality.lightSteps) }, uPixel: { value: 0.002 } }));
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    shared.tCloudShadow.value = this.shadow.texture;
    shared.uCloudShadow.value.set(this.region.x, this.region.y, 1 / size, 0);
    this.frame = 0;
  }

  /** Draws some slices of the noise textures; `budget` slices per call. Returns true when everything is baked. */
  bakeSome(budget = 6) {
    if (this.ready || !this.enabled) return this.ready;
    for (const b of this.bake) {
      while (b.slice < b.size && budget-- > 0) {
        b.pass.material.uniforms.uSlice.value = (b.slice + 0.5) / b.size;
        b.pass.render(this.renderer, b.target, b.slice++);
      }
    }
    this.ready = this.bake.every(b => b.slice >= b.size);
    return this.ready;
  }

  /**
   * Per frame, before the scene is drawn: drift with the wind and refresh the shadow map.
   * @param {number} dt seconds  @param {{speed: number, from: number}} wind  @param {number} cover 0..1
   */
  update(dt, wind, cover) {
    this.cover = cover;
    const on = this.enabled && this.ready && cover > 0.01;
    // The noise pattern only passes its threshold over part of the sky: this maps a sky fraction to that threshold.
    shared.uCloudLayer.value.z = on ? 0.3 + 0.55 * cover : 0;
    shared.uCloudShadow.value.w = on ? 1 : 0;
    if (!this.enabled) return;
    // Clouds ride the wind at cloud level (a little faster than at the surface), blowing towards from + 180.
    const az = (wind.from + 180) * Math.PI / 180, speed = wind.speed * 1.3;
    this.wind.x = (this.wind.x + Math.sin(az) * speed * dt) % 3.6e6;
    this.wind.y = (this.wind.y - Math.cos(az) * speed * dt) % 3.6e6;
    shared.uCloudWind.value.x = this.wind.x; shared.uCloudWind.value.y = this.wind.y;
    if (on && (this.frame++ % this.quality.shadowEvery === 0 || dt === 0)) this.shadowPass.render(this.renderer, this.shadow);
  }

  /** Draws the cloud layer for the current view into `this.target` (after the scene's depth is final). */
  render(depthTexture, width, height) {
    if (!(this.enabled && this.ready && this.cover > 0.01)) return false;
    const w = Math.max(1, Math.round(width * this.quality.scale)), h = Math.max(1, Math.round(height * this.quality.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    this.march.material.uniforms.tDepth.value = depthTexture;
    this.march.material.uniforms.uPixel.value = 2 * shared.uCamUp.value.length() / h;      // uCamUp is scaled by tan(fov / 2)
    this.march.render(this.renderer, this.target);
    return true;
  }
}
