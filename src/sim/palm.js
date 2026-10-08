// What you hold in your hand, as stuff that lies and runs: a grid of heights over the cupped palm and the roots
// of the fingers. Dry sand rests at its own slope and slides to wherever is lower in the world (so it goes as
// the palm tips), funnels down into the gaps between the fingers and falls through them as fast as they are
// open; wet sand holds together and lets go in lumps; water lies level and leaks even through closed fingers.
// What falls out is handed back, gap by gap, to be drawn falling and to land on the sand or the sea below.
//
// Palm coordinates: u across the hand towards the thumb, v along it from the wrist to the fingers, heights along
// the palm's normal; the origin is the middle of the palm. Plain arrays, no three (it is measured in a test).
export const CELL = 0.004, NU = 28, NV = 38, U0 = -NU / 2 * CELL, V0 = -0.062;
export const HANDFUL = 6e-5;                        // cubic metres: sixty cubic centimetres
const FINGERS = [0.0285, 0.0095, -0.0095, -0.0285], HALF_FINGER = 0.0082;
const clamp01 = v => Math.min(1, Math.max(0, v));

export class Palm {
  constructor() {
    this.s = new Float32Array(NU * NV);           // how deep the stuff lies in each cell (m)
    this.floor = new Float32Array(NU * NV);       // the hand under it (m above the palm's plane); NaN where there is no hand
    this.leak = new Float32Array(NU * NV);        // how fast a cell lets go downwards, 0..1 (the gaps between the fingers)
    this.gap = new Int8Array(NU * NV).fill(-1);   // which gap a cell drains through (0..2), -1 none
    this.next = new Float32Array(NU * NV);
    // How the stuff on top is moving, for the picture of it: how far the grains at each cell have been carried
    // (m, along u and along v), and how fast they are going now.
    this.shiftU = new Float32Array(NU * NV); this.shiftV = new Float32Array(NU * NV); this.runU = new Float32Array(NU * NV); this.runV = new Float32Array(NU * NV);
    this.fingers = null; this.wide = new Float32Array(NU * NV).fill(-1);
    this.kind = 'dry'; this.knuckle = 0.045; this.shape(0.45, 0.3);
    /** 0..1: how hard the fingers are working what they hold: worked, dry sand stands at a lower slope and runs on. */
    this.work = 0;
  }

  /**
   * The hand's shape under the stuff: `curl` of the fingers (0 flat .. 1); how far they are `open` (0 together ..
   * 1 parted: each fans by (1.5 - n) * 0.13 * open radians, as the hand is posed); `knuckle`: where the knuckles
   * are along v; `us`: where each finger's root is across the hand (index to little).
   */
  shape(curl, open, knuckle = this.knuckle, us = this.us || FINGERS) {
    this.fingers = null; this.skinned = false; this.build(curl, open, knuckle, us);
  }

  /**
   * Her hand's own skin, where it is now: `pos`, x y z of each vertex, `tri`, three of them a triangle; `O` the
   * middle of the palm and `A`, `f`, `N` its directions (across, along the fingers, out of the palm), in the frame
   * `pos` is in. What lies in the hand lies on the lowest skin that faces up out of the palm over each cell (a
   * fingertip curled over the palm, or the thumb laid across it, is a lid over what is held, not its floor).
   * To be followed by setHand, which says where the ways through between the fingers are.
   */
  setSkin(pos, tri, O, A, f, N) {
    const n = pos.length / 3, q = this.skinAt && this.skinAt.length >= n * 3 ? this.skinAt : (this.skinAt = new Float32Array(n * 3)), top = this.top ??= new Float32Array(NU * NV);
    top.fill(NaN);
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3] - O[0], y = pos[v * 3 + 1] - O[1], z = pos[v * 3 + 2] - O[2];
      q[v * 3] = x * A[0] + y * A[1] + z * A[2]; q[v * 3 + 1] = x * f[0] + y * f[1] + z * f[2]; q[v * 3 + 2] = x * N[0] + y * N[1] + z * N[2];
    }
    // (A left hand's directions are a mirror's: its triangles go round the other way.)
    const way = (A[1] * f[2] - A[2] * f[1]) * N[0] + (A[2] * f[0] - A[0] * f[2]) * N[1] + (A[0] * f[1] - A[1] * f[0]) * N[2] > 0 ? 1 : -1;
    for (let t = 0; t + 2 < tri.length; t += 3) {
      const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
      const ax = q[a], ay = q[a + 1], az = q[a + 2], bx = q[b] - ax, by = q[b + 1] - ay, bz = q[b + 2] - az, cx = q[c] - ax, cy = q[c + 1] - ay, cz = q[c + 2] - az;
      const nz = bx * cy - by * cx, nx = by * cz - bz * cy, ny = bz * cx - bx * cz;
      // (Facing up out of the palm, if only a little: a finger's side that leans is still something to lie on.)
      if (!(way * nz > 0.08 * Math.hypot(nx, ny, nz))) continue;
      const u0 = Math.min(ax, ax + bx, ax + cx), u1 = Math.max(ax, ax + bx, ax + cx), v0 = Math.min(ay, ay + by, ay + cy), v1 = Math.max(ay, ay + by, ay + cy);
      const i0 = Math.max(0, Math.ceil((u0 - U0) / CELL - 0.5)), i1 = Math.min(NU - 1, Math.floor((u1 - U0) / CELL - 0.5)), j0 = Math.max(0, Math.ceil((v0 - V0) / CELL - 0.5)), j1 = Math.min(NV - 1, Math.floor((v1 - V0) / CELL - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const pu = U0 + (i + 0.5) * CELL - ax, pv = V0 + (j + 0.5) * CELL - ay, lb = (pu * cy - pv * cx) / nz, lc = (bx * pv - by * pu) / nz;
        if (lb < -1e-4 || lc < -1e-4 || lb + lc > 1.0001) continue;
        const w = az + lb * bz + lc * cz, k = j * NU + i;
        if (w > -0.03 && !(top[k] <= w)) top[k] = w;
      }
    }
    this.skinned = true;
  }

  /**
   * The hand's shape under the stuff, from her own fingers as they are held: `fingers`, index to little, each
   * { pts: the middle of the finger at its root, its two joints and its tip ([u, v, w] in palm coordinates),
   * hw: half its width at each of its three bones, th: half its thickness }. The gap between two fingers is as
   * wide, at every place along them, as the two really are apart there: part one finger and that gap opens; curl
   * one out of the way and what lay on it falls. (`open` is kept for how loose the fingers work the sand.)
   */
  setHand(fingers, open, knuckle = this.knuckle, us = this.us || FINGERS) {
    this.fingers = fingers; this.build(0.45, open, knuckle, us);
  }

  build(curl, open, knuckle, us) {
    this.knuckle = knuckle; this.curl = curl; this.open = open; this.us = us;
    const F = this.fingers;
    /** The middle of finger q where it crosses the row v: { u, w, hw, th }, or null beyond its tip. */
    const cross = (q, v) => {
      const p = F[q].pts;
      if (v <= p[0][1]) return { u: p[0][0], w: p[0][2], hw: F[q].hw[0], th: F[q].th[0] };
      for (let i = 0; i < 3; i++) if (p[i + 1][1] - p[i][1] > 1e-4 && v <= p[i + 1][1]) { const t = Math.max(0, (v - p[i][1]) / (p[i + 1][1] - p[i][1])); return { u: p[i][0] + (p[i + 1][0] - p[i][0]) * t, w: p[i][2] + (p[i + 1][2] - p[i][2]) * t, hw: F[q].hw[i], th: F[q].th[i] }; }
      return null;
    };
    // (The fingers slope up from the knuckles by about half their curl: a cupped hand's are nearly level at the root.)
    const rise = Math.tan(Math.min(1.1, 0.5 * curl)), reach = 0.058, half = Math.abs(us[0] - us[3]) / 2 + HALF_FINGER + 0.004, mid = (us[0] + us[3]) / 2;
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const u = U0 + (i + 0.5) * CELL, v = V0 + (j + 0.5) * CELL, k = j * NU + i, along = v - knuckle;
      let f = NaN, leak = 0, gap = -1, wideHere = -1;
      if (along <= 0) {
        // The palm: a hollow, with the ball of the thumb and the heel of the hand as its walls.
        const edge = Math.abs(u - mid) / half, back = Math.max(0, (-v - 0.02) / 0.04);
        if (edge <= 1 && v > V0 + CELL) f = 0.013 * edge * edge * (u > mid ? 1.25 : 1) + 0.012 * back * back + 0.002 * clamp01(1 + along / 0.02);
      } else if (F) {
        // Her fingers: each where it is. On a finger, its own rounded top; between two, the valley they make, and
        // the gap there as wide as they are apart; beyond the outermost or past a fingertip, nothing.
        const at = [cross(0, v), cross(1, v), cross(2, v), cross(3, v)];
        let near = Infinity, n = -1;
        for (let q = 0; q < 4; q++) if (at[q]) { const d = Math.abs(u - at[q].u); if (d < near) { near = d; n = q; } }
        if (n >= 0) {
          const a = at[n], other = u > a.u ? n - 1 : n + 1, b = other >= 0 && other <= 3 ? at[other] : null;
          // (Its outer side, where no finger is beside it, is a finger's side: nothing runs off it below its top.)
          if (near <= a.hw + 0.5 * CELL) { const round = Math.sqrt(Math.max(0, 1 - (near / (a.hw + 0.001)) ** 2)); f = a.w + a.th * (b ? round : Math.max(round, 0.75)); }
          else if (b) f = Math.min(a.w + a.th, b.w + b.th) - 0.008;
          if (b && near > a.hw - 0.75 * CELL) {
            // (At their roots two fingers are no further apart than at their middle joints: the web between them closes the rest.)
            let apart = Math.abs(a.u - b.u) - a.hw - b.hw;
            const joint = Math.max(F[n].pts[1][1], F[other].pts[1][1]);
            if (v < joint) { const a1 = cross(n, joint), b1 = cross(other, joint); if (a1 && b1) apart = Math.min(apart, Math.abs(a1.u - b1.u) - a1.hw - b1.hw); }
            // (Fingers held together are pressed together, skin to skin: nothing passes until they are parted.
            // `wide`: how wide the way through is, metres.)
            wideHere = Math.max(0, apart) * clamp01(open / 0.04); leak = clamp01(wideHere / 0.002); gap = Math.min(n, other);
          }
        }
      } else if (along < reach) {
        // The fingers: four of them side by side (touching when they are together), each going its own way as they part.
        const at = q => us[q] + along * Math.tan((1.5 - q) * 0.13 * open);
        let near = Infinity, n = 0;
        for (let q = 0; q < 4; q++) { const d = Math.abs(u - at(q)); if (d < near) { near = d; n = q; } }
        const other = u > at(n) ? n - 1 : n + 1, inside = other >= 0 && other <= 3;                      // (the index is at the greater u)
        const thick = inside ? Math.abs(us[n] - us[other]) / 2 : HALF_FINGER;                             // half the finger's width
        if (near <= thick + 0.5 * CELL) f = 0.002 + along * rise - 0.006 * (1 - Math.sqrt(Math.max(0, 1 - (near / (thick + 0.001)) ** 2)));
        else if (inside) f = 0.002 + along * rise - 0.01;
        if (inside && near > thick - 0.75 * CELL) {
          // Between two fingers: how wide the gap is here (none when they are together, but for a crack water finds).
          leak = clamp01((Math.abs(at(n) - at(other)) - 2 * thick) / 0.004); gap = Math.min(n, other);
        }
      }
      // (Her own skin, where it is known: that is the floor. Where there is none over a cell, there is nothing
      // there, but a way through between two fingers.)
      if (this.skinned) { const t = this.top[k]; if (t === t) f = t; else if (!(F && gap >= 0)) f = NaN; }
      this.floor[k] = f; this.leak[k] = leak; this.gap[k] = gap; this.wide[k] = wideHere;
    }
    // (A slit a cell wide with skin on both sides of it and no way through is skin pressed to skin: the thumb laid
    // against the first finger, a fold. It is closed, at the height of the lower side.)
    if (this.skinned) {
      const fl = this.floor, close = [];
      for (let j = 1; j < NV - 1; j++) for (let i = 1; i < NU - 1; i++) {
        const k = j * NU + i;
        if (fl[k] === fl[k]) continue;
        const a = fl[k - 1], b = fl[k + 1], c = fl[k - NU], d = fl[k + NU];
        if (a === a && b === b) close.push(k, Math.min(a, b)); else if (c === c && d === d) close.push(k, Math.min(c, d));
      }
      for (let q = 0; q < close.length; q += 2) fl[close[q]] = close[q + 1];
    }
  }

  /** A handful of `kind` ('dry', 'wet' sand or 'water') lying in the hand. */
  fill(kind, volume = HANDFUL) {
    this.kind = kind; this.s.fill(0); this.shiftU.fill(0); this.shiftV.fill(0); this.runU.fill(0); this.runV.fill(0);
    // (Water: spread evenly for now; the hand that lifts it says how it is held, and it is flooded to that: flood().)
    if (kind === 'water') { let cells = 0; for (let k = 0; k < this.s.length; k++) if (!Number.isNaN(this.floor[k])) cells++; const d = volume / (cells * CELL * CELL); for (let k = 0; k < this.s.length; k++) if (!Number.isNaN(this.floor[k])) this.s[k] = d; return; }
    // (Heaped over the hollow of the palm; it finds its own shape in the next few frames.)
    let sum = 0;
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const k = j * NU + i, u = U0 + (i + 0.5) * CELL, v = V0 + (j + 0.5) * CELL;
      if (Number.isNaN(this.floor[k])) continue;
      // (Over the hollow of the palm and the roots of the fingers.)
      this.s[k] = Math.max(0, 1 - Math.hypot(u / 0.036, (v - 0.012) / 0.046) ** 2);
      sum += this.s[k];
    }
    const scale = volume / (sum * CELL * CELL || 1);
    for (let k = 0; k < this.s.length; k++) this.s[k] *= scale;
  }

  /**
   * Water in the hand: as much as the hand holds as it is held, up to `volume`. `tilt`: which way is up, in the
   * palm's own directions (across, along the fingers, out of the palm). The water lies level in every hollow the
   * hand makes, to a millimetre under the lowest place it could run out of that hollow by (the edge of the palm,
   * a gap between fingers that are apart, a fingertip): a cupped hand holds a couple of spoonfuls, not a cupful.
   * Returns the cubic metres it holds.
   */
  flood(volume = HANDFUL, tilt = [0, 0, 1]) {
    const { s, floor, leak } = this, n = NU * NV, flow = this.flow ??= { u: new Float32Array(n), v: new Float32Array(n) };
    flow.u.fill(0); flow.v.fill(0);
    // How high each cell's floor is, and how high water can stand over it before it finds a way out: found from
    // the ways out inward, lowest first, each cell taking the higher of its own floor and the way it was reached by.
    const high = new Float32Array(n), brim = new Float32Array(n).fill(Infinity), seen = new Uint8Array(n), queue = [], t2 = Math.max(tilt[2], 0.3);
    const valid = k => !Number.isNaN(floor[k]);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const k = j * NU + i;
      if (!valid(k)) continue;
      high[k] = floor[k] * t2 + (U0 + (i + 0.5) * CELL) * tilt[0] + (V0 + (j + 0.5) * CELL) * tilt[1];
      if (leak[k] > 0.2 || i === 0 || i === NU - 1 || j === 0 || j === NV - 1 || !valid(k - 1) || !valid(k + 1) || !valid(k - NU) || !valid(k + NU)) { brim[k] = high[k]; seen[k] = 1; queue.push(k); }
    }
    while (queue.length) {
      let at = 0;
      for (let q = 1; q < queue.length; q++) if (brim[queue[q]] < brim[queue[at]]) at = q;
      const k = queue[at]; queue[at] = queue[queue.length - 1]; queue.pop();
      for (const to of [k - 1, k + 1, k - NU, k + NU]) if (to >= 0 && to < n && valid(to) && !seen[to]) { brim[to] = Math.max(high[to], brim[k]); seen[to] = 1; queue.push(to); }
    }
    // (And no higher anywhere than the level that holds `volume`: found by halving.)
    const held = level => { let sum = 0; for (let k = 0; k < n; k++) if (seen[k]) sum += Math.max(0, Math.min(brim[k] - 0.001, level) - high[k]); return sum / t2 * CELL * CELL; };
    let lo = -0.1, hi = 0.1;
    if (held(hi) > volume) for (let q = 0; q < 28; q++) { const mid = (lo + hi) / 2; if (held(mid) > volume) hi = mid; else lo = mid; }
    for (let k = 0; k < n; k++) s[k] = seen[k] ? Math.max(0, Math.min(brim[k] - 0.001, hi) - high[k]) / t2 : 0;
    return held(hi);
  }

  /**
   * Water, a step on: it runs to wherever its surface is lower and has its own way while it goes, so it rocks
   * in a hand that is moved and comes to rest in a second or two; it runs out over any edge it reaches, through
   * an open gap freely, and through fingers held together slowly: by the crack there is between any two fingers.
   * A film is left wherever it has been. `tilt` as for step().
   */
  stepWater(dt, tilt) {
    const { s, floor, leak, gap } = this, flow = this.flow ??= { u: new Float32Array(NU * NV), v: new Float32Array(NU * NV) };
    const out = { gaps: [0, 0, 0], edge: 0, skin: 0, at: [0, 0], slots: [0, 1, 2].map(() => ({ n: 0, u: 0, v: 0, w: 0, v0: Infinity, v1: -Infinity })) };
    const g = 9.81, FILM = 0.00015, n = Math.min(8, Math.max(1, Math.ceil(dt / 0.004))), h = dt / n, keep = Math.exp(-h * 3);
    const head = k => (floor[k] + s[k]) * tilt[2] + (U0 + (k % NU + 0.5) * CELL) * tilt[0] + (V0 + (((k - k % NU) / NU) + 0.5) * CELL) * tilt[1];
    const give = this.next;
    for (let step = 0; step < n; step++) {
      // The flow between each cell and the next (to the right, flow.u; onward, flow.v): pushed by the difference in
      // level, through as deep a way as the water there is over the higher of the two floors.
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const k = j * NU + i;
        for (const [to, f] of [[i + 1 < NU ? k + 1 : -1, flow.u], [j + 1 < NV ? k + NU : -1, flow.v]]) {
          if (to < 0 || Number.isNaN(floor[k]) || Number.isNaN(floor[to])) { f[k] = 0; continue; }
          const a = head(k), b = head(to), top = Math.max(floor[k], floor[to]), deep = Math.max(0, Math.max(floor[k] + s[k], floor[to] + s[to]) - top - FILM);
          f[k] = deep > 0 ? f[k] * keep + h * g * deep * (a - b) / CELL : 0;
        }
      }
      // No cell gives more than it has.
      give.fill(0);
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const k = j * NU + i;
        if (!(s[k] > 0)) continue;
        const leaving = Math.max(flow.u[k], 0) + Math.max(flow.v[k], 0) + (i > 0 ? Math.max(-flow.u[k - 1], 0) : 0) + (j > 0 ? Math.max(-flow.v[k - NU], 0) : 0);
        give[k] = leaving * h > Math.max(s[k] - FILM, 0) * CELL ? Math.max(s[k] - FILM, 0) * CELL / (leaving * h) : 1;
      }
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const k = j * NU + i;
        for (const [to, f] of [[i + 1 < NU ? k + 1 : -1, flow.u], [j + 1 < NV ? k + NU : -1, flow.v]]) {
          if (to < 0 || f[k] === 0) continue;
          f[k] *= f[k] > 0 ? (give[k] || 0) : (give[to] || 0);
          const moved = f[k] * h / CELL; s[k] -= moved; s[to] += moved;
        }
      }
      // Out of the hand: over an edge it has reached (more than a film's depth of it: a lip of water holds), and
      // through the gaps: a crack seven hundredths of a millimetre wide between fingers held together, and as
      // wide as they are apart when they are parted.
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const k = j * NU + i, d = s[k] - FILM;
        if (!(d > 0) || Number.isNaN(floor[k])) { if (s[k] < 0) s[k] = 0; continue; }
        const u = U0 + (i + 0.5) * CELL, v = V0 + (j + 0.5) * CELL, speed = Math.sqrt(2 * 9.81 * d);
        let edges = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || a >= NU || b < 0 || b >= NV || Number.isNaN(floor[b * NU + a])) edges++; }
        if (edges && d > 0.0006) { const gone = Math.min(d, 0.5 * speed * d * edges * h / CELL); s[k] -= gone; out.edge += gone * CELL * CELL; out.at[0] += u * gone; out.at[1] += v * gone; }
        if (gap[k] >= 0 && s[k] > FILM) {
          const wide = 0.00007 + 0.6 * (this.wide[k] >= 0 ? this.wide[k] : 0.004 * leak[k]), gone = Math.min(s[k] - FILM, 0.6 * speed * wide * h / CELL);
          s[k] -= gone; out.gaps[gap[k]] += gone * CELL * CELL;
          const sl = out.slots[gap[k]]; sl.n += gone; sl.u += gone * u; sl.v += gone * v; sl.w += gone * floor[k]; sl.v0 = Math.min(sl.v0, v); sl.v1 = Math.max(sl.v1, v);
        }
      }
    }
    // (What is left as a film is the wet of the skin: it is gone from the handful in a third of a second. `skin`.)
    // (Not the thin edge of a pool: only where there is no more than a film all round.)
    for (let k = 0; k < s.length; k++) if (s[k] > 0 && s[k] < 0.0004) {
      const i = k % NU, thin = q => !(s[q] >= 0.0008);
      if (!(thin(k - (i > 0 ? 1 : 0)) && thin(k + (i + 1 < NU ? 1 : 0)) && thin(Math.max(k - NU, 0)) && thin(Math.min(k + NU, s.length - 1)))) continue;
      const gone = Math.min(s[k], dt * 0.001); s[k] -= gone; out.skin += gone * CELL * CELL;
    }
    if (out.edge > 0) { const w = out.edge / (CELL * CELL); out.at[0] /= w; out.at[1] /= w; }
    for (const sl of out.slots) if (sl.n > 0) { sl.u /= sl.n; sl.v /= sl.n; sl.w /= sl.n; }
    return out;
  }

  /**
   * The hand is turned over, or far enough that nothing lies on it: what it holds falls off it, all of it within
   * half a second, from wherever it lay. Returns what a step returns, with `shed`: where each part
   * left from ([u, v, w, cubic metres]).
   */
  shed(dt) {
    const { s, floor } = this, part = Math.min(1, dt / 0.16), out = { gaps: [0, 0, 0], edge: 0, skin: 0, at: [0, 0, 0], slots: [0, 1, 2].map(() => ({ n: 0, u: 0, v: 0, w: 0, v0: Infinity, v1: -Infinity })), shed: [] };
    for (let k = 0; k < s.length; k++) {
      if (!(s[k] > 0) || floor[k] !== floor[k]) { s[k] = 0; continue; }
      const gone = Math.min(s[k], Math.max(s[k], 0.006) * part), i = k % NU, vol = gone * CELL * CELL;
      s[k] -= gone; out.edge += vol; out.shed.push([U0 + (i + 0.5) * CELL, V0 + ((k - i) / NU + 0.5) * CELL, floor[k], vol]);
    }
    if (this.flow) { this.flow.u.fill(0); this.flow.v.fill(0); }
    return out;
  }

  /** How much is in the hand, in handfuls. */
  get amount() { let sum = 0; for (let k = 0; k < this.s.length; k++) sum += this.s[k]; return sum * CELL * CELL / HANDFUL; }
  empty() { this.s.fill(0); }

  /**
   * One step. `tilt` = [the world's up along u, along v, along the normal] (how the palm lies), `dt` seconds.
   * Returns what fell out: { gaps: [m3, m3, m3], edge: m3, at: [u, v] the middle of what went over the edge }.
   */
  step(dt, tilt) {
    if (this.kind === 'water') return this.stepWater(dt, tilt);
    const { s, floor, leak, gap, next } = this, water = false, wet = this.kind === 'wet';
    // The slope it stands at. Dry sand: 32 degrees in a still hand; fingers that are parting work it loose, and it
    // creeps at half that. Wet sand from the wash is a slurry: it sags slowly. Water stands at none.
    const talus = water ? 0.01 : wet ? 0.3 * (1 - 0.5 * this.work) : (0.62 - 0.36 * Math.min(1, this.open * 1.4)) * (1 - 0.4 * this.work), rate = water ? 0.11 : wet ? 0.08 : 0.2;
    // (`slots`: for each gap, where what fell through it left the hand: the middle of it across and along, the
    // stretch of the gap it fell from, and the height of the hand there.)
    const out = { gaps: [0, 0, 0], edge: 0, at: [0, 0], slots: [0, 1, 2].map(() => ({ n: 0, u: 0, v: 0, w: 0, v0: Infinity, v1: -Infinity })) }, fu = this.fu ??= new Float32Array(NU * NV), fv = this.fv ??= new Float32Array(NU * NV);
    fu.fill(0); fv.fill(0);
    // (A step is a sixtieth of a second's worth; a slow frame takes more than one.)
    // (Water finds its level quickly: it gets three rounds of running to one of leaking.)
    const frames = Math.max(1, Math.min(4, Math.round(dt * 60))), rounds = frames * (water ? 3 : 1);
    for (let round = 0; round < rounds; round++) {
      next.set(s);
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const k = j * NU + i;
        if (s[k] <= 0 || Number.isNaN(floor[k])) continue;
        const u = U0 + (i + 0.5) * CELL, v = V0 + (j + 0.5) * CELL, here = (floor[k] + s[k]) * tilt[2] + u * tilt[0] + v * tilt[1];
        // To each of the four neighbours that is lower in the world by more than the slope it stands at.
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj, n = b * NU + a, off = a < 0 || a >= NU || b < 0 || b >= NV || Number.isNaN(floor[n]);
          // (Beyond the edge of the hand there is nothing: what reaches the edge goes over it.)
          const there = (off ? floor[k] * tilt[2] - 0.02 : (floor[n] + s[n]) * tilt[2]) + (u + di * CELL) * tilt[0] + (v + dj * CELL) * tilt[1];
          const drop = here - there - talus * CELL;
          if (drop <= 0) continue;
          const move = Math.min(s[k] * 0.24, rate * drop / Math.max(tilt[2], 0.3));
          next[k] -= move; fu[k] += di * move; fv[k] += dj * move;
          if (off) { if (this.lost) this.lost[k] += move; out.edge += move * CELL * CELL; out.at[0] += u * move; out.at[1] += v * move; out.at[2] = (out.at[2] || 0) + floor[k] * move; } else next[n] += move;
        }
      }
      // Through the gaps: a cell over a gap lets go of what lies in it, faster the wider the gap.
      const leaking = !water || round % 3 === 2;
      for (let k = 0; k < next.length; k++) {
        if (next[k] < 0) next[k] = 0;
        if (!leaking) continue;
        // (Water finds the crack between closed fingers; wet sand goes through an open gap only once enough of it has sagged in there, and then all at once: in lumps.)
        const through = water ? (gap[k] >= 0 ? Math.max(leak[k], 0.08) : 0) : wet ? (leak[k] > 0 && next[k] > 0.004 * (1 - 0.5 * this.work) ? 16 : 0) : leak[k] * (1 + 2 * this.work);
        if (through <= 0 || next[k] <= 0) continue;
        const gone = Math.min(next[k], (water ? 0.0018 : 0.0011) * through + next[k] * 0.06 * through);
        next[k] -= gone;
        if (gap[k] >= 0) {
          out.gaps[gap[k]] += gone * CELL * CELL;
          const sl = out.slots[gap[k]], i = k % NU, v = V0 + ((k - i) / NU + 0.5) * CELL;
          sl.n += gone; sl.u += gone * (U0 + (i + 0.5) * CELL); sl.v += gone * v; sl.w += gone * floor[k]; sl.v0 = Math.min(sl.v0, v); sl.v1 = Math.max(sl.v1, v);
        }
      }
      s.set(next);
    }
    if (out.edge > 0) { const w = out.edge / (CELL * CELL); out.at[0] /= w; out.at[1] /= w; out.at[2] = (out.at[2] || 0) / w; }
    for (const sl of out.slots) if (sl.n > 0) { sl.u /= sl.n; sl.v /= sl.n; sl.w /= sl.n; }
    // How the top of it is moving: what went from each cell towards each side, over a layer three millimetres deep.
    // The grains drawn on it are carried along at that speed (eased over a twelfth of a second: it does not jitter).
    const k = 1 - Math.exp(-dt / 0.08), most = 0.25;
    for (let c = 0; c < fu.length; c++) {
      const u = Math.max(-most, Math.min(most, fu[c] * CELL / 0.003 / dt)), v = Math.max(-most, Math.min(most, fv[c] * CELL / 0.003 / dt));
      this.runU[c] += (u - this.runU[c]) * k; this.runV[c] += (v - this.runV[c]) * k;
      this.shiftU[c] += this.runU[c] * dt; this.shiftV[c] += this.runV[c] * dt;
    }
    return out;
  }

  /** Where gap g (0 between index and middle .. 2) lets go, in palm coordinates [u, v]. */
  gapAt(g) { const along = 0.018, us = this.us || FINGERS, at = n => us[n] + along * Math.tan((1.5 - n) * 0.13 * this.open); return [(at(g) + at(g + 1)) / 2, this.knuckle + along]; }
}
