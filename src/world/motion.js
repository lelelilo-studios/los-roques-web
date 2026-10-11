// The pieces her movement is made of, wherever it is made (bodymotion.js, moves.js, handact.js): a number that
// goes where it is sent as a limb goes, one that follows as a sprung weight follows, one that takes up a
// difference so that nothing jumps, and slow noise. Plain numbers, no three; nothing here knows the frame rate.

/**
 * One number that goes to where it is sent smoothly: from where it is, as fast as it is going and however that
 * is changing, to its goal in a given time, arriving at rest. Sent somewhere else on the way, it goes on from
 * what it was doing: nothing jumps.
 */
export class Mover {
  constructor(x = 0) { this.set(x); }
  /** There, at rest, at once. */
  set(x) { this.x = x; this.v = 0; this.a = 0; this.goal = x; this.t = 0; this.T = 0; this.c = null; }
  /** Go to `goal` in `T` seconds (if it is already on its way there, it goes on as it was). */
  to(goal, T) {
    if (goal === this.goal && (this.c || this.x === goal)) return this;
    this.goal = goal; this.t = 0; this.T = Math.max(T, 1e-3);
    const d = goal - this.x, v = this.v, a = this.a, t = this.T;
    this.c = [this.x, v, a / 2, (20 * d - 12 * v * t - 3 * a * t * t) / (2 * t * t * t), (-30 * d + 16 * v * t + 3 * a * t * t) / (2 * t ** 4), (12 * d - 6 * v * t - a * t * t) / (2 * t ** 5)];
    return this;
  }
  step(dt) {
    if (!this.c) return this.x;
    this.t += dt;
    if (this.t >= this.T) { this.x = this.goal; this.v = 0; this.a = 0; this.c = null; return this.x; }
    const [c0, c1, c2, c3, c4, c5] = this.c, t = this.t;
    this.x = c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * c5))));
    this.v = c1 + t * (2 * c2 + t * (3 * c3 + t * (4 * c4 + t * 5 * c5)));
    this.a = 2 * c2 + t * (6 * c3 + t * (12 * c4 + t * 20 * c5));
    return this.x;
  }
  get done() { return !this.c; }
  /** How far along it is, 0..1 of its time. */
  get part() { return this.c ? this.t / this.T : 1; }
}


/**
 * One number that follows another as a weight on a spring follows: `omega` how quickly (radians a second),
 * `zeta` how nearly it settles without swinging past (1: not at all; less: it goes a little by and comes back,
 * as a hand does at the end of a swing, or a body that stops). `angle`: it is an angle, and goes the short way
 * round. Stepped in pieces of a 240th of a second with what it follows carried evenly across them, so that a
 * frame of a 30th and a frame of a 120th bring it to the same place.
 */
export class Follower {
  constructor({ omega = 10, zeta = 1, angle = false, x = 0 } = {}) { this.omega = omega; this.zeta = zeta; this.angle = angle; this.set(x); }
  /** There, at rest, at once. */
  set(x) { this.x = x; this.v = 0; this.was = x; return this; }
  step(dt, target, omega = this.omega, zeta = this.zeta) {
    if (!(dt > 0)) return this.x;
    const n = Math.max(1, Math.ceil(dt * 240 - 1e-9)), h = dt / n, from = this.was, wrap = d => (this.angle ? Math.atan2(Math.sin(d), Math.cos(d)) : d), by = wrap(target - from);
    for (let i = 1; i <= n; i++) {
      const to = from + by * i / n;
      this.v += (omega * omega * wrap(to - this.x) - 2 * zeta * omega * this.v) * h; this.x += this.v * h;
    }
    this.was = target;
    return this.x;
  }
}

/**
 * A difference, dying away: when what moves a part of her changes all at once (a stride begun, a clock set
 * back, one source handed over to another), what she was doing less what she would now be doing is handed to
 * this (`kick`), added back, and let go to nothing with no jump of place or of speed. `omega`: how quickly.
 */
export class Inertial {
  constructor(omega = 9) { this.omega = omega; this.x = 0; this.v = 0; }
  kick(dx, dv = 0) { this.x += dx; this.v += dv; return this; }
  clear() { this.x = 0; this.v = 0; }
  step(dt) {
    if (!(dt > 0) || (this.x === 0 && this.v === 0)) return this.x;
    // (A critically damped return to nought, exactly: x(t) = (x0 + (v0 + w x0) t) e^(-w t).)
    const w = this.omega, e = Math.exp(-w * dt), a = this.v + w * this.x;
    const x = (this.x + a * dt) * e; this.v = (a - w * (this.x + a * dt)) * e; this.x = x;
    if (Math.abs(this.x) < 1e-9 && Math.abs(this.v) < 1e-9) this.clear();
    return this.x;
  }
}

/** A number from 0 to 1 that is always the same for the same whole numbers: for what should differ from stride to stride and yet be the same every time it is asked. */
export function hash(a, b = 0) {
  let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA6B)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297A2D39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/**
 * Slow noise, -1..1: a pure function of `t` (it wanders about once in each unit of `t`) and of a whole number
 * `seed`, smooth in place and in speed. Nothing is kept, so there is nothing to seed again: the same clock gives
 * the same wandering.
 */
export function noise1(seed, t) {
  const i = Math.floor(t), u = t - i, at = k => hash(seed, i + k) * 2 - 1, a = at(-1), b = at(0), c = at(1), d = at(2);
  // (Through four neighbours as a Catmull-Rom curve goes: smooth where it passes each.)
  return Math.max(-1, Math.min(1, b + 0.5 * u * (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)))));
}
/** The lesser of two numbers, the corner between them rounded over about `k`: a limit that is come up against softly. */
export const softMin = (a, b, k = 0.01) => 0.5 * (a + b - Math.sqrt((a - b) * (a - b) + k * k));
export const softMax = (a, b, k = 0.01) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));
