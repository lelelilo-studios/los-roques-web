// The one ground function. Terrain, water and (through data/geoCPU.js, its JS twin) the CPU all call it, so the
// waterline is the same curve everywhere: the zero of the shore-distance map, not a depth-buffer intersection.
//
// The maps are 11 m/px; a beach is narrower than that. So within ~60 m of the shoreline the map height is
// replaced by a shore profile driven by the signed shore distance (positive seaward), which bicubic sampling
// keeps smooth at any zoom. Keep lrShoreProfile/lrGround in step with geoCPU.js.
export default /* glsl */`
#ifndef LR_GEO
#define LR_GEO
uniform sampler2D tHeight;   // R16F metres above mean sea level
uniform sampler2D tShore;    // R16F signed distance to the shoreline, metres, positive seaward
uniform vec4 uMapTexels;     // xy = height map size in texels, zw = shore map size
uniform float uMpp;          // metres per texel of the height map

// Bicubic B-spline with four bilinear taps (the texture must be linear-filtered, single channel).
float lrBicubic(sampler2D tex, vec2 uv, vec2 size) {
  vec2 st = uv * size - 0.5, f = fract(st), i = st - f, f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0, w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 p0 = (i - 0.5 + w1 / g0) / size, p1 = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * textureLod(tex, vec2(p0.x, p0.y), 0.0).r + g1.x * textureLod(tex, vec2(p1.x, p0.y), 0.0).r)
       + g1.y * (g0.x * textureLod(tex, vec2(p0.x, p1.y), 0.0).r + g1.x * textureLod(tex, vec2(p1.x, p1.y), 0.0).r);
}

// Height of a sand shore at signed distance s from the waterline (s > 0 is seaward), relative to mean sea level.
// Land side: rises at 0.11 m/m and levels off at a berm whose height follows the mapped ground there (up to
// +1 m), so a low sand spit like the Cayo de Agua isthmus stays low enough for a high tide to cover.
// Sea side: a step to -0.5 m a few metres out, then a 1:50 terrace.
float lrShoreProfile(float s, float mapHeight) {
  float berm = clamp(mapHeight * 1.2 + 0.05, 0.08, 1.0);
  float up = berm * (1.0 - exp(min(s, 0.0) * 0.11 / berm));
  float dn = -0.11 * s / (1.0 + 0.22 * max(s, 0.0)) - max(s - 4.0, 0.0) * 0.02;
  return s < 0.0 ? up : dn;
}

// Ground height at world position wxz. 'cell' is the size of the thing asking (grid cell or pixel footprint), so
// coarse geometry reads a matching mip instead of aliasing; 'shore' returns the signed shore distance.
float lrGround(vec2 wxz, float cell, out float shore) {
  vec2 uv = lrMapUV(wxz);
  float lod = log2(max(cell / uMpp, 1.0));
  float h = lod < 1.0 ? lrBicubic(tHeight, uv, uMapTexels.xy) : textureLod(tHeight, uv, lod - 1.0).r;
  shore = lrBicubic(tShore, uv, uMapTexels.zw);
  // Outside the mapped rectangle there is only deep water.
  vec2 e = abs(uv - 0.5) * 2.0;
  float inside = 1.0 - smoothstep(0.985, 1.0, max(e.x, e.y));
  h = mix(-64.0, h, inside);
  shore = mix(300.0, shore, inside);
  float w = 1.0 - smoothstep(25.0, 60.0, abs(shore));
  return mix(h, lrShoreProfile(shore, h), w);
}

// Surface normal of the ground from central differences over 'd' metres.
vec3 lrGroundNormal(vec2 wxz, float cell, float d) {
  float s;
  float hx = lrGround(wxz + vec2(d, 0.0), cell, s) - lrGround(wxz - vec2(d, 0.0), cell, s);
  float hz = lrGround(wxz + vec2(0.0, d), cell, s) - lrGround(wxz - vec2(0.0, d), cell, s);
  return normalize(vec3(-hx, 2.0 * d, -hz));
}
#endif
`;
