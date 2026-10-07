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
uniform vec4 uCamTexel;      // the camera's place in the height map: xy = whole texels, zw = the fraction (split in doubles on the CPU)
uniform vec4 uCamTexelShore; // the same in the shore map (which may be finer than the height map)
uniform vec4 uSandbar;       // the sandbar of Cayo de Agua: the two ends of its crest (world xz, xz)
uniform vec2 uSandbarP;      // how far to either side it reaches (m; 0 = none), and the height of its crest (m)

// The lowest a beach's berm can be: 0.22 m, so that no beach is under still water at the highest tide
// (+0.17 m); except along the sandbar of Cayo de Agua, which is lower than any beach and goes under at an
// autumn high water. Set by lrGround / lrGroundFine for the point in hand before the profile is taken.
float lrBermMin = 0.22;
float lrBermMinAt(vec2 wxz) {
  if (uSandbarP.x <= 0.0) return 0.22;
  vec2 ab = uSandbar.zw - uSandbar.xy, ap = wxz - uSandbar.xy;
  float along = clamp(dot(ap, ab) / dot(ab, ab), 0.06, 0.94);            // (its roots at either end are the cays' own beaches)
  return mix(uSandbarP.y, 0.22, smoothstep(0.5 * uSandbarP.x, uSandbarP.x, length(ap - ab * along)));
}

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
// Land side: rises at 0.11 m/m and levels off at a berm whose height follows the mapped ground there, between
// 0.22 and 1 m (lower along the sandbar of Cayo de Agua: see lrBermMin).
// Sea side: a step to -0.5 m a few metres out, then a 1:50 terrace.
float lrShoreProfile(float s, float mapHeight) {
  float berm = clamp(mapHeight * 1.2 + 0.05, 0.22, 1.0);
  berm = min(berm, mix(1.0, lrBermMin, step(lrBermMin, 0.2199)));       // (on the sandbar: its own crest height)
  float up = berm * (1.0 - exp(min(s, 0.0) * 0.11 / berm));
  float dn = -0.11 * s / (1.0 + 0.22 * max(s, 0.0)) - max(s - 4.0, 0.0) * 0.02;
  return s < 0.0 ? up : dn;
}

// The map height with the shore profile blended in near the waterline.
float lrGroundBlend(float h, float shore) {
  return mix(h, lrShoreProfile(shore, h), 1.0 - smoothstep(25.0, 60.0, abs(shore)));
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
  lrBermMin = lrBermMinAt(wxz);
  return lrGroundBlend(h, shore);
}

// Surface normal of the ground from central differences over 'd' metres.
vec3 lrGroundNormal(vec2 wxz, float cell, float d) {
  float s;
  float hx = lrGround(wxz + vec2(d, 0.0), cell, s) - lrGround(wxz - vec2(d, 0.0), cell, s);
  float hz = lrGround(wxz + vec2(0.0, d), cell, s) - lrGround(wxz - vec2(0.0, d), cell, s);
  return normalize(vec3(-hx, 2.0 * d, -hz));
}

// Whether the water at the nearest waterline is open (1) or a puddle or creek a few metres across (0): the
// shore distance is probed 8 m out from that waterline. Waves come from the sea, not from pools on a sand bar.
float lrOpenWater(vec2 wxz, float shore) {
  if (shore > 8.0) return 1.0;
  vec2 uv = lrMapUV(wxz), d = 4.0 * uMapRect.zw;
  vec2 g = vec2(textureLod(tShore, uv + vec2(d.x, 0.0), 0.0).r - textureLod(tShore, uv - vec2(d.x, 0.0), 0.0).r,
                textureLod(tShore, uv + vec2(0.0, d.y), 0.0).r - textureLod(tShore, uv - vec2(0.0, d.y), 0.0).r);
  vec2 probe = wxz + g / max(length(g), 1e-3) * (8.0 - shore);
  return smoothstep(1.0, 5.0, textureLod(tShore, lrMapUV(probe), 0.0).r);
}

// The ground seen from close by. lrBicubic leans on the GPU's bilinear filter, whose weights have 8 bits: at
// 11 m per texel that is a 4 cm staircase in the waterline, plain to see from eye height; and 'uCamXZ + rel'
// rounds to 2 mm twenty kilometres from the origin. So here the sixteen texels round the point are read one
// by one and weighted exactly, starting from the camera's texel position (split on the CPU) plus 'rel'.
// Returns the value and its slope per metre east and south. 'cam' is the camera in this texture's texels
// (xy whole, zw fraction), 'mpp' its metres per texel.
vec3 lrSplineFine(sampler2D tex, vec4 cam, vec2 rel, vec2 size, float mpp) {
  vec2 st = cam.zw + rel / mpp - 0.5, fl = floor(st), f = st - fl, f2 = f * f, f3 = f2 * f;
  ivec2 i = ivec2(cam.xy) + ivec2(fl) - 1, top = ivec2(size) - 1;
  vec4 wx = vec4(1.0 - 3.0 * f.x + 3.0 * f2.x - f3.x, 4.0 - 6.0 * f2.x + 3.0 * f3.x, 1.0 + 3.0 * f.x + 3.0 * f2.x - 3.0 * f3.x, f3.x) / 6.0;
  vec4 wy = vec4(1.0 - 3.0 * f.y + 3.0 * f2.y - f3.y, 4.0 - 6.0 * f2.y + 3.0 * f3.y, 1.0 + 3.0 * f.y + 3.0 * f2.y - 3.0 * f3.y, f3.y) / 6.0;
  vec4 dx = vec4(-(1.0 - f.x) * (1.0 - f.x), 3.0 * f2.x - 4.0 * f.x, 1.0 + 2.0 * f.x - 3.0 * f2.x, f2.x) * 0.5;
  vec4 dy = vec4(-(1.0 - f.y) * (1.0 - f.y), 3.0 * f2.y - 4.0 * f.y, 1.0 + 2.0 * f.y - 3.0 * f2.y, f2.y) * 0.5;
  vec3 v = vec3(0.0);
  for (int r = 0; r < 4; r++) {
    vec2 row = vec2(0.0);
    for (int c = 0; c < 4; c++) row += vec2(wx[c], dx[c]) * texelFetch(tex, clamp(i + ivec2(c, r), ivec2(0), top), 0).r;
    v += vec3(wy[r] * row, dy[r] * row.x);
  }
  return vec3(v.x, v.yz / mpp);
}
// Ground height, shore distance and normal from exact samples. The slope comes with them: the height and the
// shore distance are taken as planes round the point and the shore profile is differenced over them.
float lrGroundFine(vec2 rel, out float shore, out vec3 normal) {
  vec3 h = lrSplineFine(tHeight, uCamTexel, rel, uMapTexels.xy, uMpp);
  vec3 s = lrSplineFine(tShore, uCamTexelShore, rel, uMapTexels.zw, uMpp * uMapTexels.x / uMapTexels.z);
  vec2 e = abs(lrMapUV(uCamXZ + rel) - 0.5) * 2.0;
  float inside = 1.0 - smoothstep(0.985, 1.0, max(e.x, e.y));
  h = vec3(mix(-64.0, h.x, inside), h.yz * inside); s = vec3(mix(300.0, s.x, inside), s.yz * inside);
  shore = s.x;
  lrBermMin = lrBermMinAt(uCamXZ + rel);
  const float d = 0.25;
  float gx = lrGroundBlend(h.x + h.y * d, s.x + s.y * d) - lrGroundBlend(h.x - h.y * d, s.x - s.y * d);
  float gz = lrGroundBlend(h.x + h.z * d, s.x + s.z * d) - lrGroundBlend(h.x - h.z * d, s.x - s.z * d);
  normal = normalize(vec3(-gx, 2.0 * d, -gz));
  return lrGroundBlend(h.x, s.x);
}

// How much of the close-up ground a pixel with a footprint of 'px' metres gets (1 near, 0 from afar).
// (Out to some 40 m from a standing eye: on sand as flat as a bar the waterline and the wet line wander by
// metres for a centimetre of height, and the cheap lookup's steps showed as a sawtooth.)
float lrGroundNear(float px) { return 1.0 - smoothstep(0.5, 1.0, px); }

// Ground height, shore distance and normal for a pixel: the exact version close up, the cheap one from afar,
// blended in between. With farNormal false the normal from afar is simply 'up' (four ground lookups saved).
float lrGroundAt(vec2 rel, float px, bool farNormal, out float shore, out vec3 normal) {
  float near = lrGroundNear(px), g = 0.0;
  shore = 0.0; normal = vec3(0.0);
  if (near > 0.0) { g = lrGroundFine(rel, shore, normal) * near; shore *= near; normal *= near; }
  if (near < 1.0) {
    float s;
    vec2 wxz = uCamXZ + rel;
    g += lrGround(wxz, px, s) * (1.0 - near); shore += s * (1.0 - near);
    normal += (farNormal ? lrGroundNormal(wxz, px, max(px, 1.5)) : vec3(0.0, 1.0, 0.0)) * (1.0 - near);
  }
  normal = normalize(normal);
  return g;
}
#endif
`;
