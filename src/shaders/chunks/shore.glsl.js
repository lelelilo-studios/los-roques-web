// What the sea does at the beach: small waves that line up with the shore as they come in, and the swash that
// runs up the sand and drains back. Everything is a function of the signed shore distance (positive seaward),
// the height of the waves arriving there and time, so it follows any coastline at any zoom.
export default /* glsl */`
#ifndef LR_SHORE
#define LR_SHORE
// Sand this far above still water can get wet. The terrain hands those fragments to the water pass (as
// reflectance), which lights them itself: dry, wet with a sheen, or under a film of water.
const float LR_WET_BAND = 0.6;

// Period of the waves reaching a beach, and how high (vertically) their swash climbs: both from the height
// 'hs' of the waves arriving (Stockdon et al. 2006 gives about 0.8 hs on a 1:9 foreshore).
float lrSwashPeriod(float hs) { return 3.0 + 3.0 * lrSaturate(hs); }
float lrRunup(float hs) { return min(0.8 * hs + 0.015, 0.5); }

// Where a stretch of beach is in its swash cycle: 0 as a wave arrives at the waterline, 1 just before the next.
// Neighbouring stretches are out of step (noise along the shore), so the edge of the sea is scalloped.
float lrSwashPhase(vec2 wxz, float hs) {
  float lag = 1.3 * lrNoise(wxz / 13.0) + 2.6 * lrNoise(wxz / 41.0);
  return fract(uTime / lrSwashPeriod(hs) - lag);
}
// Swash level over still water, as a share of the run-up: a quick uprush, a slow drain.
float lrSwashCurve(float p) {
  return p < 0.28 ? sin(p / 0.28 * 1.5708) : pow(cos((p - 0.28) / 0.72 * 1.5708), 1.6);
}

// Height of the sea surface above still water near a shore 'shore' metres away.
float lrShoreSurface(vec2 wxz, float shore, float hs) {
  float p = lrSwashPhase(wxz, hs), s = max(shore, 0.0);
  float swash = lrRunup(hs) * lrSwashCurve(p) * (1.0 - smoothstep(1.0, 9.0, shore));
  // Incoming wavelets: crests a travel time 'tau' from the waterline arrive there when the swash starts.
  float tau = 2.2 * sqrt(s) / lrSwashPeriod(hs);
  float crest = pow(0.5 + 0.5 * cos(6.2832 * (p + tau)), 3.0) - 0.3125;
  float amp = 0.45 * hs * smoothstep(0.3, 4.0, s) * (1.0 - smoothstep(14.0, 40.0, s));
  return swash + amp * crest;
}
#endif
`;
