// Bubbles: the air you let go under water, the air a dive carries down with you, the air your feet beat into the
// sea when you kick at the surface. Each rises as a bubble of its size does (a foot a second, the larger the
// faster), wobbling, swelling a little as the water over it thins, and is gone at the surface. A few hundred
// at most, moved here and drawn as small rings of light over the finished picture (as what falls from your
// hand is: world/falling.js).
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';

const vertexShader = /* glsl */`
#include <lr_common>
uniform float uScale;      // pixels for a metre at a metre
in float aSize;            // its radius, metres (0: none)
out float vSize;
out float vDepth;
uniform float uSurface;
void main() {
  vec4 view = viewMatrix * vec4(position.x, position.y - lrCurveDrop(position.xz), position.z, 1.0);
  gl_Position = projectionMatrix * view;
  vSize = aSize; vDepth = uSurface - position.y;
  gl_PointSize = aSize > 0.0 ? max(1.5, 2.0 * aSize * uScale / max(0.05, -view.z)) : 0.0;
}`;
const fragmentShader = /* glsl */`
#include <lr_common>
in float vSize;
in float vDepth;
layout(location = 0) out vec4 outColor;
void main() {
  if (vSize <= 0.0) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // A bubble is a mirror for the bright surface over it: a bright ring, brightest at the top, a clear middle, a glint.
  float ring = smoothstep(0.55, 0.95, r) * (0.55 + 0.45 * (0.5 - 0.5 * p.y)), glint = (1.0 - smoothstep(0.0, 0.32, length(p - vec2(-0.3, -0.42))));
  vec3 light = (uSunE * lrSaturate(uSunDir.y) + uSkyE) / PI * exp(-0.18 * max(vDepth, 0.0));
  float cover = clamp(0.5 * ring + 0.7 * glint, 0.0, 1.0) * (1.0 - smoothstep(0.9, 1.0, r));
  outColor = vec4(light * (0.5 * ring + 0.9 * glint), cover * 0.6);
}`;

export class Bubbles {
  constructor(count = 512) {
    this.count = count; this.next = 0;
    this.p = new Float32Array(count * 3); this.size = new Float32Array(count); this.v = new Float32Array(count * 3); this.seed = new Float32Array(count); this.world = new Float64Array(count * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common], { uScale: { value: 800 }, uSurface: { value: 0 } }) }));
    this.points.frustumCulled = false; this.points.matrixAutoUpdate = false;
    let s = 24680; this.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    this.alive = 0;
  }

  /** Lets `n` bubbles go at about (x, y, z) in the world, `spread` metres round it, of about `size` metres radius, with a first speed `v` (m/s: [x, y, z]). */
  let(x, y, z, n = 1, spread = 0.03, size = 0.003, v = [0, 0, 0]) {
    const r = this.random;
    for (let k = 0; k < n; k++) {
      const i = this.next, o = i * 3; this.next = (i + 1) % this.count;
      this.world[o] = x + (r() - 0.5) * 2 * spread; this.world[o + 1] = y + (r() - 0.5) * 2 * spread; this.world[o + 2] = z + (r() - 0.5) * 2 * spread;
      this.v[o] = v[0] + (r() - 0.5) * 0.2; this.v[o + 1] = v[1] + (r() - 0.5) * 0.15; this.v[o + 2] = v[2] + (r() - 0.5) * 0.2;
      this.size[i] = size * (0.5 + r() * r() * 1.6); this.seed[i] = r() * 6.283;
    }
  }

  /**
   * Moves them on and puts them where the camera sees them.
   * @param {number} dt  @param {{x: number, z: number}} eye  the camera  @param {(x: number, z: number) => number} surfaceAt  the sea's surface
   * @param {number} time  @param {number} scale  pixels for a metre at a metre (the picture's height over twice the tangent of half the lens)
   */
  update(dt, eye, surfaceAt, time, scale) {
    let alive = 0;
    const top = surfaceAt(eye.x, eye.z);
    for (let i = 0; i < this.count; i++) {
      if (this.size[i] <= 0) continue;
      const o = i * 3, a = this.size[i];
      if (dt > 0) {
        // (What it was thrown with is soon lost to the water; then it rises: 0.22 m/s at a millimetre across the middle, 0.35 at four.)
        const rise = 0.2 + 38 * Math.min(a, 0.004), k = Math.exp(-dt * 5);
        this.v[o] *= k; this.v[o + 2] *= k; this.v[o + 1] += (rise - this.v[o + 1]) * (1 - Math.exp(-dt * 6));
        const wob = 0.07 * Math.min(1, a / 0.003);
        this.world[o] += (this.v[o] + wob * Math.sin(time * 9 + this.seed[i])) * dt; this.world[o + 1] += this.v[o + 1] * dt; this.world[o + 2] += (this.v[o + 2] + wob * Math.cos(time * 7.3 + this.seed[i] * 1.7)) * dt;
        this.size[i] = a * (1 + 0.04 * dt);
        if (this.world[o + 1] > top - 0.01) { this.size[i] = 0; continue; }
      }
      this.p[o] = this.world[o] - eye.x; this.p[o + 1] = this.world[o + 1]; this.p[o + 2] = this.world[o + 2] - eye.z;
      alive++;
    }
    this.alive = alive;
    const g = this.points.geometry; g.attributes.position.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
    const u = this.points.material.uniforms; u.uScale.value = scale; u.uSurface.value = top;
    this.points.visible = alive > 0;
  }
}
