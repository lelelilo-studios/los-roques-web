// What the sea does at the beach: small waves that line up with the shore as they come in, and the swash, a thin
// sheet of water that runs up the sand and drains back. Everything is a function of the height of the sand above
// still water, the shore distance, the height of the waves arriving there and time, so it follows any coastline.
//
// The terrain and the water pass both call lrBeach() for the same point and so agree, pixel by pixel, on where
// the sheet ends: the terrain shades the sand the sea has left (dry, damp, wet, glossy), the water pass shades
// the sand it still covers.
export default /* glsl */`
#ifndef LR_SHORE
#define LR_SHORE
// Sand up to this far above still water may be covered by the swash (the highest run-up is 0.5 m).
const float LR_WET_BAND = 0.6;
uniform vec2 uLift;
// How far the sea's mesh rides above the sand of the beach face, 'dist' metres from the eye: enough for the
// depth buffer to tell them apart, no more (seen edge-on from eye level a high slab of sea would show).
float lrLift(float dist) { return min(0.002 + uLift.x * dist + uLift.y * dist * dist, 0.25); }
// Seconds between waves on the sand. One value everywhere: a period that varied from place to place would let
// neighbouring stretches of beach drift further out of step the longer the page stays open.
const float LR_SWASH_T = 4.6;

// How high (vertically) the swash of waves of height 'hs' climbs (Stockdon et al. 2006: about 0.8 hs on a 1:9
// foreshore). 'hs' is the sea arriving off the beach; what reaches the sand has broken on the shallow terrace
// in front of it (half a metre of water carries a wave of a hand's breadth or two), hence the cap.
float lrRunup(float hs) { return 0.8 * min(hs, 0.22) + 0.015; }

// Swash level over still water, as a share of the reach: a quick uprush (to p = 0.28), a slow drain.
float lrSwashCurve(float p) {
  return p < 0.28 ? sin(p / 0.28 * 1.5708) : pow(cos((p - 0.28) / 0.72 * 1.5708), 1.6);
}
// The moment in the cycle at which the draining swash falls back through the share q of its reach.
float lrSwashDrain(float q) { return 0.28 + 0.72 * acos(pow(lrSaturate(q), 0.625)) / 1.5708; }

struct LrSwash {
  float e;       // thickness of the sheet over the sand; seaward of the still waterline, how far the sea stands above still level (m)
  float behind;  // how far the swash level stands above this point (m): positive = under water, 0 at the edge of the sheet
  float lip;     // how steeply the sheet thickens behind its edge: large at an advancing front, small while draining
  float age;     // seconds since the water last left this point (0 while covered, 1000 if the last waves never came this far)
  float p;       // place in the cycle: 0 as a wave arrives at the waterline, 0.28 at the top of its run, 1 just before the next
  float reach;   // how high this wave climbs here (m above still water); every wave differs
  float last;    // how high the wave before it climbed
  float top;     // the highest any wave climbs here: the upper edge of the wet sand
  float open;    // 1 on a shore of open water, 0 round a puddle or creek too small to carry waves
};

// The swash at a point of the beach whose sand stands 'a' metres above still water (negative: below it),
// 'shore' metres out from the still waterline (negative: up the beach).
// 'fine' fades it out where it is far too small to see (1 near, 0 from the air).
//
// Each wave is one cycle of a clock. The clock runs early offshore (the wave is there before it reaches the
// waterline) and late across flat sand (the front takes time to cross it, and dies out on the way), so a wave
// is a front that travels in, steepens into a little bore at the waterline and runs on up the face, or sweeps
// some metres over a sand bar that is barely above the sea.
LrSwash lrBeach(vec2 wxz, float shore, float hs, float a, float fine) {
  LrSwash s = LrSwash(0.0, -a, 0.0, 1000.0, 0.0, 0.0, 0.0, 0.0, 1.0);
  if (a > LR_WET_BAND || shore > 60.0) { s.age = a < 0.0 ? 0.0 : 1000.0; return s; }
  s.open = lrOpenWater(wxz, shore);
  // (Flat sand: how much further from the waterline this point is than a beach face would put it.)
  float flat_ = max(-shore - max(a, 0.0) / 0.08, 0.0), R = lrRunup(hs) * fine * mix(0.1, 1.0, s.open), run = R / 0.11 + 0.3;
  R *= 1.0 - smoothstep(1.2 * run, 3.0 * run, flat_);
  // Neighbouring stretches are out of step (noise along the shore), so the edge of the sea is scalloped.
  float c = uTime / LR_SWASH_T - 1.3 * lrNoise(wxz / 13.0) - 2.6 * lrNoise(wxz / 41.0)
          + (2.2 * (sqrt(max(shore, 0.0) + 1.0) - 1.0) - flat_ / 1.5) / LR_SWASH_T;
  float n = floor(c);
  s.p = c - n;
  vec2 q = wxz / 7.0;
  const vec2 hop = vec2(17.31, 5.17);
  s.reach = R * (0.72 + 0.28 * lrNoise(q + n * hop));
  s.last = R * (0.72 + 0.28 * lrNoise(q + (n - 1.0) * hop));
  s.top = (R * (1.0 + 0.05 * lrNoise(wxz / 2.3)) + 0.02 * fine) * step(1e-4, R);      // (the sand above the last wave is still wet from bigger ones)
  float level = s.reach * lrSwashCurve(s.p), h = max(a, 0.0);
  // The sheet: a blunt front a few centimetres high on the way up, a film feathering out to nothing on the way
  // down. Out in the water the same rise is spread out: a low swell that sharpens as it comes into the shallows.
  float up = 1.0 - smoothstep(0.28, 0.9, s.p);
  float thick = (0.012 + 0.25 * s.reach) * (0.4 + 0.6 * up);
  float k = mix(mix(1.5, 0.15, up), 1.5, smoothstep(0.0, 0.1 + thick, -a));
  float over = max(level - h, 0.0), fall = exp(-over / (k * thick));
  s.behind = level - a;
  s.e = thick * (1.0 - fall);
  s.lip = fall / k;
  // When the water last left: on this wave's way down, or the wave before, or the one before that.
  if (over > 0.0 || a <= 0.0) s.age = 0.0;
  else {
    float before = R * (0.72 + 0.28 * lrNoise(q + (n - 2.0) * hop)), left = lrSwashDrain(a / max(s.reach, 1e-5));
    if (a < s.reach && s.p >= left) s.age = (s.p - left) * LR_SWASH_T;
    else if (a < s.last) s.age = (s.p + 1.0 - lrSwashDrain(a / s.last)) * LR_SWASH_T;
    else if (a < before) s.age = (s.p + 2.0 - lrSwashDrain(a / before)) * LR_SWASH_T;
  }
  return s;
}

// Height of the sea surface above still water over a bed standing 'a' above it, 'shore' metres out from the waterline.
float lrShoreSurface(float shore, float a, float hs, LrSwash s) {
  float d = max(shore, 0.0);
  // Incoming wavelets: their crests are the fronts of the swash, further out.
  float crest = pow(0.5 + 0.5 * cos(6.2832 * s.p), 3.0) - 0.3125;
  float amp = 0.45 * min(hs, 0.5) * s.open * smoothstep(0.3, 4.0, d) * (1.0 - smoothstep(14.0, 40.0, d));
  return max(a, 0.0) + s.e * (1.0 - smoothstep(1.0, 9.0, shore)) + amp * crest;
}

// Slope of the water lying on the beach face, given the slope of the sand: level where the sea is, parallel to
// the sand on the face, and standing up from it at an advancing front.
vec2 lrSheetSlope(vec2 sandSlope, float a, LrSwash s) {
  return sandSlope * smoothstep(0.0, 0.02, a) * (1.0 - s.lip * (1.0 - smoothstep(0.22, 0.34, s.p)));
}

// Foam of the swash. Bubbles are made at the front as it runs up, ride with the water (up the beach and back),
// and burst over a couple of seconds; what the sheet leaves behind on the sand lasts a moment longer.
// 'made' is how long ago (s) the front passed the point where the sand stands 'a' above still water.
float lrSwashFoamAge(float a, LrSwash s) {
  float passed = a > 0.0 ? 0.28 * asin(lrSaturate(a / max(s.reach, 1e-4))) / 1.5708 : 0.0;
  return max(s.p - passed, 0.0) * LR_SWASH_T;
}
// How far the water (and the foam on it) has been carried up the beach from where it would lie at still
// water, in metres along the slope's direction: 'level' metres of rise on sand sloping at 'slope'.
float lrSwashCarry(float level, float slope) { return 0.8 * level / clamp(slope, 0.04, 0.3); }

// Wet sand: what leaves a bottom of reflectance 'x' (per unit of light on it) under water of no depth at all,
// as a share of what the same sand gives dry. This is the shallow-water model in lr_optics at H = 0, so sand
// just uncovered and sand under a vanishing film are the same colour.
vec3 lrWetSand(vec3 x) { return 0.52 / (1.0 - 1.7 * min(x / PI, 0.33)); }
// Sand soaked through is darker still (light is trapped between the grains: wet sand gives back about half of
// what dry sand does). This is applied to the sand itself, wet or under the swash, so it too is seamless.
const float LR_SOAKED = 0.72;
#endif
`;
