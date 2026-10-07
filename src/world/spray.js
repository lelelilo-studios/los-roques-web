// Small things in the air: grains of dry sand flicked back as a foot pushes off, drops of water where one comes
// down in the shallows, and above all what runs out of your hand: sand pouring between the fingers in thin
// streams, water in strings of drops. A thousand points, each a small thing let go and falling; where and when
// each was let go is kept, the rest is worked out in the vertex shader. Places are kept wrapped to 64 m, like
// the footprints, and unwrapped next to the camera.
//
// A falling grain is drawn as the short streak the eye sees of it (a few hundredths of a second of its path),
// so that grains following one another down the same line read as a stream, as pouring sand does.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';

const vertexShader = /* glsl */`
#include <lr_common>
in vec4 aThrown;        // where from (x, z wrapped to 64 m; y absolute) and when (s)
in vec4 aWay;           // the velocity it left with (m/s) and its size (m; negative for a drop of water)
// (position.x: the height at which it lands and is gone; position.y: a shade for the grain, 0..1.)
out float vWater;
out float vShade;
out vec3 vStreak;       // the streak across the point: its direction on the screen (xy) and how thin the thing is against its length
vec3 lrThingAt(float t) {
  // (The air slows a grain flung sideways; it hardly slows one falling.)
  vec2 rel = mod(aThrown.xz - uCamMod.xy + 32.0, 64.0) - 32.0 + aWay.xz * t * (1.0 - 0.6 * min(t, 0.8));
  return vec3(rel.x, aThrown.y + aWay.y * t - 4.9 * t * t, rel.y);
}
void main() {
  float t = uTime - aThrown.w, water = step(aWay.w, 0.0);
  vec3 p = lrThingAt(t);
  vWater = water; vShade = position.y;
  // (Not let go yet, or landed: nothing to draw.)
  if (t < 0.0 || t > 1.6 || p.y < position.x) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vStreak = vec3(1.0, 0.0, 1.0); return; }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vec4 before = projectionMatrix * viewMatrix * vec4(lrThingAt(max(t - mix(0.03, 0.016, water), 0.0)), 1.0);
  vec2 pixels = 0.5 / uInvResolution, smear = (gl_Position.xy / gl_Position.w - before.xy / max(before.w, 1e-3)) * pixels;
  float across = clamp(abs(aWay.w) * projectionMatrix[1][1] * pixels.y / max(gl_Position.w, 0.05), 1.0, 12.0), along = clamp(length(smear), across, 40.0);
  gl_PointSize = along;
  vStreak = vec3(length(smear) > 0.5 ? normalize(smear) : vec2(0.0, 1.0), across / along);
}`;

const fragmentShader = /* glsl */`
#include <lr_common>
in float vWater;
in float vShade;
in vec3 vStreak;
layout(location = 0) out vec4 outColor;
void main() {
  // (The point's square, turned to lie along the streak: a thin ellipse within it.)
  vec2 c = gl_PointCoord - 0.5, d = vec2(vStreak.x, -vStreak.y), l = vec2(dot(c, d), dot(c, vec2(-d.y, d.x)) / vStreak.z);
  if (dot(l, l) > 0.25) discard;
  // A grain is sand, some paler (shell) and some darker than others. A drop in the sun is bright: it gathers
  // the light of everything round it, with the sun's glint on one side.
  vec3 light = (uSunE * max(uSunDir.y, 0.0) + uSkyE) / PI;
  // (Falling, a grain shows its side to you, not its sunlit top: duller than the beach it falls past, which
  // is what lets a stream of them be seen against it.)
  vec3 sand = mix(vec3(0.34, 0.3, 0.25), vec3(0.6, 0.56, 0.49), vShade * vShade) * light;
  vec3 drop = light * vec3(0.78, 0.84, 0.88) + uSunE * 0.03 * smoothstep(0.3, 0.0, length(l - vec2(0.05, -0.12)));
  outColor = vec4(mix(sand, drop, vWater), -1000.0);
}`;

export class Spray {
  /** @param {number} count  how many grains and drops can be in the air at once */
  constructor(count = 1200) {
    this.count = count; this.next = 0;
    this.thrown = new THREE.BufferAttribute(new Float32Array(count * 4).fill(-1e9), 4).setUsage(THREE.DynamicDrawUsage);
    this.way = new THREE.BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.floor = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.floor); geometry.setAttribute('aThrown', this.thrown); geometry.setAttribute('aWay', this.way);
    this.points = new THREE.Points(geometry, new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms: uniformsFor(CHUNK_UNIFORMS.common) }));
    this.points.frustumCulled = false;
    let seed = 12345;
    this.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  }

  /**
   * Lets one thing go: from (x, z: wrapped to 64 m; y absolute) at time `when` (s; it may be a moment ahead),
   * with velocity v (m/s), to fall until `floor`. `size` in metres; `water` = a drop, not a grain.
   */
  put(x, y, z, floor, when, v, size, water = false) {
    const i = this.next++ % this.count;
    this.floor.setXY(i, floor, this.random());
    this.thrown.setXYZW(i, x, y, z, when);
    this.way.setXYZW(i, v[0], v[1], v[2], water ? -size : size);
    this.thrown.needsUpdate = true; this.way.needsUpdate = true; this.floor.needsUpdate = true;
  }

  /**
   * Throws `n` things up from the ground at (x, y, z). `back` = unit [east, south] the foot pushes towards;
   * `water` = drops, not grains; `force` scales how hard.
   */
  burst(x, y, z, when, back, n, water = false, force = 1) {
    const r = this.random;
    for (let k = 0; k < n; k++) {
      const a = r() * 2 * Math.PI, out = water ? 0.25 + 0.7 * r() : 0.35 * r();
      // Sand goes mostly back and low, in a fan; water goes up and outwards all round.
      const along = water ? 0.25 * r() : 0.5 + 1.1 * r(), up = water ? 0.9 + 1.5 * r() : 0.45 + 0.9 * r() * r();
      this.put(x + (r() - 0.5) * 0.07, y + 0.004, z + (r() - 0.5) * 0.07, y, when + 0.04 * r(),
        [(back[0] * along + Math.cos(a) * out) * force, up * Math.sqrt(force), (back[1] * along + Math.sin(a) * out) * force], water ? 0.004 + 0.005 * r() : 0.0016 + 0.002 * r(), water);
    }
  }

  /** Lets `n` things fall from about (x, y, z) to `floor` below, over the next `over` seconds: the last of what a hand held. */
  drip(x, y, z, floor, when, n, water, over = 0.5) {
    const r = this.random;
    for (let k = 0; k < n; k++) {
      this.put(x + (r() - 0.5) * 0.09, y - 0.01 * r(), z + (r() - 0.5) * 0.09, floor, when + over * r() * r(), [(r() - 0.5) * 0.12, -0.1 * r(), (r() - 0.5) * 0.12], water ? 0.003 + 0.004 * r() : 0.0014 + 0.0016 * r(), water);
    }
  }
}
