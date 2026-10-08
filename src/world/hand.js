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
  vec3 light = (uSunE * max(uSunDir.y, 0.0) * lrShadow(vRel, vec3(0.0, 1.0, 0.0)) + uSkyE + bounce) / PI;
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
    // (Falling, grains show their shaded sides: a stream is a shade darker than the sunlit beach behind it.)
    outColor = vec4(mix(vec3(0.26, 0.23, 0.19), vec3(0.5, 0.46, 0.4), shade) * light, -1000.0);
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
in float aDepth;     // how deep the stuff lies here (m)
out vec3 vRel;
out vec3 vNormal;
out vec3 vLocal;
out float vDepth;
void main() {
  vRel = position; vNormal = normal; vLocal = vec3(aLocal.x, aDepth, aLocal.y); vDepth = aDepth;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const lyingFragment = /* glsl */`
#include <lr_common>
${shadowGLSL}
uniform vec2 uStuff;        // 0 dry sand, 1 wet sand, 2 water; how much of a handful
in vec3 vRel;
in vec3 vNormal;
in vec3 vLocal;
in float vDepth;
layout(location = 0) out vec4 outColor;
void main() {
  float water = step(1.5, uStuff.x), wet = step(0.5, uStuff.x) * (1.0 - water);
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
  float sky = max(fresnel, 0.05 + 0.14 * tremble * tremble + 0.25 * shallow);
  vec3 pool = vec3(0.5, 0.37, 0.29) * exp(-vDepth * 30.0) * (uSunE * lrSaturate(uSunDir.y) * lit + uSkyE) / PI * (1.0 - sky) + sky * uSkyE / PI * 1.5
            + uSunE * lit * 4.0 * pow(lrSaturate(dot(reflect(-V, normalize(n + 0.12 * vec3(tremble - 0.5, 0.0, lrNoise(vLocal.zx * 180.0 - uTime * 2.6) - 0.5))), uSunDir)), 500.0);
  outColor = vec4(mix(col, pool, water), -1000.0);
}`;

export class Hand {
  /**
   * @param {object} o
   * @param {import('./spray.js').Spray} o.spray
   * @param {{touch: Function}} o.sound
   * @param {(x: number, z: number, when: number, strength: number) => void} o.ring  a ring on the water
   * @param {number} o.shadowTaps
   */
  constructor({ spray, sound, ring, shadowTaps = 8, patch = null }) {
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
    sheet.setAttribute('position', this.lPos); sheet.setAttribute('normal', this.lNor); sheet.setAttribute('aDepth', this.lDepth); sheet.setAttribute('aLocal', new THREE.BufferAttribute(local, 2)); sheet.setIndex(quads);
    this.lying = new THREE.Mesh(sheet, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: lyingVertex, fragmentShader: lyingFragment, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.shadow], { uStuff: { value: new THREE.Vector2() } }),
    }));
    this.lying.frustumCulled = false; this.lying.matrixAutoUpdate = false; this.lying.visible = false;
    this.trail = Array.from({ length: GAPS }, () => []);
    this.count = shared.uTouchSeg.value.length;
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
      tip: null, from: null, speed: 0, mark: -1, marks: 0, heap: null, spot: null,
      spoke: 0, ringed: 0, wet: 0, sand: 0, floor: 0, at: null,
      pushed: -1, epoch: 0, bounce: 0, lastK: null, pour: null, tipped: 0,
    });
    if (this.trail) for (const t of this.trail) t.length = 0;
    if (this.streams) this.streams.visible = false;
    if (this.lying) this.lying.visible = false;
    this.sim?.empty(); this.open = 0.3; this.real = false;
    shared.uTouchCount.value = 0; shared.uLeg.value[2].z = 0;
    if (this.mesh) this.mesh.visible = false;
  }

  /** A new mark in the sand at (x, z): returns its place in the list. */
  stamp(x, z, time, kind, a, b) {
    const i = this.marks++ % this.count;
    shared.uTouchSeg.value[i].set(wrap64(x), wrap64(z), wrap64(x), wrap64(z));
    shared.uTouchInfo.value[i].set(time, kind, a, b);
    shared.uTouchCount.value = Math.min(this.marks, this.count);
    return i;
  }

  /**
   * Before the body is posed: what the hand is to do this frame. Returns poseBody's `touch`, or null.
   * @param {number} dt
   * @param {object} c  want (the button is held), canReach (crouched, on sand or in shallow water), open (how far
   *   the fingers are parted, 0..1), time, look,
   *   body (eye height over your feet), feet (their height), x, z, cy, sy (cos and sin of your heading),
   *   groundAt(x, z), surf (the sea surface here), wetAt(x, z, ground): whether the sand there is wet
   */
  plan(dt, c) {
    const going = c.want && c.canReach;
    if (dt > 0) {
      if (going) {
        // Down it goes (whatever it held is let fall).
        if (this.lift > 0.5 && this.amount > 0.02) this.spill(c.time);
        this.ik = Math.min(1, this.ik + dt * 4.5); this.lift = Math.max(0, this.lift - dt * 5);
      } else if (this.amount > 0.004 || (this.lift > 0 && this.empty < 0.5)) {
        // Up before you with what it took, and held there until that has run out (and a moment more).
        this.ik = Math.min(1, this.ik + dt * 4.5); this.lift = Math.min(1, this.lift + dt * 2.6);
      } else {
        this.ik = Math.max(0, this.ik - dt * 3); if (this.ik === 0) this.lift = 0;
      }
      // The fingers close a fifth of a second after the hand has landed, and what is under them is taken.
      const closing = this.down && going && c.time - this.landed > 0.18;
      this.grip = closing ? Math.min(1, this.grip + dt * 4) : this.lift > 0.3 ? this.grip : Math.max(0, this.grip - dt * 6);
    }
    if (this.ik <= 0) return null;
    // Where: on the line of your look, as far as the arm goes. (In dry sand the fingers go in; on wet sand they
    // press on it; in water the hand goes to the bottom if that is within a hand's length, or under by that much.)
    // (Sitting, your legs lie where it would go: it works beside your right thigh.)
    // (`seated`: how far you are on to your seat, 0..1: the hand's places go over from the one posture's to the other's, not at a jump.)
    const seated = c.seated ?? (c.sitting ? 1 : 0), far = Math.min(0.6 - 0.15 * seated, Math.max(0.3, Math.cos(c.look) * c.body / Math.max(0.25, -Math.sin(c.look)))), lx = 0.1 + 0.23 * seated, lz = -far;
    const wx = c.x + lx * c.cy - lz * c.sy, wz = c.z + lx * c.sy + lz * c.cy, g = c.groundAt(wx, wz), depth = Math.max(c.surf - g, 0);
    if (!this.down && this.lift < 0.05 && this.amount < 0.02) this.kind = depth > 0.015 ? 'water' : c.wetAt(wx, wz, g) ? 'wet' : 'dry';
    const y = this.kind === 'water' ? Math.max(g + 0.004, c.surf - 0.17) : this.kind === 'dry' ? g - 0.012 - 0.012 * this.grip : g - 0.003 - 0.006 * this.grip;
    this.at = { x: wx, z: wz, ground: g, depth };
    // Held up: a forearm's length before your eyes and a little below the line of your look, to the right.
    const sl = Math.sin(c.look), cl = Math.cos(c.look), held = clamp01(this.lift * 2 - 1);
    const L = [0, sl, -cl], U = [0, cl, sl], eye = [0, c.body, 0];
    // (Far enough out, and near enough to the middle of what you see, that the hand, what falls from it and the
    // place where that lands are all in view.)
    // Not hung from the line of your look, a forearm from your face: held as people hold a handful to watch it,
    // the upper arm by your side, the forearm out in front of the lower chest, some 45 cm from your eyes. It comes
    // a little higher when you look less far down. Squatting, it is held over your knees.
    const raise = 0.12 * clamp01((c.look + 0.95) / 0.7), low = c.low || 0;
    // (Seated you lean back: it is held out beside your right thigh, the elbow still bent.)
    const up = [eye[0] + 0.13 + 0.03 * low, eye[1] - 0.4 + raise + 0.2 * low, eye[2] - 0.27 + 0.03 * low], down = [eye[0] + 0.27, eye[1] - 0.36 + raise, eye[2] - 0.15];
    const wrist = [0, 1, 2].map(i => up[i] + (down[i] - up[i]) * seated);
    // (A hand held out is never quite still: it rises and falls a little with your breath.)
    wrist[1] += 0.003 * Math.sin(c.time * 1.45); wrist[0] += 0.0015 * Math.sin(c.time * 0.83 + 1);
    // (No lower than the arm can hold it level, crouched: above your knees.)
    wrist[1] = Math.max(wrist[1], Math.min(c.body - 0.22, 0.36));
    // How far the fingers are parted: as you have set them (the wheel), wide while you send it all down.
    if (dt > 0) this.open += (clamp01(c.want && !c.canReach ? 1 : c.open ?? 0.3) - this.open) * (1 - Math.exp(-dt * 8));
    let dir, palm, cupped, spread;
    if (this.real) {
      // What it holds obeys the hand (sim/palm.js), so the hand is held to the world, not to your eye: level
      // while the fingers are together; with them parted it tips forward, slowly and further the longer it
      // pours (faster the wider they are), as a hand does to keep sand running; closed again, it comes level.
      if (dt > 0) this.tipped = this.open > 0.05 && this.amount > 0.002 && held > 0.9 ? Math.min(0.8, this.tipped + dt * (0.06 + 0.4 * this.open)) : Math.max(0, this.tipped - dt * 1.2);
      const tip = (0.1 + 0.25 * this.open + this.tipped) * held, st = Math.sin(tip), ct = Math.cos(tip);
      dir = [-0.3, -st, -ct]; palm = [0.06, ct, -st]; cupped = 0.5 - 0.12 * this.open; spread = this.lift * this.open;
    } else {
      // (The figure of tubes: the palm up and turned a little towards you, tipping forward as it empties.)
      const tip = 0.25 + 0.3 * (1 - this.amount) * held;
      dir = [-0.3, L[1] * 0.92 + U[1] * 0.12, L[2] * 0.92 + U[2] * 0.12]; palm = [0.06, U[1] - L[1] * tip, U[2] - L[2] * tip];
      cupped = 0.5 - 0.16 * (1 - this.amount); spread = this.lift * (this.kind === 'water' ? 0.3 : 0.5) * (0.15 + 0.85 * (1 - this.amount));
    }
    const full = this.grip;
    this.cupped = cupped;
    return {
      at: [lx, y - c.feet, lz], amount: this.ik, lift: this.lift, wrist, dir, palm,
      // (On the ground the fingers close on what they take; held up they are cupped.)
      curl: (this.kind === 'water' ? 0.1 + 0.38 * full : this.kind === 'dry' ? 0.34 + 0.4 * full : 0.16 + 0.5 * full) * (1 - this.lift) + cupped * this.lift, spread,
    };
  }

  /** What the hand held is let fall at once (it was sent down again). */
  spill(time) {
    if (this.pour) this.release(this.amount, time, 0.25);
    this.amount = 0; this.sim.empty();
  }

  /**
   * After the body is posed: the marks, the grains, the drops, the sounds.
   * @param {number} dt
   * @param {object} c  as for plan(), and: joints (from poseBody), world(q): a point of the body in the world,
   *   turn(v): a direction of it, eye (the camera: x, y, z), material (the body's, for the wet and sandy hand)
   */
  act(dt, c) {
    const touching = c.joints.touching, tip = touching ? c.world(touching.tip) : null, sandy = this.kind !== 'water', time = c.time;
    if (tip && dt > 0) this.speed = this.tip ? Math.hypot(tip[0] - this.tip[0], tip[2] - this.tip[2]) / dt : 0;
    // (A frame drawn without time passing, for a picture, changes nothing in what the hand is doing.)
    const pressing = (c.want && c.canReach) || (dt === 0 && this.down);
    if (tip && this.ik >= 1 && this.lift <= 0 && pressing) {
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
        this.sim.shape(0.5, 0); this.sim.fill(this.kind);
        this.sound.touch(this.kind, 'take');
        if (sandy && this.mark >= 0 && info[this.mark].y > 0.5) { info[this.mark].set(time, 4, c.yaw, this.kind === 'dry' ? 1 : 0.7); this.mark = -1; }
        if (!sandy) this.ring(tip[0], tip[2], time, 0.3);
        // (Out of real sand: the handful's volume, from under the palm and the fingers.)
        if (sandy) { const w = c.world(touching.wrist); this.patch()?.move((tip[0] + w[0]) / 2, (tip[2] + w[2]) / 2, 0.042, -HANDFUL * (this.kind === 'dry' ? 1 : 0.75), 0.12); }
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
    shared.uLeg.value[2].set(tip ? wrap64(tip[0]) : 0, tip ? wrap64(tip[2]) : 0, tip && this.down && !sandy ? 1 : 0, this.speed);

    // Held up: what is in the palm, and its running out between the fingers.
    const palm = touching?.palm;
    let running = 0;
    this.pour = null; this.mesh.visible = false;
    if (!palm || this.lift <= 0.25) this.lastK = null;
    this.real = !!palm?.us || (this.real && !palm);
    this.lying.visible = false;
    if (palm?.us && this.lift > 0.25) running = this.hold(dt, c, palm);
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
          this.amount -= gone;
          if (this.amount <= Math.max(stuff.left, 0.004)) { this.amount = 0; this.empty = 0; this.sound.touch(this.kind, 'up'); }
          if (sandy) this.sand = Math.min(1, Math.max(this.sand, this.kind === 'wet' ? 0.7 : 0.3)); else this.wet = 1;
          if (time - this.spoke > 0.085) { this.sound.touch(this.kind, 'pour', rate / stuff.rate); this.spoke = time; }
        }
      } else if (dt > 0) this.empty += dt;
    }
    this.flow(dt, c, running > 0 && this.kind !== 'wet' ? this.pour : null, running);
    // (A wet hand dries in a minute or so in this sun and wind; dry sand falls off it sooner.)
    if (dt > 0 && !this.down && this.amount < 0.02) { this.wet = Math.max(0, this.wet - dt / 70); this.sand = Math.max(0, this.sand - dt / (this.wet > 0.3 ? 60 : 6)); }
    const wrist = c.joints.wrists[1], end = c.joints.fingertips[1];
    if (wrist && end) {
      const mid = c.world([(wrist[0] + end[0]) / 2, (wrist[1] + end[1]) / 2, (wrist[2] + end[2]) / 2]);
      c.material.uniforms.uHandWet.value.set(mid[0] - c.eye.x, mid[1], mid[2] - c.eye.z, this.wet);
      c.material.uniforms.uHandSand.value = this.sand;
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
    sim.shape(this.cupped ?? 0.45, this.open, palm.half, palm.us);
    const under = g => { const q = sim.gapAt(g), p = at(q[0], q[1], -0.016); return p; };
    this.pour = { K, f, N, A, floor, sea, ground, v, wetGround: !sea && c.wetAt(K[0], K[2], ground), gaps: [under(0), under(1), under(2)] };
    let running = 0;
    if (dt > 0 && this.lift > 0.8 && this.amount > 0.002) {
      const out = sim.step(dt, [A[1], f[1], N[1]]), through = out.gaps[0] + out.gaps[1] + out.gaps[2], gone = (through + out.edge) / HANDFUL;
      this.amount = sim.amount;
      // How hard each gap is running (a stream at full strength carries a twentieth of a handful a second).
      for (let g = 0; g < 3; g++) this.rates[g] += (clamp01(out.gaps[g] / dt / (HANDFUL * 0.05)) - this.rates[g]) * (1 - Math.exp(-dt * 14));
      running = Math.max(...this.rates);
      if (gone > 0) {
        // Where it lands: under the gaps it fell through, a third of a second later.
        const fall = Math.sqrt(Math.max(K[1] - floor, 0.01) / 4.9), r = this.spray.random, patch = this.patch(), blown = this.carried(fall, c);
        for (let g = 0; g < 3; g++) if (out.gaps[g] > 0) {
          const p = [this.pour.gaps[g][0] + blown[0], this.pour.gaps[g][1], this.pour.gaps[g][2] + blown[1]];
          if (sea) continue;
          if (sandy) patch?.pour(p[0], p[2], 0.012, out.gaps[g] * (this.kind === 'dry' ? 1 : 0.75), this.kind === 'wet' && !this.pour.wetGround ? out.gaps[g] / HANDFUL * 5 : 0, fall, time);
          else patch?.pour(p[0], p[2], 0.035, 0, out.gaps[g] / HANDFUL * 7, fall, time);
        }
        if (out.edge > 0) {
          const p = at(out.at[0], out.at[1], 0);
          if (!sea) { if (sandy) patch?.pour(p[0], p[2], 0.02, out.edge, 0, fall, time); else patch?.pour(p[0], p[2], 0.04, 0, out.edge / HANDFUL * 7, fall, time); }
          // (What goes over the edge of the hand goes as loose grains, or drops.)
          this.owed += out.edge / HANDFUL * stuff.things;
          for (; this.owed >= 1; this.owed--) this.spray.put(wrap64(p[0] + (r() - 0.5) * 0.02), p[1], wrap64(p[2] + (r() - 0.5) * 0.02), floor, time + dt * r(), [v[0] + (r() - 0.5) * 0.08, -0.05 - 0.2 * r(), v[2] + (r() - 0.5) * 0.08], stuff.size[0] + (stuff.size[1] - stuff.size[0]) * r() * r(), !sandy);
        }
        if (sea && time - this.ringed > (sandy ? 0.3 : 0.16)) { const p = this.pour.gaps[1]; this.ring(p[0] + (r() - 0.5) * 0.05, p[2] + (r() - 0.5) * 0.05, time + fall, sandy ? 0.1 : 0.2); this.ringed = time; }
        if (sandy) this.sand = Math.min(1, Math.max(this.sand, this.kind === 'wet' ? 0.7 : 0.3)); else this.wet = 1;
        if (time - this.spoke > 0.085) { this.sound.touch(this.kind, 'pour', clamp01(gone / dt / 0.2)); this.spoke = time; }
      }
      if (this.amount <= Math.max(stuff.left * 0.3, 0.004)) { this.amount = 0; sim.empty(); this.empty = 0; this.sound.touch(this.kind, 'up'); }
    } else if (dt > 0) {
      for (let g = 0; g < 3; g++) this.rates[g] *= Math.exp(-dt * 14);
      if (this.amount <= 0.004) this.empty += dt;
    }
    // What lies in the hand: a vertex a cell, on top of the stuff; its slope from its neighbours.
    if (this.amount > 0.002) {
      const pos = this.lPos.array, nor = this.lNor.array, depth = this.lDepth.array, s = sim.s, fl = sim.floor;
      const top = k => (Number.isNaN(fl[k]) ? 0 : fl[k] + s[k]);
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const k = j * NU + i, here = top(k), p = at(U0 + (i + 0.5) * CELL, V0 + (j + 0.5) * CELL, Number.isNaN(fl[k]) ? -0.02 : here + (sandy ? 0 : 0.0008));
        pos[k * 3] = p[0] - c.eye.x; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2] - c.eye.z;
        depth[k] = Number.isNaN(fl[k]) ? 0 : s[k];
        const du = (top(k + (i + 1 < NU ? 1 : 0)) - top(k - (i > 0 ? 1 : 0))) / (2 * CELL), dv = (top(k + (j + 1 < NV ? NU : 0)) - top(k - (j > 0 ? NU : 0))) / (2 * CELL);
        const n = [N[0] - A[0] * du - f[0] * dv, N[1] - A[1] * du - f[1] * dv, N[2] - A[2] * du - f[2] * dv], l = Math.hypot(n[0], n[1], n[2]) || 1;
        nor[k * 3] = n[0] / l; nor[k * 3 + 1] = n[1] / l; nor[k * 3 + 2] = n[2] / l;
      }
      this.lPos.needsUpdate = this.lNor.needsUpdate = this.lDepth.needsUpdate = true;
      this.lying.material.uniforms.uStuff.value.set(this.kind === 'dry' ? 0 : this.kind === 'wet' ? 1 : 2, this.amount);
      this.lying.visible = true;
    }
    return running;
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
    const time = c.time, eye = c.eye, water = this.kind === 'water', r = this.spray.random, wind = c.wind || [0, 0];
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
    const p = this.pour, stuff = STUFF[this.kind], r = this.spray.random, water = this.kind === 'water';
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
