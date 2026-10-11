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
/**
 * The same, for a woman at an ordinary walk, where women have been measured (WOMAN below, at v / sqrt(g L) =
 * 0.5: the mean, two spreads either way): what tools/bodycheck.mjs holds her to since her walk was shaped on
 * recorded people. Her pelvis lists and turns more than the textbooks' mixed figures above, her arms swing
 * further; her body's centre rises and falls 2.8 cm on a hard floor (less on dry sand, which gives under each
 * foot), not the 5 cm of the old account.
 */
export const STRIDE_HERS = {
  pelvisTurn: [4, 23], pelvisList: [6, 20], rise: [0.016, 0.045], sway: [0.015, 0.06],
  chestTurn: [8, 33], shoulder: [14, 52], elbow: [15, 60],
};

/**
 * A woman walking and running, measured: 24 women (leg 0.85 m), each at three walking and three running
 * speeds set for the length of her legs (v / sqrt(g L): 0.48 is 1.4 m/s for them, an ordinary walk; 1.12 is
 * 3.2 m/s, an easy run). Bruening, Baird, Weaver and Rasmussen, "Whole body kinematic sex differences persist
 * across non-dimensional gait speeds", PLoS ONE 15(8): e0237449 (2020), table A3 of its appendix: means, with
 * the spread between women in the comments. Peak to peak over a stride, degrees; `rise` and `sway` (the body's
 * centre, up and down and from side to side), `step` (one pace) and `cadence` (paces in the time sqrt(L / g))
 * as shares of leg length.
 *
 * The women's pelvis lists two thirds as far again as the men's in the same study (12.6 against 7.6 degrees at
 * a walk) and turns a little more; they swing their arms more; their chests keep as still as the men's.
 * What her walk is made the size of (bodymotion.js), the shape of each movement being a recorded person's.
 */
export const WOMAN = {
  pace: [0.32, 0.48, 0.64, 0.88, 1.12, 1.36],
  pelvisList: [9.3, 12.6, 14.8, 14.0, 15.7, 17.2],        // the pelvis's list in the world (+- 3.1 to 3.8)
  pelvisTurn: [10.0, 13.1, 17.8, 12.2, 14.7, 16.7],       // and its turn about the upright (+- 3.8 to 6.7)
  chestRoll: [3.5, 3.6, 4.1, 4.7, 5.6, 6.1],              // the chest's list in the world (+- 1.2 to 2.1)
  chestYaw: [12.0, 11.5, 12.2, 37.5, 43.1, 49.0],         // and its turn (+- 3.9 to 10.1)
  chestList: [11.3, 15.1, 18.1, 17.6, 19.9, 21.5],        // the chest against the pelvis: side to side (+- 4.4 to 4.9)
  chestTurn: [15.8, 20.5, 26.7, 34.7, 40.8, 48.2],        // and about the upright (+- 5.0 to 12.9)
  arm: [25.6, 36.2, 39.4, 44.0, 51.6, 61.2],              // the upper arm at the shoulder, mean of left (the larger, by an eighth) and right (+- 9 to 16: people differ most here)
  elbow: [23.0, 38.4, 43.9, 16.0, 19.6, 23.8],            // (+- 6 to 14)
  ankle: [25.0, 29.1, 32.8, 48.4, 49.7, 50.2],            // (+- 4.7 to 6.8)
  rise: [0.027, 0.036, 0.045, 0.106, 0.105, 0.098],       // (+- 0.006 walking, 0.014 running)
  sway: [0.047, 0.034, 0.028, 0.023, 0.020, 0.019],       // (+- 0.012 to 0.004)
  step: [0.68, 0.85, 0.99, 1.11, 1.34, 1.52],             // (+- 0.03 to 0.10)
  cadence: [0.474, 0.566, 0.649, 0.790, 0.838, 0.897],    // (+- 0.022 to 0.059)
};
/** One of WOMAN's rows at a pace (v / sqrt(g L)), between the measured paces and held at the ends. `run`: read along the running paces (true) or the walking ones. */
export function womanAt(row, pace, run = false) {
  const p = WOMAN.pace, v = WOMAN[row], a = run ? 3 : 0, b = run ? 5 : 2, q = Math.min(p[b], Math.max(p[a], pace));
  for (let i = a; i < b; i++) if (q <= p[i + 1]) return v[i] + (v[i + 1] - v[i]) * (q - p[i]) / (p[i + 1] - p[i]);
  return v[b];
}

/**
 * How far a knee is bent through its stance, walking (radians; `share`: 0 as the foot lands .. 1 as it leaves): all
 * but straight as the heel touches, giving fifteen degrees as it takes her weight and staying so while she
 * passes over the foot, straight again late (three quarters of the way through, the other foot about to land),
 * and bending fast as the heel comes up behind her, well on its way into the swing as the toes leave. The
 * recorded walkers' own (tools/ref/motion.json: both knees of 42 strides of three people, by twelfths of their
 * stance), set five degrees off straight at its least: a marker skeleton does not say where straight is, and a
 * leg's length hardly changes over the last few degrees, where a knee held looks locked. (It was the textbook's
 * curve, which straightens by the middle of stance: against the recorded one her knee was straight a tenth of a
 * stride early, five spreads out of the band.)
 * Through the first three quarters, while it bears her, it gives three quarters of what theirs gave (ten degrees
 * as she takes her weight: they are men in shoes, and a bare foot gives less at the knee), which leaves her hips
 * riding up and down nearer what the middle of a woman's body is measured to (WOMAN.rise below). The bend for
 * the swing, in the last quarter, is theirs whole.
 */
export const KNEE_STANCE = [[0, 6.5], [0.083, 10.2], [0.167, 15.0], [0.25, 16.2], [0.333, 15.3], [0.417, 14.6], [0.5, 14.7], [0.583, 12.7], [0.667, 8.2], [0.75, 5.5], [0.833, 7.5], [0.917, 17.9], [1, 37.3]];
export function kneeStance(share) {
  const P = KNEE_STANCE, u = Math.min(1, Math.max(0, share)); let i = 0; while (i + 2 < P.length && u > P[i + 1][0]) i++;
  const p0 = P[Math.max(0, i - 1)][1], p1 = P[i][1], p2 = P[i + 1][1], p3 = P[Math.min(P.length - 1, i + 2)][1], t = (u - P[i][0]) / (P[i + 1][0] - P[i][0]);
  return (p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))) * Math.PI / 180;
}
