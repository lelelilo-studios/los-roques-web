// A peñero afloat: the open fishing boat of Los Roques, 7.6 m, an outboard on its transom steered by the tiller.
// Bare arithmetic: it is given the sea (how high the surface is at a place, and how fast it is rising there) and
// the seabed, and moves the hull on them. world/penero.js draws it; tests/boat.test.mjs runs it.
//
// What is worked out, and what is laid down:
//   worked out   it floats on ten points of its bottom, each pushed up by how deep it is in the sea there and
//                held back by how fast it is going into it; so it sits lower with you aboard, heaves, pitches and
//                rolls on the waves that are drawn, slaps down off a crest, and takes the ground where the bed
//                comes up under it. The outboard pushes where it points, the hull resists going sideways far
//                more than forwards, and the two turn it.
//   laid down    how hard the water resists it at each speed (the hump before it planes), how far the bow rides
//                up at each speed, how much of its weight the water carries by its speed alone once it planes,
//                and how far it leans into a turn: taken from how such a boat is known to behave (appendix F of
//                the plan), not from the flow round the hull, which nothing here computes.
//
// Frames. The world: x east, y up, z south, metres. `heading`: radians clockwise from north, as the walker's.
// The boat's own: x forward to the bow, y up, z to starboard; its middle is on the waterline amidships when it
// lies at rest in still water with nobody aboard.

const G = 9.81, RHO = 1025;

export const PENERO = {
  length: 7.6, beam: 2.0,
  mass: 900,                           // all up: hull 580, outboard and tank 110, gear, a little water (kg; my estimate)
  heaveMass: 1500, yaw: 4500, pitch: 5400, roll: 620,     // the water that moves with it counted in (kg, kg m2)
  bottom: 6.7,                         // the area it floats on (m2)
  // Where it is pushed up: [x forward of amidships, half-breadth there, its share of the bottom]
  stations: [[-3.3, 0.86, 0.2], [-1.7, 0.95, 0.24], [0, 0.94, 0.24], [1.6, 0.76, 0.2], [3.0, 0.34, 0.12]],
  depth: 0.8,                          // from its bottom at the side to the gunwale: beyond this, deeper is no more lift
  keel: 0.3,                           // how far its keel is under the waterline at rest; the outboard's foot is 0.75
  foot: 0.75, kick: 0.45,              // and in less water than `kick` the outboard is tilted up and pushes nothing
  height: 0.28,                        // its centre of gravity over the waterline
  engine: -3.8,                        // where the outboard pushes (x)
  power: 29400, push: 2600, efficiency: 0.55, astern: 0.28, tiller: 32 * Math.PI / 180,
  // What the water does to it by its speed (see the head of this file): resistance = drag * v2 + hump * bell;
  // the bow's rise, and the lean into a turn.
  drag: 8.6, slow: 40, hump: 1380, humpAt: 4.5, humpWide: 1.25,     // (`slow`: N for each m/s, what stops it drifting on for ever in neutral)
  bowUp: [6.5 * Math.PI / 180, 5.2, 1.3, 2.6 * Math.PI / 180],      // most, at this speed, over this spread; and planing
  lift: 0.5, planeFrom: 4.6, planeBy: 9.5,                          // the share of its weight its speed carries when planing
  lean: 0.5,                           // radians for each g of turn
  side: [2.4, 3.2], sideAt: -0.45,     // how the hull resists going sideways (1/s, 1/m), and where that acts (x)
  turnHold: [1.08, 1.6],               // how its turning is held back (1/s, per radian)
  wind: [3.4, 0.25],                   // what the air does to it broadside, for each m/s of wind over it, squared (N: half the air's density by six square metres of side), and the share of that bow-on
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), ease = t => { const k = clamp(t, 0, 1); return k * k * (3 - 2 * k); };

export class Boat {
  constructor(spec = PENERO) {
    this.spec = spec;
    const S = spec;
    // Its ten points, and how deep each is when it lies at its marks (so that the waterline is y = 0 then).
    const total = S.stations.reduce((a, q) => a + q[2], 0), d0 = S.mass * G / (RHO * G * S.bottom);
    this.points = S.stations.flatMap(([x, half, share]) => [-1, 1].map(side => ({ x, z: side * half * 0.72, y: -d0, area: S.bottom * share / total / 2 })));
    // (Its weight is over the middle of what holds it up: it lies level.)
    this.cg = this.points.reduce((a, p) => a + p.x * p.area, 0) / S.bottom;
    this.stiff = { pitch: RHO * G * this.points.reduce((a, p) => a + p.area * (p.x - this.cg) ** 2, 0), roll: RHO * G * this.points.reduce((a, p) => a + p.area * p.z * p.z, 0), heave: RHO * G * S.bottom };
    this.damp = 2 * 0.55 * Math.sqrt(this.stiff.heave * S.heaveMass) / S.bottom;      // N s/m for each m2 of bottom
    this.place({ x: 0, z: 0, heading: 0 });
  }

  /** Set down afloat and at rest, with the sea level at height `sea`. */
  place({ x, z, heading = 0, sea = 0 }) {
    Object.assign(this, { x, y: sea, z, heading, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, turning: 0, pitching: 0, rolling: 0, throttle: 0, helm: 0, revs: 0, slam: 0, aground: 0, time: 0, left: 0, wet: 1, down: 1 });
    /** What it is made fast by: lines, each from a place along it (`from`, x in its own frame) to a place in the world (`to`: [x, z]), `length` long. A line only pulls, and only when it is taut. */
    this.lines = [];
  }

  /** Forward, to starboard and up, in the world, as the boat now lies (small angles of pitch and roll). */
  axes() {
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading), f = [sh, 0, -ch], r = [ch, 0, sh], p = this.pitch, q = this.roll;
    // (Bow up by `pitch`; starboard side down by `roll`.)
    const fwd = [f[0] * Math.cos(p), Math.sin(p), f[2] * Math.cos(p)], right = [r[0] * Math.cos(q), -Math.sin(q), r[2] * Math.cos(q)];
    const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]].map(v => -v);
    return { fwd, right, up };
  }

  /** A point of the boat (its own frame) in the world. */
  toWorld(p) { const { fwd, right, up } = this.axes(); return [this.x + fwd[0] * p[0] + up[0] * p[1] + right[0] * p[2], this.y + fwd[1] * p[0] + up[1] * p[1] + right[1] * p[2], this.z + fwd[2] * p[0] + up[2] * p[1] + right[2] * p[2]]; }

  /** Sixteen numbers, columns first: the boat's own frame to the world, less `origin` (the camera's [x, z]). */
  matrix(origin = [0, 0]) { const { fwd, right, up } = this.axes(); return [fwd[0], fwd[1], fwd[2], 0, up[0], up[1], up[2], 0, right[0], right[1], right[2], 0, this.x - origin[0], this.y, this.z - origin[1], 1]; }

  /** How far it is up on the plane, 0..1. */
  get planing() { return ease((this.speed - this.spec.planeFrom) / (this.spec.planeBy - this.spec.planeFrom)); }

  /** How fast it is going through the water, forwards (m/s). */
  get speed() { return this.vx * Math.sin(this.heading) - this.vz * Math.cos(this.heading); }

  /**
   * Moves it on by dt seconds, in fixed steps of a hundred-and-twentieth (so that a faster or slower display
   * changes nothing).
   * @param {number} dt
   * @param {{throttle?: number, helm?: number, crew?: {mass: number, x: number, z: number}[], wind?: number[], forces?: {f: number[], at?: number}[]}} input
   *   throttle -1 (astern) .. 1; helm -1 (to port) .. 1 (to starboard: the bow goes right); who is aboard and where;
   *   the wind over the water (m/s: [x, z])
   * @param {(x: number, z: number) => {h: number, v: number}} sea  the surface there: its height, and how fast it is rising
   * @param {((x: number, z: number) => number) | null} bed  the seabed's height there
   */
  step(dt, input, sea, bed = null) {
    this.left += Math.max(0, Math.min(dt, 0.25));
    this.slam = 0;
    const h = 1 / 120;
    while (this.left >= h - 1e-9) { this.once(h, input, sea, bed); this.left -= h; this.time += h; }
  }

  once(h, input, sea, bed) {
    const S = this.spec, sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    // (The throttle and the helm are hands on a lever and a tiller: they take a moment.)
    this.throttle += clamp((input.throttle ?? 0) - this.throttle, -h / 0.35, h / 0.35);
    this.helm += clamp((input.helm ?? 0) - this.helm, -h / 0.3, h / 0.3);
    const u = this.vx * sh - this.vz * ch, side = this.vx * ch + this.vz * sh;                   // forwards, and to starboard
    let fx = 0, fy = -S.mass * G, fz = 0, mPitch = 0, mRoll = 0, mYaw = 0;                         // in the boat's level frame: forward, up, starboard; bow up, starboard down, bow to starboard
    for (const c of input.crew || []) { fy -= c.mass * G; mPitch -= c.mass * G * (c.x - this.cg); mRoll += c.mass * G * c.z; }
    // Afloat: each point pushed up by its depth in the sea there, and held back by how fast it is going into it.
    // Planing, its speed carries a share of its weight and the sea that much less.
    const planing = ease((u - S.planeFrom) / (S.planeBy - S.planeFrom)), carried = S.lift * planing;
    let wet = 0, ground = 0;
    for (const p of this.points) {
      const at = this.toWorld([p.x, p.y, p.z]), w = sea(at[0], at[2]), depth = clamp(w.h - at[1], 0, S.depth);
      // (How fast this point is going down: the hull's own fall, and its pitching and rolling.)
      const fall = -(this.vy + this.pitching * (p.x - this.cg) - this.rolling * p.z);
      if (depth > 0) {
        const lift = Math.max(0, RHO * G * p.area * depth * (1 - carried) + this.damp * p.area * (fall + w.v) * Math.min(1, depth / 0.05));
        fy += lift; mPitch += lift * (p.x - this.cg); mRoll -= lift * p.z; wet++;
      }
      // Aground: the bed under this point pushes it up, and drags at it.
      if (bed) {
        const floor = bed(at[0], at[2]), into = floor - (at[1] - (S.keel - Math.abs(p.y)) * (1 - Math.abs(p.z) / 1.2));
        if (into > 0) {
          const push = Math.max(0, 9e4 * into + 9e3 * fall);
          fy += push; mPitch += push * (p.x - this.cg); mRoll -= push * p.z; ground++;
          const rub = Math.min(0.55 * push, 600 * Math.hypot(u, side) + 40);
          if (Math.hypot(u, side) > 1e-3) { fx -= rub * u / Math.hypot(u, side); fz -= rub * side / Math.hypot(u, side); }
          mYaw -= this.turning * 300;
        }
      }
    }
    fy += carried * S.mass * G * Math.min(1, wet / 6);
    this.wet = wet / this.points.length; this.aground = ground / this.points.length;
    // The outboard: it pushes where it points, as hard as its power gives at this speed; tilted up in the shallows.
    const stern = this.toWorld([S.engine, 0, 0]), water = bed ? sea(stern[0], stern[2]).h - bed(stern[0], stern[2]) : 99, down = ease((water - S.kick * 0.6) / (S.kick * 0.4)) * Math.min(1, wet / 4);
    const want = this.throttle >= 0 ? this.throttle : this.throttle * S.astern, thrust = want * Math.min(S.push, S.efficiency * S.power / Math.max(Math.abs(u), 1)) * down;
    const helm = this.helm * S.tiller;
    fx += thrust * Math.cos(helm); fz -= thrust * Math.sin(helm); mYaw += thrust * Math.sin(helm) * -(S.engine - this.cg);
    this.revs += ((0.16 + 0.84 * Math.abs(want)) * (0.75 + 0.25 * clamp(Math.abs(u) / 11, 0, 1)) * (down > 0.1 ? 1 : 0.5) - this.revs) * Math.min(1, h * 5);
    // The water's resistance: a hump as it climbs out of its own wave, then what a planing hull meets.
    const bell = Math.exp(-(((Math.abs(u) - S.humpAt) / S.humpWide) ** 2)), resist = (S.drag * u * u + S.slow * Math.abs(u) + S.hump * bell * Math.min(1, Math.abs(u) / 1.5)) * Math.min(1, wet / 5 + 0.15);
    // (Going astern it pushes its flat transom through the water.)
    fx -= Math.sign(u) * resist * (u < 0 ? 3 : 1);
    // Sideways it hardly goes: the hull's side force, which acts aft of its middle and so brings the bow round to the way it is going.
    // (Under way the hull holds its line as a keel does, the harder the faster it goes; lying still it is only pushed broadside through the water, and drifts.)
    const slip = side + this.turning * (S.sideAt - this.cg), hold = -S.mass * (S.side[0] * (0.12 + 0.88 * ease(Math.abs(u) / 4)) + S.side[1] * Math.abs(slip)) * slip * Math.min(1, wet / 5 + 0.1);
    fz += hold; mYaw += hold * (S.sideAt - this.cg);
    mYaw -= S.yaw * (S.turnHold[0] + S.turnHold[1] * Math.abs(this.turning)) * this.turning * Math.min(1, wet / 5 + 0.1);
    // The bow's rise with speed, and the lean into a turn: laid down (see the head of this file), each as the moment that holds the hull at that angle against its own stiffness.
    const up = S.bowUp[0] * Math.exp(-(((Math.abs(u) - S.bowUp[1]) / S.bowUp[2]) ** 2)) * Math.min(1, Math.abs(u) / 2) + S.bowUp[3] * planing;
    // (And held near it by more than the sea's own stiffness, which falls away as the bow lifts its forward points clear: left to that alone the bow went on up to eighteen degrees.)
    const afloat = Math.min(1, wet / 6), over = S.lean * clamp(u * this.turning / G, -0.5, 0.5);
    mPitch += (this.stiff.pitch * (1 - carried) * up + 1.5 * this.stiff.pitch * (up - this.pitch) * Math.min(1, Math.abs(u) / 2)) * afloat;
    mRoll += (this.stiff.roll * (1 - carried) * over + 1.5 * this.stiff.roll * (over - this.roll) * Math.min(1, Math.abs(u) / 2)) * afloat;
    // Made fast: a line pulls its end of the boat towards where it is made fast, once it is taut (it gives like rope: a metre of stretch is all it has).
    for (const line of this.lines) {
      const ax = this.x + sh * line.from, az = this.z - ch * line.from, dx = line.to[0] - ax, dz = line.to[1] - az, far = Math.hypot(dx, dz), over = far - line.length;
      line.taut = Math.max(0, over);
      if (over <= 0) continue;
      // (How fast that end is going away from where the line is made fast.)
      const ex = this.vx + ch * this.turning * line.from, ez = this.vz + sh * this.turning * line.from, away = -(ex * dx + ez * dz) / far;
      const pull = Math.max(0, Math.min(6000, 1500 * over + 900 * away)), px = pull * dx / far, pz = pull * dz / far, along = px * sh - pz * ch, across = px * ch + pz * sh;
      fx += along; fz += across; mYaw += across * (line.from - this.cg);
    }
    // Pushed: by a pole on the bottom, by you leaning on it. Each a force in the world ([east, south], N) at a place along it.
    for (const f of input.forces || []) { const along = f.f[0] * sh - f.f[1] * ch, across = f.f[0] * ch + f.f[1] * sh; fx += along; fz += across; mYaw += across * ((f.at || 0) - this.cg); }
    // (How far the outboard's foot is down in the water, 0..1: for whoever wants to know why it does not push.)
    this.down = down;
    // The wind on its side and its bow.
    if (input.wind) { const ax = input.wind[0] - this.vx, az = input.wind[1] - this.vz, a = Math.hypot(ax, az); fx += S.wind[0] * S.wind[1] * a * (ax * sh - az * ch); fz += S.wind[0] * a * (ax * ch + az * sh); }
    // Moved on.
    const ay = fy / S.heaveMass, ax = fx / S.mass, az = fz / S.mass;
    this.slam = Math.max(this.slam, Math.abs(ay) / G);
    this.vy += ay * h;
    const nu = u + ax * h, ns = side + az * h;
    this.vx = nu * sh + ns * ch; this.vz = -nu * ch + ns * sh;
    this.pitching += (mPitch / S.pitch - 1.4 * this.pitching) * h; this.rolling += (mRoll / S.roll - 2.2 * this.rolling) * h; this.turning += mYaw / S.yaw * h;
    this.x += this.vx * h; this.y += this.vy * h; this.z += this.vz * h;
    this.pitch = clamp(this.pitch + this.pitching * h, -0.6, 0.6); this.roll = clamp(this.roll + this.rolling * h, -0.7, 0.7); this.heading += this.turning * h;
  }
}
