// What your feet throw up: grains of dry sand flicked back as a foot pushes off, and drops of water where one
// comes down in the shallows. A few hundred points, each a small thing thrown and falling; where and when each
// was thrown is kept, the rest is worked out in the vertex shader. Places are kept wrapped to 64 m, like the
// footprints, and unwrapped next to the camera.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';

const vertexShader = /* glsl */`
#include <lr_common>
in vec4 aThrown;        // where from (x, z wrapped to 64 m; y absolute) and when (s)
in vec4 aWay;           // the velocity it left with (m/s) and its size (m; negative for a drop of water)
// (position.x: the height at which it lands and is gone.)
out float vWater;
out float vAge;
void main() {
  float t = uTime - aThrown.w, water = step(aWay.w, 0.0), life = mix(0.45, 0.6, water);
  vec2 rel = mod(aThrown.xz - uCamMod.xy + 32.0, 64.0) - 32.0 + aWay.xz * t * (1.0 - 0.6 * t);        // (the air slows a grain)
  float y = aThrown.y + aWay.y * t - 4.9 * t * t;
  vWater = water; vAge = t / life;
  // (Not thrown yet, already landed, or fallen back to where it came from: nothing to draw.)
  if (t < 0.0 || t > life || y < position.x) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = projectionMatrix * viewMatrix * vec4(rel.x, y, rel.y, 1.0);
  gl_PointSize = clamp(abs(aWay.w) * projectionMatrix[1][1] * 0.5 / uInvResolution.y / max(gl_Position.w, 0.05), 1.0, 14.0);
}`;

const fragmentShader = /* glsl */`
#include <lr_common>
in float vWater;
in float vAge;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  // A grain is sand from just under the surface, a shade darker than what lies on top. A drop in the sun is
  // bright: it gathers the light of everything round it, with the sun's glint on one side (drawn as sky alone
  // the drops came out as dark specks on the bright sand).
  vec3 light = (uSunE * max(uSunDir.y, 0.0) + uSkyE) / PI;
  vec3 sand = vec3(0.5, 0.45, 0.37) * light;
  vec3 drop = light * vec3(0.78, 0.84, 0.88) + uSunE * 0.03 * smoothstep(0.3, 0.0, length(c - vec2(-0.1, -0.14)));
  outColor = vec4(mix(sand, drop, vWater), -1000.0);
}`;

export class Spray {
  /** @param {number} count  how many grains and drops can be in the air at once */
  constructor(count = 320) {
    this.count = count; this.next = 0;
    this.floor = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.thrown = new THREE.BufferAttribute(new Float32Array(count * 4).fill(-1e9), 4).setUsage(THREE.DynamicDrawUsage);
    this.way = new THREE.BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.floor);
    geometry.setAttribute('aThrown', this.thrown); geometry.setAttribute('aWay', this.way);
    this.points = new THREE.Points(geometry, new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms: uniformsFor(CHUNK_UNIFORMS.common) }));
    this.points.frustumCulled = false;
    let seed = 12345;
    this.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  }

  /**
   * Throws `n` things from (x, z: wrapped to 64 m; y absolute) at time `when` (s; it may be a moment ahead).
   * `back` = unit [east, south] the foot pushes towards; `water` = drops, not grains; `force` scales how hard.
   */
  burst(x, y, z, when, back, n, water = false, force = 1) {
    const r = this.random;
    for (let k = 0; k < n; k++) {
      const i = this.next++ % this.count, a = r() * 2 * Math.PI, out = water ? 0.25 + 0.7 * r() : 0.35 * r();
      // Sand goes mostly back and low, in a fan; water goes up and outwards all round.
      const along = water ? 0.25 * r() : 0.5 + 1.1 * r(), up = water ? 0.9 + 1.5 * r() : 0.45 + 0.9 * r() * r();
      this.floor.setX(i, y);
      this.thrown.setXYZW(i, x + (r() - 0.5) * 0.07, y + 0.004, z + (r() - 0.5) * 0.07, when + 0.04 * r());
      this.way.setXYZW(i, (back[0] * along + Math.cos(a) * out) * force, up * Math.sqrt(force), (back[1] * along + Math.sin(a) * out) * force, water ? -(0.004 + 0.005 * r()) : 0.0016 + 0.002 * r());
    }
    this.thrown.needsUpdate = true; this.way.needsUpdate = true; this.floor.needsUpdate = true;
  }

  /**
   * Lets `n` things fall from about (x, y, z) to `floor` below, over the next `over` seconds: water running off
   * a hand lifted out of the sea, dry sand trickling from between fingers.
   */
  drip(x, y, z, floor, when, n, water, over = 0.5) {
    const r = this.random;
    for (let k = 0; k < n; k++) {
      const i = this.next++ % this.count;
      this.floor.setX(i, floor);
      this.thrown.setXYZW(i, x + (r() - 0.5) * 0.09, y - 0.01 * r(), z + (r() - 0.5) * 0.09, when + over * r() * r());
      this.way.setXYZW(i, (r() - 0.5) * 0.12, -0.1 * r(), (r() - 0.5) * 0.12, water ? -(0.003 + 0.004 * r()) : 0.0014 + 0.0016 * r());
    }
    this.thrown.needsUpdate = true; this.way.needsUpdate = true; this.floor.needsUpdate = true;
  }
}
