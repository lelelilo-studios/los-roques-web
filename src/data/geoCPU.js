// The ground function on the CPU: the JS twin of shaders/chunks/geo.glsl.js (keep the two in step).
// Used for camera clearance, placing things on the ground, and labels.

const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Height of a sand shore at signed distance s from the waterline (s > 0 seaward). Same as lrShoreProfile. */
export function shoreProfile(s, mapHeight) {
  if (s >= 0) return -0.11 * s / (1 + 0.22 * s) - Math.max(s - 4, 0) * 0.02;
  const berm = Math.min(1, Math.max(0.08, mapHeight * 1.2 + 0.05));
  return berm * (1 - Math.exp(s * 0.11 / berm));
}

export class Ground {
  /**
   * @param {{raw: Uint16Array, width: number, height: number, scale: number, offset: number}} height
   * @param {{raw: Uint16Array, width: number, height: number, scale: number, offset: number}} shore
   * @param {{x: number, z: number, w: number, h: number}} rect  world rectangle of the maps
   */
  constructor(height, shore, rect) { Object.assign(this, { height, shore, rect }); }

  /** Bilinear sample of a raster at map coordinates u, v in 0..1. */
  sample(map, u, v) {
    const x = Math.min(map.width - 1.001, Math.max(0, u * map.width - 0.5)), y = Math.min(map.height - 1.001, Math.max(0, v * map.height - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * map.width + x0, r = map.raw;
    const top = r[i] + (r[i + 1] - r[i]) * fx, bottom = r[i + map.width] + (r[i + map.width + 1] - r[i + map.width]) * fx;
    return (top + (bottom - top) * fy) * map.scale + map.offset;
  }

  /** Signed distance to the shoreline at world x/z (positive seaward, clamped to +-300 m). */
  shoreAt(x, z) {
    const u = (x - this.rect.x) / this.rect.w, v = (z - this.rect.z) / this.rect.h;
    return u < 0 || u > 1 || v < 0 || v > 1 ? 300 : this.sample(this.shore, u, v);
  }

  /** Ground height above mean sea level at world x/z (bilinear where the shader is bicubic: within centimetres). */
  heightAt(x, z) {
    const u = (x - this.rect.x) / this.rect.w, v = (z - this.rect.z) / this.rect.h;
    if (u < 0 || u > 1 || v < 0 || v > 1) return -64;
    const e = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2, inside = 1 - smoothstep(0.985, 1, e);
    const h = -64 + (this.sample(this.height, u, v) + 64) * inside, s = 300 + (this.sample(this.shore, u, v) - 300) * inside;
    const w = 1 - smoothstep(25, 60, Math.abs(s));
    return h + (shoreProfile(s, h) - h) * w;
  }
}
