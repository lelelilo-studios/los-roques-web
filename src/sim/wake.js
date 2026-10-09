// What your boat does to the water: a sheet over 128 m of sea that goes with the boat (30 m of it ahead, the
// rest astern), in which the hull pushes the water up where it comes and leaves a hollow where it has been.
// That spreads as waves do, at a speed tied to the boat's, so that the crests trail back in a V of about the
// angle a real wake has (19 degrees a side at low speed, narrowing as it planes); behind the transom the
// propeller's wash is white for a few seconds, and where the hull has passed the small ripples are calmed.
// The sea's own waves are not in this: it is what the boat adds to them. world/water.js draws it.
//
// What it is not: a real wake is many crests, because long waves outrun short ones; here all waves go at one
// speed, so each arm of the V is one crest and its hollow. The speed is chosen for the angle to be right.
//
// A texture anchored to the world (a texel belongs to a place modulo L):
//   r  how far the surface stands above or below where the sea has it (m)      g  how fast that is changing (m/s)
//   b  slick: how far the small ripples are calmed here (0..1)                 a  foam (0..1)
import * as THREE from 'three';
import { FullscreenPass } from '../core/framegraph.js';
import { shared } from '../core/uniforms.js';

export const WAKE = {
  L: 128, ahead: 30,                   // metres across; how much of that is ahead of the boat
  angle: [19.5, 12.5],                 // degrees a side: at displacement speeds, and flat out
  push: 0.5,                          // how far the water is raised where the hull comes into it, for each metre it draws
  foam: 6, slick: 14,                // seconds for foam to go, and for the calm to
  rest: 12,                            // seconds after the boat has stopped that it goes on being worked out
};
/** The speed waves go at in the sheet (m/s), for the boat's speed: what gives the wake its angle. */
export const wakeSpeed = speed => { const u = Math.abs(speed), k = Math.min(1, Math.max(0, (u - 5) / 6)), a = (WAKE.angle[0] + (WAKE.angle[1] - WAKE.angle[0]) * k) * Math.PI / 180; return Math.min(3.6, Math.max(0.5, u * Math.sin(a))); };

const simFragment = /* glsl */`
precision highp float;
uniform sampler2D tPrev;
uniform vec2 uCentre;         // the window's middle (metres, modulo uL)
uniform float uL, uN, uDt, uC;
uniform vec4 uHull, uHullWas; // the boat's middle (metres, modulo uL) and the way it heads (sine, cosine): now, and a step ago
uniform vec4 uGo;             // its speed through the water (m/s, astern negative), how far it planes (0..1), how much of it is in the water (0..1), how hard the propeller is driven (0..1)
uniform float uTime;
uniform float uRaise;      // 1: the water is raised and hollowed; 0: only its foam and its calm are kept (the simplest setting)
in vec2 vUv;
layout(location = 0) out vec4 outColor;
float lrHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Where a place is in the boat's own frame: x forward of its middle, y to starboard. (hull.zw: the sine and cosine of its heading: forward is (sin, -cos), starboard (cos, sin).)
vec2 lrInHull(vec2 d, vec4 hull) { vec2 q = mod(d - hull.xy + 0.5 * uL, uL) - 0.5 * uL; return vec2(q.x * hull.z - q.y * hull.w, q.x * hull.w + q.y * hull.z); }
// How much of a cell the hull's waterline covers (the same shape as world/penero.js gives it).
float lrHull(vec2 p) {
  float t = clamp((p.x + 3.8) / 7.6, 0.0, 1.0);
  float wide = 0.86 * (0.8 + 0.2 * min(1.0, t / 0.35)) * pow(max(0.0, 1.0 - pow(t, 2.7)), 0.62);
  return (1.0 - smoothstep(wide - 0.3, wide + 0.3, abs(p.y))) * (1.0 - smoothstep(3.6, 4.0, abs(p.x)));
}
void main() {
  vec2 d = vUv * uL, q = mod(d - uCentre + 0.5 * uL, uL) - 0.5 * uL;
  float cell = uL / uN, e = 1.0 / uN, edge = max(abs(q.x), abs(q.y));
  if (edge > 0.5 * uL - 1.0) { outColor = vec4(0.0); return; }
  vec4 c = texture(tPrev, vUv), xp = texture(tPrev, vUv + vec2(e, 0.0)), xm = texture(tPrev, vUv - vec2(e, 0.0)), zp = texture(tPrev, vUv + vec2(0.0, e)), zm = texture(tPrev, vUv - vec2(0.0, e));
  float v = c.g + uC * uC * (xp.r + xm.r + zp.r + zm.r - 4.0 * c.r) / (cell * cell) * uDt;
  vec2 p = lrInHull(d, uHull), was = lrInHull(d, uHullWas);
  float m = lrHull(p), before = lrHull(was), speed = abs(uGo.x);
  // The hull comes: the water it comes into is raised by what the hull draws there (less as it planes and
  // rides on its after part), and falls into the hollow it leaves.
  float draws = uRaise * ${WAKE.push.toFixed(3)} * uGo.z * (1.0 - 0.5 * uGo.y) * smoothstep(0.3, 2.5, speed);
  float h = c.r + (m - before) * draws;
  v *= exp(-uDt * 0.16);
  h = (h + v * uDt) * exp(-uDt * 0.05);
  // (A crest does not stand as a knife's edge: it is rounded off a little as it goes.)
  h = mix(h, 0.25 * (xp.r + xm.r + zp.r + zm.r), 0.05);
  // Foam. The propeller's wash: a strip astern of the transom, as wide as the engine's leg throws it, thick
  // when it is driven hard. And the water thrown aside along the forward part of the hull once it is going:
  // a line of white each side.
  // (Fresh foam goes quickly, the big bubbles first; the last of it lingers.)
  float foam = (c.a + 0.03 * (xp.a + xm.a + zp.a + zm.a - 4.0 * c.a)) * exp(-uDt * (1.0 / ${WAKE.foam.toFixed(2)} + 0.75 * c.a * c.a));
  float grain = 0.55 + 0.45 * lrHash(floor(d / cell) + floor(uTime * 20.0));
  float wash = exp(-pow((p.x + 4.5) / 0.7, 2.0)) * exp(-pow(p.y / (0.24 + 0.045 * speed), 2.0)) * uGo.w * smoothstep(0.5, 3.0, speed);
  float thrown = (1.0 - smoothstep(0.0, 0.3, abs(abs(p.y) - (0.9 - 0.12 * p.x)))) * step(-3.9, p.x) * step(p.x, 3.0 - 2.4 * uGo.y) * (1.0 - m) * smoothstep(3.0, 7.0, speed);
  foam = max(foam, grain * max(wash, 0.75 * thrown * uGo.z));
  // (And where a crest of the wake stands steep it breaks a little.)
  foam = max(foam, 0.6 * grain * smoothstep(0.14, 0.3, h) * smoothstep(3.0, 6.0, speed));
  // The calm: where the hull and its wash have been.
  float slick = max(c.b * exp(-uDt / ${WAKE.slick.toFixed(1)}), max(m, wash) * smoothstep(0.3, 2.0, speed));
  // (Out towards the rim everything dies away: nothing comes back from the edge.)
  float rim = smoothstep(0.36 * uL, 0.49 * uL, edge), keep = exp(-uDt * 6.0 * rim);
  outColor = vec4(clamp(h * keep, -0.6, 0.6), clamp(v * keep, -6.0, 6.0), clamp(slick * keep, 0.0, 1.0), clamp(foam * keep, 0.0, 1.0));
}`;

/** GLSL for the water: the wake at a place (x, z relative to the camera). */
export const wakeGLSL = /* glsl */`
uniform sampler2D tWake;
uniform vec4 uWake;       // the window's middle (x, z relative to the camera), its length (m), 1 = there is a wake
uniform vec2 uWakeC;      // the window's middle in the sheet's own coordinates (metres, modulo its length)
float lrWakeIn(vec2 p) {
  if (uWake.w < 0.5) return 0.0;
  vec2 q = p - uWake.xy;
  return 1.0 - smoothstep(0.42 * uWake.z, 0.48 * uWake.z, max(abs(q.x), abs(q.y)));
}
// (r: height, m; b: slick; a: foam.)
vec4 lrWake(vec2 p) { return textureLod(tWake, (p - uWake.xy + uWakeC) / uWake.z, 0.0); }
vec2 lrWakeSlope(vec2 p) {
  float e = uWake.z / float(textureSize(tWake, 0).x);
  return vec2(lrWake(p + vec2(e, 0.0)).r - lrWake(p - vec2(e, 0.0)).r, lrWake(p + vec2(0.0, e)).r - lrWake(p - vec2(0.0, e)).r) / (2.0 * e);
}
`;
export const WAKE_UNIFORMS = ['tWake', 'uWake', 'uWakeC'];

export class Wake {
  /** @param {THREE.WebGLRenderer} renderer  @param {number} size  texels across  @param {boolean} flat  no heights: foam and calm only */
  constructor(renderer, size = 768, flat = false) {
    this.renderer = renderer; this.size = size; this.L = WAKE.L;
    const target = () => new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    this.targets = [target(), target()]; this.now = 0;
    this.pass = new FullscreenPass(simFragment, {
      tPrev: { value: null }, uCentre: { value: new THREE.Vector2() }, uL: { value: this.L }, uN: { value: size }, uDt: { value: 0 }, uC: { value: 1 }, uTime: { value: 0 },
      uHull: { value: new THREE.Vector4(0, 0, 0, 1) }, uHullWas: { value: new THREE.Vector4(0, 0, 0, 1) }, uGo: { value: new THREE.Vector4() }, uRaise: { value: flat ? 0 : 1 },
    });
    this.zero = new Float32Array([0, 0, 0, 0]); this.was = null; this.quiet = 1e9; this.live = false;
    this.reset();
  }

  /** Still water everywhere. */
  reset() {
    const { renderer } = this, previous = renderer.getRenderTarget(), gl = renderer.getContext();
    for (const t of this.targets) { renderer.setRenderTarget(t); gl.clearBufferfv(gl.COLOR, 0, this.zero); }
    renderer.setRenderTarget(previous);
    this.was = null; this.quiet = 1e9; this.live = false;
    shared.uWake.value.w = 0;
  }

  /**
   * One frame.
   * @param {number} dt
   * @param {{x: number, z: number, heading: number, speed: number, planing: number, wet: number, drive: number}} b  the boat:
   *   where its middle is, the way it heads, its speed through the water, how far it planes, how much of it is in the water, how hard its propeller is driven (all 0..1)
   * @param {{x: number, z: number}} eye  the camera
   * @param {number} time
   */
  update(dt, b, eye, time) {
    const { renderer, L } = this, wrap = v => ((v % L) + L) % L, sh = Math.sin(b.heading), ch = Math.cos(b.heading);
    // (It rests when the boat has lain still a while, and nothing of it is drawn then.)
    if (Math.abs(b.speed) > 0.3) this.quiet = 0; else this.quiet += Math.max(dt, 0);
    if (this.quiet > WAKE.rest) { if (this.live) this.reset(); return; }
    // (Set down somewhere else: the old water is not this water.)
    // (More than sixty metres in a frame: on a hurried crossing it goes nine.)
    if (this.was && Math.hypot(b.x - this.was.x, b.z - this.was.z) > 60) this.reset(), this.quiet = 0;
    this.live = true;
    const back = L / 2 - WAKE.ahead, cx = b.x - sh * back, cz = b.z + ch * back;
    shared.uWake.value.set(cx - eye.x, cz - eye.z, L, 1); shared.uWakeC.value.set(wrap(cx), wrap(cz)); shared.tWake.value = this.targets[this.now].texture;
    if (!(dt > 0)) return;
    const previous = renderer.getRenderTarget(), u = this.pass.material.uniforms, c = wakeSpeed(b.speed), cell = L / this.size;
    // (As many steps as keep it steady: a wave goes no further than half a cell in one.)
    // (And as many as lay the hull down every 0.7 m of its way: on a crossing that is hurried it goes metres in a frame, and its wash was a row of dots.)
    const from = this.was || { x: b.x, z: b.z, heading: b.heading }, all = Math.min(dt, 1 / 20), n = Math.max(1, Math.min(24, Math.max(Math.ceil(c * all / (0.5 * cell)), Math.ceil(Math.hypot(b.x - from.x, b.z - from.z) / 0.7)))), step = all / n;
    u.uCentre.value.set(wrap(cx), wrap(cz)); u.uDt.value = step; u.uC.value = c; u.uTime.value = time;
    u.uGo.value.set(b.speed, b.planing, b.wet, b.drive);
    // (The hull's place at each step, between where it was last frame and where it is: x, z, and the sine and cosine of its heading.)
    const at = k => { const t = k / n, x = from.x + (b.x - from.x) * t, z = from.z + (b.z - from.z) * t, a = from.heading + Math.atan2(Math.sin(b.heading - from.heading), Math.cos(b.heading - from.heading)) * t; return [wrap(x), wrap(z), Math.sin(a), Math.cos(a)]; };
    for (let i = 1; i <= n; i++) {
      u.uHull.value.fromArray(at(i)); u.uHullWas.value.fromArray(at(i - 1));
      u.tPrev.value = this.targets[this.now].texture;
      this.now = 1 - this.now;
      this.pass.render(renderer, this.targets[this.now]);
    }
    this.was = { x: b.x, z: b.z, heading: b.heading };
    shared.tWake.value = this.targets[this.now].texture;
    renderer.setRenderTarget(previous);
  }

  /** For tests: [height, how fast it changes, slick, foam] at a place (world x, z). */
  read(x, z) {
    const wrap = v => ((v % this.L) + this.L) % this.L, px = Math.min(this.size - 1, Math.floor(wrap(x) / this.L * this.size)), py = Math.min(this.size - 1, Math.floor(wrap(z) / this.L * this.size)), out = new Uint16Array(4);
    this.renderer.readRenderTargetPixels(this.targets[this.now], px, py, 1, 1, out);
    return Array.from(out, THREE.DataUtils.fromHalfFloat);
  }
}
