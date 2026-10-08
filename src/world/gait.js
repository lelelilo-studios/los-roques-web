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
const TAU = 2 * Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), ease = t => t * t * (3 - 2 * t), wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
/** How far the heel is lifted at the end of a full push-off (radians), and how far each foot is turned out. */
export const PUSH = 1.05, TOE_OUT = 0.12;

/**
 * Length of a pace (m) at a speed (m/s), walking the way `along` (1 forward, -1 back) and `across` (1 sideways)
 * say: 0.72 m forward at a walk, lengthening to 1.05 m at a run; six tenths of that backward; a quarter of a
 * metre sideways, where the feet may not cross. Slow paces are short ones. `legs`: yours against 0.87 m.
 */
export function paceFor(speed, along = 1, across = 0, crouch = 0, legs = 1) {
  const k = clamp((speed - 1.6) / 1.2, 0, 1), fwd = (0.72 + 0.33 * k * k * (3 - 2 * k)) * (0.55 + 0.45 * clamp(speed / 1.1, 0, 1));
  // (Going at a slant, the sideways share of each pace is held to what a side-step is: the pace is as long as fits
  // inside an ellipse whose axes are the forward pace and the side-step.)
  const ahead = fwd * (along < 0 ? 0.62 : 1), slant = 1 / Math.sqrt((along / ahead) ** 2 + (across / 0.26) ** 2 || 1);
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
    this.feet.forEach((f, i) => { const [hx, hz] = this.home(i, x, z, heading); Object.assign(f, { x: hx, z: hz, yaw: heading + f.side * TOE_OUT, down: true, since: 9, strike: 0, pitch: 0, lift: 0, from: null, to: null, ankle: [hx, this.prop.ankle, hz], planted: 1, ahead: 0, sunk: undefined }); });
    this.phase = 0; this.still = 9; this.moving = false; this.shift = 0; this.shiftV = 0; this.settling = -1; this.events.length = 0;
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
   *   down this frame: { side, x, z, yaw, stride, length }
   */
  update(dt, c) {
    const { prop, feet } = this, h = c.heading, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const speed = Math.hypot(c.vx, c.vz), moving = speed > 0.07 && !c.hold, crouch = c.crouch || 0, legs = c.legs || 1;
    // (Which way you are going, against the way you face: known for as long as you are moving at all, so that
    // the length of a pace does not jump as you come to rest.)
    const going = speed > 1e-3, along = going ? (c.vx * fx + c.vz * fz) / speed : 1, across = going ? (c.vx * rx + c.vz * rz) / speed : 0;
    const run = ease(clamp((speed * Math.max(along, 0) - 1.6) / 1.2, 0, 1)), stance = Math.PI * (1.2 - 0.5 * run), pace = Math.max(paceFor(speed, along, across, crouch, legs), 0.05);
    // (Sideways you stand wider: the feet close up and part again, and may not cross.)
    const half = prop.hip + 0.025 + 0.05 * across * across;
    this.events.length = 0;
    const airborne = () => feet.some(f => !f.down);
    if (dt > 0 && !c.hold) {
      // Starting off from rest: the first foot goes at once. Sideways it is the one on the side you are going to;
      // otherwise the one further behind, or the other one from last time.
      if (moving && !this.moving && !airborne()) {
        const back = feet.map(f => (f.x - c.x) * c.vx + (f.z - c.z) * c.vz);
        const first = Math.abs(across) > 0.6 ? (across > 0 ? 1 : 0) : Math.abs(back[0] - back[1]) > 0.04 * speed ? (back[0] < back[1] ? 0 : 1) : this.next;
        this.phase = stance - (first ? Math.PI : 0) - 1e-4;
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
        if (worst >= 0) { this.phase = stance - (worst ? Math.PI : 0) - 1e-4; this.settling = worst; this.hurry = most > 2.2; }
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
          f.down = false; f.w = 0; f.from = { x: f.x, z: f.z, yaw: f.yaw, pitch: f.pitch, ankle: f.ankle.slice(), ground: c.groundAt(f.x, f.z) };
          this.settling = -1; this.next = 1 - i;
        }
        if (!f.down) {
          // In the air: `w` of the way through its swing.
          f.w = clamp(f.w + turn / (TAU - stance), 0, 1);
          const left = (1 - f.w) * (TAU - stance) / Math.max(rate, 1e-3), bx = c.x + c.vx * left, bz = c.z + c.vz * left;
          // Where it is going: where its hip will be half way through its next stance. (Forward, the ankle
          // comes down a little short of that: it is the heel that reaches.)
          const lead = moving ? 0.5 * stance / Math.PI * pace : 0, short = moving ? (0.114 - 0.36 * (1.2 - stance / Math.PI) * 0.19) * pace * Math.max(along, 0) ** 2 : 0;
          let tx = bx + rx * f.side * half + (moving ? c.vx / speed * lead : 0) - fx * short, tz = bz + rz * f.side * half + (moving ? c.vz / speed * lead : 0) - fz * short;
          // (Where it is going can change while it is on its way: you set off, stop, or turn. It changes its mind
          // smoothly: a foot nearly down was otherwise thrown a hand's breadth sideways in one frame.)
          if (f.to) { const k = 1 - Math.exp(-dt * 14); tx = f.to.x + (tx - f.to.x) * k; tz = f.to.z + (tz - f.to.z) * k; }
          // (Never across the other foot: at least a hand's breadth to its own side of it.)
          const other = feet[1 - i], mine = (tx - bx) * rx + (tz - bz) * rz, theirs = (other.x - bx) * rx + (other.z - bz) * rz, room = f.side > 0 ? Math.max(mine, theirs + 0.13) : Math.min(mine, theirs - 0.13);
          tx += rx * (room - mine); tz += rz * (room - mine);
          f.to = { x: tx, z: tz, yaw: h + f.side * TOE_OUT };
          if (f.w >= 1) {
            // Down. (How far ahead of you it lands decides how far its toes are up as the heel touches.)
            const length = Math.hypot(tx - f.from.x, tz - f.from.z);
            f.down = true; f.x = tx; f.z = tz; f.yaw = f.to.yaw; f.since = 0;
            f.strike = clamp(0.8 * ((tx - c.x) * Math.sin(f.yaw) - (tz - c.z) * Math.cos(f.yaw)), 0, 0.3);
            this.events.push({ side: i, x: tx + Math.sin(f.yaw) * 0.06, z: tz - Math.cos(f.yaw) * 0.06, yaw: f.yaw, stride: speed / 1.4, length });
            f.from = f.to = null;
          }
        } else {
          f.since += dt;
          // A planted foot can be turned only so far against the body before it has to give: spun round faster
          // than you can step, it pivots on its ball, where it stands.
          const twist = wrapPi(h + f.side * TOE_OUT - f.yaw), give = Math.abs(twist) - 0.75;
          if (give > 0) {
            const bx = f.x + Math.sin(f.yaw) * 0.126, bz = f.z - Math.cos(f.yaw) * 0.126;
            f.yaw += Math.sign(twist) * give;
            f.x = bx - Math.sin(f.yaw) * 0.126; f.z = bz + Math.cos(f.yaw) * 0.126; f.pivoted = (f.pivoted || 0) + give;
          }
        }
      });
    }
    // Where each foot is now, in the body's frame.
    const A = prop.ankle, hl = 0.026 + A - 0.06, bl = 0.035 + A - 0.06, L = legs;
    // (The ankle when the foot is tipped up on its heel by t, or down on its ball by f: [forward, up]. bodyshape.js footAt.)
    const heelUp = t => [-0.052 + 0.052 * Math.cos(t) - hl * Math.sin(t), 0.034 + 0.052 * Math.sin(t) + hl * Math.cos(t)];
    const ballDown = f => [0.126 - 0.126 * Math.cos(f) + bl * Math.sin(f), 0.025 + 0.126 * Math.sin(f) + bl * Math.cos(f)];
    const out = feet.map(f => {
      let wx, wz, up, pitch, yaw, planted, ground;
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
        const t = f.strike * (1 - Math.min(1, f.since / 0.11)) ** 2;
        // (By rule, only in the last tenth of its stance, once the other foot is down: from a third of a metre
        // behind you to four tenths, where it leaves the ground. Before that it rises only as the leg needs: below.)
        let push = Math.max(PUSH * clamp((-f.ahead - 0.33 * L) / (0.115 * L), 0, 1) ** 1.3, 0.5 * ease(clamp((crouch - 0.45) / 0.5, 0, 1)));
        ground = c.groundAt(f.x, f.z);
        // And the heel comes up as far as the leg needs it to: a leg left behind you does not pull your hips
        // down after it, it goes up on to its ball until, all but straight, it reaches. (c.hips: where your hip
        // joints are in the world, as last posed. Without this the hips came down five centimetres for the
        // trailing leg just before the other foot landed, and the leading knee met the ground bent seventeen
        // degrees where a person's is at five.)
        if (c.hips && !c.hold && t <= 0.002 && f.ahead < -0.04 && crouch < 0.3) {
          const H = c.hips[f.side < 0 ? 0 : 1], most = 0.996 * prop.leg;       // (a leg 0.4 % short of straight has its knee bent ten degrees; 1.5 % short, twenty)
          const far = q => { const [qa, qh] = ballDown(q); return Math.hypot(f.x + dx * qa - H[0], ground + qh - (f.sunk || 0) - H[1], f.z + dz * qa - H[2]); };
          if (far(push) > most) { let lo = push, hi = PUSH; for (let n = 0; n < 7; n++) { const mid = (lo + hi) / 2; if (far(mid) > most) lo = mid; else hi = mid; } push = hi; }
        }
        const [a, hgt] = t > 0.002 ? heelUp(t) : ballDown(push);
        wx = f.x + dx * a; wz = f.z + dz * a; up = hgt; pitch = t > 0.002 ? t : -push; yaw = f.yaw; planted = t > 0.002 ? 1 : 1 - 0.7 * push / PUSH * (1 - crouch);
        // (Set down on the ground under it, tipped to its slope.)
        const rise = (c.groundAt(f.x + dx * 0.13, f.z + dz * 0.13) - c.groundAt(f.x - dx * 0.05, f.z - dz * 0.05)) / 0.18;
        pitch += Math.atan(clamp(rise, -0.5, 0.5)) * planted;
        f.lift = push;
      } else {
        const e = ease(f.w), from = f.from, to = f.to, d = Math.hypot(to.x - from.x, to.z - from.z), strike = clamp(0.8 * ((to.x - c.x) * Math.sin(to.yaw) - (to.z - c.z) * Math.cos(to.yaw)), 0, 0.3);
        const [a1, h1] = heelUp(strike), ex = to.x + Math.sin(to.yaw) * a1, ez = to.z - Math.cos(to.yaw) * a1;
        const sx = from.ankle[0], sz = from.ankle[2];
        wx = sx + (ex - sx) * e; wz = sz + (ez - sz) * e;
        // (Carried forward lifted: a hand's breadth at a walk, more at a run, less for a small step.)
        // (Forward, that is; a step to the side or back only just clears the sand.)
        const ways = moving ? Math.max(along, 0) ** 2 : 0, clear = (0.04 + 0.03 * ways + 0.06 * run) * (1 - 0.6 * crouch) * clamp(0.3 + d / 0.35, 0.3, 1);
        // (Highest a third of the way through the swing, and almost down again well before it lands: the leg
        // straightens out in front of you before the heel touches.)
        // (The ankle, high as the toes leave, is down to its carrying height by two thirds of the swing: the shin
        // swings through under the knee, it is not held up behind.)
        up = from.ankle[1] + (h1 - from.ankle[1]) * ease(Math.min(1, f.w * 1.5)) + clear * 1.7 * Math.sin(Math.PI * f.w) * (1 - f.w);
        pitch = from.pitch + (strike - from.pitch) * ease(clamp((f.w - 0.15) / 0.8, 0, 1)); yaw = from.yaw + wrapPi(to.yaw - from.yaw) * e; planted = 0;
        ground = from.ground + (c.groundAt(to.x, to.z) - from.ground) * e;
        f.ahead = (wx - c.x) * fx + (wz - c.z) * fz;
        // (Where its ankle will be against you as it lands, for the hips to come down to in time: you will have
        // travelled on a little by then.)
        { const left = (1 - f.w) * (TAU - stance) / Math.max(this.rate || 1e-3, 1e-3), lx = ex - c.x - c.vx * left, lz = ez - c.z - c.vz * left; f.land = [lx * rx + lz * rz, c.groundAt(to.x, to.z) - c.base + h1, -lx * fx - lz * fz]; }
      }
      f.pitch = pitch; f.planted = planted;
      // (What the foot stood at when it was lifted is kept in the world: ankle = [x, height above its ground, z].)
      f.ankle[0] = wx; f.ankle[1] = up; f.ankle[2] = wz;
      // (Its weight comes on to the sand over a tenth of a second, and off it as quickly: it does not drop into its print.)
      f.sunk = dt > 0 ? (f.sunk || 0) + ((c.sink || 0) * planted - (f.sunk || 0)) * (1 - Math.exp(-dt * 22)) : (f.sunk ?? (c.sink || 0) * planted);
      const px = wx - c.x, pz = wz - c.z;
      return { ankle: [px * rx + pz * rz, ground - c.base + up - f.sunk, -px * fx - pz * fz], pitch, out: wrapPi(yaw - h), planted, down: f.down, ahead: f.ahead, w: f.down ? 1 : f.w, land: f.down ? null : f.land };
    });
    // Your weight goes over the foot that bears it: the hips shift a couple of centimetres that way.
    // (Nobody stands quite still: standing a while, your weight drifts slowly from one foot towards the other.)
    const idle = clamp((this.still - 1.5) / 2, 0, 1) * (c.hold ? 0 : 1) * (1 - crouch), drift = 0.011 * idle * (Math.sin((c.time || 0) * 0.31 + 1.3) + 0.4 * Math.sin((c.time || 0) * 0.83));
    const bear = feet.map(f => (f.down ? f.planted : 0)), want = drift + (bear[1] - bear[0]) / (bear[0] + bear[1] + 0.3) * 0.024 * clamp(speed / 0.8 + (airborne() ? 0.5 : 0), 0, 1) * (1 - 0.5 * run);
    // (Eased both ways: weight does not jump from one foot to the other.)
    if (dt > 0) { this.shiftV = (this.shiftV || 0) + (81 * (want - this.shift) - 18 * (this.shiftV || 0)) * dt; this.shift += this.shiftV * dt; }
    // The arms swing against the legs (an arm is forward when its own foot is back), further the faster you go;
    // and the hips turn with the stride. (An arm goes further back than forward at the shoulder, some twenty
    // degrees against ten walking: it is the elbow, bending as the arm comes forward, that brings the hand up
    // in front of you. Swung as far forward as back, the hand reached out two hand's lengths at every pace.)
    // (And nobody's two arms swing alike: the left a little less.)
    const reachOf = v => (v > 0 ? 0.62 * v : 1.15 * v);
    const apart = clamp((out[1].ahead - out[0].ahead) / (0.75 * legs), -1, 1), swing = 0.3 * clamp(speed / 1.3, 0, 1.5) ** 0.8 * (1 - 0.75 * crouch);
    // (`beat`: 1 a moment after a foot has come down, as your weight comes on to it, 0 half way between: the hips
    // are lowest at the one, highest at the other. At the footfall itself the knee is nearly straight; it gives
    // as it takes your weight.)
    return { feet: out, shift: this.shift, arm: [0.92 * reachOf(apart * swing), reachOf(-apart * swing)], turn: 0.1 * apart * clamp(speed / 1.0, 0, 1), amount: clamp(speed / 0.6, 0, 1), along: Math.max(along, 0) ** 2, beat: c.hold ? 0 : Math.cos(this.phase - 0.08) ** 4 * clamp(speed / 0.5, 0, 1), pace, landed: this.events };
  }
}
