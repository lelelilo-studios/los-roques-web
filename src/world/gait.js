// Your feet, as feet: each one is either planted on the ground at a place in the world, where it stays whatever
// the rest of you does, or in the air on its way to the next place. Walking any way (forward, back, sideways),
// turning on the spot, stopping and starting are all the same thing here: a foot is lifted when its turn comes,
// carried to where its hip will be half way through its next stance, and put down. Nothing drags.
//
// The body above is posed from these (bodyshape.js poseBody takes `gait`): the legs reach from the hips to the
// feet, the hips dip when the feet are far apart and shift over the standing foot, the arms swing against the
// legs. Plain numbers, no three: it is measured in tests/gait.test.mjs.
//
// Frames. The world: x east, z south, heading clockwise from north (forward = (sin h, -cos h)), as the walker has
// it. The body's own: x to your right, z behind you, the origin on the ground under the middle of your hips.
// A planted foot's place is where its ankle is when it stands flat; the ankle rises and goes forward of that as
// the foot tips on its heel (landing) or on its ball (pushing off).
import { kneeStance, womanAt } from './humanref.js';
import { hash } from './motion.js';

const TAU = 2 * Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), ease = t => t * t * (3 - 2 * t), wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
/** How far the heel is lifted at the end of a full push-off (radians), and how far each foot is turned out. */
export const PUSH = 1.05, TOE_OUT = 0.12;
/**
 * Going forward her feet come in under her: half the distance apart her ankles are where they bear her (m), and
 * how far out round the standing foot the other swings in passing. (People's ankles bear them 2 to 7 cm apart at
 * her size and pass 6 to 10 cm apart: measured on the recordings, tools/ref/motion.json. Hers were 24 cm apart,
 * as far as when she stands: a track for each foot.)
 */
export const TRACK = 0.04, SWING_OUT = 0.03;
/**
 * Her two legs are not one leg and its copy: nobody's are. Walking forward, her right is the leg she pushes off
 * with the harder (it leaves the sand tipped a little further, and the pace it drives is the longer by a
 * centimetre and a half); her left swings a little higher and a little wider, and its knee gives a little more as
 * it takes her weight. Each the size recorded walkers' left and right differ by (tools/ref/motion.json; said
 * there as how alike the left's curve is to the right's half a stride on). [left, right].
 */
export const SIDED = [{ long: 0.012, clear: 1.2, push: 0.94, out: 1.5, bend: 1.08 }, { long: -0.012, clear: 0.84, push: 1.05, out: 0.6, bend: 0.93 }];
/** How far the heel is up as the toes leave the sand at a walk (radians): the foot goes on tipping after, in the air. */
const TOE_OFF = 0.77;
// (How far the toes are up as the heel touches, for how far ahead of her it touches (radians a metre): seventeen
// degrees at an ordinary pace. People in shoes land at twenty-three (the recordings); barefoot, flatter.)
const STRIKE = 1.0;
/** A curve from p0 (going at m0 a unit of w) to p1 (going at m1), over w = 0..1. */
/**
 * How far a foot has got through the air (0..1) at `w` of its swing, walking forward: it leaves the sand at `a`
 * times its mean speed and comes down at `e` times it, gathering speed through two thirds of the way and
 * braked only at the last, as the recorded walkers' ankles go (tools/ref: 0.7 of the mean as the toes leave,
 * 1.3 at four fifths, the brake in the last tenth). A foot that set off from rest and arrived at rest was
 * slow at both ends and half as fast again in the middle: the knee bent late and was thrown straight.
 */
const swung = (w, a, e) => { const c2 = 0.2 + 1.2 * Math.max(0, 0.55 - a), c4 = e + 2 * a + c2 - 3, c3 = 4 - 3 * a - 2 * c2 - e; return w * (a + w * (c2 + w * (c3 + w * c4))); };
const hermite = (w, p0, m0, p1, m1) => { const w2 = w * w, w3 = w2 * w; return (2 * w3 - 3 * w2 + 1) * p0 + (w3 - 2 * w2 + w) * m0 + (3 * w2 - 2 * w3) * p1 + (w3 - w2) * m1; };

/**
 * Length of a pace (m) at a speed (m/s), walking the way `along` (1 forward, -1 back) and `across` (1 sideways)
 * say: forward, what women's paces are for their legs at that speed (0.76 m at 1.4 m/s on a leg of 0.87 m, a
 * metre and more at a run); six tenths of that backward; a hand and a half sideways, where the feet may not
 * cross. Slow paces are short ones. `legs`: yours against 0.87 m.
 */
export function paceFor(speed, along = 1, across = 0, crouch = 0, legs = 1) {
  // (Forward: as women's paces are measured, for the length of their legs and how fast they go for it:
  // humanref.js WOMAN. Walking at 1.4 m/s on legs of 0.77 m, 0.67 m, 2.1 of them a second; running at 3 m/s, a
  // metre. It was 0.72 m at a walk for a leg of 0.87 m whatever the leg did: a twentieth short, and quick.)
  const leg = 0.87 * legs, pace = speed / Math.sqrt(9.81 * leg), k = clamp((speed - 1.6) / 1.2, 0, 1), run = k * k * (3 - 2 * k);
  // (Slower than the slowest measured, paces go on shortening at the same rate: a shuffle is short.)
  const walking = pace < 0.32 ? Math.max(0.36, 0.68 - (0.32 - pace) * 1.06) : womanAt('step', Math.min(pace, 0.64)) + Math.max(0, pace - 0.64) * 0.5;
  const fwd = (walking + (womanAt('step', pace, true) - walking) * run) * 0.87;      // (for a leg of 0.87 m: it is made yours below, with the rest)
  // (Going at a slant, the sideways share of each pace is held to what a side-step is: the pace is as long as fits
  // inside an ellipse whose axes are the forward pace and the side-step.)
  const ahead = fwd * (along < 0 ? 0.62 : 1), slant = 1 / Math.sqrt((along / ahead) ** 2 + (across / 0.17) ** 2 || 1);
  return slant * (1 - 0.45 * crouch) * legs;
}

export class Gait {
  /** @param {{hip: number, ankle: number, leg: number}} prop  half the width of the hips, the ankle's height standing flat, thigh + shin (m) */
  constructor(prop) {
    this.prop = prop;
    this.feet = [-1, 1].map(side => ({ side, x: 0, z: 0, yaw: 0, down: true, since: 9, strike: 0, pitch: 0, lift: 0, w: 0, from: null, to: null, ankle: [0, 0, 0], planted: 1, ahead: 0 }));
    this.phase = 0; this.still = 9; this.moving = false; this.shift = 0; this.next = 1; this.settling = -1; this.events = [];
  }

  /** Where foot i stands when you stand at ease at (x, z) facing `heading`: [x, z]. */
  home(i, x, z, heading, half = this.prop.hip + 0.025) {
    const side = i ? 1 : -1;
    return [x + Math.cos(heading) * side * half, z + Math.sin(heading) * side * half];
  }

  /** Standing at ease at (x, z), facing `heading`: both feet down, side by side. */
  reset(x, z, heading) {
    this.feet.forEach((f, i) => { const [hx, hz] = this.home(i, x, z, heading); Object.assign(f, { x: hx, z: hz, yaw: heading + f.side * TOE_OUT, down: true, since: 9, strike: 0, pitch: 0, lift: 0, pivot: 0, from: null, to: null, ankle: [hx, this.prop.ankle, hz], planted: 1, ahead: 0, sunk: undefined, stoodAt: undefined, landNow: null, until: undefined }); });
    this.phase = 0; this.still = 9; this.moving = false; this.shift = 0; this.shiftV = 0; this.settling = -1; this.events.length = 0;
    this.vary = [1, 1]; this.varyTo = [1, 1]; this.late = [0, 0]; this.ride = 0; this.dice = 12345; this.strides = 0; this.paces = 0; this.jumped = true;
    for (const f of this.feet) { f.v = [0, 0, 0]; f.pitchV = 0; }
  }

  /**
   * One frame.
   * @param {number} dt
   * @param {object} c  x, z, heading: where the middle of your hips is over the ground and which way your body
   *   faces; vx, vz: how you are travelling (m/s); crouch 0..1; legs: your leg against 0.87 m; base: the height
   *   the body's frame stands on; groundAt(x, z); sink: how far a planted foot goes into this ground (m);
   *   hold: true to leave the feet alone (they are placed by something else: sitting); time (s);
   *   hips: [[x, y, z], [x, y, z]], where your hip joints are in the world as last posed (left, right), if known
   * @returns {{feet: {ankle: number[], pitch: number, out: number, planted: number, down: boolean}[], shift: number,
   *   arm: number[], turn: number, amount: number, beat: number, landed: object[]}}  feet in the body's frame; `shift`: how far
   *   your hips have gone over to the right foot (m); `arm`: how far forward each arm has swung (radians);
   *   `turn`: how far the hips are turned, right hip forward positive (radians); `landed`: the feet that came
   *   down this frame: { side, x, z, yaw, stride, length }; each foot's `share`: how far through its stance a
   *   planted foot is, 0 as it lands .. 1 as it leaves, when she is going somewhere (-1 otherwise, and in the air)
   */
  update(dt, c) {
    const { prop, feet } = this, h = c.heading, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const speed = Math.hypot(c.vx, c.vz), moving = speed > 0.07 && !c.hold, crouch = c.crouch || 0, legs = c.legs || 1;
    // (Which way you are going, against the way you face: known for as long as you are moving at all, so that
    // the length of a pace does not jump as you come to rest.)
    const going = speed > 1e-3, along = going ? (c.vx * fx + c.vz * fz) / speed : 1, across = going ? (c.vx * rx + c.vz * rz) / speed : 0;
    const run = ease(clamp((speed * Math.max(along, 0) - 1.6) / 1.2, 0, 1)), stance = Math.PI * (1.2 - 0.5 * run), pace = Math.max(paceFor(speed, along, across, crouch, legs), 0.05);
    // (Sideways the feet close up and part again, and may not cross: the trailing foot comes in to a hand's breadth
    // from the other, the leading one steps out to half a metre from it. Standing wider and stepping further, as
    // it was, the legs were astride by two thirds of a metre at every step.)
    // (Going forward, they come in under her: TRACK. Slowing to a stop they part again, so that she stops standing.)
    const narrow = ease(clamp(speed * Math.max(along, 0) / 0.9, 0, 1)) * (1 - crouch) * (moving ? 1 : 0);
    const half = (prop.hip + 0.025 - 0.022 * across * across) * (1 - narrow) + TRACK * narrow;
    this.events.length = 0;
    const airborne = () => feet.some(f => !f.down);
    if (dt > 0 && !c.hold) {
      // Starting off from rest: the first foot goes at once. Sideways it is the one on the side you are going to;
      // otherwise the one further behind, or the other one from last time.
      // (Which foot that will be is settled as soon as you wish to go, before you have moved: your weight goes
      // over the other one first. `c.wish`: the way you wish to go, in the world.)
      if (!moving && !this.moving && c.wish && !airborne()) {
        const back = feet.map(f => (f.x - c.x) * c.wish[0] + (f.z - c.z) * c.wish[1]), side = c.wish[0] * rx + c.wish[1] * rz;
        this.first ??= Math.abs(side) > 0.6 ? (side > 0 ? 1 : 0) : Math.abs(back[0] - back[1]) > 0.04 ? (back[0] < back[1] ? 0 : 1) : this.next;
      } else if (!moving) this.first = null;
      if (moving && !this.moving && !airborne()) {
        const back = feet.map(f => (f.x - c.x) * c.vx + (f.z - c.z) * c.vz);
        const first = this.first ?? (Math.abs(across) > 0.6 ? (across > 0 ? 1 : 0) : Math.abs(back[0] - back[1]) > 0.04 * speed ? (back[0] < back[1] ? 0 : 1) : this.next);
        this.phase = stance - (first ? Math.PI : 0) - 1e-4; this.first = null; this.jumped = true;
      }
      this.moving = moving;
      if (moving) this.hurry = false;
      this.still = moving ? 0 : this.still + dt;
      // Standing: a foot left far from where it belongs (you stopped in mid stride, or your body has turned)
      // steps to its place, one at a time, the worse one first.
      if (!moving && !airborne() && (this.still > 0.14 || this.hurry)) {
        let worst = -1, most = 0;
        feet.forEach((f, i) => {
          const [hx, hz] = this.home(i, c.x, c.z, h), off = Math.hypot(f.x - hx, f.z - hz) / 0.085 + Math.abs(wrapPi(f.yaw - h - f.side * TOE_OUT)) / 0.4;
          if (off > 1 && off > most) { most = off; worst = i; }
        });
        if (worst >= 0) { this.phase = stance - (worst ? Math.PI : 0) - 1e-4; this.settling = worst; this.hurry = most > 2.2; this.jumped = true; }
      }
      // The clock: a pace of travel is half a turn. A foot in the air comes down within half a second whatever
      // you do (you do not stand on one leg because you stopped).
      const before = this.phase;
      let turn = moving ? Math.PI * speed * dt / pace : 0;
      // (A step in place takes a third of a second; quicker when you are turning fast and the feet have to keep up.)
      // (Going somewhere slowly, a foot is still never more than six tenths of a second in the air.)
      if (airborne() || this.settling >= 0) turn = Math.max(turn, (TAU - stance) / (moving ? 0.6 : this.hurry ? 0.2 : 0.34) * dt);
      this.phase = before + turn;
      const rate = turn / dt;
      this.rate = rate;
      feet.forEach((f, i) => {
        const u = (((before + turn + (i ? Math.PI : 0)) % TAU) + TAU) % TAU;
        // Lifted when its stance is over (if you are going anywhere, or it has a step to take); or at once if
        // you have gone so far from it that the leg cannot reach (you changed your mind about where to go).
        const due = u >= stance && f.since > 0.08 && (moving || this.settling === i), far = moving && feet[1 - i].down && Math.hypot(f.x - c.x, f.z - c.z) > 0.72 * prop.leg;
        if (f.down && (due || far)) {
          f.down = false; f.w = 0; f.from = { x: f.x, z: f.z, yaw: f.yaw, pitch: f.pitch, ankle: f.ankle.slice(), ground: c.groundAt(f.x, f.z), v: (f.v || [0, 0, 0]).slice(), pitchV: f.pitchV || 0, T: (TAU - stance) / Math.max(rate, 1e-3), run };
          this.settling = -1; this.next = 1 - i;
          // (No two paces are quite alike: each is a fortieth longer or shorter than the last and lands a few
          // millimetres to one side or the other, as people's do; and her left pace is a hundredth the longer.
          // Which, is settled by the count of her paces: the same walk is the same each time it is walked.)
          this.paces = (this.paces || 0) + 1; f.own = { long: 0.05 * (hash(this.paces, 11) - 0.5) + SIDED[i].long, wide: 0.012 * (hash(this.paces, 23) - 0.5) };
        }
        if (!f.down) {
          // In the air: `w` of the way through its swing.
          f.w = clamp(f.w + turn / (TAU - stance), 0, 1);
          const left = (1 - f.w) * (TAU - stance) / Math.max(rate, 1e-3), bx = c.x + c.vx * left, bz = c.z + c.vz * left;
          // Where it is going: where its hip will be half way through its next stance. (Forward, the ankle
          // comes down a little short of that: it is the heel that reaches.)
          // (At a walk, shorter by another twenty-fifth of a pace: the recorded walkers' ankles land 0.35 of a leg ahead
          // of the hip and leave 0.44 behind it; hers landed 0.43 ahead, her hips three centimetres behind where a
          // person's are over their feet.)
          const lead = moving ? 0.5 * stance / Math.PI * pace : 0, short = moving ? (0.075 + 0.04 * (1 - run) - 0.36 * (1.2 - stance / Math.PI) * 0.19) * pace * Math.max(along, 0) ** 2 : 0;
          const own = moving && f.own ? f.own : { long: 0, wide: 0 }, reach = lead + own.long * pace * narrow, aside = half + own.wide * narrow;
          let tx = bx + rx * f.side * aside + (moving ? c.vx / speed * reach : 0) - fx * short, tz = bz + rz * f.side * aside + (moving ? c.vz / speed * reach : 0) - fz * short;
          // (Where it is going can change while it is on its way: you set off, stop, or turn. It changes its mind
          // smoothly: a foot nearly down was otherwise thrown a hand's breadth sideways in one frame.)
          if (f.to) { const k = 1 - Math.exp(-dt * 14); tx = f.to.x + (tx - f.to.x) * k; tz = f.to.z + (tz - f.to.z) * k; }
          // (Never across the other foot: at least a hand's breadth to its own side of it.)
          const other = feet[1 - i], mine = (tx - bx) * rx + (tz - bz) * rz, theirs = (other.x - bx) * rx + (other.z - bz) * rz, apartAtLeast = 0.13 - (0.13 - 1.6 * TRACK) * narrow, room = f.side > 0 ? Math.max(mine, theirs + apartAtLeast) : Math.min(mine, theirs - apartAtLeast);
          tx += rx * (room - mine); tz += rz * (room - mine);
          f.to = { x: tx, z: tz, yaw: h + f.side * TOE_OUT };
          if (f.w >= 1) {
            // Down. (How far ahead of you it lands decides how far its toes are up as the heel touches.)
            const length = Math.hypot(tx - f.from.x, tz - f.from.z);
            f.down = true; f.x = tx; f.z = tz; f.yaw = f.to.yaw; f.since = 0; f.lift = 0; if (i === 0 && moving) this.strides = (this.strides || 0) + 1;
            f.strike = clamp(STRIKE * ((tx - c.x) * Math.sin(f.yaw) - (tz - c.z) * Math.cos(f.yaw)), 0, 0.36);
            this.events.push({ side: i, x: tx + Math.sin(f.yaw) * 0.06, z: tz - Math.cos(f.yaw) * 0.06, yaw: f.yaw, stride: speed / 1.4, length });
            f.from = f.to = null;
          }
        } else {
          f.since += dt;
          // A planted foot can be turned only so far against the body before it has to give: spun round faster
          // than you can step, it pivots on its ball, where it stands.
          const twist = wrapPi(h + f.side * TOE_OUT - f.yaw), give = Math.abs(twist) - 0.75;
          // (And it does so with its heel up, as a foot turns on its ball: the heel begins to come up as the
          // twist nears what the foot can take, and goes down again when it has come round. `f.pivot`: 0..1.)
          { const to = ease(clamp((Math.abs(twist) - 0.5) / 0.22, 0, 1)); f.pivot = (f.pivot || 0) + (to - (f.pivot || 0)) * (1 - Math.exp(-dt * (to > (f.pivot || 0) ? 30 : 9))); }
          if (give > 0) {
            const bx = f.x + Math.sin(f.yaw) * 0.126, bz = f.z - Math.cos(f.yaw) * 0.126;
            f.yaw += Math.sign(twist) * give;
            f.x = bx - Math.sin(f.yaw) * 0.126; f.z = bz + Math.cos(f.yaw) * 0.126; f.pivoted = (f.pivoted || 0) + give;
          }
        }
      });
    }
    // A run is a bounce: you are lowest as you pass over the foot that bears you, and between one foot and the
    // next you are off the ground, rising and falling as a thing thrown does. (`ride`: metres up from where
    // the hips would otherwise be.)
    let ride = 0;
    if (run > 0 && moving) {
      const u = [0, 1].map(i => (((this.phase + (i ? Math.PI : 0)) % TAU) + TAU) % TAU), on = u.findIndex(v => v < stance);
      if (on >= 0) ride = -0.055 * Math.sin(Math.PI * u[on] / stance);
      else { const v = clamp(Math.min(...u.map(q => (q - stance) / Math.max(Math.PI - stance, 1e-3)).filter(q => q >= 0)), 0, 1), T = (Math.PI - stance) / Math.max(this.rate || 1e-3, 1e-3); ride = 9.81 * T * T / 8 * 4 * v * (1 - v); }
      ride *= run;
    }
    // (`rose`: how far that has lifted the hips since they were last posed: a heel that comes up as the leg
    // needs it must know, or it comes up a frame late and the leg is drawn out straight in between.)
    this.ride ??= 0;
    const rodeAt = this.ride;
    if (dt > 0) this.ride += (ride - this.ride) * (1 - Math.exp(-dt * 28));
    const rose = this.ride - rodeAt;
    // Where each foot is now, in the body's frame.
    const A = prop.ankle, hl = A - 0.048, bl = 0.035 + A - 0.06, L = legs;
    // (The ankle when the foot is tipped up on its heel by t, or down on its ball by f: [forward, up].)
    // (Her heel is a round of 4.8 cm whose middle is a centimetre and a half behind her ankle: all but a wheel
    // about the ankle itself, so that the ankle hardly rises as the foot rolls on it: four millimetres with the
    // toes twenty degrees up. Measured on her own foot's skin. The rule had been the drawn tubes' heel, 5.2 cm
    // behind: it put her ankle a centimetre higher than that, and her heel "touched" a centimetre up in the air
    // and came down flat a tenth of a second later.)
    // (And it rolls: as the toes come down, the round goes forward over the sand by as much of itself as has turned,
    // and the ankle with it, two centimetres from the heel's touching to the foot's lying flat. It does not spin on the spot.)
    const heelUp = t => [-0.048 * t - 0.015 + 0.015 * Math.cos(t) - hl * Math.sin(t), 0.048 + 0.015 * Math.sin(t) + hl * Math.cos(t)];
    const ballDown = f => [0.126 - 0.126 * Math.cos(f) + bl * Math.sin(f), 0.025 + 0.126 * Math.sin(f) + bl * Math.cos(f)];
    const out = feet.map((f, i) => {
      let wx, wz, up, pitch, yaw, planted, ground, stood = -1;
      if (f.down) {
        const dx = Math.sin(f.yaw), dz = -Math.cos(f.yaw);
        // How far ahead of you it stands, along the way it points. Just landed ahead: on the heel, the toes
        // coming down. Left far behind: the heel has to come up, and it stands on its ball. (Late and then fast,
        // as it is in people: the heel is hardly off the ground when the other foot lands, a quarter of a
        // metre on, and sixty degrees up as the toes leave. Rising early, it folded the trailing knee to forty
        // degrees where a person's is at ten: tools/gaitcurves.mjs.)
        // (Against the way your body faces now, when the foot was put down facing another way: you have turned since.)
        { const k = ease(clamp((Math.abs(wrapPi(f.yaw - f.side * TOE_OUT - h)) - 0.15) / 0.5, 0, 1)), own = (f.x - c.x) * dx + (f.z - c.z) * dz, yours = (f.x - c.x) * fx + (f.z - c.z) * fz; f.ahead = own + (yours - own) * k; }
        // (Squatting right down, most people's heels come off the ground: they sit on the balls of their feet.)
        // (The toes come down over a seventh of a second, from the moment the heel touches and fastest soon after,
        // settling on to the sand: as the recorded feet do, flat by an eighth of the stride. They were held up
        // for a twentieth of a stride first and then let down.)
        const t = f.strike * (1 - (q => q * q * (6 - 8 * q + 3 * q * q))(Math.min(1, f.since / 0.14)));
        // The heel comes up through the last two fifths of its stance, gently and then faster, and is some forty
        // degrees up as the toes leave the sand: as people's do (the recordings: tools/ref/motion.json `footL`;
        // it used to stay flat until the last tenth and then go up fifty degrees in five frames, the knee
        // jerking with it). Going forward at a walk, that is: a short or a slow pace lifts it less; and going
        // backward or sideways it comes up only for a foot left far behind, as before.
        const u = (((this.phase + (i ? Math.PI : 0)) % TAU) + TAU) % TAU, share = moving && u < stance ? u / stance : moving && f.since > 0.25 ? 1 : 0, fwd = Math.max(along, 0) ** 2;      // (a foot can be set down a frame before the stride's clock comes round to it: it has then just landed, it is not about to leave)
        // (Where it had got to in its stance is kept when she stops going anywhere, for her hips, which do not stop
        // being held up by the leg under them because she has stopped: bodyshape.js lets the walk's hips go as the walk goes out of her.)
        if (moving) f.stoodAt = share;
        stood = moving ? share : f.stoodAt ?? -1;
        // (Gently at first and fastest as the toes leave: it goes on tipping in the air, it does not stop to be lifted.)
        const mine = SIDED[f.side < 0 ? 0 : 1], sided = (v, k = narrow) => 1 + (v - 1) * k;
        const byStance = (TOE_OFF * sided(mine.push) + 0.22 * run) * clamp((share - 0.58) / 0.42, 0, 1) ** 2.6 * clamp(pace / (0.5 * legs), 0.25, 1) * clamp(speed / 0.5, 0, 1);
        const byPlace = PUSH * clamp((-f.ahead - 0.33 * L) / (0.115 * L), 0, 1) ** 1.3;
        let push = Math.max((byStance * fwd + byPlace * (1 - fwd)) * (1 - crouch), 0.5 * ease(clamp((crouch - 0.45) / 0.5, 0, 1)), 0.4 * (f.pivot || 0));
        ground = c.groundAt(f.x, f.z);
        // And the heel comes up as far as the leg needs it to: a leg left behind you does not pull your hips
        // down after it, it goes up on to its ball until, all but straight, it reaches. (c.hips: where your hip
        // joints are in the world, as last posed. Without this the hips came down five centimetres for the
        // trailing leg just before the other foot landed, and the leading knee met the ground bent seventeen
        // degrees where a person's is at five.)
        if (c.hips && !c.hold && t <= 0.002 && f.ahead < -0.04 && crouch < 0.3) {
          // (a leg 0.4 % short of straight has its knee bent ten degrees; 1.5 % short, twenty; going forward at a walk
          // her knee is let come within five degrees of straight, as a knee does as she passes over her foot.)
          const H = c.hips[f.side < 0 ? 0 : 1], going = fwd * clamp(speed / 0.8, 0, 1) * (1 - run), straight = (0.996 + 0.0028 * going) * prop.leg;
          // (And in the last of its stance, walking, the knee is bending for the swing: ten degrees as the other
          // foot lands, thirty as the toes leave. The heel comes up as far as lets it: that is what tips the foot
          // on to its toes, not a rule of how far a foot tips.)
          const late = going * ease(clamp((share - 0.76) / 0.2, 0, 1)), most = straight + (Math.min(straight, prop.leg * Math.cos(kneeStance(share) * sided(mine.bend) / 2)) - straight) * late;
          const far = q => { const [qa, qh] = ballDown(q); return Math.hypot(f.x + dx * qa - H[0], ground + qh - (f.sunk || 0) - H[1] - rose, f.z + dz * qa - H[2]); };
          if (far(push) > most) { let lo = push, hi = 1.35; for (let n = 0; n < 14; n++) { const mid = (lo + hi) / 2; if (far(mid) > most) lo = mid; else hi = mid; } push = hi; }
        }
        // (Once it is coming up, in the last of its stance, a heel does not go down again; nor does it leap.)
        if (moving && share > 0.55 && dt > 0 && t <= 0.002) push = clamp(push, f.lift || 0, (f.lift || 0) + 8.5 * dt);
        // (And one that is up is let down, not dropped: if she stops, or sits, with a heel in the air it comes down
        // on to the sand over a tenth of a second. It was put flat in one frame, five centimetres down and as
        // far back, and her hips with it.)
        if (dt > 0 && t <= 0.002) push = Math.max(push, (f.lift || 0) - 5 * dt);
        const [a, hgt] = t > 0.002 ? heelUp(t) : ballDown(push);
        wx = f.x + dx * a; wz = f.z + dz * a; up = hgt; pitch = t > 0.002 ? t : -push; yaw = f.yaw; planted = t > 0.002 ? 1 : 1 - 0.7 * push / PUSH * (1 - crouch);
        // (Set down on the ground under it, tipped to its slope.)
        const rise = (c.groundAt(f.x + dx * 0.13, f.z + dz * 0.13) - c.groundAt(f.x - dx * 0.05, f.z - dz * 0.05)) / 0.18;
        pitch += Math.atan(clamp(rise, -0.5, 0.5)) * planted;
        f.lift = push;
      } else {
        const w = f.w, e = ease(w), from = f.from, to = f.to, d = Math.hypot(to.x - from.x, to.z - from.z), strike = clamp(STRIKE * ((to.x - c.x) * Math.sin(to.yaw) - (to.z - c.z) * Math.cos(to.yaw)), 0, 0.36);
        const [a1, h1] = heelUp(strike), ex = to.x + Math.sin(to.yaw) * a1, ez = to.z - Math.cos(to.yaw) * a1;
        const sx = from.ankle[0], sz = from.ankle[2], T = from.T || 0.35, v0 = from.v || [0, 0, 0];
        // Through the air it goes on from how it left the sand (its ankle was already coming up and forward as the
        // heel rose), and it is still going forward a little as the heel touches: a foot does not stop in the air
        // and wait to be put down. (It used to set off from rest and arrive at rest: the knee was held dead
        // straight for eight frames before each footfall.)
        wx = hermite(w, sx, clamp(v0[0], -3, 3) * T, ex, 0.14 * (ex - sx)); wz = hermite(w, sz, clamp(v0[2], -3, 3) * T, ez, 0.14 * (ez - sz));
        // (Walking forward it goes as a walker's foot goes: `swung` above. What it left the sand with across its way dies out as it goes.)
        // (At a walk: a runner's foot is another matter, and goes as it went.)
        // (As a walker's or as a runner's for the whole of this swing, whichever she was as it left the sand: breaking out of
        // a run with a foot in the air, its path was made over from the one to the other on the way.)
        const ran = from.run ?? run;
        if (narrow * (1 - ran) > 0) { const far = Math.hypot(ex - sx, ez - sz); if (far > 0.05) {
          const ux = (ex - sx) / far, uz = (ez - sz) / far, on = clamp(v0[0], -3, 3) * ux + clamp(v0[2], -3, 3) * uz, own = clamp(on * T / far, 0.15, 0.9), fast = Math.max(own, 0.62), across = (w * w * w - 2 * w * w + w) * T;
          // (As the toes roll off the sand the foot is whipped forward: from the speed its ankle had on its toes to
          // three fifths of its mean speed through the air, in a few hundredths of a second. The recorded ankles
          // do the same: 0.45 of the mean before the toes leave, 0.7 just after.)
          const got = swung(w, fast, 0.2) - (fast - own) * 0.07 * (1 - Math.exp(-w / 0.07)) * (1 - ease(w));
          const qx = sx + (ex - sx) * got + (clamp(v0[0], -3, 3) - on * ux) * across, qz = sz + (ez - sz) * got + (clamp(v0[2], -3, 3) - on * uz) * across;
          wx += (qx - wx) * narrow * (1 - ran); wz += (qz - wz) * narrow * (1 - ran); } }
        // (And out round the foot that stands, when they are set down close: people's ankles pass a hand's breadth apart.)
        const mine = SIDED[f.side < 0 ? 0 : 1];
        { const out = SWING_OUT * mine.out * narrow * Math.sin(Math.PI * w) ** 2 * f.side; wx += rx * out; wz += rz * out; }
        // (Carried forward lifted: a hand's breadth at a walk, more at a run, less for a small step.)
        // (Forward, that is; a step to the side or back only just clears the sand.)
        const ways = moving ? Math.max(along, 0) ** 2 : 0, clear = ((0.022 + 0.012 * ways) * (1 - narrow * (1 - ran)) + 0.07 * ran) * (1 - 0.6 * crouch) * clamp(0.3 + d / 0.35, 0.3, 1);
        // The foot goes on tipping as it leaves, and comes round toes up for the heel to land; the ankle, high
        // as the toes leave, goes a little higher and then down under the knee as the shin swings through.
        // (Each goes on at the rate it left the sand at, that rate dying away in a few hundredths of a second, and
        // comes round from there to how it lands.)
        const coast = (rate, tau) => rate * tau * (1 - Math.exp(-w * T / tau)), round = ease(clamp((w - 0.06) / 0.94, 0, 1));
        { const on = coast(clamp(from.pitchV || 0, -9, 4), 0.012); pitch = Math.max(-1.36, from.pitch + on + (strike - from.pitch - on) * round); }
        yaw = from.yaw + wrapPi(to.yaw - from.yaw) * e; planted = 0;
        // (Walking forward, the ankle is at its highest a fifth of the way through, a little above where the toes
        // left, and comes down from there all the way: by four fifths it is a finger's breadth over where it will
        // stand, and it is let down that last finger's breadth as the heel reaches the sand. As the recorded
        // ankles go. It used to be carried up over the middle of the swing and brought down at the end, on to
        // the sand at ten times the speed a foot is set down at.)
        // (And up: the ankle goes on rising as the foot rolls off its toes, four centimetres above where the rule of a
        // foot on its ball had it, at the rate the recorded ankles rise.)
        { const walk = narrow * (1 - ran), own = clamp(v0[1], -0.5, 1.8), rise = Math.max(own, 0.62 * prop.leg / 0.77 * (1 + (mine.clear - 1)) * walk + own * (1 - walk)), on = coast(rise, 0.05 + 0.03 * walk) - (rise - own) * 0.025 * (1 - Math.exp(-w * T / 0.025)), to = h1 + 0.007 * walk * (1 - ease(clamp((w - 0.78) / 0.22, 0, 1)));
          up = from.ankle[1] + on + (to - from.ankle[1] - on) * ease(clamp((w - 0.06 - 0.14 * walk) / (0.9 - 0.24 * walk), 0, 1)) + clear * Math.sin(Math.PI * w) ** 2; }
        // (Never so low that the toes, or the heel, would be in the sand: clear of it by a centimetre in mid swing.)
        { const need = (pitch < 0 ? ballDown(-pitch)[1] : heelUp(pitch)[1]) + 0.012 * Math.sin(Math.PI * w), k = 0.012; up = 0.5 * (up + need + Math.sqrt((up - need) ** 2 + k * k)) - 0.5 * k * (1 - Math.sin(Math.PI * w)); }
        ground = from.ground + (c.groundAt(to.x, to.z) - from.ground) * e;
        f.ahead = (wx - c.x) * fx + (wz - c.z) * fz;
        // (Where its ankle will be against you as it lands, for the hips to come down to in time: you will have
        // travelled on a little by then.)
        // (And where that is against you now, and how long until it lands: the hips ride down to a footfall and up from it
        // on one arc about where the ankle will stand, bodyshape.js.)
        { const left = (1 - f.w) * (TAU - stance) / Math.max(this.rate || 1e-3, 1e-3), lx = ex - c.x - c.vx * left, lz = ez - c.z - c.vz * left; f.land = [lx * rx + lz * rz, c.groundAt(to.x, to.z) - c.base + h1, -lx * fx - lz * fz];
          f.landNow = [(ex - c.x) * rx + (ez - c.z) * rz, f.land[1], -(ex - c.x) * fx - (ez - c.z) * fz]; f.until = left; }
      }
      // (How it is going, for when it next leaves the sand: its ankle's speed in the world and how fast it is tipping.)
      if (dt > 0) { f.v = [(wx - f.ankle[0]) / dt, (up - f.ankle[1]) / dt, (wz - f.ankle[2]) / dt]; f.pitchV = (pitch - f.pitch) / dt; }
      f.pitch = pitch; f.planted = planted;
      // (What the foot stood at when it was lifted is kept in the world: ankle = [x, height above its ground, z].)
      f.ankle[0] = wx; f.ankle[1] = up; f.ankle[2] = wz;
      // (Its weight comes on to the sand over a tenth of a second, and off it as quickly: it does not drop into its print.)
      f.sunk = dt > 0 ? (f.sunk || 0) + ((c.sink || 0) * planted - (f.sunk || 0)) * (1 - Math.exp(-dt * 22)) : (f.sunk ?? (c.sink || 0) * planted);
      const px = wx - c.x, pz = wz - c.z;
      return { ankle: [px * rx + pz * rz, ground - c.base + up - f.sunk, -px * fx - pz * fz], pitch, out: wrapPi(yaw - h), planted, down: f.down, ahead: f.ahead, w: f.down ? 1 : f.w, land: f.down ? null : f.land, landNow: f.down ? null : f.landNow, since: f.down ? f.since : -(f.until ?? 9), share: stood, bend: 1 + (SIDED[i].bend - 1) * narrow };
    });
    // Your weight goes over the foot that bears it: the hips shift a couple of centimetres that way.
    // (Nobody stands quite still: standing a while, your weight drifts slowly from one foot towards the other.)
    const idle = clamp((this.still - 1.5) / 2, 0, 1) * (c.hold ? 0 : 1) * (1 - crouch), drift = 0.011 * idle * (Math.sin((c.time || 0) * 0.31 + 1.3) + 0.4 * Math.sin((c.time || 0) * 0.83));
    // (About to set off: over the foot that will stay down, before the other leaves the sand.)
    const ready = !moving && this.first !== null && this.first !== undefined && !c.hold ? (this.first ? -0.026 : 0.026) * (1 - crouch) : 0;
    const bear = feet.map(f => (f.down ? f.planted : 0)), want = drift + ready + (bear[1] - bear[0]) / (bear[0] + bear[1] + 0.3) * 0.024 * clamp(speed / 0.8 + (airborne() ? 0.5 : 0), 0, 1) * (1 - 0.5 * run);
    // (Eased both ways: weight does not jump from one foot to the other.)
    if (dt > 0) { this.shiftV = (this.shiftV || 0) + (81 * (want - this.shift) - 18 * (this.shiftV || 0)) * dt; this.shift += this.shiftV * dt; }
    // The arms swing against the legs (an arm is forward when its own foot is back), further the faster you go;
    // and the hips turn with the stride. (An arm goes further back than forward at the shoulder, some twenty
    // degrees against ten walking: it is the elbow, bending as the arm comes forward, that brings the hand up
    // in front of you. Swung as far forward as back, the hand reached out two hand's lengths at every pace.)
    // (And nobody's two arms swing alike: the left a little less.)
    const reachOf = v => (v > 0 ? 0.62 * v : 1.15 * v);
    // (How far the one foot is ahead of the other, by their ankles, which go on smoothly as a foot leaves the
    // sand: a planted foot's place and a swinging foot's ankle are a hand's breadth apart at that moment, and
    // arms and hips made from the one and then the other stood still for five frames and then leapt.)
    const apart = clamp((out[0].ankle[2] - out[1].ankle[2]) / (0.75 * legs), -1, 1), swing = 0.3 * clamp(speed / 1.3, 0, 1.5) ** 0.8 * (1 - 0.75 * crouch);
    // (`beat`: 1 a moment after a foot has come down, as your weight comes on to it, 0 half way between: the hips
    // are lowest at the one, highest at the other. At the footfall itself the knee is nearly straight; it gives
    // as it takes your weight.)
    // (Nor does one stride's swing match the last: each arm's reach drifts by a seventh either way, taking a new
    // measure as its own foot comes down; and the left arm's swing is shaped a little differently, forward a
    // little more and back a little less. Two limbs, not one and its reflection.)
    this.vary ??= [1, 1]; this.varyTo ??= [1, 1]; this.late ??= [0, 0]; this.dice ??= 12345; this.ride ??= 0;
    for (const e of this.events) { this.dice = (Math.imul(this.dice, 1103515245) + 12345) & 0x7fffffff; this.varyTo[e.side] = 0.86 + 0.28 * this.dice / 0x7fffffff; }
    const reachL = v => (v > 0 ? 0.76 * v : 1.02 * v), reach = [0.92 * reachL(apart * swing) * this.vary[0], reachOf(-apart * swing) * this.vary[1]];
    if (dt > 0) for (let i = 0; i < 2; i++) {
      this.vary[i] += (this.varyTo[i] - this.vary[i]) * (1 - Math.exp(-dt * 4));
      // (The forearm follows the upper arm a tenth of a second late: an elbow is a hinge with a weight on it.)
      this.late[i] += (reach[i] - this.late[i]) * (1 - Math.exp(-dt / 0.1));
    }
    // The pelvis lists: as your weight goes over one foot the other hip drops, three degrees or so. It is at
    // its most just after the other foot has left the ground, well before your weight is furthest
    // over (so it is taken a little ahead of the shift), and nearly level again as you pass over the foot: which
    // is why it hardly lowers the top of each rise (Gard and Childress, 1997).
    const list = clamp((this.shift + 0.3 * (this.shiftV || 0)) / 0.024, -1.6, 1.6) * 0.04;
    const jumped = this.jumped; this.jumped = false;
    /** `psi`: where she is in her stride, 0 as her left foot comes down .. 1 as it comes down again; `strideRate`: strides a second; `toeOff`: the share of a stride a foot is down; `jumped`: the stride's clock was set afresh this frame (a start, a settling step); `strides`: how many she has taken; `narrow`: how far her feet are in under her, 0..1. */
    return { psi: (((this.phase % TAU) + TAU) % TAU) / TAU, strideRate: (this.rate || 0) / TAU, toeOff: stance / TAU, jumped, strides: this.strides || 0, narrow, moving, feet: out, shift: this.shift, arm: reach, armLate: this.late.slice(), list, ride: this.ride, run, turn: 0.1 * apart * clamp(speed / 1.0, 0, 1), amount: clamp(speed / 0.6, 0, 1), along: Math.max(along, 0) ** 2, beat: c.hold ? 0 : Math.cos(this.phase - 0.08) ** 4 * clamp(speed / 0.5, 0, 1), pace, landed: this.events };
  }
}
