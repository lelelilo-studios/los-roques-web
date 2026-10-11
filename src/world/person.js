// Her body over her feet, for one moment: the gait places her feet, the solver poses her over them, her skeleton
// is set and her eye found. It is the part of the app's `advance` that poses her, in a file of its own with
// nothing of the page in it (no three, no DOM, no sound), so that a whole doing can be run in a test or a tool
// in milliseconds. What the world is (the ground's height, what her hands are doing, the boat that carries her)
// is handed in each frame.
//
// `you` is her body as last posed: where its own frame stands in the world (x, z, and y, the height of the
// ground it stands on), which way it faces (heading; cy, sy), how far the hips are down for the legs to reach
// (`dip`), where the ground under her weight is in that frame (`home`); `on`: on her feet or seated, as against
// swimming. `seated`: how far her legs are drawn up (0..1), how wide her feet (0..1), her toes (radians), and
// how far back she leans.
import { BodyMotion } from './bodymotion.js';
import { Follower } from './motion.js';

export class Person {
  /**
   * @param {object} o
   * @param {import('./gait.js').Gait} o.gait
   * @param {{joints: object, pose: (p: object) => void}} o.body  the solver, wrapped (world/body.js Body, or bodyshape.js Solver)
   * @param {import('../camera/walk.js').Walker} o.walker
   * @param {object} [o.seated]  her legs and lean when she sits, if the caller keeps them
   */
  constructor({ gait, body, walker, seated = null }) {
    this.gait = gait; this.body = body; this.walker = walker;
    /** Her skeleton (figurepose.js FigureRig), once her files have come. */
    this.rig = null;
    this.you = { on: false, was: '', x: 0, y: 0, z: 0, cy: 1, sy: 0, heading: 0, dip: 0, home: [0, 0, 0.08], folded: false, eyeUp: 1.5, reachable: null };
    this.seated = seated || { draw: 0, splay: 0, wiggle: 0, lean: 0.22 };
    /** What of her movement is a recorded person's, and all her body remembers of it (bodymotion.js). */
    this.motion = new BodyMotion(gait.prop.leg);
    // Where you look, your eyes are at once; her head comes round after them, a tenth of a second and a little
    // behind, and her chest after her head: eyes, head, shoulders, as a person looks round. (`headTurn`,
    // `headLook`: where her head has got to, against her body and up or down; `chestLook`: what her chest has
    // taken of it. Her head used to be wherever you looked in the same frame, level and exact: a turret.)
    this.headTurn = new Follower({ omega: 16, zeta: 1 }); this.headLook = new Follower({ omega: 16, zeta: 1 }); this.chestLook = new Follower({ omega: 8, zeta: 1 }); this.lookFresh = true;
  }

  /** A point of the world as her boat's pitch and roll leave it, when it carries her (turned about her seat); itself otherwise. */
  tilted(w) { const t = this.you.tilt; if (!t) return w; const d = [w[0] - t.at[0], w[1] - t.at[1], w[2] - t.at[2]], R = t.R; return [t.at[0] + R[0][0] * d[0] + R[0][1] * d[1] + R[0][2] * d[2], t.at[1] + R[1][0] * d[0] + R[1][1] * d[1] + R[1][2] * d[2], t.at[2] + R[2][0] * d[0] + R[2][1] * d[1] + R[2][2] * d[2]]; }
  /** A point of her body's own frame, in the world. */
  toWorld(q) { const you = this.you; return this.tilted([you.x + q[0] * you.cy - q[2] * you.sy, you.y + q[1], you.z + q[0] * you.sy + q[2] * you.cy]); }

  /**
   * The start of a frame on her feet or her seat: which way her body faces and how far her head is turned on it,
   * and her feet put under her if she has just been put down somewhere, come out of the water, got up, or is on
   * her way into her boat or out of it. `aboard`: the boat has her (her head then turns only as far as a head does).
   * Returns { heading, cy, sy, feetY, turn, state }.
   */
  begin({ aboard = false } = {}) {
    const { walker, you, gait } = this;
    const heading = walker.heading, cy = Math.cos(heading), sy = Math.sin(heading), feetY = walker.eyeY - walker.body;
    // (Aboard you look where you like and your body stays in its seat: your head turns as far as a head does.)
    const turnAll = Math.atan2(Math.sin(walker.yaw - heading), Math.cos(walker.yaw - heading)), turn = aboard ? Math.max(-1.45, Math.min(1.45, turnAll)) : turnAll, state = walker.sitting ? 'sit' : 'stand';
    // (Put down somewhere, come out of the water, sat down or got up: your feet are under you. On your way into
    // your boat or out of it they go with you.)
    if (!you.on || walker.placed || (you.was === 'sit' && state === 'stand') || (walker.carried && walker.seated < 1) || you.carriedWas !== !!walker.carried) { gait.reset(walker.x, walker.z, heading); you.dip = you.dipV = you.deep = you.deepS = you.peak = you.shallow = 0; this.motion.reset(); }
    if (!you.on || walker.placed) this.lookFresh = true;
    you.was = state; walker.placed = false; you.carriedWas = !!walker.carried;
    return { heading, cy, sy, feetY, turn, state };
  }

  /**
   * Her feet moved on, her body posed over them, her skeleton set, her eye found (`walker.head`).
   * @param {number} dt
   * @param {object} c  what `begin` gave (heading, cy, sy, feetY, turn), and: input (the keys), time (s), sink (how
   *   far a planted foot goes into this ground, m), seatSink (and her seat and heels, sitting), groundAt(x, z),
   *   reach, reachL (what each hand is to do: world/hand.js plan), reachable (kept for the hands), carried (null,
   *   or the bench she is on: { recline, drop, grip() }), tiltNow(): the boat's attitude about her seat, or null,
   *   floatAt: where her eye would be afloat, stood: 0 swimming .. 1 on her feet
   * @returns {{g: object, j: object}}  the gait's frame (g.landed: the feet that came down) and her joints
   */
  pose(dt, c) {
    const { walker, you, gait, body, seated } = this, figureRig = this.rig;
    const { input, heading, cy, sy, feetY, reach, reachL } = c;
    // (Her head is never more than thirteen degrees behind your look, so that your eye, which rides nine centimetres
    // ahead of her neck, is never two centimetres from where your look would have it; and it is there within a
    // quarter of a second. The camera looks where you look, exactly and at once: app.js.)
    const behind = (f, to, most) => { f.step(dt, to); if (Math.abs(f.x - to) > most) f.x = to + Math.sign(f.x - to) * most; return f.x; };
    if (this.lookFresh || !(dt > 0)) { this.headTurn.set(c.turn); this.headLook.set(walker.look); this.chestLook.set(c.turn); this.lookFresh = false; }
    const turn = behind(this.headTurn, c.turn, 0.23), look = behind(this.headLook, walker.look, 0.25), chest = this.chestLook.step(dt, turn);
    // (Her hips as her skeleton has them: a few millimetres from where the solver put them, up or down, by
    // what it took to bring her eye to its height. A heel that comes up as the leg needs it has to know: told
    // only the solver's hips, it came up late whenever hers were higher, and the eye was jolted as the foot left.)
    const lifted = figureRig?.shiftNow && you.on ? figureRig.shiftNow[1] : 0;
    const g = gait.update(dt, { x: walker.x, z: walker.z, heading, vx: walker.vx, vz: walker.vz, wish: walker.sitting ? null : walker.wish, crouch: walker.crouched, legs: walker.legs, base: feetY, groundAt: c.groundAt, sink: c.sink, hold: walker.sitting, time: c.time,
      // (Your hip joints as last posed, carried on by how far you have come since.)
      hips: you.on && body.joints?.hips && !walker.sitting && walker.seated < 0.02 ? body.joints.hips.map(q => { const w = this.toWorld(q); return [w[0] + walker.vx * dt, w[1] + lifted, w[2] + walker.vz * dt]; }) : null });
    // Your toes, standing: Space curls them up and digs them into the sand, as it does when you sit; and left to
    // themselves, standing a while, the toes of one foot and then the other lift and settle again every few
    // seconds, as bare feet do on sand. (They press what they touch: the patch of real sand takes their marks.)
    {
      const quiet = !walker.sitting && walker.seated < 0.02 && gait.still > 2.5 && walker.crouched < 0.3;
      const idle = i => { const u = ((c.time + i * 4.3) / 9.2) % 1; return u < 0.1 ? 0.3 * Math.sin(Math.PI * u / 0.1) : u < 0.22 ? -0.14 * Math.sin(Math.PI * (u - 0.1) / 0.12) : 0; };
      you.toes ??= [0, 0];
      g.feet.forEach((f, i) => {
        const want = walker.sitting || !f.down || walker.crouched > 0.3 ? 0 : input.up && gait.still > 0.3 ? 0.4 * Math.sin(c.time * 9 + i * 1.3) - 0.12 : quiet ? idle(i) : 0;
        if (dt > 0) you.toes[i] += (want - you.toes[i]) * (1 - Math.exp(-dt * 12));
        f.toes = you.toes[i];
      });
    }
    // (A test may put the eye lower than anyone can squat, to look at the sand: the body is then posed in its
    // deepest squat, for the shadow, and left out of the picture: it would be folded through the camera.)
    const eyeUp = Math.max(walker.body, walker.crouch - 0.13), folded = eyeUp > walker.body + 0.02, breath = Math.sin(c.time * 1.45);
    // Seated, the keys that walk you move your legs: S draws them up and W stretches them out, A / D bring your
    // feet together and apart, Space curls your toes.
    // (You sit leaning back a little on your hand; reaching for the sand beside you, you lean forward over it.)
    // (Eased both ways, like any movement of the trunk.)
    if (dt > 0) { const down = Math.max(reach ? reach.amount * (1 - (reach.lift || 0)) : 0, reachL ? reachL.amount * (1 - (reachL.lift || 0)) : 0), to = walker.sitting ? 0.22 - 0.34 * down : 0.22; seated.leanTo = to; seated.leanV = (seated.leanV || 0) + (36 * (to - seated.lean) - 12 * (seated.leanV || 0)) * dt; seated.lean += seated.leanV * dt; }
    if (walker.sitting && dt > 0) {
      seated.draw = Math.min(1, Math.max(0, seated.draw + input.fwd * -dt * 0.9)); seated.splay = Math.min(1, Math.max(0, seated.splay + input.right * dt * 0.9));
      seated.wiggle += ((input.up ? 0.45 * Math.sin(c.time * 9) - 0.15 : 0) - seated.wiggle) * (1 - Math.exp(-dt * 12));
    }
    // Sitting down and getting up are movements, a second long: from a squat over your feet back on to your
    // seat, a hand going to the sand behind you and your legs out in front; and the same undone. (`seated`: how
    // far along; the two poses are mixed, joint by joint.)
    const k = walker.seated, eased = k * k * (3 - 2 * k), sit = { sit: true, eye: walker.sit, recline: seated.lean, hop: walker.scoot || 0, draw: seated.draw, splay: seated.splay, wiggle: seated.wiggle, breath, sink: c.seatSink, touch: reach, touchL: reachL, turn, look };
    // (In your boat: on its bench, your feet on its floorboards, your hand on the tiller once you are sat. Getting
    // in and out, your knees come up to clear the side.)
    if (walker.carried) Object.assign(sit, { recline: c.carried.recline, hop: 0, sink: 0, touch: null, touchL: null, bench: { drop: c.carried.drop, ahead: 0.4, tuck: Math.sin(Math.PI * Math.min(1, k)) ** 2, grip: k > 0.8 ? c.carried.grip() : null } });
    // (Setting off, the hips come forward over the feet during the first pace, not in the first three frames; and
    // only as far as you are going forward: sideways or backward they stay over your feet.)
    if (dt > 0) { you.carryV = (you.carryV || 0) + (30 * ((g.amount || 0) * (g.along ?? 1) - (you.carry || 0)) - 11 * (you.carryV || 0)) * dt; you.carry = (you.carry || 0) + you.carryV * dt; }
    // (What of this frame is a recorded person's walk: in time with her feet, as far as she is walking.)
    this.motion.leg = gait.prop.leg;
    const motion = this.motion.step(dt, g, { speed: Math.hypot(walker.vx, walker.vz), forward: walker.vx * Math.sin(c.heading) - walker.vz * Math.cos(c.heading), crouch: Math.max(walker.crouched, k) });
    if (k >= 1) body.pose(sit);
    else body.pose({ gait: g, motion, bank: walker.bank || 0, time: c.time, dip: you.dip, carry: you.carry || 0, turn, stride: walker.stride, eye: eyeUp, look, wade: Math.min(1, Math.max(0, (walker.depth - 0.9) / 0.4)), breath, touch: reach, touchL: reachL, ...(k > 0 ? { seat: { ...sit, k: eased } } : {}) });
    const j = body.joints;
    // (For her skeleton and her eyes: what her chest has taken of the look, and where you are in fact looking.)
    j.chestLook = chest; j.lookTurn = c.turn; j.lookUp = walker.look;
    // The hips ride down to each footfall and up over the standing leg, smoothly: as far down as the legs have
    // needed lately (`deep`), in time with the feet. (Left to the legs alone they came down all at once as the
    // heel reached out: five centimetres in four frames, a stamp at every pace.)
    if (dt > 0) {
      // (`deep`: the most they needed in the pace before this one. It was kept as a multiple of the pace squared
      // and remembered for twenty seconds: the first short pace from standing set it to its limit, and the
      // hips then rode ten centimetres down at every footfall, on knees bent to forty degrees.)
      const need = j.dipWant ?? 0; you.peak = Math.max(you.peak || 0, need);
      if (g.landed.length) { you.deep = you.peak; you.peak = need; you.since = 0; } else you.since = (you.since || 0) + dt;
      if (you.since > 1) you.deep = need;
      you.deep = Math.max(you.deep || 0, need);
      // (Taken up gradually: sideways, one pace asks for more than the next, and the wave's height jumped at each footfall.)
      you.deepS = (you.deepS || 0) + (you.deep - (you.deepS || 0)) * (1 - Math.exp(-dt * 7));
      // (`shallow`: the least they have needed lately, as you pass over the standing leg.)
      you.shallow = need < (you.shallow || 0) ? need : (you.shallow || 0) + (need - (you.shallow || 0)) * Math.min(1, dt / 0.6);
      const want = j.dipWant === undefined ? 0 : Math.max(need, you.shallow + (Math.max(you.deepS, you.shallow) - you.shallow) * (g.beat || 0));
      // (Followed as a sprung weight follows, not at once: quicker down, when a leg needs it, than up.)
      // (Up again briskly when you are walking forward at a steady pace, as the leg straightens under you; more gently otherwise.)
      { const w = want > you.dip ? 30 : 24 + 14 * (g.along ?? 1) * (you.carry || 0); you.dipV = (you.dipV || 0) + (w * w * (want - you.dip) - 2 * w * (you.dipV || 0)) * dt; you.dip = Math.max(0, you.dip + you.dipV * dt); }
    }
    // Where that leaves the body's frame in the world, and your eye. (Your weight is where the walker is.)
    Object.assign(you, { on: true, home: j.home, x: walker.x - (j.home[0] * cy - j.home[2] * sy), y: feetY, z: walker.z - (j.home[0] * sy + j.home[2] * cy), cy, sy, heading, folded, eyeUp, reachable: c.reachable });
    // (Aboard, the whole of you is pitched and rolled with the boat, about your seat.)
    you.tilt = c.tiltNow ? c.tiltNow() : null;
    // (Asked for less movement: your eye keeps its height and its line; the body under it still walks.)
    // Your eye is her eye: where her head, on her neck, carries it (figurepose.js). Her skeleton is posed here,
    // before the camera is put anywhere, and the camera goes to it. (The camera used to be put where the solver
    // reckoned an eye would be, and her head put on the camera afterwards.)
    const eyeIs = figureRig ? (figureRig.pose(j, eyeUp), you.rigFor = j, figureRig.eyeNow) : j.eye;
    // (For her hands, next frame: where her eye would be were she not leaning to anything. A hand held before
    // her eyes and the lean that hand asks of her would otherwise chase one another.)
    // (Said as how far her eye is from where the solver reckons an eye, above the middle of its own frame: that
    // holds whichever frame the pose was made in. Getting up or sitting down the pose is a mixture of two, made
    // about another middle, and her eye's place in that one, handed to her hands as if in theirs, sent a
    // handful she was holding a forearm's length behind her for as long as the change took.)
    you.eyeAt = figureRig && figureRig.eyeFree && j.eyeLevel ? [figureRig.eyeFree[0] - j.eyeLevel[0], figureRig.eyeFree[1] - j.eyeLevel[1], figureRig.eyeFree[2] - j.eyeLevel[2]] : null;
    // (Her hips' sway and ride as the solver had them: the gait's, or the recorded walk's.)
    const shift = j.shift ?? g.shift ?? 0, sunk = j.sunk ?? you.dip - (g.ride || 0) + 0.05 * (g.run || 0);
    const calm = 1 - walker.bobAmount, ex = eyeIs[0] + calm * shift * (walker.sitting ? 0 : 1), ey = eyeIs[1] + calm * 0.92 * sunk, ez = eyeIs[2];
    if (!folded) {
      const head = this.tilted([you.x + ex * cy - ez * sy, feetY + ey, you.z + ex * sy + ez * cy]), floatAt = c.floatAt, stood = c.stood;
      you.headOff = [head[0] - floatAt[0], head[1] - floatAt[1], head[2] - floatAt[2]];
      walker.head = { x: floatAt[0] + you.headOff[0] * stood, y: floatAt[1] + you.headOff[1] * stood, z: floatAt[2] + you.headOff[2] * stood };
    }
    walker.roll = walker.sitting ? 0 : 0.22 * shift * walker.bobAmount;
    return { g, j };
  }
}
