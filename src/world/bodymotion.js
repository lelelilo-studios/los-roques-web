// What of her movement is a recorded person's: where she is in her stride, and from that the attitude of her
// pelvis, her back and chest, her head's small movements, both arms, and how her hips ride and sway, each read
// off the curves of one real walker (humanmotion.js) and made the size a woman's are at her pace (humanref.js
// WOMAN). Her feet stay her own (gait.js places them on this sand): the curves are keyed to her footfalls, so
// what her body does above them is in time with them as his was.
//
// All that her body remembers from frame to frame is kept here: how much of a steady walk she is in, where each
// measure was (so that when the stride's clock is set afresh, at a start or a settling step, the difference is
// taken up and dies away: nothing jumps), and which stride this is (no two are alike: each differs from the
// usual one along the ways his own strides differed, by an amount that wanders from stride to stride).
// Plain numbers, no three: it is run in tests and tools as it is in the page.
import { WALK } from './humanmotion.js';
import { womanAt } from './humanref.js';
import { Follower, Inertial, noise1 } from './motion.js';

const RAD = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const waveAt = (w, u) => { let v = w[0]; for (let k = 1; 2 * k < w.length; k++) v += w[2 * k - 1] * Math.cos(2 * Math.PI * k * u) + w[2 * k] * Math.sin(2 * Math.PI * k * u); return v; };
/** The measures driven, as humanmotion.js names them (measure.js has what each is, and its sign). */
export const DRIVEN = Object.keys(WALK.shape);

/**
 * How large each measure is for her, peak to peak (radians; rise and sway in metres), walking at `pace`
 * (v / sqrt(g L)) on legs of `leg` metres. Where women have been measured (WOMAN) it is theirs; where they have
 * not, it is the recorded walker's own, grown or shrunk with the pace as the pelvis's turn is.
 */
export function sizes(pace, leg) {
  const W = name => womanAt(name, pace) * RAD, his = WALK.size, withPace = womanAt('pelvisTurn', pace) / womanAt('pelvisTurn', WALK.pace);
  // (Arms: people differ here more than anywhere, by a third either way. She is given four fifths of the
  // women's middle, the left a sixteenth more than the right as theirs are; and her elbow four fifths of
  // theirs: an easy walker, not a marcher.)
  const arm = 0.78 * W('arm'), elbow = 0.72 * W('elbow');
  return {
    // (Her chest as it is in the world: it turns less than her pelvis and against it, and lists hardly at all.
    // Its turn and list against her pelvis follow from the two. The library's chest and the women's study's are
    // not cut from the back at the same place, so the one's angles against the pelvis are not the other's.)
    // (Her pelvis lists four fifths as far as the women's middle, which is well within how they differ. It is at its
    // most as a heel touches, the side of that heel the lower; with all of it, the hip over the landing foot was
    // two and a half centimetres under the other, more than her legs' lengths leave room for with both knees all
    // but straight, and she landed on a knee bent seventeen degrees.)
    pelvisTurn: W('pelvisTurn'), pelvisList: 0.8 * W('pelvisList'), pelvisTilt: his.pelvisTilt * withPace, chestYaw: W('chestYaw'), chestRoll: W('chestRoll'), chestTilt: his.chestTilt * withPace,
    // (Her head: the women measured kept theirs stiller than the men; his, less a fifth.)
    headYaw: 0.8 * his.headYaw, headNod: 0.8 * his.headNod, headRoll: 0.8 * his.headRoll,
    armL: 1.06 * arm, armR: 0.94 * arm, armOutL: his.armOutL * 0.8, armOutR: his.armOutR * 1.1, elbowL: 1.03 * elbow, elbowR: 0.97 * elbow, elbowWayL: his.elbowWayL, elbowWayR: his.elbowWayL * 1.1,
    kneeWayL: his.kneeWayL, kneeWayR: his.kneeWayR,
    // (The pelvis rides as the body's centre does, and sways half as far again: it goes over each foot, and the chest leans back against it.)
    pelvisRise: womanAt('rise', pace) * leg, pelvisSway: womanAt('sway', pace) * 1.45 * leg,
  };
}
/** Where each measure sits, about which it moves (radians): the arms as he carries them, a little evened out between left and right. */
export const MIDDLE = { armL: 0.01, armR: 0.03, armOutL: 0.085, armOutR: 0.07, elbowL: 0.5, elbowR: 0.47, elbowWayL: -0.12, elbowWayR: -0.2 };

export class BodyMotion {
  /** @param {number} leg  her leg, thigh and shin (m) */
  constructor(leg = 0.77) {
    this.leg = leg; this.amount = new Follower({ omega: 5.5, zeta: 1 }); this.take = {};
    for (const c of DRIVEN) this.take[c] = new Inertial(7);
    this.was = null; this.now = null; this.turns = 0; this.psiWas = null;
    /** What the solver keeps for her from one frame to the next (bodyshape.js poseBody): how high her hips ride and how fast they are going there, the height her legs last asked for, and how far under their standing height that left them. */
    this.keep = { hipY: null, hipV: 0, high: null, sunk: undefined };
  }
  /** Put down somewhere: nothing of where she was is carried over. */
  reset() { this.amount.set(0); for (const c of DRIVEN) this.take[c].clear(); this.was = null; this.now = null; this.turns = 0; this.psiWas = null; this.keep = { hipY: null, hipV: 0, high: null, sunk: undefined }; }

  /**
   * One frame.
   * @param {number} dt
   * @param {object} g  the gait's frame (gait.js update): psi, strides, jumped, amount, along, run
   * @param {object} c  speed (m/s), crouch 0..1
   * @returns {object} `amount` (0 standing .. 1 in a steady walk forward), `psi`, and each measure as it is now,
   *   about its own middle and already made her size and scaled by `amount` (measure.js names and signs);
   *   `middle`: where the arms sit (MIDDLE, scaled by `amount`)
   */
  step(dt, g, c) {
    const run = g.run || 0, pace = c.speed / Math.sqrt(9.81 * this.leg);
    // (How much of a steady walk forward she is in: it comes on over a pace or two as she sets off, as arms do.)
    // (And goes off a little quicker than it came, as she stops.)
    const want = clamp((g.amount || 0) * (g.along ?? 1) * (1 - (c.crouch || 0)) * (g.moving === false ? 0 : 1), 0, 1) * (1 - run), amount = Math.max(0, this.amount.step(dt, want, want < this.amount.x ? 8 : 5.5));
    const size = sizes(Math.max(pace, 0.2), this.leg), psi = g.psi || 0, out = { amount, psi, middle: {}, keep: this.keep, dt, speed: c.speed || 0 };
    // (This stride against her usual one: how far along each of his ways of differing. It wanders smoothly
    // through the stride, by the count of her strides, so that it is the same wherever the clock is read.)
    // (The strides are counted here, as the clock comes round: the gait counts them as her left foot lands, which
    // at a run is a frame or two after, and for that frame she was a whole stride back in her wandering.)
    if (this.psiWas !== null && !g.jumped) this.turns += psi < this.psiWas - 0.5 ? 1 : psi > this.psiWas + 0.5 ? -1 : 0;
    this.psiWas = psi;
    const along = this.turns + psi, score = WALK.modes.map((m, k) => 1.7 * m.sd * noise1(101 + k, along * 0.83 + k * 3.1));
    for (const name of DRIVEN) {
      let v = waveAt(WALK.shape[name], psi);
      WALK.modes.forEach((m, k) => { v += score[k] * waveAt(m.shape[name], psi); });
      out[name] = v * size[name] * amount;
    }
    // (The stride's clock set afresh, or her first frame: what each measure was doing less what it would now do
    // is taken up, and let go to nothing over a third of a second.)
    if (this.was && (g.jumped || this.fresh)) for (const name of DRIVEN) this.take[name].kick(this.was[name] - out[name] - this.take[name].x);
    this.fresh = false;
    for (const name of DRIVEN) out[name] += this.take[name].step(dt);
    this.was = { ...out };
    for (const [name, v] of Object.entries(MIDDLE)) out.middle[name] = v;
    this.now = out;
    return out;
  }
}
