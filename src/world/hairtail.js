// The tail of her hair: four lengths on a chain, hung from where it is tied at the back of her head. It is kept
// near the way it was dressed where it leaves the tie, less and less so down its length, so that the root goes
// with her head and the end hangs, lags as she starts off, swings on as she stops, leans downwind, and lies on
// her neck and back and not through them. Bare arithmetic: world/hair.js draws it; tests/hair.test.mjs runs it.

export const TAIL = {
  hold: [240, 60, 22, 9],            // how strongly each joint is drawn to where it would be if the tail were stiff (1/s2): strongly by the tie, hardly at the end
  drag: 2.4,                         // how quickly it loses what speed it has that her head has not (1/s): hair is well damped
  push: 0.34,                        // and how hard a breeze pushes it (m/s2 for each m/s): 3 m/s holds its end two centimetres off, a stiff 9 m/s a hand's breadth
  thick: 0.022,                      // half its thickness (m): it lies this far off what it rests on
  step: 1 / 120,                     // the longest step it is worked in (s)
  gravity: 9.81,
  // What it cannot go through, on her body at rest (centre, radius in metres, and the bone that carries it):
  // her skull, her neck, and her back between and over the shoulder blades.
  balls: [
    { bone: 'head', c: [0, 1.555, 0.065], r: 0.1 }, { bone: 'neck02', c: [0, 1.45, 0.06], r: 0.062 }, { bone: 'neck01', c: [0, 1.4, 0.075], r: 0.062 },
    { bone: 'spine01', c: [0, 1.31, 0.065], r: 0.105 }, { bone: 'spine01', c: [0.09, 1.3, 0.07], r: 0.1 }, { bone: 'spine01', c: [-0.09, 1.3, 0.07], r: 0.1 }, { bone: 'spine02', c: [0, 1.22, 0.07], r: 0.1 },
  ],
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = a => Math.hypot(a[0], a[1], a[2]);

export class Tail {
  /** @param {number[][]} links  five points down its middle line as it is modelled (the body's frame at rest): where it is tied, and four places down it */
  constructor(links) {
    if (links.length !== 5) throw new Error('the tail is four lengths: five points');
    this.rest = links.map(p => p.slice());
    this.lengths = [1, 2, 3, 4].map(k => len(sub(links[k], links[k - 1])));
    this.p = null; this.v = null;
  }

  /** Forgets where it was: it is next found hanging as it was dressed. */
  reset() { this.p = this.v = null; }

  /**
   * Moves it on by dt seconds.
   * @param {number} dt
   * @param {(p: number[]) => number[]} carried  where a point of the hair at rest is now, if it went stiffly with her head (the world, metres)
   * @param {number[]} wind  the air's speed there (m/s, the world)
   * @param {{c: number[], r: number}[]} balls  what it cannot enter, in the world
   * @param {number} afloat  0 in the air .. 1 under water: there it weighs next to nothing and is held back by the water it moves through
   * @returns {number[][]} its five points, in the world
   */
  step(dt, carried, wind = [0, 0, 0], balls = [], afloat = 0) {
    const home = this.rest.map(carried);
    // (Set down somewhere else, or never yet moved: as it was dressed.)
    if (!this.p || len(sub(this.p[0], home[0])) > 0.6) { this.p = home.map(q => q.slice()); this.v = home.map(() => [0, 0, 0]); return this.p; }
    const all = Math.min(Math.max(dt, 0), 0.05);
    if (all <= 0) return this.p;
    const n = Math.max(1, Math.ceil(all / TAIL.step - 1e-9)), h = all / n, from = this.p[0].slice(), going = [0, 1, 2].map(c => (home[0][c] - from[c]) / all);      // (`going`: how fast her head is carrying the tie)
    for (let s = 1; s <= n; s++) {
      // (The tie goes with her head, a part of the way each step.)
      const a = s / n;
      for (let c = 0; c < 3; c++) this.p[0][c] = from[c] + (home[0][c] - from[c]) * a;
      const before = this.p.map(q => q.slice());
      for (let k = 1; k <= 4; k++) {
        const P = this.p[k], V = this.v[k], hold = TAIL.hold[k - 1] * (1 - 0.6 * afloat), weight = TAIL.gravity * (1 - 0.94 * afloat), drag = TAIL.drag * (1 + 3 * afloat);
        for (let c = 0; c < 3; c++) {
          // (What slows it is the hair's own stiffness and rubbing, against the head it hangs from: not the air it
          // goes through, which only pushes it, and gently. Running, it bounces behind her; it does not stream out.
          // Under water it is the water that holds it back.)
          const acc = hold * (home[k][c] - P[c]) + TAIL.push * (wind[c] - V[c]) * (1 - afloat) - drag * (V[c] - going[c] * (1 - afloat)) - (c === 1 ? weight : 0);
          V[c] += acc * h; P[c] += V[c] * h;
        }
      }
      // Each length its own length (from the tie down, a few times over), and out of her head, neck and back.
      const touched = [false, false, false, false, false];
      for (let pass = 0; pass < 4; pass++) {
        for (let k = 1; k <= 4; k++) {
          const A = this.p[k - 1], Bp = this.p[k], d = sub(Bp, A), l = len(d) || 1e-9, off = (l - this.lengths[k - 1]) / l, share = k === 1 ? 1 : 0.5;
          for (let c = 0; c < 3; c++) { Bp[c] -= d[c] * off * share; if (k > 1) A[c] += d[c] * off * (1 - share); }
        }
        for (let k = 1; k <= 4; k++) for (const ball of balls) {
          const d = sub(this.p[k], ball.c), l = len(d), least = ball.r + TAIL.thick;
          if (l < least && l > 1e-9) { for (let c = 0; c < 3; c++) this.p[k][c] = ball.c[c] + d[c] / l * least; touched[k] = true; }
        }
      }
      // (Its speed is what it has moved by; where it lies on her it is slowed, as hair on skin is.)
      for (let k = 1; k <= 4; k++) for (let c = 0; c < 3; c++) this.v[k][c] = (this.p[k][c] - before[k][c]) / h * (touched[k] ? 0.82 : 1);
    }
    if (!this.p.every(q => q.every(Number.isFinite))) this.reset();
    return this.p ?? this.step(0, carried, wind, balls, afloat);
  }

  /**
   * Where each length of the tail has the hair that is modelled along it: four matrices (16 numbers each,
   * columns first) that take a point of the hair at rest to the world, less `origin` (the camera's place).
   * A length is turned from the way it would lie if it went stiffly with her head to the way it lies.
   * @param {number[][]} basis  where her head has turned the three axes of the hair at rest: [x, y, z], each a direction in the world
   * @param {number[]} origin
   */
  frames(basis, origin = [0, 0, 0]) {
    const out = [], turnBy = (v, q) => {                          // q: [axis x, y, z, cos, sin] (Rodrigues)
      const [x, y, z, c, s] = q, d = (x * v[0] + y * v[1] + z * v[2]) * (1 - c);
      return [v[0] * c + (y * v[2] - z * v[1]) * s + x * d, v[1] * c + (z * v[0] - x * v[2]) * s + y * d, v[2] * c + (x * v[1] - y * v[0]) * s + z * d];
    };
    for (let k = 1; k <= 4; k++) {
      const r0 = sub(this.rest[k], this.rest[k - 1]), stiff = [0, 1, 2].map(c => basis[0][c] * r0[0] + basis[1][c] * r0[1] + basis[2][c] * r0[2]), now = sub(this.p[k], this.p[k - 1]);
      const a = len(stiff) || 1, b = len(now) || 1, u = stiff.map(v => v / a), w = now.map(v => v / b);
      let axis = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const s = len(axis), c = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
      axis = s > 1e-9 ? axis.map(v => v / s) : [1, 0, 0];
      const q = [axis[0], axis[1], axis[2], s > 1e-9 ? c : 1, s > 1e-9 ? s : 0], cols = basis.map(v => turnBy(v, q)), at = this.rest[k - 1], P = this.p[k - 1];
      const t = [0, 1, 2].map(i => P[i] - origin[i] - (cols[0][i] * at[0] + cols[1][i] * at[1] + cols[2][i] * at[2]));
      out.push([cols[0][0], cols[0][1], cols[0][2], 0, cols[1][0], cols[1][1], cols[1][2], 0, cols[2][0], cols[2][1], cols[2][2], 0, t[0], t[1], t[2], 1]);
    }
    return out;
  }
}
