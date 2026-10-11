// A change of position is a movement of parts, each in its turn: not every joint at once along a straight line.
//
// What is here says, for a change that is `k` of the way along (0..1, and back again if she changes her mind), how
// far each part of her has got. The solver (bodyshape.js `mixPoses`) makes the posture: her hips, her trunk, each
// foot and each hand taken from the one posture to the other by its own share, limbs kept to their lengths.
//
// Sitting down on the ground and getting up, from the recorded people who do it (Carnegie Mellon 113/8, "lay down
// and get up"; 140/8, "get up from ground laying on back"; measured with pipeline/motion and the same yardstick as
// her). Sitting down takes them two and a half seconds from standing: a second into a squat, trunk well forward;
// a hand to the ground as the squat reaches its lowest; the seat lowered back and down over the next second, the
// trunk coming upright as it goes; the legs out, one a third of a second before the other; and only then leaning
// back. Getting up is that undone and takes as long (2.2 and 2.7 s): one foot drawn in and then the other, the
// trunk forward, the seat lifted forward over the feet off the hand, the hand leaving the ground as the hips come
// over the feet, then up, the trunk coming upright last.
const ease = k => k * k * (3 - 2 * k), span = (k, a, b) => ease(Math.min(1, Math.max(0, (k - a) / (b - a))));

/**
 * Between a squat over her feet (k = 0) and sitting on the sand a foot's length behind them (k = 1), legs out,
 * leaning back on her left hand: how far along each part of her is.
 * @returns {{ k: number, prop: number, hips: number, trunk: number, feet: number[], hand: number }}
 *   prop: the hand that goes to the sand behind her (her left); hand: the other, from its knee to its thigh
 */
export function seatParts(k) {
  return {
    k,
    prop: span(k, 0, 0.46),                       // the hand goes back to the sand first, and has it before her seat is down
    hips: span(k, 0.1, 0.74),                     // her seat lowered back and down, on that hand
    trunk: span(k, 0.16, 0.96),                   // from well forward over her knees, upright as her seat comes down, back last
    feet: [span(k, 0.44, 0.88), span(k, 0.6, 1)], // her legs out, the left before the right, heels drawn through the sand
    hand: span(k, 0.5, 1),                        // the other hand from its knee back along its thigh as the leg goes out
  };
}
