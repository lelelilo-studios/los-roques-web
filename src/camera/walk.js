// First person: a body that walks on the ground, wades, floats when the water is deep enough and can dive.
//
// There are no separate "walking" and "swimming" states. The eye sits at
//     max(ground + body height, sea surface + 0.12 m)
// so in about a metre and a half of water the surface lifts you off your feet by itself, and wading simply gets
// slower as the water gets deeper. Diving is the one real switch: the eye then moves freely between the bed and
// the surface, along the direction you look.
//
// `Walker` is pure logic (no DOM, no three) so it can be tested in Node; `attachWalkInput` feeds it.

export const STAND = 1.65, CROUCH = 0.75, FLOAT = 0.12;

/** Walking speed in m/s with `depth` metres of water round the legs: 56 % at half a metre, 31 % at one metre. */
export function wadeSpeed(depth, run = false) {
  return (run ? 3.0 : 1.4) / (1 + 2.2 * Math.max(depth, 0) ** 1.5);
}

/**
 * Length of a pace in metres at a given speed: 0.72 m walking (two paces a second at 1.4 m/s), lengthening to
 * 1.05 m at a run (not quite three a second at 3 m/s), and shorter crouched (`crouch` 0..1).
 */
export function paceLength(speed, crouch = 0, legs = 1) {
  const k = Math.min(1, Math.max(0, (speed - 1.6) / 1.2));
  return (0.72 + 0.33 * k * k * (3 - 2 * k)) * (1 - 0.45 * crouch) * legs;        // (`legs`: the length of yours against the 0.87 m these paces are for)
}

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Walker {
  /**
   * @param {object} o
   * @param {{heightAt: (x: number, z: number) => number}} o.ground
   * @param {(x: number, z: number) => number} o.surfaceAt  height of the sea surface there right now
   * @param {(x: number, z: number) => boolean} [o.blocked]  true where a wall stands
   * @param {{x: number, z: number, w: number, h: number}} [o.rect]  the walker stays inside this rectangle
   */
  constructor({ ground, surfaceAt, blocked = () => false, rect = null }) {
    Object.assign(this, { ground, surfaceAt, blocked, rect });
    this.x = 0; this.z = 0; this.yaw = 0; this.look = 0;       // radians; yaw clockwise from north, look above the horizon
    // Which way your body faces. Your head turns on it (yaw is where you look): standing or crouched by fifty
    // degrees either way, seated by eighty; past that the body comes round. Walking, it comes round to where you look.
    this.heading = 0;
    this.gaited = false;                                          // your feet are placed by a gait (world/gait.js): no pace clock, bob or sway from here
    this.head = null;                                             // { x, y, z }: where the posed body's eye is (app.js), when it has one
    this.placed = false;                                          // put down somewhere at once since anyone last looked
    // (How high your eyes are standing and crouched, and your legs against the 0.87 m the paces are for: your body's, see app.js.)
    this.stand = STAND; this.crouch = CROUCH; this.legs = 1;
    this.sit = 0.83; this.sitting = false;                        // seated eye height; whether you are sitting on the sand
    this.seated = 0;                                              // how far you are on to your seat: 0 on your feet .. 1 sitting (it takes a second)
    this.scoot = 0; this.scootLeft = 0;                           // shuffling round on your seat: how far heels and hand are lifted (0..1)
    this.eyeY = STAND; this.body = STAND; this.surf = 0; this.vx = 0; this.vz = 0;
    this.diving = false; this.diveTimer = 0; this.phase = 0; this.bob = 0; this.bobAmount = 1;
    this.pinned = false;                                          // a test pose holds the eye where it was put
    this.depth = 0; this.afloat = false;
    this.stride = 0;                                              // pace against an easy walk: 0 standing, 1 walking, about 2 running
    this.stroke = 0;                                              // phase of the swimming stroke, radians
    this.ahead = 0;                                               // how far the eyes are ahead of the body's own line (looking down, squatting: bodyshape.js eyeAhead)
    this.sway = 0;                                                // the head's swing to the side of the planted foot, metres (to the right positive)
    this.roll = 0;                                                // and its lean over that foot, radians
    this.thud = 0;                                                // the jolt of a heel coming down, 1 fading to 0
    this.turned = 0;                                              // how fast you are turning on the spot, as a pace (see stride)
  }

  /**
   * Puts the walker somewhere at once (no springs). `eye`, if given, is the eye height in metres above the sea
   * surface at that spot at that moment (negative = under water) and stays fixed until the walker moves.
   */
  /** How far down you are, 0 standing .. 1 in a full crouch. */
  get crouched() { return Math.min(1, Math.max(0, (this.stand - this.body) / (this.stand - this.crouch))); }
  place({ x, z, yaw = this.yaw, look = this.look, height = this.stand, eye = null }) {
    Object.assign(this, { x, z, yaw, look, heading: yaw, head: null, placed: true, seated: 0, bodyV: 0, turnRate: 0, turning: false, slant: 0, vx: 0, vz: 0, phase: 0, bob: 0, sway: 0, roll: 0, thud: 0, turned: 0, lastYaw: yaw, diveTimer: 0, stride: 0, sitting: false, sat: false });
    const g = this.ground.heightAt(x, z);
    this.surf = this.surfaceAt(x, z); this.surfMean = this.surf;
    this.body = height; this.bodyTo = height; this.bodyV = 0;
    this.pinned = eye !== null; this.under0 = g; this.onFeet = false;
    this.eyeY = eye !== null ? Math.max(this.surf + eye, g + 0.2) : Math.max(g + height, this.surf + FLOAT);
    this.diving = this.eyeY < this.surf;
    this.depth = Math.max(this.surf - g, 0);
    // (A test pose with the eye lower than you could stand is a swimmer.)
    this.afloat = this.pinned ? this.eyeY < g + height - 0.05 && !this.diving : this.surf + FLOAT > g + this.body;
  }

  /** True when the eye is under the sea surface. */
  get under() { return this.eyeY + this.bob < this.surf - 0.02; }

  /**
   * Advances by dt seconds. input: { fwd, right (-1..1), run, down, up (booleans) }.
   * Returns the footsteps taken: [{ x, z, yaw, side: 0|1, depth }] (for footprints and sound).
   */
  step(dt, input) {
    const steps = [];
    if (dt <= 0) return steps;
    const moving = Math.abs(input.fwd) + Math.abs(input.right) > 0.01 || input.up || input.down || input.sit;
    if (this.pinned && !moving) return steps;
    this.pinned = false;

    const g = this.ground.heightAt(this.x, this.z);
    this.surf += (this.surfaceAt(this.x, this.z) - this.surf) * (1 - Math.exp(-dt / 0.25));
    // (And the sea's level here over the last second or two, the waves averaged out: see `afloat` below.)
    this.surfMean = (this.surfMean ?? this.surf) + (this.surf - (this.surfMean ?? this.surf)) * (1 - Math.exp(-dt / 1.6));
    const d = Math.max(this.surf - g, 0);
    this.depth = d;

    // Sitting down and getting up (the key is taken once a press): on sand, in water no deeper than a hand.
    if (input.sit && !this.sat) this.sitting = !this.sitting && !this.diving && !this.afloat && d < 0.25;
    this.sat = !!input.sit;
    if (this.sitting && (this.diving || d > 0.4)) this.sitting = false;
    // Where the legs (or arms) want to take us.
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = input.fwd * sy + input.right * cy, wz = -input.fwd * cy + input.right * sy, vy = 0;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    let speed;
    if (this.diving) {
      speed = input.run ? 1.2 : 0.7;
      const cl = Math.cos(this.look);
      vy = input.fwd * Math.sin(this.look) * speed;
      wx = input.fwd * sy * cl + input.right * cy; wz = -input.fwd * cy * cl + input.right * sy;
    } else {
      // Wading slows with depth; from about waist deep, swimming is quicker than pushing through it.
      speed = Math.max(wadeSpeed(d, input.run), (input.run ? 1.5 : 0.8) * smooth(0.7, 1.1, d));
    }
    const onGround = !this.diving && !this.afloat;
    // (Crouched you shuffle along at less than half the pace.)
    const crouch = this.crouched;
    if (onGround) speed *= 1 - 0.55 * crouch;
    // (Backwards you go at little more than half your pace, sideways at less: the feet cannot cross.)
    // (Against the way your body faces, that is: going diagonally you turn towards where you are going, and walk.)
    if (onGround && wl > 0.01) {
      const hx = Math.sin(this.gaited ? this.heading : this.yaw), hz = -Math.cos(this.gaited ? this.heading : this.yaw), n = Math.hypot(wx, wz) || 1, a = (wx * hx + wz * hz) / n, r = (wx * -hz + wz * hx) / n;
      speed *= (a * a * (a < 0 ? 0.55 : 1) + r * r * 0.33) / (a * a + r * r || 1);
    }
    if (this.sitting || this.seated > 0.02) speed = 0;  // (seated, the same keys move your legs: see app.js)
    // (You do not start or stop at once: the first pace takes you up to speed, the last one brings you to rest.)
    const faster = wx * speed * this.vx + wz * speed * this.vz > this.vx * this.vx + this.vz * this.vz, k = 1 - Math.exp(-dt * (onGround ? (this.gaited ? (faster ? 4.2 : 6) : 9) : 3.5));
    const was = Math.hypot(this.vx, this.vz);
    this.vx += (wx * speed - this.vx) * k; this.vz += (wz * speed - this.vz) * k;
    // Setting off from standing, your weight goes over one foot before the other leaves the ground (a quarter of
    // a second, in which you hardly move: world/gait.js shifts the hips), and then you gather speed over two or
    // three paces, no harder than a walker pushes off (2.4 m/s2). Only how fast you are going is held back so,
    // not which way: turning as you go is as quick as it was.
    // (`launch`: seconds since you began to wish to go; already under way, it is as if long ago.)
    if (onGround && this.gaited) {
      this.launch = wl > 0.01 && speed > 0 ? (was > 0.35 ? 9 : (this.launch || 0) + dt) : 0;
      const e = Math.min(1, Math.max(0, (this.launch - 0.22) / 0.2)), most = was + (0.2 + 2.2 * e * e * (3 - 2 * e)) * dt, now = Math.hypot(this.vx, this.vz);
      if (now > most) { this.vx *= most / now; this.vz *= most / now; }
      /** Which way you wish to go, on your feet (a direction in the world), or null: the gait shifts your weight for the first step by it. */
      this.wish = wl > 0.01 && speed > 0 ? [wx / wl, wz / wl] : null;
      // (Going round a bend you lean into it, as anything does that turns while it travels: a few degrees.)
      const lean = Math.max(-0.1, Math.min(0.1, 0.8 * now * (this.turnRate || 0) / 9.81));
      this.bank = (this.bank || 0) + (lean - (this.bank || 0)) * (1 - Math.exp(-dt * 5));
    } else { this.launch = 0; this.wish = null; this.bank = 0; }
    // Your body's heading. Going anywhere, it comes round to where you look; standing, it stays, and only
    // follows when your head has turned as far as it goes (seated: slowly, shuffling round on your seat).
    {
      const off = Math.atan2(Math.sin(this.yaw - this.heading), Math.cos(this.yaw - this.heading)), low = this.sitting || this.seated > 0.4, limit = low ? 1.4 : 0.87, going = Math.hypot(this.vx, this.vz);
      if (!onGround || !this.gaited) this.heading = this.yaw;
      else {
        let rate = 0;
        // (Going at a slant, forward or back, the body turns most of the way to face along its path and you look
        // over your shoulder: nobody walks far with every pace half sideways. It turns over a pace or two, the feet
        // coming round with it as they are put down. Straight sideways you side-step, square.)
        const slant = Math.abs(input.fwd) > 0.3 && Math.abs(input.right) > 0.3 ? 0.8 * (input.fwd > 0 ? Math.atan2(input.right, input.fwd) : Math.atan2(-input.right, -input.fwd)) : 0;
        this.slant = (this.slant || 0) + Math.max(-1.3 * dt, Math.min(1.3 * dt, slant - (this.slant || 0)));
        if (!low && going > 0.2) rate = Math.max(-4.5, Math.min(4.5, (off + this.slant) * 6));
        else if (low) {
          // Seated, you shuffle round in scoots: heels and hand lifted clear of the sand, a quarter turn of the
          // hips... a seventh of a radian, in four tenths of a second; down; and again if you are still turned.
          // (`scoot`: 0 down .. 1 at the top of the lift: the pose lifts heels and hand by it.)
          const T = 0.42;
          if (!(this.scootLeft > 0) && Math.abs(off) > limit && this.sitting) { this.scootLeft = T; this.scootWay = Math.sign(off); }
          if (this.scootLeft > 0) {
            const e = t => t * t * (3 - 2 * t), t0 = 1 - this.scootLeft / T; this.scootLeft = Math.max(0, this.scootLeft - dt);
            const t1 = 1 - this.scootLeft / T; rate = dt > 0 ? this.scootWay * 0.24 * (e(t1) - e(t0)) / dt : 0; this.scoot = Math.sin(Math.PI * t1);
          } else this.scoot = 0;
        }
        else {
          // (Once your feet have to move, you turn to face what you are looking at, not just far enough.)
          if (Math.abs(off) > limit) this.turning = true; else if (Math.abs(off) < 0.12) this.turning = false;
          if (this.turning) rate = Math.sign(off) * Math.min(Math.max(Math.abs(off) * 5, (Math.abs(off) - limit) * 40), 7);
        }
        // (A body does not start or stop turning at once.)
        // (A scoot has its own easing: it is taken as it is.)
        this.turnRate = low ? rate : (this.turnRate || 0) + (rate - (this.turnRate || 0)) * (1 - Math.exp(-dt * 14));
        this.heading += this.turnRate * dt;
        // (Your head cannot go further round than your neck lets it. On your feet the body keeps up with any
        // turn you are likely to make, stepping round; on your seat you can only shuffle.)
        const over = Math.atan2(Math.sin(this.yaw - this.heading), Math.cos(this.yaw - this.heading)), most = limit + (low ? 0.06 : 0.5);
        if (Math.abs(over) > most) this.yaw = this.heading + Math.sign(over) * most;
      }
    }

    // Move, sliding along walls and refusing slopes steeper than 39 degrees.
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const ok = (x, z) => {
      if (this.blocked(x, z)) return false;
      if (this.rect && (x < this.rect.x || x > this.rect.x + this.rect.w || z < this.rect.z || z > this.rect.z + this.rect.h)) return false;
      // The slope is measured over a fixed pace ahead, not over this frame's step (a slow enough creep would
      // otherwise climb anything).
      const run = Math.hypot(x - this.x, z - this.z);
      if (!onGround || d >= 0.6 || run < 1e-6) return true;
      const px = this.x + (x - this.x) / run * 0.35, pz = this.z + (z - this.z) / run * 0.35;
      return this.ground.heightAt(px, pz) - g <= 0.81 * 0.35;
    };
    if (!ok(nx, nz)) {
      if (ok(nx, this.z)) { nz = this.z; this.vz = 0; } else if (ok(this.x, nz)) { nx = this.x; this.vx = 0; } else { nx = this.x; nz = this.z; this.vx = this.vz = 0; }
    }
    const travelled = Math.hypot(nx - this.x, nz - this.z);
    this.x = nx; this.z = nz;

    // The eye.
    const g2 = this.ground.heightAt(this.x, this.z);
    // (Crouched, reaching down to touch, you lean in over your hand: the eye comes a hand's breadth lower.)
    // (Nobody walks in a full squat: going anywhere crouched, you come half way up and go stooped.)
    const stoop = this.gaited ? 0.3 * (this.stand - this.crouch) * Math.min(1, Math.hypot(this.vx, this.vz) / 0.3) : 0;
    // (Either hand at work brings you a hand's breadth lower.)
    // (And you come up with the hand as it comes up from the sand, not all at once when you let go: the hand,
    // still on the sand, was dragged in under you.)
    // (`atWork`, 0..1: how far a hand is still down at the sand, as it comes up from it.)
    const reaching = Math.max(input.hand || input.hand2 ? 1 : 0, input.atWork || 0);
    const want = this.sitting ? this.sit - (this.gaited ? 0 : 0.06 * reaching) : input.down && !this.diving && d < 0.9 ? this.crouch + stoop - 0.12 * reaching : this.stand;
    this.bodyWant = want;                                         // (where your eye is on its way to: app.js holds the hand off the sand until you are nearly there)
    // (Down into a squat and up again in two thirds of a second; on to your seat and off it in a second and more.)
    { const to = this.sitting ? 1 : 0; this.seated += Math.sign(to - this.seated) * Math.min(Math.abs(to - this.seated), dt / 1.1); }
    if (this.gaited) {
      // (Eased at both ends: you neither drop nor shoot up. A spring without overshoot.)
      // (What it is drawn towards moves off gently too: you begin to sink at about the rate things fall, not faster.)
      const w = this.seated > 0.02 && this.seated < 0.98 ? 6 : 7.5;
      this.bodyTo = this.bodyTo === undefined ? want : this.bodyTo + (want - this.bodyTo) * (1 - Math.exp(-dt * 5.5));
      this.bodyV = (this.bodyV || 0) + (w * w * (this.bodyTo - this.body) - 2 * w * (this.bodyV || 0)) * dt; this.body += this.bodyV * dt;
    } else this.body += (want - this.body) * (1 - Math.exp(-dt * 10));
    // (Lifted off your feet when the water would float you four centimetres clear of them, and set down again
    // only when it is six short of that: at just the depth where you float, every wave no longer takes you off
    // your feet and puts you back.)
    // By the sea's mean level, not by each wave: standing chin-deep you are not swimming at every crest and
    // standing again in every trough (ten times in the 25 seconds it takes to swim in to where you can stand).
    { const lift = this.surfMean + FLOAT - (g2 + this.body); this.afloat = this.afloat ? lift > -0.06 : lift > 0.04; }
    if (!this.diving) {
      const target = Math.max(g2 + this.body, this.surf + FLOAT);
      // (On your feet with a gait, your eye is exactly your own height over the ground you stand on, the ground
      // followed smoothly: chasing ground-plus-height instead left the whole body behind whenever you crouched or
      // rose, a tenth of a second's worth: it dipped into the sand as you stood up.)
      this.under0 = this.under0 === undefined || !Number.isFinite(this.under0) ? g2 : this.under0 + (g2 - this.under0) * (1 - Math.exp(-dt * 12));
      // (Whatever your eye is off that by when you come on to your feet, set down by the sea or put down by a
      // test, is given up over a fifth of a second: not all at once, which was a jolt of several centimetres.)
      if (this.gaited && !this.afloat) {
        // (Standing chin-deep, a crest lifts you off your toes for a moment: your eyes stay a hand's breadth out
        // of the water, and your feet come down again as it passes.)
        const stood = this.under0 + this.body, floated = this.surf + FLOAT, want = floated < stood - 0.2 ? stood : 0.5 * (stood + floated + Math.sqrt((stood - floated) ** 2 + 0.0016));       // (the greater of the two, the corner between them rounded)
        this.eyeOff = (this.onFeet ? this.eyeOff || 0 : this.eyeY - want) * Math.exp(-dt * 10);
        this.eyeY = want + this.eyeOff; this.onFeet = true;
      } else { this.onFeet = false; this.eyeY += (target - this.eyeY) * (1 - Math.exp(-dt * (this.afloat ? 9 : 10))); }
      // Under we go: with the dive key in water deep enough, or by swimming forward while looking well down.
      this.diveTimer = this.afloat && this.look < -0.35 && input.fwd > 0.5 ? this.diveTimer + dt : 0;
      if ((input.down && d >= 0.9) || this.diveTimer > 0.3) this.diving = true;
    } else {
      this.eyeY += (vy + (input.up ? 0.8 : 0) - (input.down ? 0.6 : 0)) * dt;
      const lo = g2 + 0.35, hi = this.surf - FLOAT;
      if (hi < lo + 0.05 || (this.eyeY >= hi && (vy > 0.01 || input.up))) this.diving = false;      // back up through the surface
      this.eyeY = Math.min(Math.max(this.eyeY, lo), Math.max(lo, hi));
      this.diveTimer = 0;
    }

    // Steps: the head bobs once per pace of 0.72 m (shorter crouched), and each pace is reported.
    if (onGround && travelled > 0 && !this.gaited) {
      const before = Math.floor(this.phase / Math.PI);
      this.phase += travelled / paceLength(travelled / dt, crouch, this.legs) * Math.PI;
      const after = Math.floor(this.phase / Math.PI);
      if (after !== before) { steps.push({ x: this.x, z: this.z, yaw: this.yaw, side: after & 1, depth: Math.max(this.surf - g2, 0), stride: this.stride }); this.thud = Math.min(1.4, 0.4 + this.stride); }
    }
    // Turning on the spot you shift your feet: small paces in place, faster the faster you turn.
    const swung = Math.abs(Math.atan2(Math.sin(this.yaw - (this.lastYaw ?? this.yaw)), Math.cos(this.yaw - (this.lastYaw ?? this.yaw))));
    this.lastYaw = this.yaw;
    this.turned += ((onGround && dt > 0 ? Math.min(0.42, swung / dt * 0.16) : 0) - this.turned) * (1 - Math.exp(-dt * 6));
    if (onGround && travelled < 0.2 * dt && !this.gaited) this.phase += swung * 1.6;
    const stride = onGround ? Math.min(1, Math.hypot(this.vx, this.vz) / 1.2) : 0;
    // Afloat: a stroke every second and a half when swimming along, a slow scull when lying still.
    if (!onGround) this.stroke += (0.22 + 0.45 * Math.min(1, Math.hypot(this.vx, this.vz) / 0.7)) * dt * 2 * Math.PI;
    this.stride += ((onGround ? Math.hypot(this.vx, this.vz) / 1.4 : 0) - this.stride) * (1 - Math.exp(-dt * 8));
    // The head rises as you pass over the planted leg and is lowest as the next heel comes down (three and a half
    // centimetres at a walk); your weight goes over each foot in turn, the head swinging two centimetres to that
    // side and leaning a quarter of a degree; and each heel lands with a small jolt.
    // (With a gait, the head rides on the body the gait carries: nothing is added here.)
    if (this.gaited && onGround) this.bob = this.sway = 0;
    else {
      this.bob += (0.035 * this.bobAmount * stride * Math.abs(Math.sin(this.phase)) - this.bob) * (1 - Math.exp(-dt * 14));
      this.sway += (0.02 * this.bobAmount * stride * Math.sin(this.phase) - this.sway) * (1 - Math.exp(-dt * 10));
      this.roll += (0.0045 * this.bobAmount * stride * Math.sin(this.phase) - this.roll) * (1 - Math.exp(-dt * 10));
    }
    this.thud *= Math.exp(-dt * 9);
    // (Whatever happened above, you are somewhere. A position that is not a number would stay one, and black
    // the picture out for good: go back to the last place that was.)
    if (Number.isFinite(this.x + this.z + this.yaw + this.look + this.eyeY + this.bob + this.sway + this.roll + this.thud + this.turned)) this.safe = [this.x, this.z, this.yaw, this.look];
    else if (this.safe) { this.bob = this.sway = this.stride = this.roll = this.thud = this.turned = 0; this.place({ x: this.safe[0], z: this.safe[1], yaw: this.safe[2], look: this.safe[3] }); }
    return steps;
  }
}

/** A quick "is there a wall here?" test from building footprints ([{ poly: [[x, z], ...] }]), with a body radius. */
export function buildingBlocker(buildings, radius = 0.3, cell = 24) {
  const grid = new Map(), polys = [];
  for (const b of buildings || []) {
    if (!b.poly || b.poly.length < 3) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const index = polys.push(b.poly) - 1;
    for (let i = Math.floor((x0 - radius) / cell); i <= Math.floor((x1 + radius) / cell); i++) {
      for (let j = Math.floor((z0 - radius) / cell); j <= Math.floor((z1 + radius) / cell); j++) {
        const key = `${i},${j}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(index);
      }
    }
  }
  const inside = (poly, x, z) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  return (x, z) => {
    const list = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
    if (!list) return false;
    for (const index of list) {
      const poly = polys[index];
      if (inside(poly, x, z) || inside(poly, x + radius, z) || inside(poly, x - radius, z) || inside(poly, x, z + radius) || inside(poly, x, z - radius)) return true;
    }
    return false;
  };
}

/**
 * Keyboard, mouse and touch for the walker. Returns { read(): input, dispose() }.
 *   desktop: W A S D / arrows walk, Shift runs, C crouches or dives, Space comes up, mouse looks (click to capture
 *            the pointer; without capture, drag to look), Tab or Esc leaves. V: see yourself, from behind
 *            (`onThird`); while Alt is held the mouse swings that camera round her and does not turn her (`onSwing`).
 *   touch:   left half of the screen is a stick, right half looks; `buttons` (elements with data-walk="up|down|run")
 *            do the rest.
 * @param {() => boolean} active  whether first person is on (the handlers stay installed)
 */
export function attachWalkInput(walker, el, { active, onLeave, buttons = [], onThird = null, onSwing = null }) {
  const held = new Set(), touch = { stick: null, look: null, vec: [0, 0] }, pressed = new Set();
  const typing = e => /INPUT|SELECT|TEXTAREA/.test(e.target?.tagName || '');
  // (Letters by where the key is, not by what it types: with Alt held a Mac types "∑" for W, and W A S D are
  // places on the keyboard on any layout.)
  const key = e => (e.code === 'Space' ? ' ' : /^Key[A-Z]$/.test(e.code || '') ? e.code[3].toLowerCase() : e.key.length === 1 ? e.key.toLowerCase() : e.key);
  // (Alt held: the mouse swings the camera behind her. `onSwing(true | false)` says it is held or let go;
  // `onSwing(dx, dy)` how far the mouse went, in radians.)
  let swinging = false;
  const swing = on => { if (swinging === on) return; swinging = on; onSwing?.(on); };
  const turn = (dx, dy, rate) => { walker.yaw += dx * rate; walker.look = Math.min(1.5, Math.max(-1.5, walker.look - dy * rate)); };
  // (What your hands are asked: `by`, how much further to part the fingers since last read; `steer`, whether the
  // mouse moves the hand that holds something and not your look, as app.js says; `dx`, `dy`, how far it has moved it.)
  const grasp = { by: 0, at: performance.now(), left: false, steer: false, dx: 0, dy: 0 };
  const lock = () => {
    if (!el.requestPointerLock || document.pointerLockElement === el) return;
    // Raw mouse movement where the browser offers it; some refuse the option, some refuse the lock: both are fine.
    try { Promise.resolve(el.requestPointerLock({ unadjustedMovement: true })).catch(() => { try { Promise.resolve(el.requestPointerLock()).catch(() => {}); } catch { /* drag to look */ } }); } catch { /* drag to look */ }
  };
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); return () => target.removeEventListener(type, fn, opts); };
  const off = [
    on(window, 'keydown', e => {
      if (!active() || typing(e)) return;
      const k = key(e);
      if (k === 'Tab' || (k === 'Escape' && document.pointerLockElement !== el)) { e.preventDefault(); onLeave(); return; }
      // (Alt alone opens the browser's menu on some systems: not while you are on the sand.)
      if (k === 'Alt') { e.preventDefault(); swing(true); return; }
      if (k === 'v' && !e.repeat && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onThird?.(); return; }
      // (Ctrl is not among them, though many crouch with it by habit: with W, forward, it is the browser's "close
      // this tab", which no page can prevent. Crouching or diving while going forward closed the page.)
      if (['w', 'a', 's', 'd', 'c', 'q', 'e', 'x', 'f', ' ', 'Shift', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { held.add(k); e.preventDefault(); }
    }),
    on(window, 'keyup', e => { const k = key(e); if (k === 'Alt') { if (active()) e.preventDefault(); swing(false); } held.delete(k); }),
    on(window, 'blur', () => { held.clear(); grasp.left = false; swing(false); }),
    on(el, 'click', () => { if (active()) lock(); }),
    // The wheel parts your fingers (away from you) or brings them together: how fast what you hold runs out.
    on(el, 'wheel', e => { if (!active()) return; e.preventDefault(); grasp.by -= Math.sign(e.deltaY) * Math.min(0.12, Math.abs(e.deltaY) / 600 + 0.04); }, { passive: false }),
    // (While you hold the button of a hand that holds something, the mouse moves that hand, not your look.)
    on(document, 'mousemove', e => { if (!active() || document.pointerLockElement !== el) return; if (grasp.steer) { grasp.dx += e.movementX; grasp.dy += e.movementY; } else if (swinging && onSwing) onSwing(e.movementX * 0.0022, e.movementY * 0.0022); else turn(e.movementX, e.movementY, 0.0022); }),
    on(el, 'pointerdown', e => {
      if (!active()) return;
      if (e.pointerType === 'touch' && e.clientX < el.clientWidth * 0.45 && !touch.stick) touch.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      else if (e.pointerType === 'mouse' && e.button === 2) grasp.left = true;                 // (the other mouse button: your left hand)
      else if (!touch.look) touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
    }),
    // (With one button already down the second does not come as a pointer event, and letting one of two go is not
    // a pointer's letting go: the mouse's own events say, for either button, in either order. The other button
    // first and then the main one, the main one was never heard; the main one let go first, it stayed down.)
    on(el, 'mousedown', e => { if (!active()) return; if (e.button === 2) grasp.left = true; else if (e.button === 0 && !touch.look) touch.look = { id: -1, x: e.clientX, y: e.clientY, touch: false }; }),
    on(window, 'mouseup', e => { if (e.button === 2) grasp.left = false; else if (e.button === 0 && touch.look && !touch.look.touch) touch.look = null; }),
    on(el, 'contextmenu', e => { if (active()) e.preventDefault(); }),
    on(el, 'pointermove', e => {
      if (!active()) return;
      if (touch.stick?.id === e.pointerId) {
        const dx = (e.clientX - touch.stick.x) / 56, dy = (e.clientY - touch.stick.y) / 56, l = Math.max(1, Math.hypot(dx, dy));
        touch.vec = [dx / l, -dy / l];
      } else if (touch.look?.id === e.pointerId && document.pointerLockElement !== el) {
        if (swinging && onSwing) onSwing((e.clientX - touch.look.x) * 0.004, (e.clientY - touch.look.y) * 0.004); else turn(e.clientX - touch.look.x, e.clientY - touch.look.y, touch.look.touch ? 0.005 : 0.004);
        touch.look.x = e.clientX; touch.look.y = e.clientY;
      }
    }),
    ...['pointerup', 'pointercancel'].map(type => on(el, type, e => {
      if (touch.stick?.id === e.pointerId) { touch.stick = null; touch.vec = [0, 0]; }
      if (touch.look?.id === e.pointerId) touch.look = null;
    })),
    ...buttons.flatMap(b => [
      on(b, 'pointerdown', e => { e.preventDefault(); pressed.add(b.dataset.walk); }),
      on(b, 'pointerup', () => pressed.delete(b.dataset.walk)), on(b, 'pointerleave', () => pressed.delete(b.dataset.walk)), on(b, 'pointercancel', () => pressed.delete(b.dataset.walk)),
    ]),
  ];
  return {
    /** The walker's input for this frame. */
    read() {
      const h = k => (held.has(k) ? 1 : 0), now = performance.now();
      // (E parts the fingers, Q closes them, for as long as either is held.)
      grasp.by += (h('e') - h('q')) * Math.min(0.1, (now - grasp.at) / 1000) * 0.9; grasp.at = now;
      const openBy = grasp.by, steerBy = grasp.dx || grasp.dy ? [grasp.dx, grasp.dy] : null;
      grasp.by = 0; grasp.dx = grasp.dy = 0;
      return {
        fwd: Math.max(-1, Math.min(1, h('w') + h('ArrowUp') - h('s') - h('ArrowDown') + touch.vec[1])),
        right: Math.max(-1, Math.min(1, h('d') + h('ArrowRight') - h('a') - h('ArrowLeft') + touch.vec[0])),
        run: held.has('Shift') || pressed.has('run') || Math.hypot(touch.vec[0], touch.vec[1]) > 0.97,
        down: held.has('c') || pressed.has('down'), up: held.has(' ') || pressed.has('up'),
        sit: held.has('x') || pressed.has('sit'),      // sit down on the sand, or get up
        openBy,                                          // how much further you part your fingers (the wheel, Q / E): from then on they are yours for that handful
        steerBy,                                         // how far the mouse has moved the hand you are steering (counts across, counts down), or null
        hand2: grasp.left || held.has('f'),              // the other mouse button (or F): your left hand does the same
        hand: !!touch.look,                              // the mouse button (or a finger on the right of the screen) held: crouched, your hand goes down to touch
      };
    },
    /** Whether the mouse moves a hand and not your look, from now (the hand that holds something, its button held). */
    steering(on) { grasp.steer = !!on; if (!on) grasp.dx = grasp.dy = 0; },
    release() { grasp.steer = false; swing(false); held.clear(); pressed.clear(); touch.stick = touch.look = null; touch.vec = [0, 0]; if (document.pointerLockElement === el) document.exitPointerLock?.(); },
    dispose() { for (const f of off) f(); },
  };
}
