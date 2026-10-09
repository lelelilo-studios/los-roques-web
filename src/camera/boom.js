// The camera behind her (the third-person view): where it stands, for where her eye is and how she looks.
// It hangs on a boom behind her right shoulder, turns with her look at once, follows her eye a little late (so
// that the bob of her walk does not shake it), swings round her while Alt is held, and keeps out of the sand and
// off the sea's surface: it rises first, then comes nearer, and if there is still no room it goes back to her eyes.
// No three.js here: camera/rig.js puts the result on the camera, and tests/boom.test.mjs runs it bare.

export const BOOM = {
  far: 3.0, near: 0.8,                 // metres behind her, and the nearest it comes before giving up
  above: 0.3, side: 0.35,              // the boom's root: over her eye (the top of her head: you see over it, and her feet are in the picture); and the camera's place to the right of her (none while swung round)
  rise: 0.6,                           // how far it rises to clear the ground before it comes nearer
  overGround: 0.15, overSea: 0.25, underSea: 0.12,     // room kept over the sand, over the sea, and under the surface when she is under it
  glide: 0.45, release: 0.35,          // seconds out of her eyes and back; seconds for a swing to come back behind
  swungPitch: -0.1,                    // where the boom tips to by itself when it is swung round her (radians: a little above her head's level)
  pitch: [-1.25, 0.45],                // how far the boom itself tips (radians: looking down, the camera climbs; looking up, it stops short of the sand)
  follow: [12, 6],                     // how quickly it follows her eye, sideways and up and down (1/s)
  fov: 55,                             // degrees across the short side of the picture (her own eyes: 65)
  tilt: 0.105,                         // and it looks this much lower than she does (6 degrees): she stands in the lower half of the picture, feet and all, the horizon over her head
  headNear: [0.28, 0.45],              // her head is not drawn within the first, and is whole beyond the second (m from her eye): it comes in with her hair, not before it
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), ease = t => t * t * t * (t * (6 * t - 15) + 10);

export class Boom {
  constructor() { this.want = 0; this.k = 0; this.swing = [0, 0]; this.held = false; this.pivot = null; this.lift = 0; this.len = BOOM.far; this.block = 0;
    /** How far behind her it stands, how far over her eye its root is, and how far to her right: BOOM's on foot; further back, higher and in the middle when she is in her boat (app.js eases them). */
    this.far = BOOM.far; this.above = BOOM.above; this.side = BOOM.side; }
  /** Out of her eyes (true) or back into them; `now`: without the glide. */
  set(on, now = false) { this.want = on ? 1 : 0; if (now) { this.k = this.want; this.pivot = null; } }
  /** Swings the camera round her by so many radians (Alt held and the mouse moved). */
  swingBy(yaw, pitch) { this.swing[0] = clamp(this.swing[0] + yaw, -Math.PI, Math.PI); this.swing[1] = clamp(this.swing[1] + pitch, -1.2, 1.2); }
  /** Whether anything but her own eyes is being looked through. */
  get on() { return this.k > 0 || this.want > 0; }
  /**
   * @param {{x: number, y: number, z: number}} own  her eye   @param {number} yaw  @param {number} look  radians
   * @param {number} dt  seconds since last asked (0: nothing moves on)
   * @param {(x: number, z: number) => {ground: number, sea: number}} floorAt  the ground's height and the sea surface's there
   * @param {boolean} under  her eye is under water: the camera keeps under it too
   * @returns {{e: number, x: number, y: number, z: number, dir: number[], fov: number, away: number}}  `e`: how far
   *   out of her eyes the view is (0 her eyes .. 1 the camera behind); `away`: metres from her eye
   */
  step(own, yaw, look, dt, floorAt, under = false) {
    const B = BOOM, d = Math.max(0, dt);
    this.k = clamp(this.k + clamp(this.want - this.k, -d / B.glide, d / B.glide), 0, 1);
    if (!this.held && d > 0) { const k = Math.exp(-d * 4.6 / B.release); this.swing[0] *= k; this.swing[1] *= k; if (Math.hypot(...this.swing) < 1e-4) this.swing = [0, 0]; }
    const swung = Math.min(1, Math.hypot(...this.swing) / 0.3), cl = Math.cos(look), ahead = [Math.sin(yaw) * cl, Math.sin(look), -Math.cos(yaw) * cl];
    if (!this.on) { this.pivot = null; this.lift = 0; this.len = this.far; this.block = 0; return { e: 0, x: own.x, y: own.y, z: own.z, dir: ahead, fov: 65, away: 0 }; }
    // The boom's root: just over her head, followed a little late. (Set down somewhere else, it is there at once.)
    const root = { x: own.x, y: own.y + this.above, z: own.z }, p = this.pivot;
    if (!p || Math.hypot(root.x - p.x, root.y - p.y, root.z - p.z) > 3) this.pivot = { ...root };
    else { const kh = 1 - Math.exp(-d * B.follow[0]), kv = 1 - Math.exp(-d * B.follow[1]); p.x += (root.x - p.x) * kh; p.z += (root.z - p.z) * kh; p.y += (root.y - p.y) * kv; }
    // (Swung round her, the boom leaves her look for a level of its own, a little above hers, that the mouse
    // then raises and lowers: looking down at the sand in her hand, she is not looked at from the sky.)
    const at = this.pivot, by = yaw + this.swing[0], bp = clamp(look + (B.swungPitch - look) * swung + this.swing[1], B.pitch[0], B.pitch[1]), cb = Math.cos(bp);
    const back = [-Math.sin(by) * cb, -Math.sin(bp), Math.cos(by) * cb], side = this.side * (1 - swung), right = [Math.cos(by) * side, 0, Math.sin(by) * side];
    const place = (len, lift) => ({ x: at.x + back[0] * len + right[0], y: at.y + back[1] * len + lift, z: at.z + back[2] * len + right[2] });
    // What room there is at a place: no lower than `lo`, no higher than `hi`.
    const room = (x, z) => { const f = floorAt(x, z); return under ? { lo: f.ground + B.overGround, hi: f.sea - B.underSea, bare: f.ground, top: f.sea } : { lo: Math.max(f.ground + B.overGround, f.sea + B.overSea), hi: Infinity, bare: Math.max(f.ground, f.sea), top: Infinity }; };
    // How much a boom of this length must rise (or sink) for the camera to have its room and for nothing to stand
    // between it and her (the ground, or the sea's surface, half way and three quarters of the way along).
    const need = len => {
      const c = place(len, 0), r = room(c.x, c.z);
      let up = r.lo - c.y, down = c.y - r.hi;
      for (const s of [0.5, 0.75]) { const q = { x: at.x + (c.x - at.x) * s, y: at.y + (c.y - at.y) * s, z: at.z + (c.z - at.z) * s }, m = room(q.x, q.z); up = Math.max(up, (m.bare - q.y) / s); down = Math.max(down, (q.y - m.top) / s); }
      return { up: Math.max(0, up), down: Math.max(0, down), shut: r.hi < r.lo };
    };
    let len = this.far, lift = 0, block = 1;
    for (let l = this.far; l >= B.near - 1e-6; l -= 0.3) { const n = need(l); if (!n.shut && n.up <= B.rise && !(n.up > 0 && n.down > 0)) { len = l; lift = n.up - n.down; block = 0; break; } len = l; lift = Math.min(n.up, B.rise) - n.down; }
    if (d > 0) {
      this.lift += (lift - this.lift) * (1 - Math.exp(-d * (lift > this.lift ? 12 : 4)));
      this.len += (len - this.len) * (1 - Math.exp(-d * (len < this.len ? 12 : 3)));
      this.block += (block - this.block) * (1 - Math.exp(-d * (block > this.block ? 10 : 3)));
    } else if (!p) { this.lift = lift; this.len = len; this.block = block; }
    const c = place(this.len, this.lift), r = room(c.x, c.z), meant = c.y - this.lift;
    // (Whatever the easing has it at, it is never in the sand or at the surface.)
    if (r.hi >= r.lo) c.y = clamp(c.y, r.lo, r.hi); else this.block = 1;
    // (Pushed up over a dune or down under the surface, it is turned back towards her by most of that: she
    // stays in the picture.)
    const turned = -Math.atan2(c.y - meant, Math.max(0.5, this.len * cb)) * 0.85;
    const e = ease(this.k) * (1 - clamp(this.block, 0, 1));
    const x = own.x + (c.x - own.x) * e, z = own.z + (c.z - own.z) * e;
    let y = own.y + (c.y - own.y) * e;
    // (On its way out of her eyes or back into them it is somewhere between: from half way out it has its room
    // again, less a little that it gets back by the time it is all the way out. Nearer her eyes than that, it is
    // where her eyes are: swimming, a hand's breadth over the water.)
    if (e > 0.5) { const m = room(x, z), slack = (1 - e) * 2 * (B.overSea - B.underSea); if (m.hi >= m.lo) y = clamp(y, m.lo - slack, m.hi + slack); }
    // Looking the way she looks, a little lower; swung round her, at her.
    const low = clamp(look + (turned - B.tilt) * e, -1.55, 1.55), clow = Math.cos(low);
    let dir = [Math.sin(yaw) * clow, Math.sin(low), -Math.cos(yaw) * clow];
    if (swung > 0) { const t = [at.x - c.x, at.y - this.above - 0.1 - c.y, at.z - c.z], tl = Math.hypot(...t) || 1, k = swung * e, v = dir.map((a, i) => a + (t[i] / tl - a) * k), vl = Math.hypot(...v) || 1; dir = v.map(a => a / vl); }
    return { e, x, y, z, dir, fov: 65 + (B.fov - 65) * e, away: Math.hypot(x - own.x, y - own.y, z - own.z) };
  }
}
