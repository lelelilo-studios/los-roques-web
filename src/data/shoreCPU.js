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
