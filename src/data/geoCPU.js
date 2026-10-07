// The ground function on the CPU: the JS twin of shaders/chunks/geo.glsl.js (keep the two in step).
// Used for camera clearance, placing things on the ground, and labels.

const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const _wx = [0, 0, 0, 0], _wy = [0, 0, 0, 0];
/** Weights of the four texels around a sample at fraction f for a cubic B-spline. */
export function bspline(f, out = [0, 0, 0, 0]) {
  const f2 = f * f, f3 = f2 * f;
  out[0] = (1 - 3 * f + 3 * f2 - f3) / 6; out[1] = (4 - 6 * f2 + 3 * f3) / 6; out[3] = f3 / 6; out[2] = 1 - out[0] - out[1] - out[3];
  return out;
}

/** Height of a sand shore at signed distance s from the waterline (s > 0 seaward). Same as lrShoreProfile. */
export function shoreProfile(s, mapHeight, bermMin = 0.22) {
  if (s >= 0) return -0.11 * s / (1 + 0.22 * s) - Math.max(s - 4, 0) * 0.02;
  let berm = Math.min(1, Math.max(0.22, mapHeight * 1.2 + 0.05));
  if (bermMin < 0.2199) berm = Math.min(berm, bermMin);       // (on the sandbar of Cayo de Agua: its own crest height)
  return berm * (1 - Math.exp(s * 0.11 / berm));
}

export class Ground {
  /**
   * @param {{raw: Uint16Array, width: number, height: number, scale: number, offset: number}} height
   * @param {{raw: Uint16Array, width: number, height: number, scale: number, offset: number}} shore
   * @param {{x: number, z: number, w: number, h: number}} rect  world rectangle of the maps
   */
  constructor(height, shore, rect) {
    Object.assign(this, { height, shore, rect });
    this.cover = {};
    /** The sandbar of Cayo de Agua, lower than any beach: { a: [x, z], b: [x, z], reach (m), crest (m) }, or null (lrBermMinAt in lr_geo). */
    this.sandbar = null;
  }

  /** The lowest a berm can be at a point: 0.22 m, less along the sandbar. */
  bermMinAt(x, z) {
    const bar = this.sandbar;
    if (!bar) return 0.22;
    const abx = bar.b[0] - bar.a[0], abz = bar.b[1] - bar.a[1], apx = x - bar.a[0], apz = z - bar.a[1];
    const along = Math.min(0.94, Math.max(0.06, (apx * abx + apz * abz) / (abx * abx + abz * abz)));
    return bar.crest + (0.22 - bar.crest) * smoothstep(0.5 * bar.reach, bar.reach, Math.hypot(apx - abx * along, apz - abz * along));
  }

  /**
   * One texel (0..1 per channel) of an 8-bit RGBA map given to `this.cover` (`land`: mangrove, scrub, built-up,
   * canopy height; `benthic`: seagrass, coral, rubble, confidence), or zeros where there is no such map.
   */
  coverAt(name, x, z, out = [0, 0, 0, 0]) {
    const m = this.cover[name];
    if (!m) return out.fill(0);
    const i = Math.min(m.width - 1, Math.max(0, Math.floor((x - this.rect.x) / this.rect.w * m.width))), j = Math.min(m.height - 1, Math.max(0, Math.floor((z - this.rect.z) / this.rect.h * m.height)));
    for (let c = 0; c < 4; c++) out[c] = m.rgba[(j * m.width + i) * 4 + c] / 255;
    return out;
  }

  /**
   * Bicubic B-spline sample of a raster at map coordinates u, v in 0..1: the same filter as lrBicubic in the
   * shader (which builds it from four bilinear taps), with texels clamped at the edges.
   */
  sample(map, u, v) {
    const W = map.width, H = map.height, r = map.raw;
    const sx = u * W - 0.5, sy = v * H - 0.5, ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const wx = bspline(fx, _wx), wy = bspline(fy, _wy);
    let sum = 0;
    for (let j = 0; j < 4; j++) {
      const row = Math.min(H - 1, Math.max(0, iy - 1 + j)) * W;
      let line = 0;
      for (let i = 0; i < 4; i++) line += wx[i] * r[row + Math.min(W - 1, Math.max(0, ix - 1 + i))];
      sum += wy[j] * line;
    }
    return sum * map.scale + map.offset;
  }

  /** Signed distance to the shoreline at world x/z (positive seaward, clamped to +-300 m). */
  shoreAt(x, z) {
    const u = (x - this.rect.x) / this.rect.w, v = (z - this.rect.z) / this.rect.h;
    return u < 0 || u > 1 || v < 0 || v > 1 ? 300 : this.sample(this.shore, u, v);
  }

  /** Unit vector pointing seaward (up the shore-distance field) at world x/z, or null where the field is flat. */
  seaward(x, z, d = 3) {
    const gx = this.shoreAt(x + d, z) - this.shoreAt(x - d, z), gz = this.shoreAt(x, z + d) - this.shoreAt(x, z - d), l = Math.hypot(gx, gz);
    return l < 1e-3 ? null : { x: gx / l, z: gz / l, slope: l / (2 * d) };
  }

  /**
   * The point near (x, z) whose shore distance is `shore` metres (negative = up the beach), found by walking
   * along the shore-distance gradient. Returns { x, z, yaw } with yaw (degrees) facing the sea, or null.
   */
  findShore(x, z, shore) {
    for (let i = 0; i < 40; i++) {
      const g = this.seaward(x, z), s = this.shoreAt(x, z);
      if (!g) return null;
      if (Math.abs(s - shore) < 0.02) return { x, z, yaw: Math.atan2(g.x, -g.z) * 180 / Math.PI };
      const step = Math.max(-20, Math.min(20, (shore - s) / Math.max(g.slope, 0.3)));
      x += g.x * step; z += g.z * step;
    }
    const g = this.seaward(x, z);
    return g ? { x, z, yaw: Math.atan2(g.x, -g.z) * 180 / Math.PI } : null;
  }

  /**
   * The middle of a sand bar: from a point on it, the nearby point furthest from the water on either side
   * (found by walking up the shore-distance field until it levels off, as it does along a ridge).
   */
  ridge(x, z) {
    for (let i = 0; i < 80; i++) {
      const g = this.seaward(x, z, 2);
      if (!g || g.slope < 0.2) break;
      x -= g.x * 0.6; z -= g.z * 0.6;
    }
    return { x, z };
  }

  /** Ground height above mean sea level at world x/z: what lrGround gives in the shader at full detail. */
  heightAt(x, z) {
    const u = (x - this.rect.x) / this.rect.w, v = (z - this.rect.z) / this.rect.h;
    if (u < 0 || u > 1 || v < 0 || v > 1) return -64;
    const e = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2, inside = 1 - smoothstep(0.985, 1, e);
    const h = -64 + (this.sample(this.height, u, v) + 64) * inside, s = 300 + (this.sample(this.shore, u, v) - 300) * inside;
    const w = 1 - smoothstep(25, 60, Math.abs(s));
    return h + (shoreProfile(s, h, this.bermMinAt(x, z)) - h) * w;
  }
}
