// What falls from your hand, grain by grain. A handful of dry sand running out between the fingers is some
// fifty thousand grains a second; each is drawn: where and when it was let go is kept, and where it is now is
// worked out in the vertex shader from how a small thing falls through the air (sim/fall.js). A grain half a
// millimetre across is less than a pixel, and in a sixtieth of a second it falls across thirty of them: so it is
// drawn as the faint streak the eye sees of it, and a stream is the sum of them, a veil, dense where the grains
// are slow under the hand and thinning as they speed up. (Drawn as solid ribbons with holes cut in them, a
// stream was a pencil line: three times over.)
//
// The grains are drawn after the water, over the finished picture, each laid on with its own share of cover
// (core/framegraph.js: the overlay). Places are kept wrapped to 64 m and unwrapped next to the camera.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { landTime } from '../sim/fall.js';
import { patchGLSL } from '../sim/patch.js';

const vertexShader = /* glsl */`
#include <lr_common>
uniform highp sampler2D tShadow;
uniform vec3 uShadowC, uShadowR, uShadowU;
uniform vec4 uShadowP;
uniform highp sampler2D tShadowB;
uniform vec4 uShadowB;
uniform vec2 uShadowBP;
${patchGLSL}
uniform float uNow;        // seconds since the moment births are counted from
uniform float uShutter;    // how long the eye's picture of a moving thing lasts (s): a frame
uniform vec2 uAir;         // the breeze where they fall (east, south; m/s)
in vec2 corner;            // along the streak 0..1, across it -1..1
in vec4 aBirth;            // where it was let go (x, z wrapped to 64 m; y absolute) and when
in vec4 aVel;              // the velocity it left with (m/s), and tau: how long the air takes to carry it along (s)
in vec4 aLand;             // when it lands (s after it was let go), the height it lands at, its size (m), a number of its own
in vec4 aMore;             // how many grains it stands for, how hard it hops up and out where it lands (m/s), its kind
out vec3 vColor;
out vec4 vShape;           // along, across, the streak's length over its width, its cover
out vec3 vGlint;           // how bright a glint it gives this frame, where along the streak, how far the frame is in pixels
out float vDrop;           // 1: a drop of water
// (sim/fall.js fallAt: the same lines.)
vec3 lrFallAt(float t) {
  float tau = aVel.w, k = tau * (1.0 - exp(-t / tau)), vy = -9.81 * tau;
  vec2 rel = mod(aBirth.xz - uCamMod.xy + 32.0, 64.0) - 32.0;
  return vec3(rel.x + uAir.x * t + (aVel.x - uAir.x) * k, aBirth.y + vy * t + (aVel.y - vy) * k, rel.y + uAir.y * t + (aVel.z - uAir.y) * k);
}
// 1 where the sun reaches p (x, z relative to the camera, y absolute), 0 in the shadow of your body or of anything else: one look at each map.
float lrLitAt(vec3 p) {
  float lit = 1.0;
  if (uShadowBP.y > 0.5) {
    vec3 q = p - uShadowB.xyz; vec2 s = vec2(dot(q, uShadowR), dot(q, uShadowU)) / uShadowB.w; float towards = dot(q, uSunDir) + 0.006;
    if (max(abs(s.x), abs(s.y)) < 1.0 && towards <= uShadowB.w) lit = step(textureLod(tShadowB, s * 0.5 + 0.5, 0.0).r, towards);
  }
  if (uShadowP.z > 0.5) {
    vec3 q = p - uShadowC; vec2 s = vec2(dot(q, uShadowR), dot(q, uShadowU)) / uShadowP.x;
    if (max(abs(s.x), abs(s.y)) < 1.0) lit = min(lit, step(textureLod(tShadow, s * 0.5 + 0.5, 0.0).r, dot(q, uSunDir) + uShadowP.y * 2.0 + 0.012));
  }
  return lit;
}
void main() {
  float age = uNow - aBirth.w, land = aLand.x, kind = floor(aMore.w + 0.02), dense = fract(aMore.w + 0.02) / 0.45;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vShape = vec4(0.0); vGlint = vec3(0.0); vDrop = step(3.5, kind);
  // (A drop is seen sharper than a grain: the eye follows it. A third of a frame of it.)
  float shutter = uShutter * mix(1.0, 0.3, vDrop);
  // (Not let go yet, or landed and gone.)
  if (age < 0.0 || age > land + 0.25 || aMore.x <= 0.0) return;
  // Where it lands the sand may stand higher than the beach: the heap it is building. It lands on that, a moment sooner.
  vec3 end = lrFallAt(land);
  float tau = aVel.w, falling = 9.81 * tau - (aVel.y + 9.81 * tau) * exp(-land / tau);          // (how fast it comes down, m/s)
  if (uPatch.w > 0.5) {
    vec2 at = mod(end.xz + uCamMod.xy, 64.0);
    land = clamp(land - lrPatchIn(at) * lrPatchHeight(at) / max(falling, 0.3), 0.0, land);
    end = lrFallAt(land);
  }
  vec3 A, B;
  if (age <= land) { A = lrFallAt(clamp(age - shutter, 0.0, land)); B = lrFallAt(age); }
  else {
    // Landed. Most grains stay where they fall; one in three hops: up a few millimetres to a centimetre or two
    // and out a little way, and is down again in a twentieth of a second. (Sand alone: not clots, not drops.)
    float h1 = lrHash12(vec2(aLand.w * 13.1 + 2.0, aLand.w * 5.7)), h2 = lrHash12(vec2(aLand.w * 29.3, 7.0 + aLand.w)), h3 = lrHash12(vec2(4.0 + aLand.w * 3.3, aLand.w * 41.0));
    float up = (0.05 + 0.13 * h2) * falling, t = age - land;
    if (h1 < 0.65 || kind > 2.5 || t > 2.0 * up / 9.81) return;
    float az = 6.2832 * h3, out_ = 0.04 + 0.22 * fract(h1 * 7.0), t0 = max(t - uShutter, 0.0);
    A = end + vec3(cos(az) * out_ * t0, up * t0 - 4.905 * t0 * t0, sin(az) * out_ * t0);
    B = end + vec3(cos(az) * out_ * t, up * t - 4.905 * t * t, sin(az) * out_ * t);
  }
  vec4 a = projectionMatrix * viewMatrix * vec4(A, 1.0), b = projectionMatrix * viewMatrix * vec4(B, 1.0);
  if (a.w < 0.02 || b.w < 0.02) return;
  // The streak, in pixels: from where it was a frame ago to where it is, as wide as the grain (and a pixel and a
  // quarter at least: narrower than that it would flicker; its cover makes up for the width it is given).
  vec2 pixels = 0.5 / uInvResolution, sa = a.xy / a.w * pixels, sb = b.xy / b.w * pixels, d = sb - sa;
  float run = length(d), size = aLand.z * projectionMatrix[1][1] * pixels.y / b.w, wide = max(size, mix(1.25, 2.0, vDrop));
  vec2 dir = run > 1e-3 ? d / run : vec2(0.0, -1.0), side = vec2(-dir.y, dir.x);
  vec2 p = mix(sa - dir * wide * 0.5, sb + dir * wide * 0.5, corner.x) + side * corner.y * wide * 0.5;
  float w = mix(a.w, b.w, corner.x);
  gl_Position = vec4(p / pixels * w, mix(a.z / a.w, b.z / b.w, corner.x) * w, w);
  // How much of what is behind it a grain hides, over the streak: its own area over the streak's, for as many grains as it stands for.
  // (Twice over: a grain too small to see is seen all the same by the light it turns aside, more than its own
  // width of it; counted once, sand falling in front of sand could hardly be made out at arm's length.)
  float cover = min(2.0 * aMore.x * (size / wide) * size / (run + size), 0.92);
  vShape = vec4(corner.x, corner.y, (run + wide) / wide, cover);
  if (vDrop > 0.5) {
    // Water: a bead that lets the sand behind it through, darker round its rim, with the sky in it and the sun's
    // spark on its sunward side. (Its light is worked out where it is drawn.)
    float lit = lrLitAt(B);
    vColor = uSkyE / PI * vec3(0.9, 1.0, 1.08);
    vGlint = vec3(lit, 0.0, run + wide);
    vShape.w = min(size / wide, 1.0);
    return;
  }
  // The light on it. A grain is a little ball: how much of its lit side you see goes by the angle between the
  // sun and you, seen from it (a ball lit from behind you is all bright; lit from in front of you, a dark dot
  // with a bright edge). With the sky's light, and the sunlit sand below it throwing light up.
  float lit = lrLitAt(B), below = lrLitAt(vec3(B.x, aLand.y + 0.01, B.z));
  vec3 toEye = normalize(vec3(0.0, uCamY, 0.0) - B);
  float ca = clamp(dot(toEye, uSunDir), -1.0, 1.0), al = acos(ca), phase = (sin(al) + (PI - al) * ca) / PI;
  float own = lrHash12(vec2(aLand.w * 7.31, aLand.w * 3.17 + 1.0));
  vec3 sand = vec3(0.66, 0.61, 0.53) * (0.78 + 0.44 * own);
  vec3 albedo = kind < 0.5 ? sand : kind < 1.5 ? vec3(0.93, 0.91, 0.86) : kind < 2.5 ? vec3(0.26, 0.23, 0.21) : kind < 3.5 ? sand * 0.56 : vec3(0.8, 0.86, 0.9);
  // (In the thick of a stream each grain is in the shade of others half the time: it is darker than a grain alone.
  // That is what lets you see sand falling in front of sand.)
  vec3 sun = uSunE * lit * (1.0 - 0.6 * dense * exp(-age * 4.0)), ground = uSunE * max(uSunDir.y, 0.0) * below * vec3(0.76, 0.7, 0.6) * 0.3;
  vColor = albedo * (sun * (2.0 / 3.0) * phase + uSkyE * (0.7 - 0.3 * dense) + ground * 0.5 + sun * 0.06 * (1.0 - phase)) / PI;
  // Now and then a grain turns a face to the sun as it spins: a spark somewhere along its streak. Flakes of shell
  // more often, and brighter.
  float flake = kind > 0.5 && kind < 1.5 ? 1.0 : 0.0, roll = lrHash12(vec2(aLand.w * 91.7 + 3.0, floor(uNow * 60.0) + aLand.w));
  vGlint = vec3(step(1.0 - (0.012 + 0.1 * flake) * (1.0 + 0.5 * max(ca, 0.0)), roll) * lit * (3.0 + 5.0 * flake), lrHash12(vec2(roll * 53.0, aLand.w)), run + wide);
}`;

const fragmentShader = /* glsl */`
#include <lr_common>
in vec3 vColor;
in vec4 vShape;
in vec3 vGlint;
in float vDrop;
layout(location = 0) out vec4 outColor;
void main() {
  if (vDrop > 0.5) {
    // (The bead's own shape: a round end at each end of the little way it has come. A drop is a lens: dark round
    // its rim, where it turns the light away, clear and a little bright in its middle, and with the sun's spark
    // on it wherever you see it from: there is always a place on a ball that mirrors the sun to you.)
    float l = vShape.x * vShape.z, core = clamp(l, 0.5, vShape.z - 0.5), r2 = (l - core) * (l - core) * 4.0 + vShape.y * vShape.y;
    if (r2 > 1.0) discard;
    float rim = smoothstep(0.35, 1.0, r2), cover = vShape.w * (0.1 + 0.6 * rim);
    vec2 at = vec2((l - core) * 2.0 + 0.3, vShape.y + 0.35);
    float spark = (0.35 + 0.65 * vGlint.x) * smoothstep(0.12, 0.0, dot(at, at));
    outColor = vec4(vColor * (1.4 - 1.1 * rim) * cover + vColor * 0.5 * (1.0 - rim) * vShape.w + uSunE / PI * spark * 5.0 * vShape.w, cover);
    return;
  }
  // Soft across, and rounded at its two ends.
  float along = vShape.x * vShape.z, end = min(min(along, vShape.z - along), 0.5) * 2.0, across = 1.0 - vShape.y * vShape.y;
  float cover = vShape.w * across * 1.5 * smoothstep(0.0, 1.0, end);
  if (cover <= 0.002 && vGlint.x <= 0.0) discard;
  float spark = vGlint.x * across * smoothstep(1.2, 0.0, abs(vShape.x - vGlint.y) * vGlint.z);
  // (Laid over the picture: its light for the part it covers, and what is behind for the rest. A spark is light added.)
  outColor = vec4(vColor * cover + uSunE / PI * vec3(1.0, 0.97, 0.9) * spark * 0.6, cover);
}`;

export class Falling {
  /** @param {number} count  how many grains can be in the air at once  @param {number} share  the part of all the grains that are drawn (each then stands for 1 / share of them) */
  constructor(count = 65536, share = 1) {
    this.count = count; this.share = share; this.next = 0; this.from = 0; this.put_ = 0; this.epoch = 0; this.overwritten = 0;
    this.data = new Float32Array(count * 16); this.until = new Float32Array(count);
    const buffer = this.buffer = new THREE.InstancedInterleavedBuffer(this.data, 16).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    for (const [name, at] of [['aBirth', 0], ['aVel', 4], ['aLand', 8], ['aMore', 12]]) geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, at));
    geometry.instanceCount = count;
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.DoubleSide, depthWrite: false, transparent: true,
      // (Each grain's light for the part it covers, the picture for the rest; the frame's fourth channel, which says what lies where, is left alone.)
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.shadow, 'tPatch', 'uPatch'], { uNow: { value: 0 }, uShutter: { value: 1 / 60 }, uAir: { value: new THREE.Vector2() } }),
    }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
    let seed = 97531;
    this.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    this.seed = s => { seed = s >>> 0; };
  }

  /** Nothing in the air. */
  clear() { this.data.fill(0); this.until.fill(0); this.next = 0; this.from = 0; this.put_ = 0; this.buffer.clearUpdateRanges(); this.buffer.needsUpdate = true; }

  /**
   * Lets one thing go: from (x, y, z) in the world at time `when` (the clock's; it may be a moment back, within
   * the frame), with velocity (vx, vy, vz), to fall to `floor`. `size` in metres, `tau` (sim/fall.js), `weight`:
   * how many grains it stands for, `kind`: 0 a grain, 1 a flake of shell, 2 a dark grain, 3 a clot of wet sand, 4 a drop of water;
   * `dense`, 0..1: how thick the stream it falls in (the grains of a thick stream shade one another).
   * Returns when it lands (seconds after `when`).
   */
  put(x, y, z, vx, vy, vz, when, floor, size, tau, weight = 1, kind = 0, dense = 0) {
    const i = this.next, o = i * 16, d = this.data, land = landTime(y, vy, tau, floor);
    // (A grain still in the air is written over only when there are more than can be drawn: it is counted.)
    if (this.until[i] > when) this.overwritten++;
    this.until[i] = when + land;
    d[o] = ((x % 64) + 64) % 64; d[o + 1] = y; d[o + 2] = ((z % 64) + 64) % 64; d[o + 3] = when - this.epoch;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = tau;
    d[o + 8] = land; d[o + 9] = floor; d[o + 10] = size; d[o + 11] = this.random();
    // (`dense`, 0..1: how thick the stream it is in: with its kind, as the part after the point.)
    d[o + 12] = weight; d[o + 13] = 0; d[o + 14] = 0; d[o + 15] = kind + 0.45 * Math.min(1, Math.max(0, dense));
    this.next = (i + 1) % this.count; this.put_++;
    return land;
  }

  /** Before the picture is drawn: the moment, how long a frame is, the breeze; and what was let go since the last picture is handed to the graphics card. */
  update(time, dt, wind = [0, 0]) {
    // (Births are counted from a moment not too long ago, so that a thirty-second of a millisecond can still be told.)
    if (time - this.epoch > 2048 || time < this.epoch) { this.epoch = Math.floor(time / 1024) * 1024; this.clear(); }
    const u = this.mesh.material.uniforms;
    u.uNow.value = time - this.epoch; u.uAir.value.set(wind[0], wind[1]);
    if (dt > 0) u.uShutter.value = Math.min(1 / 30, Math.max(1 / 240, dt));
    if (this.put_ > 0) {
      const b = this.buffer, n = Math.min(this.put_, this.count);
      b.clearUpdateRanges();
      if (n >= this.count) b.addUpdateRange(0, this.count * 16);
      else if (this.from + n <= this.count) b.addUpdateRange(this.from * 16, n * 16);
      else { b.addUpdateRange(this.from * 16, (this.count - this.from) * 16); b.addUpdateRange(0, (this.from + n - this.count) * 16); }
      b.needsUpdate = true; this.from = this.next; this.put_ = 0;
    }
  }

  /** For tests: how many things are in the air at `time`, and how many were written over while still falling. */
  inAir(time) { let n = 0; for (let i = 0; i < this.count; i++) if (this.until[i] > time) n++; return { n, overwritten: this.overwritten }; }
}
