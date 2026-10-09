// The way by water from one place to another: for "take me there", and for the chart. The seabed is read once
// on a grid of 44 m (the depth map's own detail is no finer out at sea), a cell is water a boat can cross if it
// has 1.2 m over it at the lowest tide and so have all the cells round it, and the way is the shortest through
// such cells, a little dearer where it is shallow or where the swell breaks (so that it keeps to the open
// lagoon and the channels when it can). Bare arithmetic: tests/route.test.mjs runs it on seas of its own.

export class Seaways {
  /**
   * @param {(x: number, z: number) => number} heightAt  the bed's height (m; mean sea level is 0)
   * @param {{x: number, z: number, w: number, h: number}} rect  the world it covers
   * @param {number} cell  metres
   * @param {{deep?: number, lowest?: number, hazardAt?: ((x: number, z: number) => number) | null}} [o]  `deep`: the
   *   least water to cross (m), at a tide of `lowest` (m); `hazardAt`: 0..1, how much a place is to be kept away from
   *   (where the swell breaks)
   */
  constructor(heightAt, rect, cell = 44, { deep = 1.2, lowest = -0.27, hazardAt = null } = {}) {
    Object.assign(this, { heightAt, rect, cell, deep, lowest, hazardAt });
    this.nx = Math.ceil(rect.w / cell); this.nz = Math.ceil(rect.h / cell);
    const n = this.nx * this.nz;
    this.h = new Float32Array(n); this.hazard = new Uint8Array(n); this.clear = new Uint8Array(n);
    this.row = 0; this.ready = false;
  }

  /** The cell a place is in ([i, j]), and a cell's middle ([x, z]). */
  cellOf(x, z) { return [Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.rect.x) / this.cell))), Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.rect.z) / this.cell)))]; }
  middle(i, j) { return [this.rect.x + (i + 0.5) * this.cell, this.rect.z + (j + 0.5) * this.cell]; }

  /**
   * Reads the bed, a few rows at a time: for as long as `ms` milliseconds, then again next frame. Returns how far
   * along it is, 0..1 (1: ready).
   */
  build(ms = 4) {
    if (this.ready) return 1;
    const until = (globalThis.performance?.now?.() ?? Date.now()) + ms, { nx, nz, cell, rect } = this;
    while (this.row < nz) {
      const j = this.row, z = rect.z + (j + 0.5) * cell;
      for (let i = 0; i < nx; i++) { const x = rect.x + (i + 0.5) * cell; this.h[j * nx + i] = this.heightAt(x, z); if (this.hazardAt) this.hazard[j * nx + i] = Math.round(255 * Math.min(1, Math.max(0, this.hazardAt(x, z)))); }
      this.row++;
      if ((globalThis.performance?.now?.() ?? Date.now()) > until) break;
    }
    if (this.row >= nz) {
      // Clear water: deep enough, and so is every cell round it.
      const least = -(this.deep - this.lowest), ok = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && this.h[j * nx + i] <= least;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let all = 1; for (let b = -1; b <= 1 && all; b++) for (let a = -1; a <= 1; a++) if (!ok(i + a, j + b)) { all = 0; break; } this.clear[j * nx + i] = all; }
      this.ready = true;
    }
    return this.row / nz;
  }

  /** How deep the water is at a place at mean sea level (m; negative on land), from the grid, between its cells. */
  depthAt(x, z) {
    const { nx, nz, cell, rect } = this, u = Math.min(nx - 1.001, Math.max(0, (x - rect.x) / cell - 0.5)), v = Math.min(nz - 1.001, Math.max(0, (z - rect.z) / cell - 0.5)), i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j, a = j * nx + i;
    return -((this.h[a] * (1 - fx) + this.h[a + 1] * fx) * (1 - fz) + (this.h[a + nx] * (1 - fx) + this.h[a + nx + 1] * fx) * fz);
  }

  /** The nearest cell to a place that `test(index)` accepts, looking out to `reach` cells: [i, j], or null. */
  nearest(x, z, test, reach = 40) {
    const [ci, cj] = this.cellOf(x, z), { nx, nz } = this;
    let best = null, far = Infinity;
    for (let r = 0; r <= reach && r <= far + 1; r++) {
      for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        const i = ci + a, j = cj + b;
        if (i < 0 || j < 0 || i >= nx || j >= nz || !test(j * nx + i)) continue;
        const d = Math.hypot(a, b);
        if (d < far) { far = d; best = [i, j]; }
      }
    }
    return best;
  }

  /**
   * Where a boat is left when it comes to a place: the nearest clear water to it that is no deeper than `most`
   * metres (to anchor in), within `reach` metres: [x, z], or null.
   */
  anchorage(x, z, most = 6, reach = 1500) {
    const c = this.nearest(x, z, k => this.clear[k] === 1 && -this.h[k] <= most, Math.ceil(reach / this.cell)) || this.nearest(x, z, k => this.clear[k] === 1, Math.ceil(reach / this.cell));
    return c ? this.middle(c[0], c[1]) : null;
  }

  /** What it costs to cross a cell, for each metre: 1 in open deep water, more where it is shallow or the swell breaks. */
  dear(k) { const d = -this.h[k]; return 1 + (d < 2.5 ? 0.7 : d < 4 ? 0.25 : 0) + 3 * this.hazard[k] / 255; }

  /** Whether the straight line between two places lies in clear water all the way, and nowhere much dearer than its ends. */
  sight(a, b) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.cell * 0.4)));
    let most = 0;
    for (const p of [a, b]) { const [i, j] = this.cellOf(p[0], p[1]); most = Math.max(most, this.dear(j * this.nx + i)); }
    for (let s = 0; s <= n; s++) { const [i, j] = this.cellOf(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n), k = j * this.nx + i; if (!this.clear[k] || this.dear(k) > most + 0.3) return false; }
    return true;
  }

  /**
   * The way from one place to another: { points: [[x, z], ...], length (m) }, or null if there is none. It
   * begins at `from` itself and ends at `to` itself, each joined to the nearest clear water (within `reach` m).
   */
  route(from, to, reach = 1500) {
    if (!this.ready) return null;
    const { nx, nz, cell } = this, n = nx * nz, cells = Math.ceil(reach / cell);
    const s = this.nearest(from[0], from[1], k => this.clear[k] === 1, cells), t = this.nearest(to[0], to[1], k => this.clear[k] === 1, cells);
    if (!s || !t) return null;
    const start = s[1] * nx + s[0], goal = t[1] * nx + t[0];
    // A*: the cheapest way cell to cell, eight ways from each.
    const g = this.g ??= new Float32Array(n), came = this.came ??= new Int32Array(n), state = this.state ??= new Uint8Array(n);
    g.fill(Infinity); state.fill(0);
    const heap = [], key = [];
    const push = (k, f) => { let i = heap.length; heap.push(k); key.push(f); while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= f) break; heap[i] = heap[p]; key[i] = key[p]; i = p; } heap[i] = k; key[i] = f; };
    const pop = () => { const top = heap[0], k = heap.pop(), f = key.pop(), m = heap.length; if (m) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= m) break; if (c + 1 < m && key[c + 1] < key[c]) c++; if (key[c] >= f) break; heap[i] = heap[c]; key[i] = key[c]; i = c; } heap[i] = k; key[i] = f; } return top; };
    const ti = t[0], tj = t[1], guess = k => { const a = Math.abs(k % nx - ti), b = Math.abs(Math.floor(k / nx) - tj); return (Math.max(a, b) + 0.41421356 * Math.min(a, b)) * cell; };
    g[start] = 0; came[start] = -1; push(start, guess(start));
    let found = false;
    while (heap.length) {
      const k = pop();
      if (state[k]) continue;
      state[k] = 1;
      if (k === goal) { found = true; break; }
      const i = k % nx, j = (k - i) / nx;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        if (!a && !b) continue;
        const p = i + a, q = j + b;
        if (p < 0 || q < 0 || p >= nx || q >= nz) continue;
        const m = q * nx + p;
        if (!this.clear[m] || state[m]) continue;
        const cost = g[k] + (a && b ? 1.41421356 : 1) * cell * 0.5 * (this.dear(k) + this.dear(m));
        if (cost < g[m]) { g[m] = cost; came[m] = k; push(m, cost + guess(m)); }
      }
    }
    if (!found) return null;
    const raw = [];
    for (let k = goal; k >= 0; k = came[k]) raw.push(this.middle(k % nx, Math.floor(k / nx)));
    raw.reverse();
    // Pulled straight where there is a clear line of sight (the cells' stair steps are not how a boat goes).
    const pulled = [raw[0]];
    for (let i = 0; i < raw.length - 1;) { let j = Math.min(raw.length - 1, i + 60); while (j > i + 1 && !this.sight(raw[i], raw[j])) j--; pulled.push(raw[j]); i = j; }
    let points = [from.slice(), ...pulled, to.slice()];
    // (No two points nearer than half a cell: the ends may lie close to the first and last cells' middles.)
    points = points.filter((p, i) => i === 0 || i === points.length - 1 || (Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > cell * 0.5 && Math.hypot(p[0] - points[points.length - 1][0], p[1] - points[points.length - 1][1]) > cell * 0.5));
    // And its corners rounded: each cut 45 m along both its legs (a quarter of a short leg). No further: clear
    // water is a cell from water that is not, and a corner cut by more could cross it.
    {
      const out = [points[0]];
      for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1], p = points[i], b = points[i + 1], la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]), ka = Math.min(0.25, 45 / la), kb = Math.min(0.25, 45 / lb);
        out.push([p[0] + (a[0] - p[0]) * ka, p[1] + (a[1] - p[1]) * ka], [p[0] + (b[0] - p[0]) * kb, p[1] + (b[1] - p[1]) * kb]);
      }
      out.push(points[points.length - 1]);
      points = out;
    }
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    return { points, length };
  }
}

/** A way as a line to follow: where you are and which way you head after `s` metres of it. */
export class Passage {
  /** @param {number[][]} points  [[x, z], ...] */
  constructor(points) {
    this.points = points; this.at_ = [0];
    for (let i = 1; i < points.length; i++) this.at_.push(this.at_[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    this.length = this.at_[this.at_.length - 1]; this.i = 0;
  }

  /** The point `s` metres along: [x, z]. */
  point(s) {
    const d = Math.min(this.length, Math.max(0, s)), a = this.at_;
    if (d < a[this.i]) this.i = 0;
    while (this.i < a.length - 2 && a[this.i + 1] < d) this.i++;
    const i = this.i, span = a[i + 1] - a[i] || 1, k = (d - a[i]) / span, p = this.points[i], q = this.points[i + 1];
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  }

  /**
   * Where a boat is `s` metres along, heading the way the line goes a boat's length either side of it (so
   * that it comes round a corner as a boat does, not all at once): { x, z, heading (radians clockwise from
   * north), turn: how fast the heading changes for each metre gone (radians) }.
   */
  at(s, look = 12) {
    const p = this.point(s), a = this.point(s - look), b = this.point(s + look), c = this.point(s + 3 * look);
    const heading = Math.atan2(b[0] - a[0], -(b[1] - a[1])), next = Math.atan2(c[0] - p[0], -(c[1] - p[1]));
    return { x: p[0], z: p[1], heading, turn: Math.atan2(Math.sin(next - heading), Math.cos(next - heading)) / (2 * look) };
  }
}
