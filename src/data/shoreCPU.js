// The sea at the shore, on the CPU: the clock of the swash and the height of the little waves coming in, the
// same numbers as lr_shore (shaders/chunks/shore.glsl.js) computes per pixel. The walker floats on this surface
// and the sound of each wave is timed by it. Keep in step with lrShoreLag, lrBeach and lrShoreSurface.

export const SWASH_T = 4.6;                                   // LR_SWASH_T: seconds between waves on the sand

const fract = v => v - Math.floor(v), clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * How far behind (in cycles) a stretch of shore runs: neighbouring stretches are out of step, so the edge of
 * the sea is scalloped. Sums of sines, not a hash: a hash comes out differently in the GPU's 32-bit arithmetic
 * and here, and these must agree to the hundredth of a cycle.
 */
export function shoreLag(x, z) {
  const ax = x / 13, az = z / 13, bx = x / 41, bz = z / 41;
  return 1.3 * (0.5 + 0.25 * (Math.sin(ax * 1.7 + 1.3 * Math.sin(az * 1.1)) + Math.sin(az * 2.3 + 1.7 * Math.sin(ax * 0.9 + 2.0))))
       + 2.6 * (0.5 + 0.25 * (Math.sin(bx * 1.9 + 1.1 * Math.sin(bz * 1.3 + 4.0)) + Math.sin(bz * 2.1 + 1.5 * Math.sin(bx * 1.2 + 1.0))));
}

/**
 * Where a point is in the cycle at time t (0 as a wave arrives): `shore` metres out from the still waterline
 * (the wave is there earlier offshore). Sand above the waterline is not handled here (shore <= 0 reads as 0).
 */
export const swashPhase = (x, z, t, shore = 0) => fract(t / SWASH_T - shoreLag(x, z) + 2.2 * (Math.sqrt(Math.max(shore, 0) + 1) - 1) / SWASH_T);

// The lattice noise of the shaders, on the CPU. Its hash is worked out step by step in 32-bit arithmetic, as the
// graphics card does it (lrHash12): in doubles it comes out quite different, because the last step takes the
// fraction of a number of twenty thousand that single precision knows only to a few thousandths. (Cards that
// fuse a multiply and an add round a last bit differently: the two then differ by a few thousandths, which
// for where a patch of wet sand ends is nothing.)
const f32 = Math.fround, frac32 = v => f32(v - Math.floor(v)), K = f32(0.1031), C = f32(33.33);
export function hash12(px, py) {
  let x = frac32(f32(f32(px) * K)), y = frac32(f32(f32(py) * K)), z = x;
  const d = f32(f32(f32(x * f32(y + C)) + f32(y * f32(z + C))) + f32(z * f32(x + C)));
  x = f32(x + d); y = f32(y + d); z = f32(z + d);
  return frac32(f32(f32(x + y) * z));
}
/** lrNoiseTile: lattice noise repeating every `period` cells. */
export function noiseTile(px, py, period) {
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = v => ((v % period) + period) % period, x0 = m(ix), x1 = m(ix + 1), y0 = m(iy), y1 = m(iy + 1);
  const a = hash12(x0, y0), b = hash12(x1, y0), c = hash12(x0, y1), d = hash12(x1, y1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}
/**
 * lrRagged: how ragged the reach of a sheet of water over a flat is at a place (world x, z): -0.5..0.5, tongues a
 * few steps wide. With it the CPU knows the same patches of a low bar to be wet as the picture shows.
 */
export function ragged(x, z) {
  const px = ((x % 1024) + 1024) % 1024, pz = ((z % 1024) + 1024) % 1024, wx = px * (2 * Math.PI / 1024), wz = pz * (2 * Math.PI / 1024);
  const ax = px * (330 / 1024) + 0.6 * Math.sin(wz * 263 + 1.3 * Math.sin(wx * 97)), az = pz * (330 / 1024) + 0.6 * Math.sin(wx * 229 + 1.7 * Math.sin(wz * 113));
  const bx = px * (788 / 1024) + 0.4 * Math.sin(wx * 401) + 7, bz = pz * (788 / 1024) + 0.4 * Math.sin(wz * 367) + 7;
  return 0.62 * noiseTile(ax, az, 330) + 0.38 * noiseTile(bx, bz, 788) - 0.5;
}

/** How high the swash of waves of height hs runs (lrRunup). */
export const runup = hs => 0.8 * Math.min(hs, 0.22) + 0.015;

/**
 * Height the incoming wavelets add to the sea surface `shore` metres out from the waterline, for waves of
 * height hs arriving (the last term of lrShoreSurface): up to a hand's breadth, four to fourteen metres out.
 */
export function shoreCrest(x, z, shore, hs, t) {
  if (shore <= 0.3 || shore >= 40) return 0;
  const crest = (0.5 + 0.5 * Math.cos(2 * Math.PI * swashPhase(x, z, t, shore))) ** 3 - 0.3125;
  return 0.45 * Math.min(hs, 0.5) * smooth(0.3, 4, shore) * (1 - smooth(14, 40, shore)) * crest;
}
