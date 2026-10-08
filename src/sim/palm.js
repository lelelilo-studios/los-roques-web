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
    this.knuckle = knuckle; this.curl = curl; this.open = open; this.us = us;
    // (The fingers slope up from the knuckles by about half their curl: a cupped hand's are nearly level at the root.)
    const rise = Math.tan(Math.min(1.1, 0.5 * curl)), reach = 0.058, half = Math.abs(us[0] - us[3]) / 2 + HALF_FINGER + 0.004, mid = (us[0] + us[3]) / 2;
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const u = U0 + (i + 0.5) * CELL, v = V0 + (j + 0.5) * CELL, k = j * NU + i, along = v - knuckle;
      let f = NaN, leak = 0, gap = -1;
      if (along <= 0) {
        // The palm: a hollow, with the ball of the thumb and the heel of the hand as its walls.
        const edge = Math.abs(u - mid) / half, back = Math.max(0, (-v - 0.02) / 0.04);
        if (edge <= 1 && v > V0 + CELL) f = 0.013 * edge * edge * (u > mid ? 1.25 : 1) + 0.012 * back * back + 0.002 * clamp01(1 + along / 0.02);
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
      this.floor[k] = f; this.leak[k] = leak; this.gap[k] = gap;
    }
  }

  /** A handful of `kind` ('dry', 'wet' sand or 'water') lying in the hand. */
  fill(kind, volume = HANDFUL) {
    this.kind = kind; this.s.fill(0);
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

  /** How much is in the hand, in handfuls. */
  get amount() { let sum = 0; for (let k = 0; k < this.s.length; k++) sum += this.s[k]; return sum * CELL * CELL / HANDFUL; }
  empty() { this.s.fill(0); }

  /**
   * One step. `tilt` = [the world's up along u, along v, along the normal] (how the palm lies), `dt` seconds.
   * Returns what fell out: { gaps: [m3, m3, m3], edge: m3, at: [u, v] the middle of what went over the edge }.
   */
  step(dt, tilt) {
    const { s, floor, leak, gap, next } = this, water = this.kind === 'water', wet = this.kind === 'wet';
    // The slope it stands at. Dry sand: 32 degrees in a still hand; fingers that are parting work it loose, and it
    // creeps at half that. Wet sand from the wash is a slurry: it sags slowly. Water stands at none.
    const talus = water ? 0.01 : wet ? 0.3 * (1 - 0.5 * this.work) : (0.62 - 0.36 * Math.min(1, this.open * 1.4)) * (1 - 0.75 * this.work), rate = water ? 0.11 : wet ? 0.08 : 0.2, out = { gaps: [0, 0, 0], edge: 0, at: [0, 0] };
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
          next[k] -= move;
          if (off) { out.edge += move * CELL * CELL; out.at[0] += u * move; out.at[1] += v * move; } else next[n] += move;
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
        if (gap[k] >= 0) out.gaps[gap[k]] += gone * CELL * CELL;
      }
      s.set(next);
    }
    if (out.edge > 0) { const w = out.edge / (CELL * CELL); out.at[0] /= w; out.at[1] /= w; }
    return out;
  }

  /** Where gap g (0 between index and middle .. 2) lets go, in palm coordinates [u, v]. */
  gapAt(g) { const along = 0.018, us = this.us || FINGERS, at = n => us[n] + along * Math.tan((1.5 - n) * 0.13 * this.open); return [(at(g) + at(g + 1)) / 2, this.knuckle + along]; }
}
