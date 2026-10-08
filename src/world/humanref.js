// How people walk, in numbers: the angles of hip, knee and ankle over one cycle of level walking at an easy
// pace, as gait laboratories measure them (the textbook curves: Perry, Gait Analysis; Winter, Biomechanics and
// Motor Control of Human Movement: means of healthy adults, which differ from one study to the next by a few
// degrees). A cycle runs from one heel strike of a foot to its next: 0..100 %. The foot is on the ground for
// the first 60 % or so, and both feet are for about 10 % at each end of that.
//
// Degrees. Hip: thigh forward of the trunk's line positive (flexion). Knee: bend from straight. Ankle: toes
// towards the shin positive (dorsiflexion), from the foot square to the shin.
// The body here is not driven by these curves: its legs reach from the hips to feet the gait places
// (gait.js), and tools/gaitcurves.mjs measures what comes of that against them.
export const CYCLE = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
export const WALK = {
  hip: [30, 27, 18, 8, -2, -10, -4, 13, 28, 33, 30],
  knee: [5, 16, 14, 8, 5, 10, 36, 61, 50, 20, 5],
  ankle: [0, -5, 3, 7, 10, 8, -16, -8, 0, 2, 0],
};
/** What matters most to the eye, and the range healthy walking keeps each within. */
export const MARKS = {
  stance: [58, 64],          // % of the cycle the foot is on the ground
  kneeSwing: [50, 70],       // the knee's greatest bend, in swing (degrees)
  kneeStance: [0, 22],       // and its bend while it alone bears your weight (the first 45 % of the cycle)
  hipRange: [35, 52],        // from furthest back to furthest forward
  ankleRange: [20, 35],
  cadence: [1.6, 2.2],       // steps a second at 1.2..1.5 m/s
  stepOverLeg: [0.7, 0.95],  // step length over leg length
};
/** The curve at p % of the cycle. */
export function refAt(curve, p) {
  const q = ((p % 100) + 100) % 100 / 10, i = Math.floor(q), k = q - i;
  return curve[i] + (curve[Math.min(i + 1, 10)] - curve[i]) * k;
}
