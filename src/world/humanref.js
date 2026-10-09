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

// How a hand moves, in numbers. What the joints can do is the American Academy of Orthopaedic Surgeons' table of
// normal ranges (Joint Motion: Method of Measuring and Recording), as textbooks of goniometry repeat it; sources
// differ by five or ten degrees, and so do people. The limits the hand here is held to (`mcp`, `pip`, ...) are a
// little inside those: taking up sand, no joint goes to the end of its range.
//
// Degrees. A finger's joints: bent towards the palm positive, from the finger straight out along the palm. The
// wrist: bent towards the palm positive (flexion), back negative (extension); tilted towards the thumb positive.
// The forearm: 0 with the thumb up, turned palm up positive (supination), palm down negative (pronation).
// The hand here is not driven by these numbers: tools/handcheck.mjs measures what it does against them.
export const HAND = {
  can: { mcp: [-45, 90], pip: [0, 100], dip: [-10, 90] },      // the knuckle at the palm, the middle joint, the end joint
  mcp: [-10, 85], pip: [0, 90], dip: [-10, 75],
  dipOverPip: 0.67,                    // the end joint bends with the middle one, about two thirds as far: one tendon works both
  // A hand hanging at ease (the "cascade": each finger a little more curled than the one before, index to little).
  rest: { mcp: [30, 33, 36, 39], pip: [33, 33, 33, 33], dip: [20, 20, 20, 20] },
  speed: 400, thumbSpeed: 300, palmSpeed: 400,                 // the fastest a joint turns in unhurried use, degrees a second (an estimate: a quick grasp closes in a fifth of a second)
};
export const WRIST = {
  can: { flex: [-70, 80], dev: [-30, 20] },
  flex: [-60, 60], dev: [-25, 15],
  holdBack: 45,                        // holding something up to look at, the wrist is bent back no further than this
  speed: 300,                          // the fastest it bends, degrees a second (my estimate; scooping water it is about 270)
};
export const FOREARM = {
  can: [-80, 80],                      // (other tables give up to 90 palm up)
  sup: [-75, 85],
  twistPerFrame: 8,                    // no bone of the forearm turns further about its length in a sixtieth of a second
};
// Reaching for something and taking it (Jeannerod, The timing of natural prehension movements, 1984; Flash and
// Hogan, 1985, on the smooth bell-shaped speed of a reaching hand): the hand speeds up once and slows down once,
// fastest a third to half way through; the fingers are widest open at 60 to 75 % of the time, on the way down.
export const REACH = {
  time: [0.5, 0.9],                    // seconds, from the hand setting off to its touching, at arm's length or less
  lift: [0.9, 1.4],                    // seconds to bring a handful up before you
  peak: [33, 50],                      // % of the time at which the wrist is fastest
  liftPeak: [33, 55],                  // and bringing a handful up: nearer half way (a hand that carries is not hurrying to arrive)
  aperture: [55, 75],                  // % of the time at which the fingers are widest
  speed: [0.6, 1.3],                   // the wrist's top speed, m/s
  accel: 12,                           // and its greatest acceleration, m/s2
};
// A hand held out is never still: it trembles at 8 to 12 times a second (the stretch reflex going round), a
// fraction of a millimetre at the fingertip (the size is an estimate; it grows with effort and tiredness).
export const TREMOR = { hz: [8, 12], tip: 0.0006 };

/**
 * The whole body in a comfortable walk (about 1.4 m/s), peak to peak over a stride, as measured on people. What
 * tools/bodycheck.mjs holds her walk against.
 * - pelvis turning about the upright: 11.7 +- 4.5 degrees (three-dimensional gait analysis of healthy adults,
 *   PMC3040131, table 3: 5.75 forward, 6.0 back);
 * - pelvis dropping on the swinging side ("pelvic list"), the body's centre rising and falling about 5 cm and
 *   moving 4-5 cm from side to side: the determinants of gait (Saunders, Inman and Eberhart 1953, as given in
 *   D. Thompson, Kinematic analyses of gait, University of Oklahoma HSC); the list is about 5 degrees each way
 *   in that account, and gait laboratories report 6-10 degrees peak to peak in young adults;
 * - the arm at the shoulder: 24.6 +- 2.4 degrees; the elbow: 29.7 +- 10.2 degrees (arm swing in gait, Clinics
 *   in Shoulder and Elbow 2023).
 * The chest turns against the pelvis, so that the shoulders swing opposite to the hips: about half the
 * pelvis's turn or more (no single figure found: the range here is the pelvis's, halved to whole).
 */
export const STRIDE = {
  pelvisTurn: [7, 16], pelvisList: [4, 10], rise: [0.03, 0.06], sway: [0.03, 0.06],
  chestTurn: [4, 12], shoulder: [18, 34], elbow: [15, 45],
};
