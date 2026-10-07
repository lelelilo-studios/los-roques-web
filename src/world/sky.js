// Builds the atmosphere LUTs and keeps the sun/sky lighting uniforms current.
import * as THREE from 'three';
import { FullscreenPass } from '../core/framegraph.js';
import { CHUNK_UNIFORMS, shared, uniformsFor } from '../core/uniforms.js';

const transmittanceFragment = /* glsl */`
#include <lr_common>
#include <lr_atmosphere>
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 rm = lrTransmittanceParams(vUv);
  vec3 p = vec3(0.0, rm.x, 0.0), dir = vec3(sqrt(max(0.0, 1.0 - rm.y * rm.y)), rm.y, 0.0), optical = vec3(0.0);
  float dt = lrDistToTop(rm.x, rm.y) / 48.0;
  for (int i = 0; i < 48; i++) {
    vec3 rayleigh, extinction; float mie;
    lrMedium(p + dir * (float(i) + 0.5) * dt, rayleigh, mie, extinction);
    optical += extinction * dt;
  }
  outColor = vec4(exp(-optical), 1.0);
}`;

// Multiple scattering as a function of sun zenith cosine (u) and altitude (v): 64 directions per texel.
const multiScatterFragment = /* glsl */`
#include <lr_common>
#include <lr_atmosphere>
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / 31.0;
  float cosSun = uv.x * 2.0 - 1.0, r = ATMO_BOTTOM + max(uv.y * (ATMO_TOP - ATMO_BOTTOM), 0.01);
  vec3 p0 = vec3(0.0, r, 0.0), sunDir = normalize(vec3(0.0, cosSun, sqrt(max(0.0, 1.0 - cosSun * cosSun))));
  vec3 lSum = vec3(0.0), fSum = vec3(0.0);
  for (int k = 0; k < 64; k++) {
    float theta = 2.0 * PI * (float(k % 8) + 0.5) / 8.0, cosPhi = 1.0 - 2.0 * (float(k / 8) + 0.5) / 8.0, sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
    vec3 dir = vec3(cos(theta) * sinPhi, cosPhi, sin(theta) * sinPhi);
    float tGround = lrRaySphere(p0, dir, ATMO_BOTTOM), tMax = tGround > 0.0 ? tGround : lrRaySphere(p0, dir, ATMO_TOP), tPrev = 0.0;
    vec3 l = vec3(0.0), f = vec3(0.0), through = vec3(1.0);
    for (int s = 0; s < 20; s++) {
      float t = tMax * (float(s) + 0.3) / 20.0, dt = t - tPrev;
      tPrev = t;
      vec3 p = p0 + dir * t, rayleigh, extinction; float mie;
      lrMedium(p, rayleigh, mie, extinction);
      vec3 stepT = exp(-extinction * dt), ext = max(extinction, vec3(1e-7)), scattering = rayleigh + mie;
      vec3 sLum = lrTransmittanceToSun(p, sunDir) * scattering / (4.0 * PI);
      l += through * (sLum - sLum * stepT) / ext;
      f += through * (scattering - scattering * stepT) / ext;
      through *= stepT;
    }
    if (tGround > 0.0) {
      vec3 p = p0 + dir * tGround;
      float rr = length(p);
      l += through * textureLod(tTransmittance, lrTransmittanceUV(rr, dot(p / rr, sunDir)), 0.0).rgb * lrSaturate(dot(p / rr, sunDir)) * GROUND_ALBEDO / PI;
    }
    lSum += l; fSum += f;
  }
  // Uniform sphere sampling, then an isotropic phase function: both averages are over the 64 directions.
  vec3 l2 = lSum / 64.0, fms = fSum / 64.0;
  outColor = vec4(l2 / max(1.0 - fms, vec3(1e-4)), 1.0);
}`;

const skyViewFragment = /* glsl */`
#include <lr_common>
#include <lr_atmosphere>
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 lum, trans;
  lrScatter(lrAtmoPos(uCamY), lrSkyViewDir(vUv, uSunDir), uSunDir, 1e9, 32, lum, trans);
  outColor = vec4(lum, 1.0);
}`;

// Sky irradiance on a horizontal surface at sea level, per unit of sun irradiance (one texel).
const irradianceFragment = /* glsl */`
#include <lr_common>
#include <lr_atmosphere>
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 e = vec3(0.0);
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 16; i++) {
      // Cosine-weighted hemisphere: E = pi * mean radiance over these directions.
      float u = (float(j) + 0.5) / 8.0, phi = 2.0 * PI * (float(i) + 0.5) / 16.0, ct = sqrt(1.0 - u), st = sqrt(u);
      vec3 lum, trans;
      lrScatter(lrAtmoPos(0.0), vec3(st * cos(phi), ct, st * sin(phi)), uSunDir, 1e9, 16, lum, trans);
      e += lum;
    }
  }
  outColor = vec4(e * PI / 128.0, 1.0);
}`;

const lutTarget = (w, h, type = THREE.HalfFloatType, wrapS = THREE.ClampToEdgeWrapping) => new THREE.WebGLRenderTarget(w, h, {
  type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS, wrapT: THREE.ClampToEdgeWrapping, colorSpace: THREE.NoColorSpace,
});

// Optical depth from sea level to space towards a direction with zenith cosine mu (the same medium as the shader).
function sunTransmittance(mu, mieScale) {
  const R0 = 6360.0005, TOP = 6460;
  if (mu < -0.02) return [0, 0, 0];
  const tMax = -R0 * mu + Math.sqrt(Math.max(R0 * R0 * (mu * mu - 1) + TOP * TOP, 0)), n = 96, dt = tMax / n, tau = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt, h = Math.max(Math.sqrt(R0 * R0 + t * t + 2 * R0 * t * mu) - 6360, 0);
    const dR = Math.exp(-h / 8), dM = Math.exp(-h / 1.2) * mieScale, dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
    tau[0] += (5.802e-3 * dR + 4.44e-3 * dM + 0.650e-3 * dO) * dt;
    tau[1] += (13.558e-3 * dR + 4.44e-3 * dM + 1.881e-3 * dO) * dt;
    tau[2] += (33.1e-3 * dR + 4.44e-3 * dM + 0.085e-3 * dO) * dt;
  }
  // Fade out as the disc sinks through the horizon.
  const rise = Math.min(1, Math.max(0, (mu + 0.02) / 0.03));
  return tau.map(v => Math.exp(-v) * rise);
}

export class Sky {
  constructor(renderer, { syncReadback = false } = {}) {
    this.renderer = renderer;
    this.syncReadback = syncReadback;
    const names = [...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.atmosphere];
    this.transmittance = lutTarget(256, 64);
    this.multiScatter = lutTarget(32, 32);
    this.skyView = lutTarget(192, 108, THREE.HalfFloatType, THREE.RepeatWrapping);
    this.canReadFloat = renderer.extensions.has('EXT_color_buffer_float');
    this.irradiance = lutTarget(1, 1, this.canReadFloat ? THREE.FloatType : THREE.HalfFloatType);
    this.passes = {
      transmittance: new FullscreenPass(transmittanceFragment, uniformsFor(names)),
      multiScatter: new FullscreenPass(multiScatterFragment, uniformsFor(names)),
      skyView: new FullscreenPass(skyViewFragment, uniformsFor(names)),
      irradiance: new FullscreenPass(irradianceFragment, uniformsFor(names)),
    };
    shared.tTransmittance.value = this.transmittance.texture;
    shared.tMultiScatter.value = this.multiScatter.texture;
    shared.tSkyView.value = this.skyView.texture;
    this.last = { mie: -1, sun: new THREE.Vector3(), camY: -1e9, irrSun: new THREE.Vector3(9, 9, 9) };
    this.pending = false;
    this.readBuffer = new Float32Array(4);
    this.clearSky = [0.35, 0.5, 0.75];      // until the first read-back
    this.overcast = 0;                      // 0 clear .. 1 fully overcast (set by the app from the cloud cover)
  }

  /** Call once per frame after the sun direction and camera height are set. */
  update() {
    const { renderer, last } = this, sun = shared.uSunDir.value, mie = shared.uMieScale.value, camY = shared.uCamY.value;
    const mediumChanged = mie !== last.mie;
    if (mediumChanged) {
      // The first pass must not sample the LUT it is writing.
      shared.tTransmittance.value = null;
      this.passes.transmittance.render(renderer, this.transmittance);
      shared.tTransmittance.value = this.transmittance.texture;
      shared.tMultiScatter.value = null;
      this.passes.multiScatter.render(renderer, this.multiScatter);
      shared.tMultiScatter.value = this.multiScatter.texture;
      last.mie = mie;
    }
    const sunMoved = last.sun.distanceToSquared(sun) > 1e-9;
    if (mediumChanged || sunMoved || Math.abs(camY - last.camY) > Math.max(0.5, 0.01 * camY)) {
      shared.tSkyView.value = null;
      this.passes.skyView.render(renderer, this.skyView);
      shared.tSkyView.value = this.skyView.texture;
      last.sun.copy(sun); last.camY = camY;
    }
    // The sky's light on the ground: integrated on the GPU and read back (before it is used below, so a frame
    // drawn right after the sun moved is lit by this sky, not the last one; when the read-back is asynchronous
    // it arrives a few frames later).
    const toa = shared.uSunToa.value;
    if (this.canReadFloat && !this.pending && (mediumChanged || last.irrSun.distanceToSquared(sun) > 2e-6)) {
      last.irrSun.copy(sun);
      this.passes.irradiance.render(renderer, this.irradiance);
      const apply = () => { this.clearSky = [toa.x * this.readBuffer[0], toa.y * this.readBuffer[1], toa.z * this.readBuffer[2]]; };
      if (this.syncReadback) { renderer.readRenderTargetPixels(this.irradiance, 0, 0, 1, 1, this.readBuffer); apply(); }
      else {
        this.pending = true;
        renderer.readRenderTargetPixelsAsync(this.irradiance, 0, 0, 1, 1, this.readBuffer).then(apply).catch(() => {}).finally(() => { this.pending = false; });
      }
    }
    // Direct sun at sea level (exact, on the CPU) and the sky's contribution (integrated on the GPU, read back).
    const t = sunTransmittance(sun.y, mie);
    shared.uSunE.value.set(toa.x * t[0], toa.y * t[1], toa.z * t[2]);
    // Sky light: the clear sky's (blue) under few clouds; under an overcast it is the sun's own light, spread out
    // and grey. After dark the moon and stars keep a little light in the scene (a fixed dim blue floor).
    const c = this.clearSky, ov = this.overcast, e = shared.uSunE.value, mu = Math.max(sun.y, 0);
    const grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.3 * mu * (0.2126 * e.x + 0.7152 * e.y + 0.0722 * e.z);
    shared.uSkyE.value.set(c[0] + (grey - c[0]) * ov + 0.004, c[1] + (grey - c[1]) * ov + 0.006, c[2] + (grey - c[2]) * ov + 0.011);
  }
}
