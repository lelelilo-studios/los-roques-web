// How a hand moves when it takes something up: what it is doing from moment to moment (reaching, landing, resting
// on the sand, raking, digging in, gathering, lifting, holding, going back), and how far along each of the
// things that move it it is. A person's hand does not go at one speed and stop dead: it sets off gently, is
// fastest a third to half of the way, and arrives gently (Flash and Hogan's "minimum jerk"); it opens on the way
// and closes as it arrives (Jeannerod); its fingers do not all move at once; and once it has begun to take a
// handful it finishes. (It used to go by three numbers that went up and down at fixed rates: a quarter of a second
// to the sand at three metres a second, the fingers all closing together.)
//
// Plain numbers, no three: it is measured in a test (tests/handact.test.mjs). world/hand.js asks it what the hand
// is doing and makes everything that comes of it; humanref.js REACH has the timings a person keeps.
import { POSE_LENGTH, MCP, ABD, PIP, DIP, T_PLANE, ARCH } from './handpose.js';

const clamp01 = v => Math.min(1, Math.max(0, v));
/** The smooth way from 0 to 1 over 0..1: no speed and no acceleration at either end, fastest half way. */
export const ease = k => { const t = clamp01(k); return t * t * t * (10 - 15 * t + 6 * t * t); };

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

// How long things take (seconds), by what is being taken: dry sand, wet sand, water (humanref.js REACH; the
// plan's appendix B). Wet sand is heavier and gives less; water is not dug.
const TIMES = {
  dry: { settle: 0.12, dig: 0.22, gather: 0.55, lift: 1.1 },
  wet: { settle: 0.15, dig: 0.3, gather: 0.75, lift: 1.2 },
  water: { settle: 0.05, dig: 0.25, gather: 0.5, lift: 1.35 },
};
const DWELL = 0.18, BACK = 0.65;
// When each finger sets about closing after the little finger does, and about opening after the thumb does
// (seconds; index, middle, ring, little, then the thumb and the hollow of the palm).
const CLOSING = [0.06, 0.035, 0.015, 0, 0.09, 0], OPENING = [0.015, 0.035, 0.05, 0.06, 0, 0.02];
const TOGETHER = [0, 0, 0, 0, 0, 0];
// How quickly each finger follows where it is told to be (radians a second: the little finger is the lightest),
// and how nearly it settles without swinging past (1: not at all).
const FOLLOW = [34, 32, 30, 36, 30, 28], DAMP = 0.82;
/** Which of those six a joint of the pose belongs to. */
const part = i => (i < ABD ? i - MCP : i < PIP ? i - ABD : i < DIP ? i - PIP : i < T_PLANE ? i - DIP : i === ARCH ? 5 : 4);

/** What one hand is doing. */
export class HandMotion {
  constructor() {
    // How far the arm has gone from where it rests to its work (`go`), from the ground to held up (`lift`), how
    // far the palm has rolled over from down to up (`turn`), how far the fingers have dug in (`dig`), been drawn
    // back through the sand (`drag`) and closed on what they take (`close`); each 0..1.
    this.go = new Mover(); this.lift = new Mover(); this.turn = new Mover(); this.dig = new Mover(); this.drag = new Mover(); this.close = new Mover();
    this.from = new Array(POSE_LENGTH).fill(0); this.aim = new Array(POSE_LENGTH).fill(0); this.pose = new Array(POSE_LENGTH).fill(0); this.speed = new Array(POSE_LENGTH).fill(0);
    this.reset();
  }

  reset() {
    for (const m of [this.go, this.lift, this.turn, this.dig, this.drag, this.close]) m.set(0);
    Object.assign(this, { phase: 'idle', t: 0, still: 0, rake: 0, kind: 'dry', took: false, shape: null, shapeT: 0, shapeFor: 0.2, shapeWait: 0, order: TOGETHER, posed: false, leaving: false });
  }

  /** On the ground: the fingertips have come down (and, taking, have not left yet). */
  get landed() { return ['land', 'rest', 'rake', 'dig', 'gather', 'closed'].includes(this.phase); }
  /** Has begun to take a handful and will finish. */
  get committed() { return this.phase === 'dig' || this.phase === 'gather'; }

  enter(phase) { this.phase = phase; this.t = 0; }

  /**
   * On by `dt`.
   * @param {object} c  going (the button is held and the ground can be reached), moving (the hand is being drawn
   *   along), kind ('dry', 'wet', 'water': what is under it), holds (there is something in it), emptyFor (seconds
   *   it has been held up empty), far (how far the hand has to go to its work, metres)
   */
  step(dt, c) {
    const T = TIMES[this.kind] || TIMES.dry, quick = this.leaving ? 1.5 : 1;
    this.t += dt;
    switch (this.phase) {
      case 'idle':
        if (c.going) { this.kind = c.kind; this.took = false; this.leaving = false; this.go.to(1, this.reachTime(c.far)); this.shapeTo('reach', 0.65 * this.go.T); this.enter('reach'); }
        break;
      case 'reach':
        // (Let go before it has arrived: it comes back from where it has got to.)
        if (!c.going) { this.back(); break; }
        this.kind = c.kind;                    // (what is under it is known for sure only as it comes near)
        // (The fingers are widest two thirds of the way; then they come to what they will touch.)
        if (this.shape === 'reach' && this.go.part >= 0.65) this.shapeTo('contact', 0.35 * this.go.T);
        // (Arrived: the arm has come to its work, and a hand sent down from being held up has come down.)
        if (this.go.done && this.lift.x < 0.02) this.enter('land');
        break;
      case 'land':
        if (!c.going) { this.back(); break; }
        if (this.t >= T.settle) { this.still = c.moving ? 0 : DWELL; this.enter('rest'); }
        break;
      case 'rest':
        if (!c.going) { this.back(); break; }
        if (c.moving) { this.still = 0; this.shapeTo('rake', 0.2); this.enter('rake'); break; }
        this.still += dt;
        // Rested where it is: it takes what is under it. From here it finishes.
        if (this.still >= DWELL) { this.dig.to(1, T.dig); this.shapeTo('dig', T.dig); this.enter('dig'); }
        break;
      case 'rake':
        if (!c.going) { this.back(); break; }
        this.still = c.moving ? 0 : this.still + dt;
        if (this.still > 0.1) { this.shapeTo('contact', 0.2); this.enter('rest'); }
        break;
      case 'dig':
        if (!c.going) this.leaving = true;
        if (this.dig.done) { const g = T.gather / quick; this.drag.to(1, g); this.close.to(1, g); this.turn.to(0.5, g); this.shapeTo('closed', g - 0.09, CLOSING); this.enter('gather'); }
        break;
      case 'gather':
        if (!c.going) this.leaving = true;
        if (this.close.done) { this.took = true; this.enter('closed'); }
        break;
      case 'closed':
        // (Closed on its handful, it stays in the sand until you let go.)
        if (!c.going) this.raise(T);
        break;
      case 'lift':
        if (this.lift.done) this.enter('hold');
        break;
      case 'hold':
        if (!c.holds && c.emptyFor >= 0.5) { this.back(); break; }
        break;
      case 'back':
        if (c.going) { this.kind = c.kind; this.took = false; this.leaving = false; this.go.to(1, this.reachTime(c.far) * (0.4 + 0.6 * (1 - this.go.x))); this.lift.to(0, 0.5); this.turn.to(0, 0.5); for (const m of [this.dig, this.drag, this.close]) m.to(0, 0.3); this.shapeTo('reach', 0.3); this.enter('reach'); break; }
        if (this.go.done) { for (const m of [this.lift, this.turn, this.dig, this.drag, this.close]) m.set(0); this.took = false; this.posed = false; this.enter('idle'); }
        break;
    }
    // (Sent down again while it is held up: what it holds is let fall, and down it goes.)
    if ((this.phase === 'hold' || this.phase === 'lift') && c.going) {
      this.took = false; this.leaving = false; this.kind = c.kind;
      this.lift.to(0, 0.6); this.turn.to(0, 0.5); for (const m of [this.dig, this.drag, this.close]) m.to(0, 0.4); this.shapeTo('contact', 0.5); this.enter('reach');
    }
    for (const m of [this.go, this.lift, this.turn, this.dig, this.drag, this.close]) m.step(dt);
    const raking = this.phase === 'rake' ? 1 : 0;
    this.rake += (raking - this.rake) * (1 - Math.exp(-dt * 8));
    return this;
  }

  /** How long the reach takes: longer the further the hand has to go (humanref.js REACH.time). */
  reachTime(far = 0.45) { return Math.min(0.85, Math.max(0.55, 0.45 + 0.6 * far)); }

  /** Up with what it has taken: the palm is up by three fifths of the way, and the fingers ease from closed to a bowl. */
  raise(T) {
    this.lift.to(1, T.lift); this.turn.to(1, 0.6 * T.lift);
    this.shapeTo('cup', 0.5 * T.lift, OPENING, 0.3 * T.lift);
    this.enter('lift');
  }

  /** Back to where the arm rests, from wherever it is; a hand that had landed opens as it leaves. */
  back() {
    // (From being held up, palm up, it has further to turn than from the sand: it takes a second.)
    const far = Math.max(this.go.x, 0.15);
    this.go.to(0, (this.phase === 'hold' || this.phase === 'lift' ? 1.0 : BACK) * (0.5 + 0.5 * far));
    if (this.landed || this.phase === 'hold') this.shapeTo('release', 0.3, OPENING);
    for (const m of [this.dig, this.drag, this.close]) m.to(0, 0.3);
    this.took = false; this.enter('back');
  }

  /** The fingers set about taking the attitude `name` (handpose.js: the model's `poses`), over `T` seconds, each finger starting when `order` says, after `wait`. */
  shapeTo(name, T, order = TOGETHER, wait = 0) {
    for (let i = 0; i < POSE_LENGTH; i++) this.from[i] = this.posed ? this.aim[i] : NaN;
    this.shape = name; this.shapeT = 0; this.shapeFor = Math.max(T, 0.05); this.order = order; this.shapeWait = wait;
  }

  /**
   * Where every joint of the hand is now (handpose.js: a pose), `dt` on: the attitude it is taking, each finger in
   * its turn, followed as a finger follows what it is told, not at once. `attitude(name)`: the model's pose for a
   * name (the caller's, because what a held hand is told depends on how far you have parted the fingers).
   */
  fingers(dt, attitude) {
    const to = attitude(this.shape || 'rest');
    if (!this.posed) { for (let i = 0; i < POSE_LENGTH; i++) { this.pose[i] = this.aim[i] = this.from[i] = to[i]; this.speed[i] = 0; } this.posed = true; }
    this.shapeT += dt;
    for (let i = 0; i < POSE_LENGTH; i++) {
      const p = part(i), k = ease((this.shapeT - this.shapeWait - this.order[p]) / this.shapeFor), from = Number.isNaN(this.from[i]) ? to[i] : this.from[i];
      this.aim[i] = from + (to[i] - from) * k;
    }
    // (Followed in steps of a two hundred and fortieth of a second at most: a slow frame must not make a finger overshoot.)
    for (let left = dt; left > 1e-9;) {
      const h = Math.min(left, 1 / 240); left -= h;
      for (let i = 0; i < POSE_LENGTH; i++) { const w = FOLLOW[part(i)]; this.speed[i] += (w * w * (this.aim[i] - this.pose[i]) - 2 * DAMP * w * this.speed[i]) * h; this.pose[i] += this.speed[i] * h; }
    }
    return this.pose;
  }
}
