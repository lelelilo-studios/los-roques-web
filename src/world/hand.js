// Your right hand, taking up what is under it. Crouched, with the button held, it goes down to the ground on the
// line of your look and closes on what is there: a handful of dry sand, of wet sand, or of water. Let go and
// it comes up before you, palm up and cupped, and what it holds runs out between the fingers: dry sand in thin
// steady streams that build a little heap where they land, wet sand in clots, water in strings of drops that
// ring the sea or darken the sand. Then the hand opens and goes back to your side, wet or sandy for a while.
//
// The body is posed elsewhere (bodyshape.js: poseBody's `touch`); this decides what the hand should be doing,
// and makes everything that comes of it: the marks in the sand (uTouchSeg / uTouchInfo, drawn by the terrain),
// the grains and drops in the air (spray.js), the heap in the palm (a small mesh of its own), the sounds.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, shared, uniformsFor } from '../core/uniforms.js';
import { shadowGLSL } from './shadow.js';
import { CELL, NU, NV, Palm, U0, V0 } from '../sim/palm.js';
import { DIP, MCP, PIP, POSE_LENGTH, mixPose } from './handpose.js';
import { HandMotion } from './handact.js';
import { grainTau } from '../sim/fall.js';

const clamp01 = v => Math.min(1, Math.max(0, v));
const wrap64 = v => ((v % 64) + 64) % 64;
// How fast a handful runs out (handfuls a second when the hand is full), how many grains or drops a handful is
// drawn as, their size (m), and how much stays on the hand.
// (Slowly: a handful of dry sand takes eight seconds to run out, water four.)
const STUFF = {
  dry: { rate: 0.2, things: 650, size: [0.0014, 0.0025], left: 0 },
  wet: { rate: 0.2, things: 260, size: [0.003, 0.0065], left: 0.12 },
  water: { rate: 0.42, things: 260, size: [0.0022, 0.0042], left: 0 },
};
/** A handful of sand: sixty cubic centimetres. */
const HANDFUL = 6e-5;
// The streams: one from each of the three gaps between the four fingers, each a ribbon of so many samples.
const GAPS = 3, SAMPLES = 64, GRAVITY = 9.8;

const streamVertex = /* glsl */`
#include <lr_common>
in vec2 aUV;       // across the stream, -1..1; and when this part of it left the hand (s)
in vec3 aInfo;     // how strongly it was running then, 0..1; how long it has been falling (s); which gap
out vec3 vRel;
out vec2 vUV;
out vec3 vInfo;
void main() { vRel = position; vUV = aUV; vInfo = aInfo; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const streamFragment = /* glsl */`
#include <lr_common>
${shadowGLSL}
uniform float uWater;
in vec3 vRel;
in vec2 vUV;
in vec3 vInfo;
layout(location = 0) out vec4 outColor;
void main() {
  float u = vUV.x, s = vUV.y, k = vInfo.x, tau = vInfo.y, seed = vInfo.z * 17.0;
  // (Under the hand the stream is in its shadow, but not in the dark: the sunlit sand below lights it from
  // underneath. With the sky alone it came out deep blue.)
  vec3 bounce = uSunE * max(uSunDir.y, 0.0) * 0.3 * vec3(0.76, 0.7, 0.6);
  float lit = lrShadow(vRel, vec3(0.0, 1.0, 0.0));
  vec3 direct = uSunE * max(uSunDir.y, 0.0) * lit;
  vec3 light = (direct + uSkyE + bounce) / PI;
  if (uWater > 0.5) {
    // Water leaves the hand as a thread and breaks into beads as it falls (a thread of water cannot keep its
    // shape: it necks and parts within a hand's breadth).
    float bead = 0.5 + 0.5 * sin(s * 150.0 + seed + 4.0 * lrNoise(vec2(s * 14.0, seed)));
    float parted = smoothstep(0.03, 0.2, tau), round_ = 1.0 - u * u;
    if (k < 0.03 || round_ < 0.12 || bead < parted * (0.82 - 0.3 * k) || round_ * mix(1.0, bead, parted) < 0.2) discard;
    outColor = vec4(light * vec3(0.8, 0.86, 0.9) + uSunE * 0.035 * smoothstep(0.35, 0.0, abs(u + 0.3)) * step(0.5, bead + 1.0 - parted), -1000.0);
  } else {
    // Sand leaves it as a dense thread of grains, which spreads and thins as it speeds up. The grains are tied
    // to the moment they left the hand, so they travel down the stream and draw out into streaks as they go.
    float grain = 0.6 * lrNoise(vec2(u * 2.2 + seed, s * 380.0)) + 0.4 * lrNoise(vec2(u * 5.0 - seed, s * 1300.0 + 9.0));
    float dense = k * (1.0 - u * u * u * u) * mix(1.0, 0.5, smoothstep(0.0, 0.3, tau));
    if (grain > 0.18 + 0.72 * dense) discard;
    float shade = lrNoise(vec2(u * 7.0 + seed * 3.0, s * 700.0));
    // (Falling, grains show their shaded sides: a stream is a shade darker than the sunlit beach behind it. A
    // shade: at half the sand's own brightness it was a thread of grey, pencil lines hanging from the hand. And
    // here and there a grain catches the sun as it turns, brighter than the beach: falling sand glitters.)
    float glint = step(0.9, lrHash12(floor(vec2(u * 1.5 + seed, s * 2600.0))));
    // (In the sun it stays that shade darker: with the light off the sand added to the sun's it was a white thread.)
    // (And the light off the sand reaches it only where the sand round about is in the sun: under your hand at
    // midday, yes; falling through your own long shadow in the evening, no: there it is as dim as the sand
    // behind it, not a pale line drawn across the shadow.)
    float around = (lrShadow(vRel + vec3(0.15, 0.0, 0.0), vec3(0.0, 1.0, 0.0)) + lrShadow(vRel + vec3(-0.075, 0.0, 0.13), vec3(0.0, 1.0, 0.0)) + lrShadow(vRel + vec3(-0.075, 0.0, -0.13), vec3(0.0, 1.0, 0.0))) / 3.0;
    vec3 on = (0.85 * direct + uSkyE + 1.4 * bounce * around * (1.0 - 0.6 * lit)) / PI;
    outColor = vec4(mix(vec3(0.5, 0.455, 0.385), vec3(0.73, 0.675, 0.58), shade) * on + glint * direct / PI * vec3(0.5, 0.48, 0.43), -1000.0);
  }
}`;

const vertexShader = /* glsl */`
#include <lr_common>
uniform vec3 uSize;
uniform vec2 uStuff;
out vec3 vRel;
out vec3 vNormal;
out vec3 vLocal;
void main() {
  // (A heap of sand is not a dome: it is higher here and lower there. Water lies level.)
  vec3 q = position * uSize;
  float lump = uStuff.x < 1.5 ? 0.75 + 0.5 * lrNoise(q.xz * 95.0 + 3.0) : 1.0;
  vec4 p = modelMatrix * vec4(position.x, position.y * lump, position.z, 1.0);
  vRel = p.xyz; vLocal = q;
  vNormal = mat3(modelMatrix) * (normal / (uSize * uSize));
  gl_Position = projectionMatrix * viewMatrix * p;
}`;
const fragmentShader = /* glsl */`
#include <lr_common>
${shadowGLSL}
uniform vec2 uStuff;        // what the hand holds: 0 dry sand, 1 wet sand, 2 water; and how much of a handful
uniform vec3 uSize;         // how big it is (m): across the palm, high, along it
in vec3 vRel;
in vec3 vNormal;
in vec3 vLocal;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal), V = normalize(vec3(0.0, uCamY, 0.0) - vRel);
  if (dot(n, V) < 0.0) n = -n;
  float water = step(1.5, uStuff.x), wet = step(0.5, uStuff.x) * (1.0 - water);
  // (A heap of loose sand has no clean edge: it thins out to scattered grains on the skin round it, and its
  // surface is lumpy.)
  float rise = vLocal.y / uSize.y, lumps = lrNoise(vLocal.xz * 260.0 + 5.0), bits = lrNoise(vLocal.xz * 620.0 + vLocal.y * 300.0);
  if (water < 0.5 && rise < 0.3 * lrNoise(vLocal.xz * 900.0 + 2.0) + 0.1 * lumps) discard;
  n = normalize(n + (1.0 - water) * (0.8 * vec3(lumps - 0.5, 0.0, lrNoise(vLocal.zx * 260.0 + 9.0) - 0.5) + 0.5 * vec3(bits - 0.5, 0.0, lrNoise(vLocal.zx * 620.0 + 1.0) - 0.5)));
  float lit = lrShadow(vRel, n);
  // Sand: every grain its own shade, a few of them shell-white, and the heap's surface rough with them.
  float fine = lrNoise(vLocal.xz * 2600.0 + vLocal.y * 900.0), coarse = lrNoise(vLocal.xz * 700.0 + 3.0);
  vec3 grain = normalize(n + 0.28 * vec3(fine - 0.5, 0.0, lrNoise(vLocal.zx * 2600.0 + 7.0) - 0.5));
  // (Grains big enough to tell apart at arm's length: darker ones, and flakes of shell.)
  vec3 sand = vec3(0.7, 0.65, 0.56) * (0.78 + 0.2 * fine + 0.12 * coarse + 0.14 * bits) * (1.0 - 0.32 * step(0.8, bits)) + 0.2 * step(0.86, lrNoise(vLocal.xz * 480.0 + 11.0));
  sand *= mix(1.0, 0.56, wet);                                                            // (wet sand is darker by that much)
  vec3 col = sand * (uSunE * lrSaturate(dot(grain, uSunDir)) * lit + uSkyE * (0.5 + 0.5 * grain.y) + uSunE * max(uSunDir.y, 0.0) * 0.12 * vec3(0.76, 0.7, 0.6)) / PI;
  col += wet * uSunE * lit * 0.5 * pow(lrSaturate(dot(reflect(-V, grain), uSunDir)), 60.0);  // and glistens
  // Water in the palm: the skin seen through it, the sky in it, the sun's glint off it.
  float fresnel = 0.02 + 0.98 * pow(1.0 - lrSaturate(dot(n, V)), 5.0);
  // (Its surface trembles, so the sky shows in it brokenly even looking straight down, and it is brightest round its rim.)
  float tremble = lrNoise(vLocal.xz * 180.0 + uTime * 3.0), rim = smoothstep(0.55, 0.15, rise);
  // (Clear water a few millimetres deep: mostly the palm seen through it, a little darker for being wet.)
  float sky = max(fresnel, 0.05 + 0.14 * tremble * tremble + 0.22 * rim);
  vec3 pool = vec3(0.5, 0.37, 0.29) * (uSunE * lrSaturate(uSunDir.y) * lit + uSkyE) / PI * (1.0 - sky) + sky * uSkyE / PI * 1.5
            + uSunE * lit * (4.0 * pow(lrSaturate(dot(reflect(-V, normalize(n + 0.12 * vec3(tremble - 0.5, 0.0, lrNoise(vLocal.zx * 180.0 - uTime * 2.6) - 0.5))), uSunDir)), 500.0) + 0.02 * rim);
  outColor = vec4(mix(col, pool, water), -1000.0);
}`;

// What lies in the hand, as the palm simulation has it (sim/palm.js): a sheet over the palm, a vertex a cell.
const lyingVertex = /* glsl */`
#include <lr_common>
in vec2 aLocal;      // where on the palm (u, v)
in vec2 aShift;      // how fast what lies on top here is moving (m/s, along u and v): the grains drawn on it are carried with it
in float aDepth;     // how deep the stuff lies here (m)
out vec3 vRel;
out vec3 vNormal;
out vec3 vLocal_;
out float vDepth;
out vec2 vRun;
void main() {
  vRel = position; vNormal = normal; vLocal_ = vec3(aLocal.x, aDepth, aLocal.y); vDepth = aDepth; vRun = aShift;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const lyingFragment = /* glsl */`
#include <lr_common>
${shadowGLSL}
uniform vec2 uStuff;        // 0 dry sand, 1 wet sand, 2 water; how much of a handful
in vec3 vRel;
in vec3 vNormal;
in vec3 vLocal_;
in float vDepth;
in vec2 vRun;
layout(location = 0) out vec4 outColor;
void main() {
  float water = step(1.5, uStuff.x), wet = step(0.5, uStuff.x) * (1.0 - water);
  // Where sand is running, the grains drawn on it run with it. A pattern carried on and on is drawn out into
  // streaks; so it is carried for six tenths of a second and begun again, in two turns half a beat apart, each
  // pixel taking one of the two by how far through its turn that one is. Where nothing moves the two are the same.
  float beat = fract(uTime / 0.6), turn = lrHash12(gl_FragCoord.xy) < 1.0 - abs(2.0 * beat - 1.0) ? beat : fract(beat + 0.5);
  vec3 vLocal = vec3(vLocal_.x - vRun.x * turn * 0.6 * (1.0 - water), vLocal_.y, vLocal_.z - vRun.y * turn * 0.6 * (1.0 - water));
  // Where it thins out to nothing its edge is ragged: the last grains lie scattered on the skin.
  float lumps = lrNoise(vLocal.xz * 260.0 + 5.0), bits = lrNoise(vLocal.xz * 620.0 + 3.0), fine = lrNoise(vLocal.xz * 2600.0);
  if (vDepth < mix(0.0004 + 0.0011 * bits, 0.0006, water)) discard;
  vec3 n = normalize(vNormal), V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  if (dot(n, V) < 0.0) n = -n;
  n = normalize(n + (1.0 - water) * (0.55 * vec3(lumps - 0.5, 0.0, lrNoise(vLocal.zx * 260.0 + 9.0) - 0.5) + 0.4 * vec3(bits - 0.5, 0.0, lrNoise(vLocal.zx * 620.0 + 1.0) - 0.5)));
  float lit = lrShadow(vRel, n);
  // Sand: grains big enough to tell apart at arm's length, darker ones, flakes of shell.
  // (Each grain its own shade: a cell of two thirds of a millimetre is a grain; some are dark, a few are shell.)
  float grain = lrHash12(floor(vLocal.xz * 1500.0) + 5.0), thin = 1.0 - smoothstep(0.0005, 0.004, vDepth);
  vec3 sand = vec3(0.62, 0.57, 0.49) * (0.72 + 0.4 * grain + 0.1 * bits) * (1.0 - 0.35 * step(0.9, lrHash12(floor(vLocal.xz * 1500.0) + 41.0))) + 0.22 * step(0.94, lrHash12(floor(vLocal.xz * 700.0) + 11.0));
  sand *= mix(1.0, 0.56, wet) * (1.0 - 0.12 * thin);
  vec3 bounce = uSunE * max(uSunDir.y, 0.0) * 0.12 * vec3(0.76, 0.7, 0.6);
  vec3 col = sand * (uSunE * lrSaturate(dot(n, uSunDir)) * lit + uSkyE * (0.5 + 0.5 * n.y) + bounce) / PI;
  col += wet * uSunE * lit * 0.5 * pow(lrSaturate(dot(reflect(-V, n), uSunDir)), 60.0);
  // Water: the palm seen through it (darker the deeper), the sky in it, the sun's glint; its surface trembles.
  float tremble = lrNoise(vLocal.xz * 180.0 + uTime * 3.0), fresnel = 0.02 + 0.98 * pow(1.0 - lrSaturate(dot(n, V)), 5.0), shallow = 1.0 - smoothstep(0.0, 0.003, vDepth);
  // (Water in a hand is seen by the sky in it and by the bright line where it climbs the skin at its edge: without
  // those it was only a wet palm.)
  float rim = smoothstep(0.0006, 0.0012, vDepth) * (1.0 - smoothstep(0.0012, 0.0032, vDepth));
  float sky = max(fresnel, 0.12 + 0.16 * tremble * tremble + 0.25 * shallow + 0.5 * rim);
  vec3 pool = vec3(0.5, 0.37, 0.29) * exp(-vDepth * 30.0) * (uSunE * lrSaturate(uSunDir.y) * lit + uSkyE) / PI * (1.0 - sky) + sky * uSkyE / PI * 1.5
            + uSunE * lit * 4.0 * pow(lrSaturate(dot(reflect(-V, normalize(n + 0.12 * vec3(tremble - 0.5, 0.0, lrNoise(vLocal.zx * 180.0 - uTime * 2.6) - 0.5))), uSunDir)), 500.0);
  outColor = vec4(mix(col, pool, water), -1000.0);
}`;

/**
 * Water held in her hand, drawn over the hand itself (the overlay pass: it lets the skin through). It is seen as
 * water in a palm is: by the skin under it a shade darker, the sky lying flat in it, the sun's spark, and the
 * bright line where it climbs the skin at its edge. Its edge is where its level meets her skin: the surface is
 * drawn on under the skin, which hides it.
 */
const poolFragment = /* glsl */`
#include <lr_common>
${shadowGLSL}
in vec3 vRel;
in vec3 vNormal;
in vec3 vLocal_;
in float vDepth;
in vec2 vRun;
layout(location = 0) out vec4 outColor;
void main() {
  if (vDepth < -0.0001) discard;
  vec3 V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  // (Never quite still: it trembles with the hand that holds it, and more where it runs.)
  float run = min(length(vRun) * 6.0, 1.0);
  float t1 = lrNoise(vLocal_.xz * 150.0 + uTime * vec2(1.7, 2.3)), t2 = lrNoise(vLocal_.zx * 150.0 - uTime * vec2(2.1, 1.3));
  vec3 n = normalize(vNormal + (0.035 + 0.12 * run) * vec3(t1 - 0.5, 0.0, t2 - 0.5));
  if (dot(n, V) < 0.0) n = -n;
  float lit = lrShadow(vRel, n), facing = lrSaturate(dot(n, V)), fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  vec3 R = reflect(-V, n);
  float deep = lrSaturate(vDepth / 0.007), toSun = lrSaturate(dot(R, uSunDir));
  // The line at its edge: the water climbs the skin there and turns the sky to you.
  float edge = smoothstep(0.0, 0.0003, vDepth) * (1.0 - smoothstep(0.0003, 0.0012, vDepth));
  float mirror = max(fresnel, 0.045) + 0.22 * edge;
  vec3 sky = uSkyE / PI * mix(1.7, 1.0, lrSaturate(R.y));
  vec3 sun = uSunE * lit * (pow(toSun, 900.0) * 30.0 + pow(toSun, 40.0) * 0.12);
  // What is under it: seen through, a little darker the deeper it lies.
  float dark = 0.05 + 0.13 * deep;
  float cover = min(mirror + dark, 0.9);
  outColor = vec4(mirror * sky + sun + dark * vec3(0.02, 0.05, 0.06) * (uSunE * lit * lrSaturate(uSunDir.y) + uSkyE) / PI, cover);
}`;

export class Hand {
  /**
   * @param {object} o
   * @param {import('./spray.js').Spray} o.spray
   * @param {{touch: Function}} o.sound
   * @param {(x: number, z: number, when: number, strength: number) => void} o.ring  a ring on the water
   * @param {number} o.shadowTaps
   */
  /** @param {object} o  ...; side: 1 your right hand (the default), -1 your left */
  constructor({ spray, sound, ring, shadowTaps = 8, patch = null, side = 1, falling = null }) {
    this.side = side;
    /** world/falling.js: what falls from this hand is let go into it grain by grain (without it: ribbons). */
    this.falling = falling; this.slots = [null, null, null]; this.owing = [0, 0, 0, 0];
    /** `patch`: () => the sand round you as real sand (sim/patch.js), or null: then what the hand does is drawn as stamps. */
    Object.assign(this, { spray, sound, ring, patch: patch || (() => null) });
    // What is in the palm: a low dome, sized and laid in the hand every frame.
    const rings = 10, sides = 24, pos = [], nor = [], idx = [];
    for (let j = 0; j <= rings; j++) for (let i = 0; i <= sides; i++) {
      const t = j / rings * Math.PI / 2, a = i / sides * 2 * Math.PI, p = [Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a)];
      pos.push(...p); nor.push(...p);
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) { const a = j * (sides + 1) + i, b = a + sides + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geometry.setIndex(idx);
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.shadow], { uSize: { value: new THREE.Vector3(1, 1, 1) }, uStuff: { value: new THREE.Vector2() } }),
    }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.visible = false;
    // The streams between the fingers: ribbons turned to the eye, rebuilt every frame from where each part of
    // them left the hand and how long it has been falling since.
    const verts = GAPS * SAMPLES * 2, sIdx = [];
    this.sPos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sUV = new THREE.BufferAttribute(new Float32Array(verts * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.sInfo = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    for (let g = 0; g < GAPS; g++) for (let j = 0; j < SAMPLES - 1; j++) { const a = (g * SAMPLES + j) * 2; sIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const ribbons = new THREE.BufferGeometry();
    ribbons.setAttribute('position', this.sPos); ribbons.setAttribute('aUV', this.sUV); ribbons.setAttribute('aInfo', this.sInfo); ribbons.setIndex(sIdx);
    this.streams = new THREE.Mesh(ribbons, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: streamVertex, fragmentShader: streamFragment, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.shadow], { uWater: { value: 0 } }),
    }));
    this.streams.frustumCulled = false; this.streams.matrixAutoUpdate = false; this.streams.visible = false;
    // What lies in the hand, when the hand is the real one: the palm simulation, and a sheet drawn from it.
    this.sim = new Palm(); this.rates = [0, 0, 0];
    const cells = NU * NV, local = new Float32Array(cells * 2), quads = [];
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { local[(j * NU + i) * 2] = U0 + (i + 0.5) * CELL; local[(j * NU + i) * 2 + 1] = V0 + (j + 0.5) * CELL; }
    for (let j = 0; j + 1 < NV; j++) for (let i = 0; i + 1 < NU; i++) { const a = j * NU + i, b = a + NU; quads.push(a, b, a + 1, a + 1, b, b + 1); }
    this.lPos = new THREE.BufferAttribute(new Float32Array(cells * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.lNor = new THREE.BufferAttribute(new Float32Array(cells * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.lDepth = new THREE.BufferAttribute(new Float32Array(cells), 1).setUsage(THREE.DynamicDrawUsage);
    const sheet = new THREE.BufferGeometry();
    this.lShift = new THREE.BufferAttribute(new Float32Array(cells * 2), 2).setUsage(THREE.DynamicDrawUsage);
    sheet.setAttribute('position', this.lPos); sheet.setAttribute('normal', this.lNor); sheet.setAttribute('aDepth', this.lDepth); sheet.setAttribute('aShift', this.lShift); sheet.setAttribute('aLocal', new THREE.BufferAttribute(local, 2)); sheet.setIndex(quads);
    this.lying = new THREE.Mesh(sheet, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: lyingVertex, fragmentShader: lyingFragment, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.shadow], { uStuff: { value: new THREE.Vector2() } }),
    }));
    this.lying.frustumCulled = false; this.lying.matrixAutoUpdate = false; this.lying.visible = false;
    // (Water in her own hand: the same sheet, drawn see-through over the hand. For the overlay scene.)
    this.pool = new THREE.Mesh(sheet, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: lyingVertex, fragmentShader: poolFragment, side: THREE.DoubleSide, depthWrite: false, transparent: true, defines: { LR_SHADOW_TAPS: shadowTaps },
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.shadow], {}),
    }));
    this.pool.frustumCulled = false; this.pool.matrixAutoUpdate = false; this.pool.visible = false; this.pool.renderOrder = -1;
    this.trail = Array.from({ length: GAPS }, () => []);
    this.count = shared.uTouchSeg.value.length;
    /** Her own hand (handpose.js HandModel), once the body has come: this hand then holds itself by every joint. */
    this.model = null; this.poses = [0, 1, 2].map(() => new Array(POSE_LENGTH)); this.memo = { way: null, step: 0 };
    /** What it is doing, from moment to moment (handact.js). */
    this.motion = new HandMotion();
    // Each hand has its own chance, begun again whenever the hand is: the same doing gives the same grains.
    // (Both drew on the one sequence the splashes of your feet draw on, never begun again: what a hand let fall
    // depended on everything done since the page was opened.)
    let seed = 0;
    this.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    this.seed = s => { seed = s >>> 0; };
    this.reset();
  }

  /** At your side, empty, and the sand as you found it. */
  reset() {
    Object.assign(this, {
      ik: 0,              // 0 at your side .. 1 where it is working
      lift: 0,            // 0 down at the ground .. 1 held up before you
      grip: 0,            // 0 open .. 1 closed on what it took
      down: false,        // on the ground (or in the water) now
      landed: 0,          // when it came down
      kind: 'dry',        // what it is on, or holds: 'dry' sand, 'wet' sand, 'water'
      amount: 0,          // how much of a handful it holds
      owed: 0,            // grains not yet let go (a fraction of one carried over)
      empty: 0,           // how long it has been empty, held up
      tip: null, from: null, speed: 0, mark: -1, heap: null, spot: null,
      spoke: 0, ringed: 0, wet: 0, sand: 0, floor: 0, at: null,
      pushed: -1, epoch: 0, bounce: 0, lastK: null, pour: null, tipped: 0, rest: 0, rake: 0, took: false, aimAt: null, aimSpeed: 0,
    });
    this.motion?.reset(); this.takeAt = null; this.far = 0.45;
    if (this.trail) for (const t of this.trail) t.length = 0;
    if (this.streams) this.streams.visible = false;
    if (this.lying) this.lying.visible = false;
    if (this.pool) this.pool.visible = false;
    this.sim?.empty(); this.open = 0.3; this.real = false; this.upHeld = null; this.edgeBy = null; this.wantOpen = 0; this.manual = false; this.dumping = false; this.tipBy = this.rollBy = 0; this.pressFor = 0; this.pressHeld = false;
    this.seed?.(this.side > 0 ? 24680 : 13579);
    // The account of what this hand has taken and let go since it was last begun again, in cubic metres: `taken`
    // from the ground or the sea (in `takes` handfuls); `out` of the hand in all, of which through each of the
    // three `gaps`, over the `edge`, `spilt` at once, and left `stuck` on the skin; `sand` handed to the patch of sand to land there, and
    // `sea` let fall into the sea. (What is still in the hand is `amount` handfuls.)
    this.ledger = { takes: 0, taken: 0, out: 0, gaps: [0, 0, 0], edge: 0, spilt: 0, stuck: 0, sand: 0, sea: 0 };
    // (The marks in the sand are one list for both hands.)
    Hand.marks = 0; shared.uTouchCount.value = 0; if (this.side > 0) shared.uLeg.value[2].z = 0;
    if (this.mesh) this.mesh.visible = false;
  }

  /** How far it is down at the sand, 0..1: you lean in over it, and come up as it comes up. */
  get low() { const p = this.motion.phase; return this.motion.landed || p === 'reach' ? 1 : p === 'lift' ? 1 - this.lift : 0; }

  /** A new mark in the sand at (x, z): returns its place in the list. */
  stamp(x, z, time, kind, a, b) {
    const i = Hand.marks++ % this.count;
    shared.uTouchSeg.value[i].set(wrap64(x), wrap64(z), wrap64(x), wrap64(z));
    shared.uTouchInfo.value[i].set(time, kind, a, b);
    shared.uTouchCount.value = Math.min(Hand.marks, this.count);
    return i;
  }

  /**
   * Before the body is posed: what the hand is to do this frame. Returns poseBody's `touch`, or null.
   * @param {number} dt
   * @param {object} c  want (the button is held), canReach (crouched, on sand or in shallow water), open (how far
   *   the fingers are parted, 0..1), together (0..1: your other hand holds something too),
   *   headTurn (radians your head is turned on your body, to the right positive), going (how fast you are walking, m/s),
   *   settling (metres your shoulders still have to come down or forward before you are where you are reaching from), time, look,
   *   body (eye height over your feet), feet (their height), x, z, cy, sy (cos and sin of your heading),
   *   groundAt(x, z), surf (the sea surface here), wetAt(x, z, ground): whether the sand there is wet
   */
  plan(dt, c) {
    const m = this.motion, has = this.amount > 0.02 && (m.phase === 'hold' || m.phase === 'lift');
    if (dt > 0) {
      // The button while the hand holds something is not "down again" (that threw the handful away): held, the
      // hand is yours to tip with the mouse; pressed and let go within a quarter of a second, it lets it all go.
      if (c.want) { if (!(this.pressFor > 0)) this.pressHeld = has; this.pressFor = (this.pressFor || 0) + dt; }
      else { if (this.pressFor > 0 && this.pressFor < 0.25 && this.pressHeld && has) { this.dumping = true; m.dump(); } this.pressFor = 0; this.pressHeld = false; }
    }
    const going = c.want && c.canReach && !this.pressHeld;
    this.steering = !!(c.want && this.pressHeld && has);
    if (dt > 0) {
      // Tipped by you: the mouse pushed away tips the fingers down (as far as thirty degrees; ten the other way),
      // sideways rolls the hand that way (twenty degrees). Let go, it comes level again in a second.
      if (this.steering && c.steerBy) { this.tipBy = Math.min(0.52, Math.max(-0.17, (this.tipBy || 0) - c.steerBy[1] * 0.004)); this.rollBy = Math.min(0.35, Math.max(-0.35, (this.rollBy || 0) + c.steerBy[0] * 0.004)); }
      else if (!this.steering) { const k = Math.exp(-dt / 0.3); this.tipBy = (this.tipBy || 0) * k; this.rollBy = (this.rollBy || 0) * k; }
      // Down it goes (the last of what it held is let fall).
      if (going && this.lift > 0.5 && this.amount > 0) this.spill(c.time);
      // What the hand is doing and how far along it is (handact.js): it reaches as an arm reaches, slowly off,
      // fastest a third of the way and gently down; rests where it lands; drawn along (your look moving) it stays
      // open and rakes; rested a fifth of a second it digs in and gathers a handful, and from then it finishes;
      // let go, it comes up, and is held until what it took has run out, and a moment more.
      // (Whether it is being drawn along is judged by your look, not by the fingertip: that moves as the fingers
      // close, and the hand would open again at its own closing.)
      m.step(dt, { going, moving: (this.aimSpeed || 0) > 0.05, kind: this.kind, holds: this.amount > 0.004, emptyFor: this.empty, far: this.ik > 0 ? this.far : 0.45 + 0.3 * (c.seated ?? (c.sitting ? 1 : 0)) });
      // (A reaching hand is fastest two fifths of the way and takes longer to arrive than to set off: the way there is bent to that.)
      this.ik = 1 - (1 - clamp01(m.go.x)) ** 1.35; this.lift = 1 - (1 - clamp01(m.lift.x)) ** 1.3; this.grip = clamp01(m.close.x); this.rake = m.rake; this.rest = m.still;
    }
    // (The elbow goes a step at a time from where it was: half a turn a second at most. A hand at rest has no such past.)
    this.memo.step = dt * Math.PI;
    if (m.phase === 'reach' || m.phase === 'idle') this.memo.ground = null;        // (a new place on the ground)
    if (this.ik <= 0) { this.aimAt = null; this.aimSpeed = 0; this.memo.way = null; return null; }
    // Where: on the line of your look, as far as the arm goes. (In dry sand the fingers go in; on wet sand they
    // press on it; in water the hand goes to the bottom if that is within a hand's length, or under by that much.)
    // (Sitting, your legs lie where it would go: it works beside your right thigh.)
    // (`seated`: how far you are on to your seat, 0..1: the hand's places go over from the one posture's to the other's, not at a jump.)
    const seated = c.seated ?? (c.sitting ? 1 : 0), ahead = c.eyeAt ? Math.max(0, -c.eyeAt[2]) : 0, far = Math.min(0.6 + 0.25 * ahead - 0.15 * seated, Math.max(0.3, ahead + Math.cos(c.look) * c.body / Math.max(0.25, -Math.sin(c.look)))), lx0 = this.side * (0.1 + 0.23 * seated);
    // It goes where you look: your head turns on your body (c.headTurn, to the right positive), and the hand's
    // place turns with it about you, so that drawing your look across the sand draws your fingers through it.
    // (Since the body stopped turning with every look, the hand had stayed where it was whatever you looked at.)
    // Seated, a hand only goes outward from beside its thigh: your legs lie the other way.
    let aim = Math.max(-0.95, Math.min(0.95, c.headTurn || 0));
    if (seated > 0) aim += ((this.side > 0 ? Math.max(aim, 0) : Math.min(aim, 0)) - aim) * seated;
    const ca = Math.cos(aim), sa = Math.sin(aim);
    let lx = lx0 * ca + far * sa, lz = lx0 * sa - far * ca, wx = c.x + lx * c.cy - lz * c.sy, wz = c.z + lx * c.sy + lz * c.cy;
    // (Once it has begun to take a handful the place is that place, in the world: looking away does not drag the
    // hand off through the sand. And as the fingers gather, they are drawn back towards you a hand's breadth.)
    if (m.committed || m.phase === 'closed') {
      this.takeAt ??= [wx, wz]; [wx, wz] = this.takeAt;
      lx = (wx - c.x) * c.cy + (wz - c.z) * c.sy; lz = -(wx - c.x) * c.sy + (wz - c.z) * c.cy;
    } else if (m.phase !== 'lift') this.takeAt = null;
    const g = c.groundAt(wx, wz), depth = Math.max(c.surf - g, 0);
    { const pull = 0.055 * m.drag.x, vx = this.side * 0.16 - lx, vz = 0.05 - lz, l = Math.hypot(vx, vz) || 1; lx += vx / l * pull; lz += vz / l * pull; }
    // (How far the hand has to go from where it rests: a longer reach takes longer.)
    // (Seated it is not far, but the hand has to turn over from lying on your thigh: that takes as long.)
    this.far = Math.hypot(lx - this.side * 0.15, 0.3 - 0.22 * seated, lz + 0.05 + 0.15 * seated) + 0.3 * seated;
    if (!this.down && this.lift < 0.05 && this.amount < 0.02) this.kind = depth > 0.015 ? 'water' : c.wetAt(wx, wz, g) ? 'wet' : 'dry';
    // How fast you are drawing it along: by how your look is moving (and you with it), at arm's length. (Not by
    // where the hand is: as you lean down to the sand that place creeps for a third of a second, which counted as
    // raking, and every handful began with the fingers ploughing a hollow twice its size.)
    if (dt > 0) {
      const view = c.yaw + (c.headTurn || 0), was = this.aimAt, swing = was ? Math.abs(Math.atan2(Math.sin(view - was[0]), Math.cos(view - was[0]))) + Math.abs(c.look - was[1]) : 0;
      this.aimSpeed = was ? 0.6 * swing / dt + (c.going || 0) : 0; this.aimAt = [view, c.look];
    }
    // (Raking, the fingers are bent like the tines of a rake and go a finger's breadth into dry sand, half that into wet.)
    // (Landing, the fingertips go a centimetre into dry sand; digging, as far again; wet sand gives a third of that.)
    // (Gathering, the fingers come up again under what they have taken: the closed hand, rolled on to its edge,
    // lies in the sand a finger deep, not buried to the wrist. It was: the hollow it left was four handfuls.)
    const rake = this.rake || 0, dug = clamp01(m.dig.x), gathered = clamp01(m.drag.x), y = this.kind === 'water' ? Math.max(g + 0.004, c.surf - 0.17) : this.kind === 'dry' ? g - 0.01 - 0.009 * dug - 0.008 * rake + 0.034 * gathered : g - 0.003 - 0.005 * dug - 0.005 * rake + 0.028 * gathered;
    this.at = { x: wx, z: wz, ground: g, depth };
    // Held up: where a person holds a handful to watch it. The upper arm hangs by your side and the forearm lies
    // out before the lower chest, the hand a forearm's length from your eyes and below them; squatting, the
    // hand is between your knees (your shoulders are then hardly above them, and an arm held out over them is
    // an arm held up in the air: so it was, the hand out at the height of your face). It comes a little higher
    // when you look less far down.
    const sl = Math.sin(c.look), cl = Math.cos(c.look), held = clamp01(this.lift * 2 - 1);
    // (Her own eye, where her head carries it: crouched it is a hand's breadth ahead of where she stands, and a
    // handful held "before her eyes" is held before those.)
    const L = [0, sl, -cl], U = [0, cl, sl], eye = c.eyeAt ? c.eyeAt.slice() : [0, c.body, 0];
    const raise = 0.12 * clamp01((c.look + 0.95) / 0.7), low = c.low || 0;
    // (Seated you lean back: it is held out beside your thigh, the elbow still bent.)
    // (`together`: both your hands hold something. Then they come together before you, side by side, little
    // fingers almost touching, the palms turned a little towards each other: one bowl of two hands.)
    const tog = c.together || 0, real = !!this.model;
    // (And it lies across you, the wrist out to its own side and the fingers pointing in towards your other hand:
    // what falls between the fingers then falls clear of the forearm, where you can see it. Held straight out
    // from the elbow, the forearm lay between your eye and all that fell.)
    const up = real ? [eye[0] + this.side * (0.13 - 0.03 * low) * (1 - tog) + this.side * 0.062 * tog, eye[1] - 0.34 + 0.01 * low + raise * (1 - 0.5 * low), eye[2] - 0.22 - 0.02 * low]
      : [eye[0] + this.side * (0.13 + 0.03 * low - 0.072 * tog), eye[1] - 0.4 + raise + 0.2 * low, eye[2] - 0.27 + 0.03 * low - 0.03 * tog];
    // (For tests: a place and a turn to try, in place of the squatting one: Hand.tune = { x, y, z, inward }.)
    if (real && Hand.tune) { up[0] = eye[0] + this.side * Hand.tune.x; up[1] = eye[1] + Hand.tune.y; up[2] = eye[2] + Hand.tune.z; }
    const down = real ? [eye[0] + this.side * (0.27 - 0.2 * tog), eye[1] - 0.4 + raise, eye[2] - 0.2 - 0.1 * tog] : [eye[0] + this.side * (0.27 - 0.208 * tog), eye[1] - 0.36 + raise, eye[2] - 0.15 - 0.15 * tog];
    const wrist = [0, 1, 2].map(i => up[i] + (down[i] - up[i]) * seated);
    // (Held up, it comes most of the way round with your look: you hold a handful where you can watch it. Less
    // far when you squat: it is between your knees.)
    // (Water less far still: swung out to the side the arm cannot hold the palm level, and it was all spilt by
    // looking round. You turn your head; the cupped hand comes a little way and waits.)
    const hb = (this.kind === 'water' ? 0.4 : 0.7) * aim, chb = Math.cos(hb), shb = Math.sin(hb), round_ = v => [v[0] * chb - v[2] * shb, v[1], v[0] * shb + v[2] * chb];
    { const r = round_([wrist[0] - eye[0], 0, wrist[2] - eye[2]]); wrist[0] = eye[0] + r[0]; wrist[2] = eye[2] + r[2]; }
    // (Squatting, it is between your knees: carried round to one side with your look, it comes up over the knee.)
    if (real) { const out = clamp01((Math.abs(wrist[0] - eye[0]) - 0.08) / 0.07), over = out * out * (3 - 2 * out) * low * (1 - seated); wrist[1] += Math.max(0, eye[1] - 0.2 - wrist[1]) * over; }
    // (A hand held out is never quite still: it rises and falls a little with your breath.)
    wrist[1] += 0.003 * Math.sin(c.time * 1.45 + this.side); wrist[0] += 0.0015 * Math.sin(c.time * 0.83 + 1 + this.side);
    // (Nor ever without the fine tremble every held-out hand has, a fifth of a millimetre nine times a second;
    // and it comes up half a centimetre as what it holds runs out: an arm holds a lighter hand higher.)
    { const t = c.time, w = 2 * Math.PI, lighter = this.began > 0 ? clamp01(1 - this.amount / this.began) : 0;
      wrist[1] += 0.00018 * Math.sin(w * 9.3 * t + this.side) + 0.00008 * Math.sin(w * 11.1 * t) + (this.kind === 'water' ? 0.002 : 0.005) * lighter * this.lift; wrist[0] += 0.00012 * Math.sin(w * 8.7 * t + 2); wrist[2] += 0.0012 * Math.sin(t * 0.61 + 2 * this.side); }
    // (No lower than the arm can hold it level, crouched: above your knees.)
    if (!real) wrist[1] = Math.max(wrist[1], Math.min(c.body - 0.22, 0.36));
    // How far the fingers are parted: as you have set them (the wheel), wide while you send it all down.
    // By itself: the hand comes up closed, holds its handful about a second, and then parts its fingers little
    // by little, as far as keeps the stuff running at the pace that empties the hand in a quarter of a minute
    // (wider as there is less of it left to push through). Parted by you (the wheel, Q / E), they are yours for
    // the rest of that handful. Let go of altogether (a short click), wide. (`c.open`: a tool's own setting.)
    if (dt > 0) {
      if (c.openBy && has) { this.manual = true; this.wantOpen = clamp01((this.wantOpen ?? this.open) + c.openBy); }
      if (m.phase === 'hold' && this.amount > 0.002) this.heldFor = (this.heldFor || 0) + dt; else if (m.phase !== 'hold') { this.heldFor = 0; if (!has) { this.manual = false; this.dumping = false; this.wantOpen = 0; } }
      if (c.open !== undefined) this.wantOpen = c.open;
      else if (this.dumping) this.wantOpen = 1;
      else if (!this.manual && m.phase === 'hold') {
        if (this.heldFor < 1.0) this.wantOpen = 0;
        else {
          const pace = (this.began || 1) / (this.kind === 'dry' ? 16 : this.kind === 'wet' ? 19 : 14), err = (pace - (this.running_ || 0)) / pace;
          this.wantOpen = clamp01((this.wantOpen || 0) + Math.max(-1.5, Math.min(1, err)) * dt * 0.22);
        }
      }
      this.open += (clamp01(this.wantOpen ?? 0) - this.open) * (1 - Math.exp(-dt * 8));
    }
    let dir, palm, cupped, spread;
    if (this.real) {
      // What it holds obeys the hand (sim/palm.js), so the hand is held to the world, not to your eye: level
      // while the fingers are together; with them parted it tips forward, slowly and further the longer it
      // pours (faster the wider they are), as a hand does to keep sand running; closed again, it comes level.
      // (No further than a wrist will let it: it used to tip until the wrist was bent back eighty degrees.)
      if (dt > 0) this.tipped = this.open > 0.05 && this.amount > 0.002 && held > 0.9 ? Math.min(0.32, this.tipped + dt * (0.06 + 0.4 * this.open)) : Math.max(0, this.tipped - dt * 1.2);
      const tipBy = (this.tipBy || 0) * held, rollBy = (this.rollBy || 0) * held;
      // (Water is carried level, the fingertips a shade up: tipped as sand is held, a hand keeps none. It tips as
      // the fingers part, and less far: water needs no coaxing.)
      const wet_ = this.kind === 'water', tip = (wet_ ? 0.12 + (0.16 * this.open + 0.5 * this.tipped) * held : (0.06 + 0.12 * this.open + 0.6 * this.tipped) * held) + tipBy, st = Math.sin(tip), ct = Math.cos(tip);
      // The fingers point ahead and a little towards your other hand, as a forearm lying across you points them;
      // the palm is up, tilted a little towards your other hand: a forearm turns no further. (It was tilted the
      // other way, outward: turned further than a forearm goes.) Together, the fingers of both point straight
      // ahead (they do not cross) and the palms lean more towards each other: one bowl.
      // (Seated, it is out beside your thigh: the forearm lies outward and the fingers with it.)
      const inward = (0.6 * (1 - seated) - 0.25 * seated) * (1 - tog), lean = (wet_ ? 0.06 : -0.005) + 0.1 * tog - this.side * rollBy;
      const turnIn = Hand.tune ? Hand.tune.inward : inward;
      dir = [-Math.sin(turnIn) * this.side * ct, -st, -Math.cos(turnIn) * ct];
      const k = dir[1], n0 = (v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; })([-dir[0] * k, 1 - dir[1] * k, -dir[2] * k]);
      const a0 = [(dir[1] * n0[2] - dir[2] * n0[1]) * this.side, (dir[2] * n0[0] - dir[0] * n0[2]) * this.side, (dir[0] * n0[1] - dir[1] * n0[0]) * this.side];      // (across the palm, towards the thumb)
      palm = [0, 1, 2].map(i => n0[i] * Math.cos(lean) - a0[i] * Math.sin(lean)); cupped = 0.5 - 0.12 * this.open; spread = this.lift * this.open;
    } else {
      // (The figure of tubes: the palm up and turned a little towards you, tipping forward as it empties.)
      const tip = 0.25 + 0.3 * (1 - this.amount) * held;
      dir = [-0.3 * this.side, L[1] * 0.92 + U[1] * 0.12, L[2] * 0.92 + U[2] * 0.12]; palm = [0.06 * this.side, U[1] - L[1] * tip, U[2] - L[2] * tip];
      cupped = 0.5 - 0.16 * (1 - this.amount); spread = this.lift * (this.kind === 'water' ? 0.3 : 0.5) * (0.15 + 0.85 * (1 - this.amount));
    }
    const full = this.grip;
    this.cupped = cupped;
    // Her own hand, joint by joint (handpose.js). On the ground the pads come down a little apart and the fingers
    // close on what they take (in water, a flat hand cups); drawn along, they are bent like the tines of a rake.
    // Held up it is a bowl, the fingers together and the thumb along the first of them; parted as you part them.
    let fingers = null;
    if (this.model?.poses) {
      // (Each attitude by its name, as handact.js asks for it: `cup` is the hand that holds, a bowl with the fingers
      // together, parted as you part them; in water a flat hand goes in and a tighter bowl comes out.)
      const P = this.model.poses, water = this.kind === 'water', o = this.open, bowl = this.poses[1];
      const attitude = name => {
        if (name === 'cup') return o < 0.3 ? mixPose(water ? P.cupWater : P.cup, P.sift, o / 0.3, bowl) : mixPose(P.sift, P.siftWide, (o - 0.3) / 0.7, bowl);
        return water ? ({ contact: P.flat, dig: P.flat, rake: P.flat, closed: P.cupWater })[name] || P[name] : P[name];
      };
      fingers = m.fingers(dt, attitude);
      // Held up, the fingers are a living hand's: each drifts a degree or so by itself, slowly; and when the sand
      // has stopped running they work it, one finger down as the next comes up, a few degrees, twice a second.
      if (this.lift > 0.5) {
        const t = c.time, work = (this.worked || 0) * (water ? 0 : 1), live = clamp01(this.lift * 2 - 1);
        fingers = fingers.slice();
        for (let n = 0; n < 4; n++) {
          const drift = 1.2 * Math.sin(t * (0.9 + 0.31 * n) + 1.7 * n + this.side) + 0.7 * Math.sin(t * (2.3 + 0.4 * n) + n) + 0.7 * Math.sin(t * (5.1 + 0.7 * n) + 2.3 * n + this.side), ply = 3.2 * work * Math.sin(2 * Math.PI * 2.1 * t + n * Math.PI);
          fingers[MCP + n] += (drift + ply) * live * Math.PI / 180; fingers[PIP + n] += (0.5 * drift - 0.6 * ply) * live * Math.PI / 180; fingers[DIP + n] += 0.3 * drift * live * Math.PI / 180;
        }
      }
    }
    return {
      fingers,
      // (`settle`: how far your shoulders still have to come down: the solver puts the hand over the place it will
      // reach when they have, so it comes down on that place and does not slide to it through the sand.)
      at: [lx, y - c.feet, lz], settle: c.settling || 0, amount: this.ik, lift: this.lift, wrist, dir: round_(dir), palm: round_(palm),
      // (`eased`: how far along it is, is already as an arm goes: the solver takes it as it is. `turn`: how far the
      // palm has rolled over, which begins in the sand as the fingers gather, before the hand leaves it.)
      eased: true, turn: clamp01(m.turn.x), level: this.kind === 'water' ? gathered : 0, keepLevel: this.kind === 'water' && this.amount > 0.002,
      // (Her own hand comes down on the sand tipped forward, the pads of the fingers first, not laid flat: more
      // tipped into water, less on wet sand and when it rakes. `memo`: where its elbow was, for the solver.)
      // (Water is carried level whatever the forearm does: the wrist gives as far as that takes, as one carrying a bowl.)
      // (And sand lies on a level palm or slides off it: held at 26 degrees, as it was, the palm stood tipped back
      // twelve, heel down, and a third of every handful ran off at the wrist. Forty, as one carrying a tray.)
      back: Math.min(60, (this.kind === 'water' ? 48 : 40 + 14 * clamp01((this.tipped || 0) / 0.32)) + 40 * Math.abs(this.tipBy || 0)),
      incline: real ? (this.kind === 'water' ? 0.65 : this.kind === 'dry' ? 0.55 : 0.42) * (1 - 0.4 * rake) + 0.25 * seated : 0, memo: this.memo,
      // (On the ground the fingers close on what they take; held up they are cupped.)
      curl: (this.kind === 'water' ? 0.1 + 0.38 * full + 0.2 * rake : this.kind === 'dry' ? 0.34 + 0.4 * full + 0.5 * rake : 0.16 + 0.5 * full + 0.5 * rake) * (1 - this.lift) + cupped * this.lift, spread: Math.max(spread, 0.45 * rake * (1 - this.lift)),
    };
  }

  /** What the hand held is let fall at once (it was sent down again). */
  spill(time) {
    if (this.pour) this.release(this.amount, time, 0.25);
    this.ledger.out += this.amount * HANDFUL; this.ledger.spilt += this.amount * HANDFUL;
    this.amount = 0; this.sim.empty();
  }

  /**
   * After the body is posed: the marks, the grains, the drops, the sounds.
   * @param {number} dt
   * @param {object} c  as for plan(), and: joints (from poseBody), world(q): a point of the body in the world,
   *   turn(v): a direction of it, eye (the camera: x, y, z), material (the body's, for the wet and sandy hand)
   */
  act(dt, c) {
    const touching = this.side > 0 ? c.joints.touching : c.joints.touchingL, tip = touching ? c.world(touching.tip) : null, sandy = this.kind !== 'water', time = c.time;
    if (tip && dt > 0) this.speed = this.tip ? Math.hypot(tip[0] - this.tip[0], tip[2] - this.tip[2]) / dt : 0;
    // (A frame drawn without time passing, for a picture, changes nothing in what the hand is doing.)
    // (And a hand that has begun to take a handful finishes, though you have let go.)
    const pressing = (c.want && c.canReach) || this.motion.committed || (dt === 0 && this.down);
    // (It has landed when the tip of the middle finger is within two fingers' breadth of the ground it is reaching
    // for; in water, at once. It used to go by the wrist, a hand's breadth up: but how far the wrist is above the
    // fingertip depends on how the hand is held, and her own hand, its knuckles bent, holds it higher.)
    const reached = this.down || !sandy || !touching || !this.at || touching.tip[1] - (this.at.ground - c.feet) < 0.046;
    if (tip && this.ik >= 1 && this.lift <= 0 && pressing && reached) {
      const seg = shared.uTouchSeg.value, info = shared.uTouchInfo.value;
      if (!this.down) {
        // It lands: a pat, or a plop and a ring; on sand, a hand's print to begin with.
        this.down = true; this.landed = time; this.from = tip; this.spoke = time; this.took = false;
        this.sound.touch(this.kind, 'down');
        if (sandy) this.mark = this.stamp(tip[0], tip[2], time, 1, c.yaw, 0);
        else { this.ring(tip[0], tip[2], time, 0.45); this.ringed = time; this.mark = -1; }
      } else if (sandy && this.mark >= 0) {
        // Drawn along, the fingers leave their furrows: the stroke follows the hand, and a new one begins every
        // few centimetres so that a curve is drawn as it was made. (A hand that has moved less than its own
        // width has only pressed.) Drawn towards you or away, the four fingers each plough their own furrow;
        // drawn sideways they follow one another in a single one.
        const far = Math.hypot(tip[0] - this.from[0], tip[2] - this.from[2]), stroke = info[this.mark];
        if (stroke.y > 0.5 && far > 0.025) { stroke.y = 0; stroke.x = time; }
        if (stroke.y < 0.5) {
          seg[this.mark].z = wrap64(tip[0]); seg[this.mark].w = wrap64(tip[2]);
          if (far > 0.004) stroke.w = Math.abs(((tip[0] - this.from[0]) * c.sy - (tip[2] - this.from[2]) * c.cy) / far);
          if (far > 0.05) { const spread = stroke.w; this.from = tip; this.mark = this.stamp(tip[0], tip[2], time, 0, c.yaw, spread); }
        }
      }
      // The fingers have closed: the handful is taken. Out of the sand it leaves a hollow with their gouges in
      // it (where the hand had only pressed, not where it was drawn along).
      if (this.grip >= 1 && !this.took) {
        this.took = true; this.amount = 1; this.owed = 0; this.empty = 0; this.heap = this.spot = null; this.epoch = time;
        // (A hand closed on dry sand has a little more than it can keep: heaped, an eighth over, which spills from
        // the edges of the palm as it comes up and opens.)
        const heaped = this.model ? (this.kind === 'dry' ? 1.12 : this.kind === 'wet' ? 1.05 : 1) : 1;
        this.sim.shape(0.5, 0); this.sim.fill(this.kind, HANDFUL * heaped); this.worked = 0; this.amount = this.sim.amount; this.fresh = this.kind === 'water'; this.settling = this.kind !== 'water'; this.began = 0; this.running_ = 0; this.manual = false; this.dumping = false; this.wantOpen = 0; this.heldFor = 0;
        this.ledger.takes++; this.ledger.taken += this.amount * HANDFUL;
        this.sound.touch(this.kind, 'take');
        if (sandy && this.mark >= 0 && info[this.mark].y > 0.5) { info[this.mark].set(time, 4, c.yaw, this.kind === 'dry' ? 1 : 0.7); this.mark = -1; }
        if (!sandy) this.ring(tip[0], tip[2], time, 0.3);
        // (Out of real sand: the handful's volume, from under the palm and the fingers.)
        // (The furrows the fingers draw as they close, running back from where their tips went in to a bowl
        // under the palm: one mark, as a hand makes it.)
        // (Her own fingers have ploughed most of the hollow already, going in and drawing back: the patch presses
        // down under her skin. What is taken out here is the rest of the handful's worth, under the palm.)
        if (sandy) { const w = c.world(touching.wrist), long = Math.hypot(tip[0] - w[0], tip[2] - w[2]) || 1; this.patch()?.scoop(tip[0], tip[2], (tip[0] - w[0]) / long, (tip[2] - w[2]) / long, this.side, -HANDFUL * (this.model ? (this.kind === 'dry' ? 0.4 : 0.3) : (this.kind === 'dry' ? 1 : 0.75)), 0.12); }
      }
      if (this.speed > 0.06 && time - this.spoke > 0.13) { this.sound.touch(this.kind, 'drag', this.speed); this.spoke = time; }
      if (!sandy && this.speed > 0.12 && time - this.ringed > 0.28) { this.ring(tip[0], tip[2], time, 0.3); this.ringed = time; }
      // What it carries away: the sea wets it and rinses it; wet sand clings; dry sand clings to a wet hand only.
      if (dt > 0) {
        if (!sandy) { this.wet = 1; this.sand = Math.max(0, this.sand - dt * 3); }
        else if (this.kind === 'wet') { this.wet = Math.max(this.wet, 0.55); this.sand = Math.min(0.7, this.sand + dt * 1.5); }
        else this.sand = Math.min(this.wet > 0.3 ? 1 : 0.3, this.sand + dt * 1.2);
      }
    } else if (this.down && dt > 0) {
      // It leaves the ground. With nothing taken (a touch only): a few drops, or grains, fall back from it.
      this.down = false;
      this.sound.touch(this.kind, 'up');
      const at = tip || this.tip;
      if (at && this.amount < 0.02) {
        this.spray.drip(wrap64(at[0]), this.floor + 0.1, wrap64(at[2]), this.floor, time + 0.05, sandy ? (this.kind === 'dry' ? 22 : 5) : 18, !sandy, sandy ? 0.5 : 0.9);
        if (!sandy) for (const later of [0.25, 0.55]) this.ring(at[0] + 0.03 * later, at[2] - 0.02 * later, time + later, 0.2);
      }
    }
    this.tip = tip;
    if (this.at) this.floor = this.kind === 'water' ? c.surf : this.at.ground;
    if (this.side > 0) shared.uLeg.value[2].set(tip ? wrap64(tip[0]) : 0, tip ? wrap64(tip[2]) : 0, tip && this.down && !sandy ? 1 : 0, this.speed);

    // Held up: what is in the palm, and its running out between the fingers.
    const palm = touching?.palm;
    let running = 0;
    this.pour = null; this.mesh.visible = false;
    if (!palm || this.lift <= 0.25) this.lastK = null;
    this.real = !!palm?.us || (this.real && !palm);
    this.lying.visible = false; this.pool.visible = false;
    // (A frame drawn without time passing, for a picture, keeps the shade the streams had.)
    if (dt > 0) for (let g = 0; g < 3; g++) shared.uStream.value[(this.side > 0 ? 0 : 3) + g].w = 0;
    // (Water is in the hand from the moment it is taken: it is seen as the hand comes up through the surface.)
    if (palm?.us && (this.lift > 0.25 || (!sandy && this.motion.took && (this.fresh || this.amount > 0.002)))) running = this.hold(dt, c, palm);
    else if (palm && this.lift > 0.25) {
      const stuff = STUFF[this.kind], K = c.world(palm.knuckles), f = c.turn(palm.f), N = c.turn(palm.N), A = c.turn(palm.A);
      // (Sand beds itself into the palm; water lies on it.)
      const lift = sandy ? 0.006 : 0.0125, middle = [K[0] - f[0] * 0.04 + N[0] * lift, K[1] - f[1] * 0.04 + N[1] * lift, K[2] - f[2] * 0.04 + N[2] * lift];
      // Where it lands: on the ground under the hand, or on the sea if that is deeper there than a finger.
      const ground = c.groundAt(K[0], K[2]), sea = c.surf - ground > 0.01, floor = sea ? c.surf : ground;
      // (What leaves the hand leaves with the hand's own motion.)
      const v = this.lastK && dt > 0 ? [0, 1, 2].map(i => Math.max(-1.5, Math.min(1.5, (K[i] - this.lastK[i]) / dt))) : [0, 0, 0];
      this.lastK = K;
      this.pour = { K, f, N, A, floor, sea, ground, v, wetGround: !sea && c.wetAt(K[0], K[2], ground) };
      if (this.amount > 0.004) {
        // The heap (or the pool) in the palm: smaller as it goes.
        const k = Math.cbrt(this.amount), r = sandy ? 0.013 + 0.024 * k : 0.014 + 0.024 * Math.sqrt(this.amount), h = sandy ? 0.003 + 0.019 * k : 0.004 + 0.004 * this.amount;
        const m = this.mesh;
        m.matrix.set(A[0] * r, N[0] * h, f[0] * r * 1.1, middle[0] - c.eye.x, A[1] * r, N[1] * h, f[1] * r * 1.1, middle[1], A[2] * r, N[2] * h, f[2] * r * 1.1, middle[2] - c.eye.z, 0, 0, 0, 1);
        m.matrixWorld.copy(m.matrix);
        m.material.uniforms.uSize.value.set(r, h, r * 1.1); m.material.uniforms.uStuff.value.set(this.kind === 'dry' ? 0 : this.kind === 'wet' ? 1 : 2, this.amount);
        m.visible = true;
        if (dt > 0 && this.lift > 0.8) {
          // It runs out: fast at first, slower as the heap goes down (the last of it clings). Sent down with
          // the button while you stand, the hand opens and lets it all go three times as fast.
          const rate = stuff.rate * (0.3 + 0.7 * Math.sqrt(this.amount)) * (c.want && !c.canReach ? 3 : 1), gone = Math.min(this.amount, rate * dt);
          running = Math.min(1, rate / stuff.rate);
          this.release(gone, time, dt);
          this.amount -= gone; this.ledger.out += gone * HANDFUL; this.ledger[this.pour.sea ? 'sea' : 'sand'] += gone * HANDFUL;
          if (this.amount <= Math.max(stuff.left, 0.004)) { this.amount = 0; this.empty = 0; this.sound.touch(this.kind, 'up'); }
          if (sandy) this.sand = Math.min(1, Math.max(this.sand, this.kind === 'wet' ? 0.7 : 0.3)); else this.wet = 1;
          if (time - this.spoke > 0.085) { this.sound.touch(this.kind, 'pour', rate / stuff.rate); this.spoke = time; }
        }
      } else if (dt > 0) this.empty += dt;
    }
    // (Her own hand lets sand go grain by grain, world/falling.js; ribbons are for the figure of tubes, and for water still.)
    const grains = this.falling && this.real;
    this.flow(dt, c, !grains && running > 0 && this.kind !== 'wet' ? this.pour : null, running);
    // (A wet hand dries in a minute or so in this sun and wind; dry sand falls off it sooner.)
    if (dt > 0 && !this.down && this.amount < 0.02) { this.wet = Math.max(0, this.wet - dt / 70); this.sand = Math.max(0, this.sand - dt / (this.wet > 0.3 ? 60 : 6)); }
    const which = this.side > 0 ? 1 : 0, wrist = c.joints.wrists[which], end = c.joints.fingertips[which], u = c.material.uniforms;
    if (wrist && end) {
      const mid = c.world([(wrist[0] + end[0]) / 2, (wrist[1] + end[1]) / 2, (wrist[2] + end[2]) / 2]);
      (this.side > 0 ? u.uHandWet : u.uHandWetL).value.set(mid[0] - c.eye.x, mid[1], mid[2] - c.eye.z, this.wet);
      (this.side > 0 ? u.uHandSand : u.uHandSandL).value = this.sand;
    }
  }

  /**
   * The real hand, held up with something in it: the palm simulation moves on, what lies in the hand is drawn
   * from it, and what fell through each gap is handed to the streams and to whatever is below. Returns how
   * strongly it is running (0..1).
   */
  hold(dt, c, palm) {
    const { sim } = this, time = c.time, sandy = this.kind !== 'water', stuff = STUFF[this.kind];
    const f = c.turn(palm.f), N = c.turn(palm.N), A = c.turn(palm.A), K = c.world(palm.knuckles), centre = c.world(palm.centre);
    // (The palm's skin is a few millimetres off the plane of its bones.)
    const O = [centre[0] + N[0] * 0.007, centre[1] + N[1] * 0.007, centre[2] + N[2] * 0.007], at = (u, v, w) => [O[0] + A[0] * u + f[0] * v + N[0] * w, O[1] + A[1] * u + f[1] * v + N[1] * w, O[2] + A[2] * u + f[2] * v + N[2] * w];
    const ground = c.groundAt(K[0], K[2]), sea = c.surf - ground > 0.01, floor = sea ? c.surf : ground;
    const v = this.lastK && dt > 0 ? [0, 1, 2].map(i => Math.max(-1.5, Math.min(1.5, (K[i] - this.lastK[i]) / dt))) : [0, 0, 0];
    this.lastK = K;
    if (palm.caps) {
      // Her fingers as they are, in the palm's own frame: what lies in the hand lies on them, and the gaps between
      // them are the gaps there are. (`palm` is in the body's frame, as the rig gives it.)
      const o = palm.centre, pA = palm.A, pf = palm.f, pN = palm.N, local = p => { const d = [p[0] - o[0] - pN[0] * 0.007, p[1] - o[1] - pN[1] * 0.007, p[2] - o[2] - pN[2] * 0.007]; return [d[0] * pA[0] + d[1] * pA[1] + d[2] * pA[2], d[0] * pf[0] + d[1] * pf[1] + d[2] * pf[2], d[0] * pN[0] + d[1] * pN[1] + d[2] * pN[2]]; };
      // (And her skin itself, where it is: what she holds lies on that, in the hollow her palm really makes.)
      const skin = palm.skin?.();
      if (skin) sim.setSkin(skin.pos, skin.tri, [o[0] + pN[0] * 0.007, o[1] + pN[1] * 0.007, o[2] + pN[2] * 0.007], pA, pf, pN);
      sim.setHand(palm.caps.fingers.map(rods => ({ pts: [rods[0].a, rods[1].a, rods[2].a, rods[2].b].map(local), hw: rods.map(q => q.w), th: rods.map(q => q.t) })), this.open, palm.half, palm.us);
    } else sim.shape(this.cupped ?? 0.45, this.open, palm.half, palm.us);
    // (When what it holds has stopped running though the fingers are apart, the fingers work it: sand lying on
    // a palm tipped no further than a wrist will tip it stands still at its own slope. Worked, it runs on. The
    // hand used to tip on until the wrist was bent back eighty degrees, to keep it running.)
    sim.work = this.worked || 0;
    const under = g => { const q = this.slotAt?.[g] || sim.gapAt(g), p = at(q[0], q[1], -0.016); return p; };
    this.pour = { K, f, N, A, floor, sea, ground, v, wetGround: !sea && c.wetAt(K[0], K[2], ground), gaps: [under(0), under(1), under(2)] };
    let running = 0;
    // Water: the hand holds what a hand of its shape holds, held as it is. Under the sea it is full to that; out
    // of it, the water is its own (it runs to the low side, rocks, seeps between the fingers) from the moment the
    // hand comes up through the surface, not from when the arm has stopped.
    const up = [A[1], f[1], N[1]], submerged = !sandy && sea && O[1] < c.surf + 0.004;
    this.upNow = up;
    if (!sandy && dt > 0 && this.fresh) {
      // (Until it is out of the sea the handful counts as a whole one: what it is, is known when it comes out.)
      if (up[2] > 0.6 || this.lift > 0.8) sim.flood(HANDFUL, up[2] > 0.3 ? up : [0, 0, 1]);
      if (!submerged && (up[2] > 0.6 || this.lift > 0.8)) { this.ledger.taken += (sim.amount - this.amount) * HANDFUL; this.amount = sim.amount; this.fresh = false; }
    }
    // Sand: a handful is what her hand holds. What was dug is more than lies on a palm: on its way out of the
    // ground what would not lie on it, held as the hand will hold it, was never lifted. (Half of every handful
    // used to slide off the side of the palm in the first second it was held up.)
    if (sandy && this.settling && dt > 0 && palm.caps) {
      const held = this.upHeld || [0.05, -0.1, 0.994];
      for (let n = 0, most = this.kind === "wet" ? 320 : 110; n < most; n++) sim.step(1 / 60, held);
      this.ledger.taken += (sim.amount - this.amount) * HANDFUL; this.amount = sim.amount; this.settling = false;
      sim.runU.fill(0); sim.runV.fill(0);
    }
    if (dt > 0 && this.motion.phase === 'hold' && (this.heldFor || 0) > 0.4 && this.open < 0.03 && !this.steering && Math.abs(this.tipBy || 0) < 0.01) this.upHeld = up.slice();
    if (dt > 0 && (sandy ? this.lift > 0.8 : !this.fresh && !submerged) && this.amount > 0.002) {
      // (Worked, what lies in the hollow of the palm is rocked towards the fingers: the sim takes the palm as tipped a
      // little further than it is drawn. A level palm keeps the last third of a handful in its hollow for good.)
      // (And it lies as a thing lies in a hand that is moving: a hand that starts off sideways leaves what it
      // holds behind a little, one that stops sends it on. The hand's own quickening, eased over a twentieth of a
      // second and no more than six tenths of gravity, is added to which way is down.)
      const acc = this.accel ??= [0, 0, 0], was = this.lastV || v, ka = 1 - Math.exp(-dt / 0.05);
      for (let i = 0; i < 3; i++) acc[i] += (Math.max(-5.9, Math.min(5.9, (v[i] - was[i]) / dt)) - acc[i]) * ka;
      this.lastV = v;
      // (Water she carries as one carries a full cup: the wrist gives against every start and stop, and two thirds
      // of them never reach the water. Turning to look round used to throw it out of her hand.)
      const give = sandy ? 1 : 0.3, upx = give * acc[0] / 9.81, upy = 1 + give * acc[1] / 9.81, upz = give * acc[2] / 9.81;
      const rock = 0.14 * (this.worked || 0), lie = [A[0] * upx + A[1] * upy + A[2] * upz, f[0] * upx + f[1] * upy + f[2] * upz - rock, N[0] * upx + N[1] * upy + N[2] * upz], ll = Math.hypot(lie[0], lie[1], lie[2]) || 1;
      // (A hand turned over holds nothing: it all falls, from wherever it lay.)
      // (Water in a cupped hand does not go over its side for a few degrees: a hand is a deeper cup than this
      // one's skin is drawn, and gives. Tipped on purpose, it pours as it should.)
      if (!sandy) for (const i of [0, 1]) { const x = Math.abs(lie[i] / ll); lie[i] *= Math.min(1, Math.max(0.3, (x - 0.04) / 0.12)); }
      const out = up[2] < 0.3 ? sim.shed(dt) : sim.step(dt, [lie[0] / ll, lie[1] / ll, lie[2] / ll]), through = out.gaps[0] + out.gaps[1] + out.gaps[2], gone = (through + out.edge) / HANDFUL;
      this.amount = sim.amount;
      // (How fast it is running, handfuls a second, eased over half a second: what the fingers go by.)
      this.running_ = (this.running_ || 0) + (gone / dt - (this.running_ || 0)) * (1 - Math.exp(-dt / 0.5));
      if (!(this.began > 0)) this.began = this.amount + gone;
      if (this.falling && sandy) this.emit(dt, c, out, at, v, floor);
      if (this.falling && !sandy) this.drip(dt, c, out, at, v, floor, sea);
      // (Where each gap is letting go, for where it lands and for the next frame's streams.)
      this.slotAt ??= [null, null, null];
      for (let g = 0; g < 3; g++) if (out.slots[g].n > 0) this.slotAt[g] = [out.slots[g].u, out.slots[g].v];
      for (let g = 0; g < 3; g++) this.ledger.gaps[g] += out.gaps[g];
      // (Where it went over the edge, for tools: off the fingertips, the thumb's side, the little finger's, the heel.)
      if (out.edge > 0 && !out.shed) { const e = this.edgeBy ??= { tips: 0, thumb: 0, little: 0, heel: 0 }; e[out.at[1] > 0.07 ? 'tips' : out.at[1] < -0.02 ? 'heel' : out.at[0] > 0 ? 'thumb' : 'little'] += out.edge; }
      this.ledger.edge += out.edge; this.ledger.out += through + out.edge + (out.skin || 0); this.ledger.stuck += out.skin || 0; this.ledger[sea ? 'sea' : 'sand'] += through + out.edge;
      // How hard each gap is running (a stream at full strength carries a twentieth of a handful a second).
      for (let g = 0; g < 3; g++) this.rates[g] += (clamp01(out.gaps[g] / dt / (HANDFUL * 0.05)) - this.rates[g]) * (1 - Math.exp(-dt * 14));
      running = Math.max(...this.rates);
      // (Each stream's shade on the ground: terrain.js. Sand: a few drops of water cast none worth drawing.)
      if (sandy && !sea) for (let g = 0; g < 3; g++) { const p = this.pour.gaps[g]; shared.uStream.value[(this.side > 0 ? 0 : 3) + g].set(wrap64(p[0]), wrap64(p[2]), Math.max(p[1] - floor, 0.02), 0.34 * Math.sqrt(this.rates[g])); }
      { const stalled = this.open > 0.05 && this.kind !== 'water' && gone * HANDFUL / dt < 3.5e-6 * (0.4 + 2 * this.open); this.worked = this.dumping ? 1 : clamp01((this.worked || 0) + (stalled ? dt / 1.2 : -dt / 5)); }
      if (gone > 0) {
        // Where it lands: under the gaps it fell through, a third of a second later.
        const fall = Math.sqrt(Math.max(K[1] - floor, 0.01) / 4.9), r = this.random, patch = this.patch(), blown = this.carried(fall, c);
        for (let g = 0; g < 3; g++) if (out.gaps[g] > 0) {
          const p = [this.pour.gaps[g][0] + blown[0], this.pour.gaps[g][1], this.pour.gaps[g][2] + blown[1]];
          if (sea || (!sandy && this.falling)) continue;
          if (sandy) patch?.pour(p[0], p[2], 0.012, out.gaps[g] * (this.kind === 'dry' ? 1 : 0.75), this.kind === 'wet' && !this.pour.wetGround ? out.gaps[g] / HANDFUL * 5 : 0, fall, time);
          else patch?.pour(p[0], p[2], 0.035, 0, out.gaps[g] / HANDFUL * 7, fall, time);
        }
        if (out.edge > 0) {
          const p = out.shed ? at(0, 0.01, 0) : at(out.at[0], out.at[1], out.at[2] || 0);
          if (!sea) { if (sandy) patch?.pour(p[0], p[2], out.shed ? 0.035 : 0.02, out.edge, 0, fall, time); else if (!this.falling) patch?.pour(p[0], p[2], 0.04, 0, out.edge / HANDFUL * 7, fall, time); }
          // (What goes over the edge of the hand goes as loose grains, or drops.)
          if (!this.falling) this.owed += out.edge / HANDFUL * stuff.things;
          for (; this.owed >= 1; this.owed--) this.spray.put(wrap64(p[0] + (r() - 0.5) * 0.02), p[1], wrap64(p[2] + (r() - 0.5) * 0.02), floor, time + dt * r(), [v[0] + (r() - 0.5) * 0.08, -0.05 - 0.2 * r(), v[2] + (r() - 0.5) * 0.08], stuff.size[0] + (stuff.size[1] - stuff.size[0]) * r() * r(), !sandy);
        }
        if (sea && (sandy || !this.falling) && time - this.ringed > (sandy ? 0.3 : 0.16)) { const p = this.pour.gaps[1]; this.ring(p[0] + (r() - 0.5) * 0.05, p[2] + (r() - 0.5) * 0.05, time + fall, sandy ? 0.1 : 0.2); this.ringed = time; }
        if (sandy) this.sand = Math.min(1, Math.max(this.sand, this.kind === 'wet' ? 0.7 : 0.3)); else this.wet = 1;
        // (Water that leaves as drops is heard drop by drop, as each lands: drip().)
        if (time - this.spoke > 0.085 && (sandy || !this.falling)) { this.sound.touch(this.kind, 'pour', clamp01(gone / dt / 0.2)); this.spoke = time; }
      }
      // (The last of it stays on the skin: the account has it as `stuck`.)
      // (And when the last of it has stopped running, a dusting or a wet palm, that is the end of it: the hand was
      // held out for ever over a third of a millilitre that would not go.)
      this.still = this.amount < 0.03 && gone * HANDFUL / dt < 2e-8 ? (this.still || 0) + dt : 0;
      if (this.amount <= Math.max(stuff.left * 0.3, 0.004) || this.still > 1.2) { const rest = this.amount * HANDFUL; this.ledger.out += rest; this.ledger.stuck += rest; this.amount = 0; sim.empty(); this.empty = 0; this.sound.touch(this.kind, 'up'); }
    } else if (dt > 0) {
      for (let g = 0; g < 3; g++) this.rates[g] *= Math.exp(-dt * 14);
      if (this.amount <= 0.004) this.empty += dt;
    }
    // What lies in the hand: a vertex a cell, on top of the stuff; its slope from its neighbours.
    if (this.amount > 0.002) {
      const pos = this.lPos.array, nor = this.lNor.array, depth = this.lDepth.array, shift = this.lShift.array, s = sim.s, fl = sim.floor;
      // Water in her own hand: its surface where there is more than a film of it, and drawn on past its edge at
      // the level it has there, four cells into the dry: under the skin, which hides it. So its edge is where its
      // level meets her skin, not the edge of a cell. (`depth` below nothing: not drawn.)
      const pooled = !sandy && this.real, lev = pooled ? (this.lev ??= new Float32Array(NU * NV)) : null;
      if (pooled) {
        for (let k = 0; k < lev.length; k++) { const wet = fl[k] === fl[k] && s[k] > 0.0006; lev[k] = wet ? fl[k] + s[k] : NaN; depth[k] = wet ? s[k] : -1; }
        for (let pass = 0; pass < 4; pass++) {
          const was = lev.slice();
          for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
            const k = j * NU + i;
            if (was[k] === was[k]) continue;
            let low = Infinity;
            if (i > 0 && was[k - 1] < low) low = was[k - 1];
            if (i + 1 < NU && was[k + 1] < low) low = was[k + 1];
            if (j > 0 && was[k - NU] < low) low = was[k - NU];
            if (j + 1 < NV && was[k + NU] < low) low = was[k + NU];
            if (low < Infinity) { lev[k] = low; depth[k] = 0; }
          }
        }
      }
      const top = pooled ? k => lev[k] : k => (Number.isNaN(fl[k]) ? 0 : fl[k] + s[k]);
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const k = j * NU + i, here = top(k), p = at(U0 + (i + 0.5) * CELL, V0 + (j + 0.5) * CELL, pooled ? (here === here ? here : -0.03) : Number.isNaN(fl[k]) ? -0.02 : here + (sandy ? 0 : 0.0008));
        pos[k * 3] = p[0] - c.eye.x; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2] - c.eye.z;
        if (!pooled) depth[k] = Number.isNaN(fl[k]) ? 0 : s[k];
        shift[k * 2] = sim.runU[k]; shift[k * 2 + 1] = sim.runV[k];
        const or = (q, mine) => { const t = top(q); return t === t ? t : mine; }, mine = here === here ? here : 0;
        const du = (or(k + (i + 1 < NU ? 1 : 0), mine) - or(k - (i > 0 ? 1 : 0), mine)) / (2 * CELL), dv = (or(k + (j + 1 < NV ? NU : 0), mine) - or(k - (j > 0 ? NU : 0), mine)) / (2 * CELL);
        const n = [N[0] - A[0] * du - f[0] * dv, N[1] - A[1] * du - f[1] * dv, N[2] - A[2] * du - f[2] * dv], l = Math.hypot(n[0], n[1], n[2]) || 1;
        nor[k * 3] = n[0] / l; nor[k * 3 + 1] = n[1] / l; nor[k * 3 + 2] = n[2] / l;
      }
      this.lPos.needsUpdate = this.lNor.needsUpdate = this.lDepth.needsUpdate = this.lShift.needsUpdate = true;
      this.lying.material.uniforms.uStuff.value.set(this.kind === 'dry' ? 0 : this.kind === 'wet' ? 1 : 2, this.amount);
      this.lying.visible = !submerged && !pooled; this.pool.visible = !submerged && pooled;
    }
    return running;
  }

  /**
   * Water leaving the hand (`out`: sim/palm.js stepWater). What seeps through a gap gathers under the fingers
   * there, and hangs: a drop that grows until it is too heavy to hang (four and a half hundredths of a
   * millilitre, a bead 4.4 mm across; sooner if the hand is jolted), lets go, and leaves a little of itself
   * behind for the next. Coming faster than drops can form, it runs as a thread, a bead every frame. What goes
   * over the edge of the hand falls from there the same way. Every drop lands by itself: a ring on the sea where
   * it goes in, a dark spot on dry sand. `at(u, v, w)`: a place on the palm in the world.
   */
  drip(dt, c, out, at, v, floor, sea) {
    const F = this.falling, r = this.random, time = c.time, hang = this.hang ??= [0, 0, 0, 0], full = this.full ??= [4.5e-8, 4.5e-8, 4.5e-8, 4.5e-8];
    const jolt = Math.hypot(...(this.accel || [0, 0, 0])) / 9.81;
    const fall = (p, volume) => {
      const size = Math.cbrt(6 * volume / Math.PI), land = F.put(p[0], p[1], p[2], v[0] + (r() - 0.5) * 0.02, Math.min(v[1], 0) - 0.02, v[2] + (r() - 0.5) * 0.02, time - r() * dt, floor, size, 0.9, 1, 4);
      const x = p[0] + v[0] * land, z = p[2] + v[2] * land, speed = Math.min(4, 9.81 * land);
      if (sea) this.ring(x, z, time + land, Math.min(0.45, 0.06 + 2.2 * Math.sqrt(volume * 1e6 * speed) * 0.1));
      else this.patch()?.pour(x, z, 0.005 + size, 0, Math.min(1.2, volume / 4.5e-8 * 0.8), land, time);
      this.drops = (this.drops || 0) + 1; this.lastDrop = { x, z, when: time + land, volume, sea };
      if (volume > 6e-9 && time - (this.plinked || -1) > 0.045) { this.sound.touch('water', 'drop', land); this.plinked = time; }
    };
    const site = (i, inflow, p) => {
      if (!(inflow > 0) && hang[i] <= 0) return;
      hang[i] += inflow;
      const rate = inflow / dt;
      if (rate > 5e-7) {
        // (Too fast for drops to form: a thread, which breaks into beads as it falls.)
        const each = Math.max(1.2e-8, rate / 75), n = Math.min(6, Math.floor(hang[i] / each));
        for (let k = 0; k < n; k++) fall(p, each);
        hang[i] -= n * each;
      } else if (hang[i] >= full[i] / (1 + 1.5 * jolt)) {
        const gone = 0.85 * hang[i];
        fall(p, gone); hang[i] -= gone; full[i] = 4.5e-8 * (0.8 + 0.4 * r());
        // (Now and then a small bead follows the drop.)
        if (r() < 0.35) { const little = Math.min(hang[i] * 0.5, 3e-9); if (little > 2e-10) { fall([p[0], p[1] + 0.002, p[2]], little); hang[i] -= little; } }
      }
    };
    for (let g = 0; g < 3; g++) { const sl = out.slots[g], q = this.sim.gapAt(g); site(g, out.gaps[g], sl.n > 0 ? at(sl.u, sl.v, sl.w - 0.017) : this.dripAt?.[g] || at(q[0], q[1], -0.016)); if (sl.n > 0) (this.dripAt ??= [])[g] = at(sl.u, sl.v, sl.w - 0.017); }
    site(3, out.edge, out.edge > 0 ? (this.dripEdge = at(out.at[0], out.at[1], -0.004)) : this.dripEdge || at(0, 0, 0));
  }

  /**
   * What ran out of the hand this frame (`out`: sim/palm.js step), let go as grains (world/falling.js). Through
   * each gap it falls as a curtain: along the gap between two fingers, a couple of centimetres of it, and as
   * thin as the gap is wide; every grain with the hand's own motion and a little of its own, born somewhere
   * within the frame at where the gap was then, so that a moving hand leaves no steps in what it pours. Dry sand
   * is twelve thousand grains to the cubic centimetre, each drawn (or one in four, standing for four); wet sand
   * goes in clots. `at(u, v, w)`: a place on the palm in the world; `v`: the hand's velocity; `floor`: where it lands.
   */
  emit(dt, c, out, at, v, floor) {
    const F = this.falling, r = this.random, time = c.time, dry = this.kind === 'dry', sim = this.sim, share = dry ? F.share : 1, per = (dry ? 1.2e10 : 4e7) * share;
    const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const one = (p, dense, weight) => {
      let size, tau, kind = 3;
      if (dry) {
        // (Grains of all sizes about four tenths of a millimetre; three in a hundred are flakes of shell, two are dark.)
        const g = r() + r() + r() - 1.5, q = r();
        size = Math.min(0.0016, Math.max(0.00015, 0.0004 * Math.exp(0.9 * g))); kind = q < 0.03 ? 1 : q < 0.05 ? 2 : 0;
        // (In the thick of a stream the grains carry the air down with them, and it hardly slows them.)
        tau = kind === 1 ? 0.3 : grainTau(size) * (1 + 2 * dense);
        if (kind === 1) size *= 1.7;
      } else { size = 0.002 + 0.003 * r() * r(); tau = 0.9; }
      F.put(p[0], p[1], p[2], v[0] + (r() - 0.5) * 0.07, v[1] - 0.05 - 0.1 * r(), v[2] + (r() - 0.5) * 0.07, time - r() * dt, floor, size, tau, weight, kind, dense);
    };
    for (let g = 0; g < 3; g++) {
      if (!(out.gaps[g] > 0)) { this.slots[g] = null; continue; }
      // The slot: from just beyond the knuckles along the gap, under the fingers, which rise from the palm as they are cupped.
      // (Where the palm says it fell through: the stretch of the gap it left by, and under the fingers there.)
      const sl = out.slots?.[g], q = sim.gapAt(g), k0 = sim.knuckle + 0.003, wide = 0.0006 + 0.0022 * this.open;
      const end = sl && sl.n > 0 ? s => at(sl.u, sl.v0 + s * Math.max(sl.v1 - sl.v0, 0.004), sl.w - 0.012) : s => at(q[0], k0 + s * 0.014, -0.013 + s * 0.007), now = [end(0), end(1)], was = this.slots[g] || now;
      this.owing[g] += out.gaps[g] * per;
      let n = Math.floor(this.owing[g]);
      this.owing[g] -= n;
      // (No more than four hundred from a gap in a frame: beyond that each stands for more.)
      const weight = (n > 400 ? n / 400 : 1) / share; n = Math.min(n, 400);
      for (let k = 0; k < n; k++) {
        const s = r(), back = r(), p = lerp(lerp(now[0], now[1], s), lerp(was[0], was[1], s), back), a = (r() - 0.5) * wide, A = this.pour.A;
        one([p[0] + A[0] * a, p[1] + A[1] * a, p[2] + A[2] * a], this.rates[g], weight);
      }
      this.slots[g] = now;
    }
    if (out.shed) {
      // (Fallen off a hand turned over: from all over it, a cloud that draws out as it falls.)
      this.owing[3] += out.edge * per;
      let n = Math.floor(this.owing[3]);
      this.owing[3] -= n;
      const weight = (n > 500 ? n / 500 : 1) / share; n = Math.min(n, 500);
      for (let k = 0; k < n; k++) { const q = out.shed[Math.floor(r() * out.shed.length)], p = at(q[0] + (r() - 0.5) * CELL, q[1] + (r() - 0.5) * CELL, q[2] + 0.002); one(p, 0.35, weight); }
    } else if (out.edge > 0) {
      // (What goes over the edge of the hand goes as loose grains, from where it went over.)
      const p = at(out.at[0], out.at[1], out.at[2] || 0);
      this.owing[3] += out.edge * per;
      let n = Math.floor(this.owing[3]);
      this.owing[3] -= n;
      const weight = (n > 300 ? n / 300 : 1) / share; n = Math.min(n, 300);
      for (let k = 0; k < n; k++) one([p[0] + (r() - 0.5) * 0.016, p[1] + (r() - 0.5) * 0.004, p[2] + (r() - 0.5) * 0.016], 0.2, weight);
    }
  }

  /** Where the stream from gap i (0 between the first two fingers .. 2) leaves the hand. */
  gapAt(p, i) {
    if (p.gaps) return p.gaps[i];
    const a = [0.019, 0, -0.019][i];
    return [p.K[0] + p.A[0] * a + p.f[0] * 0.012 - p.N[0] * 0.011, p.K[1] + p.A[1] * a + p.f[1] * 0.012 - p.N[1] * 0.011, p.K[2] + p.A[2] * a + p.f[2] * 0.012 - p.N[2] * 0.011];
  }

  /**
   * The streams between the fingers. Each is remembered as the points at which it left the hand, a seventieth
   * of a second apart, with the moment and the motion it left with; each point has since fallen freely, and
   * the ribbon is drawn through where they are now: so a stream trails behind a moving hand, starts from the
   * hand when the pouring starts, and its tail falls away when it stops. As the handful goes, the streams
   * fail one after another, the last a thin trickle.
   * @param {object | null} pour  the hand's frame while it pours (this.pour), else null
   * @param {number} running  how fast, 0..1
   */
  /**
   * How far the breeze has carried what has been falling for `tau` seconds: [east, south, how fast it is going
   * with it now (0..1 of the breeze)]. Grains of sand take up the air's speed in a quarter of a second; water,
   * in drops and threads, hardly in a second. (c.wind: the breeze at hand height, m/s east and south.)
   */
  carried(tau, c) {
    const w = c.wind || [0, 0], tp = this.kind === 'water' ? 1.1 : 0.25, k = tau - tp * (1 - Math.exp(-tau / tp));
    return [w[0] * k, w[1] * k, 1 - Math.exp(-tau / tp)];
  }

  flow(dt, c, pour, running) {
    const time = c.time, eye = c.eye, water = this.kind === 'water', r = this.random, wind = c.wind || [0, 0];
    if (pour && dt > 0 && time - this.pushed >= 1 / 75) {
      this.pushed = time;
      for (let i = 0; i < GAPS; i++) {
        const k = pour.gaps ? this.rates[i] * (0.85 + 0.15 * Math.sin(time * (6 + i) + i * 2.1)) : running * clamp01((this.amount - [0.0, 0.1, 0.24][i]) / 0.12) * (0.8 + 0.2 * Math.sin(time * (6 + i) + i * 2.1));
        this.trail[i].unshift({ t: time, p: this.gapAt(pour, i), v: [pour.v[0] + pour.f[0] * 0.03, pour.v[1] - 0.08, pour.v[2] + pour.f[2] * 0.03], k, floor: pour.floor, sea: pour.sea });
        if (this.trail[i].length > SAMPLES - 1) this.trail[i].pop();
      }
    }
    const pos = this.sPos.array, uv = this.sUV.array, info = this.sInfo.array;
    let any = false, landed = null;
    for (let i = 0; i < GAPS; i++) {
      const trail = this.trail[i], base = i * SAMPLES * 2;
      let n = 0;
      // One point of the stream: two vertices, either side of it, on the line across the eye's view of its fall.
      const write = (x, y, z, vx, vy, vz, when, k, tau) => {
        const ex = eye.x - x, ey = eye.y - y, ez = eye.z - z;
        let sx = vy * ez - vz * ey, sy = vz * ex - vx * ez, sz = vx * ey - vy * ex;
        const sl = Math.hypot(sx, sy, sz) || 1, half = (water ? 0.0014 + 0.0012 * tau : 0.0012 + 0.0075 * tau) * (0.5 + 0.5 * k) / sl;
        sx *= half; sy *= half; sz *= half;
        for (const side of [-1, 1]) {
          const o = base + n * 2 + (side > 0 ? 1 : 0);
          pos[o * 3] = x - eye.x + sx * side; pos[o * 3 + 1] = y + sy * side; pos[o * 3 + 2] = z - eye.z + sz * side;
          uv[o * 2] = side; uv[o * 2 + 1] = when - this.epoch;
          info[o * 3] = k; info[o * 3 + 1] = tau; info[o * 3 + 2] = i;
        }
        n++;
      };
      // (The top of it is at the hand, wherever that is this very frame.)
      if (pour && trail.length) { const at = this.gapAt(pour, i), q = trail[0]; write(at[0], at[1], at[2], q.v[0], q.v[1], q.v[2], time, q.k, 0); }
      for (let j = 0; j < trail.length && n < SAMPLES; j++) {
        // (It falls, and the breeze leans it over: more the longer it has been falling.)
        const q = trail[j], tau = time - q.t, blown = this.carried(tau, c), x = q.p[0] + q.v[0] * tau + blown[0], z = q.p[2] + q.v[2] * tau + blown[1], y = q.p[1] + q.v[1] * tau - 0.5 * GRAVITY * tau * tau;
        if (y <= q.floor) {
          // It has landed: the stream ends here, and what was below this is forgotten.
          write(x, q.floor, z, q.v[0] + wind[0] * blown[2], q.v[1] - GRAVITY * tau, q.v[2] + wind[1] * blown[2], q.t, q.k, tau);
          trail.length = j === 0 && !pour ? 0 : j + 1;
          if (q.k > 0.05) landed = [x, q.floor, z, q.k, q.sea];
          break;
        }
        write(x, y, z, q.v[0] + wind[0] * blown[2], q.v[1] - GRAVITY * tau, q.v[2] + wind[1] * blown[2], q.t, q.k, tau);
      }
      if (n > 1) any = true;
      // (The rest of the ribbon is folded away into its last point.)
      const last = base + Math.max(n - 1, 0) * 2;
      for (let o = base + n * 2; o < base + SAMPLES * 2; o++) {
        pos[o * 3] = n ? pos[last * 3] : 0; pos[o * 3 + 1] = n ? pos[last * 3 + 1] : -1e4; pos[o * 3 + 2] = n ? pos[last * 3 + 2] : 0;
        info[o * 3] = 0; info[o * 3 + 1] = 0; info[o * 3 + 2] = i; uv[o * 2] = 0; uv[o * 2 + 1] = 0;
      }
    }
    this.sPos.needsUpdate = this.sUV.needsUpdate = this.sInfo.needsUpdate = true;
    this.streams.visible = any;
    this.streams.material.uniforms.uWater.value = water ? 1 : 0;
    // Where a stream lands: grains bounce and roll off the heap; drops leap from the sea.
    if (landed && dt > 0 && (!water || landed[4])) {
      this.bounce += dt * (water ? 26 : 45) * landed[3];
      for (; this.bounce >= 1; this.bounce--) {
        const a = r() * 2 * Math.PI, out = water ? 0.15 + 0.35 * r() : 0.08 + 0.3 * r();
        this.spray.put(wrap64(landed[0] + (r() - 0.5) * 0.012), landed[1] + 0.003, wrap64(landed[2] + (r() - 0.5) * 0.012), landed[1], time, [Math.cos(a) * out, water ? 0.5 + 0.7 * r() : 0.2 + 0.45 * r(), Math.sin(a) * out],
          water ? 0.002 + 0.002 * r() : 0.0012 + 0.001 * r(), water);
      }
    }
  }

  /**
   * Lets `gone` of a handful go from the hand, over the next `over` seconds: out between the fingers and off the
   * edges of the palm, each grain or drop falling to what is below, and what comes of it there.
   */
  release(gone, time, over) {
    const p = this.pour, stuff = STUFF[this.kind], r = this.random, water = this.kind === 'water';
    if (!p) return;
    this.owed += gone * stuff.things;
    const n = Math.floor(this.owed);
    this.owed -= n;
    for (let k = 0; k < n; k++) {
      // The gaps between the four fingers (most of it), the two edges of the hand, and now and then the heel.
      const gap = r() < 0.72 ? [0.019, 0, -0.019][Math.floor(r() * 3)] : r() < 0.8 ? (r() < 0.5 ? 0.041 : -0.04) : (r() - 0.5) * 0.06;
      const along = Math.abs(gap) > 0.03 ? -0.07 + 0.11 * r() : 0.004 + 0.05 * r() * r(), w = (r() - 0.5) * (water ? 0.004 : 0.0028);
      const x = p.K[0] + p.A[0] * (gap + w) + p.f[0] * along - p.N[0] * 0.011, y = p.K[1] + p.A[1] * (gap + w) + p.f[1] * along - p.N[1] * 0.011, z = p.K[2] + p.A[2] * (gap + w) + p.f[2] * along - p.N[2] * 0.011;
      const size = stuff.size[0] + (stuff.size[1] - stuff.size[0]) * r() * r();
      this.spray.put(wrap64(x), y, wrap64(z), p.floor, time + over * r(), [(r() - 0.5) * 0.05 + p.f[0] * 0.03, -0.05 - 0.2 * r(), (r() - 0.5) * 0.05 + p.f[2] * 0.03], size, water);
    }
    // Where it lands (a third of a second later; near enough).
    const fall = Math.sqrt(Math.max(p.K[1] - p.floor, 0.01) / 4.9);
    if (!water && !p.sea) {
      // Sand on sand: a heap grows under the hand, its sides as steep as sand stands; a new one when the hand has moved on.
      if (!this.heap || Math.hypot(p.K[0] - this.heap.x, p.K[2] - this.heap.z) > 0.04) this.heap = { x: p.K[0], z: p.K[2], held: 0, i: this.stamp(p.K[0], p.K[2], time, 2, 0, 0.01) };
      this.heap.held += gone;
      this.patch()?.pour(p.K[0] - p.N[0] * 0.01, p.K[2] - p.N[2] * 0.01, 0.017, gone * HANDFUL * (this.kind === 'dry' ? 1 : 0.75), this.kind === 'wet' && !p.wetGround ? gone * 5 : 0, fall, time);
      const h = 0.03 * Math.cbrt(this.heap.held) * (this.kind === 'wet' ? 0.8 : 1);
      shared.uTouchInfo.value[this.heap.i].set(time, 2, h, 1.65 * h + 0.012);
      // (Wet sand on dry: the dry sand round the clots darkens with their water.)
      if (this.kind === 'wet' && !p.wetGround) {
        if (!this.spot || Math.hypot(p.K[0] - this.spot.x, p.K[2] - this.spot.z) > 0.05) this.spot = { x: p.K[0], z: p.K[2], held: 0, i: this.stamp(p.K[0], p.K[2], time, 3, 0, 0.02) };
        this.spot.held += gone;
        shared.uTouchInfo.value[this.spot.i].set(time + fall, 3, Math.min(0.8, 0.3 + this.spot.held), 0.03 + 0.04 * Math.sqrt(this.spot.held));
      }
    } else if (water && !p.sea) {
      // Water on sand: a dark spot, wider the more of it.
      if (!this.spot || Math.hypot(p.K[0] - this.spot.x, p.K[2] - this.spot.z) > 0.05) this.spot = { x: p.K[0], z: p.K[2], held: 0, i: this.stamp(p.K[0], p.K[2], time, 3, 0, 0.02) };
      this.spot.held += gone;
      shared.uTouchInfo.value[this.spot.i].set(time + fall, 3, Math.min(1, 0.4 + 2 * this.spot.held), 0.03 + 0.05 * Math.sqrt(this.spot.held));
      this.patch()?.pour(p.K[0], p.K[2], 0.04, 0, gone * 7, fall, time);
    } else if (time - this.ringed > (water ? 0.16 : 0.3)) {
      // Into the sea: rings where the drops (or the grains) go in.
      this.ring(p.K[0] + (r() - 0.5) * 0.05, p.K[2] + (r() - 0.5) * 0.05, time + fall, water ? 0.2 : 0.1);
      this.ringed = time;
    }
  }
}
