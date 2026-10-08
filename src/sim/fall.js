// How a small thing falls through the air: a grain of sand or a drop of water let go with a velocity, pulled down
// and slowed by the air, which carries it towards its own speed (the breeze's). The air's hold is one number, `tau`:
// the seconds in which a thing takes up most of the air's speed. A grain of fine sand, a tenth of a second; a
// coarse one, two thirds; a drop of water, most of a second. Left to fall, it comes to a steady speed, g * tau.
//
// The path is known exactly, so nothing is stepped: where a thing is at any moment follows from where and when
// it was let go. The same lines are written in GLSL (world/falling.js draws every grain from them); these are
// for the hand, which has to know where and when what it lets fall will land, and for the tests.
export const GRAVITY = 9.81;

/** Where a thing let go at p0 with velocity v0 is after t seconds, in air moving at `wind` ([x, z], m/s): into `out`. */
export function fallAt(out, p0, v0, wind, tau, t) {
  const k = tau * (1 - Math.exp(-t / tau)), vy = -GRAVITY * tau;
  out[0] = p0[0] + wind[0] * t + (v0[0] - wind[0]) * k;
  out[1] = p0[1] + vy * t + (v0[1] - vy) * k;
  out[2] = p0[2] + wind[1] * t + (v0[2] - wind[1]) * k;
  return out;
}

/** How fast it is falling then (m/s, downward negative). */
export function fallSpeed(vy0, tau, t) { const vy = -GRAVITY * tau; return vy + (vy0 - vy) * Math.exp(-t / tau); }

/** When a thing let go at height y0, moving up or down at vy0, comes to the height `floor` (seconds; 0 if it is there). */
export function landTime(y0, vy0, tau, floor) {
  const h = y0 - floor;
  if (h <= 0) return 0;
  // (From where it would land with no air, three steps of Newton's: good to a tenth of a millisecond.)
  let t = (vy0 + Math.sqrt(vy0 * vy0 + 2 * GRAVITY * h)) / GRAVITY;
  const vInf = -GRAVITY * tau;
  for (let k = 0; k < 4; k++) {
    const e = Math.exp(-t / tau), y = h + vInf * t + (vy0 - vInf) * tau * (1 - e), v = vInf + (vy0 - vInf) * e;
    if (Math.abs(v) < 1e-6) break;
    t = Math.max(t - y / v, 1e-4);
  }
  return t;
}

/** How long the air takes to carry a grain of sand `size` metres across along with it (seconds): by its size, a tenth of a second to two thirds. */
export function grainTau(size) { return Math.min(0.66, Math.max(0.09, 0.31 * (size / 0.0004) ** 1.2)); }
