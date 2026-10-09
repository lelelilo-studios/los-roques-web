// The sea surface: the same clipmap as the terrain, displaced by the wave cascades and drawn after the opaque
// pass. It reads what lies under it from a copy of the scene (colour = lit bottom reflectance, alpha = water
// depth), bends the view through the surface, and turns the bottom into the colour of the water column with the
// shallow-water model in lr_optics. On top: the reflected sky, the sun's glitter and foam. On the beach face it
// draws the sheet of swash wherever the terrain marked the sand as covered (and nowhere else).
import * as THREE from 'three';
import { Clipmap, clipmapFragment, clipmapVertex } from '../core/clipmap.js';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { WAVE_UNIFORMS, wavesGLSL } from './waves.js';
import { detailGLSL } from './detail.js';
import { shadowGLSL } from './shadow.js';
import { ripplesGLSL } from '../sim/ripples.js';
import { wakeGLSL } from '../sim/wake.js';

const vertexShader = /* glsl */`
#include <lr_common>
#include <lr_geo>
#include <lr_shore>
${wavesGLSL}
${clipmapVertex}
${wakeGLSL}
out vec3 vRel;       // surface point: x/z relative to the camera, absolute height
out vec2 vGrid;      // the same point before the waves moved it
out vec4 vWeights;   // local height of each wave cascade
out vec4 vWaveMap;
out float vWaveY;    // height the cascades add (the swash is added per pixel)
out float vHs;       // height of the waves arriving here
uniform vec4 uLens;  // the sea at the camera as a plane (see core/framegraph.js)
void main() {
  float cell, shore;
  vec2 rel = lrClipmapRel(cell), wxz = uCamXZ + rel;
  float ground = lrGround(wxz, cell, shore);
  vec4 wm = lrWaveMap(wxz), raw = lrWaveWeightsRaw(wm), w = lrWaveCap(raw, uSeaLevel - ground);
  vec3 d = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    // Reading a mip as coarse as the grid cell drops the waves the mesh cannot carry.
    float lod = log2(max(cell * 256.0 / uWaveTile[i], 1.0));
    d += w[i] * textureLod(tWaveA, vec3(lrWaveUV(rel, i), float(i)), lod).xyz;
  }
  float hs = lrWaveHs(raw), a = ground - uSeaLevel;
  LrSwash sw = lrBeach(rel, shore, hs, a, 1.0);
  float y = uSeaLevel + d.y + lrShoreSurface(shore, min(a, 0.0), hs, sw);
  // Where the camera is at the surface, the sea within two metres of it is the plane the picture judges each
  // pixel by (core/framegraph.js: the waterline across the lens), and its waves are let in from there outward.
  if (uLens.w > 0.5) { float close = 1.0 - smoothstep(0.5, 2.0, length(rel)); y = mix(y, uLens.x + dot(uLens.yz, rel), close); d.xz *= 1.0 - close; }
  // (Your boat's wake stands on the sea: the bow's wave, the hollow astern, the crests trailing back.)
  { float wk = lrWakeIn(rel); if (wk > 0.0) y += lrWake(rel).r * wk * smoothstep(0.05, 0.4, -a); }
  // Over the strip of beach the swash can reach, ride just above the sand: the sheet is drawn on this.
  if (a > -0.3 && a < 1.0) y = max(y, ground + lrLift(length(vec3(rel.x, uCamY - ground, rel.y))) + sw.e);
  vGrid = rel; vWeights = w; vWaveMap = wm; vWaveY = d.y; vHs = hs;
  vRel = vec3(rel.x + d.x, y, rel.y + d.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vRel.x, y - lrCurveDrop(rel), vRel.z, 1.0);
}`;

const fragmentShader = /* glsl */`
#include <lr_common>
#include <lr_geo>
#include <lr_shore>
#include <lr_optics>
#include <lr_atmosphere>
#include <lr_cloud_shadow>
${wavesGLSL}
${clipmapFragment}
${detailGLSL}
${shadowGLSL}
uniform vec4 uRing[6];        // rings you send out wading: x, z (detail coordinates), time, strength
${ripplesGLSL}
${wakeGLSL}
uniform vec4 uLeg[3];         // your shins (and the hand you have in it) where they stand in the water: x, z (detail coordinates), 1 if in water, your speed
uniform sampler2D tRefr;      // copy of the opaque scene: rgb = lit bottom reflectance, a = water depth
uniform sampler2D tWaterType; // 1 = lagoon water, 0 = clear ocean water
uniform mat4 uViewProj;
uniform float uCompareX;
uniform vec4 uDebug;
uniform float uRain;
in vec3 vRel;
in vec2 vGrid;
in vec4 vWeights;
in vec4 vWaveMap;
in float vWaveY;
in float vHs;
uniform mat4 uHullIn;       // the world (from the camera) to your boat's own frame
uniform vec3 uHullHalf;     // half its length, how high over its waterline the sea is kept out, half its beam (x = 0: no boat)
layout(location = 0) out vec4 outColor;

// Foam: a lacy bubble pattern covering the share 'amount' of the surface. From far away (pixel footprint 'px'
// metres) the pattern is finer than a pixel and only its average is left.
float lrFoamPattern(vec2 rel, float amount, float px) {
  vec2 p = lrDetailXZ(rel);
  float cells = lrFbm(p * 2.3 + uTime * 0.07) * 0.65 + lrNoise(p * 9.0 - uTime * 0.11) * 0.35;
  cells = smoothstep(0.3, 0.7, cells);                       // spread the noise out to roughly even odds
  float lace = smoothstep(0.85 - amount, 1.15 - amount, cells);
  return mix(lace, amount, smoothstep(0.02, 0.14, px));
}

// Rain on water: every drop sends out a ring that widens and fades within a second, and throws up a speck of
// spray where it lands. Drops land on a quarter-metre lattice, each cell on its own beat. Returns the slope the
// rings add at p (detail coordinates); 'spray' is the white of the landings.
vec2 lrRainRings(vec2 p, float amount, out float spray) {
  vec2 g = floor(p * 4.0), slope = vec2(0.0);
  spray = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = mod(g + vec2(i, j), 256.0), h = lrHash22(c);
    float beat = uTime / 1.1 + lrHash12(c + 5.0) * 9.0, age = fract(beat);
    if (lrHash12(c + floor(beat) * 0.61 + 2.0) > 0.75 * amount) continue;
    vec2 q = p - (g + vec2(i, j) + 0.15 + 0.7 * lrHash22(c + floor(beat))) * 0.25;
    float r = length(q), x = r - 0.012 - 0.3 * age;
    slope += q / max(r, 1e-3) * (1.0 - age) * (1.0 - age) * exp(-x * x / (2e-4 + 0.0016 * age)) * cos(x * 240.0) * 0.45;
    spray += (1.0 - smoothstep(0.0, 0.09, age)) * (1.0 - smoothstep(0.004, 0.014, r));
  }
  return slope;
}

// The same patches as lrFoamPattern, as a thickness (0..1) that falls away gradually towards their edges.
float lrFoamThickness(vec2 rel, float amount) {
  vec2 p = lrDetailXZ(rel);
  float cells = lrFbm(p * 2.3 + uTime * 0.07) * 0.65 + lrNoise(p * 9.0 - uTime * 0.11) * 0.35;
  return smoothstep(0.6 - amount, 1.5 - amount, smoothstep(0.3, 0.7, cells));
}

void main() {
  vec2 gx = dFdx(vGrid), gy = dFdy(vGrid);
  // Towards the horizon a pixel covers a long thin strip of sea. Past what anisotropic filtering can follow, widen
  // the strip instead, or the glitter sparkles.
  float lx = length(gx), ly = length(gy), thin = max(lx, ly) / (8.0 * max(min(lx, ly), 1e-9));
  if (thin > 1.0) { if (lx < ly) gx *= thin; else gy *= thin; }
  lrClipmapDiscard(vGrid);
  vec2 suv = gl_FragCoord.xy * uInvResolution;
  if (uCompareX >= 0.0 && suv.x < uCompareX) discard;

  vec2 wxz = uCamXZ + vRel.xz;
  float px = (length(gx) + length(gy)) * 0.5;
  // (The underside can only be seen from under it. From the air, a back face is a fold of the mesh where it
  // climbs a far beach, poking over the crest of the sand.)
  if (!gl_FrontFacing && uCamY > vRel.y + 0.3) discard;
  if (!gl_FrontFacing) {
    // Seen from below (the alpha of -3000 tells the composite this pixel is looked at through water). Inside a
    // cone 97 degrees wide ("Snell's window") the whole sky is squeezed in, bent by the waves; outside it the
    // surface is a mirror for what lies below: the bed, seen through the water on the way down to it.
    // (The same surface as from above: the cascades, the ripples finer than them in their gusts, the rain's rings.)
    vec2 sl = vec2(0.0), roughness = vec2(0.0);
    float gust = lrGust(vRel.xz), nearby = 1.0 - smoothstep(0.03, 0.15, px), spray = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 b = textureGrad(tWaveB, vec3(lrWaveUV(vGrid, i), float(i)), gx / uWaveTile[i], gy / uWaveTile[i]);
      float w = vWeights[i] * (i == 3 ? gust : 1.0);
      sl += w * b.xy; roughness += w * w * max(b.zw - b.xy * b.xy, 0.0);
    }
    if (nearby > 0.0) {
      vec2 uv = lrWaveUV(vGrid, 3), t = vec2(uWaveTile[3]), gain = vWeights.w * gust * LR_FINE_GAIN * nearby;
      sl += gain.x * lrFineTurn1(textureGrad(tWaveB, vec3(LR_FINE_1 * uv, 3.0), LR_FINE_1 * gx / t, LR_FINE_1 * gy / t).xy)
          + gain.y * lrFineTurn2(textureGrad(tWaveB, vec3(LR_FINE_2 * uv, 3.0), LR_FINE_2 * gx / t, LR_FINE_2 * gy / t).xy);
      if (uRain > 0.01) sl += lrRainRings(vGrid + uCamMod.xy, uRain, spray) * nearby;
    }
    vec3 nd = -normalize(vec3(-sl.x, 1.0, -sl.y)), up = normalize(vec3(vRel.x, vRel.y - uCamY, vRel.z));
    vec3 outDir = refract(up, nd, 1.34);
    float shoreU, deep = max(uSeaLevel - lrGround(wxz, px, shoreU), 0.05), lagoon = texture(tWaterType, lrMapUV(wxz)).r;
    vec3 ab = mix(uAbsOcean, uAbsLagoon, lagoon), bb = mix(uBbOcean, uBbLagoon, lagoon), kd = ab + bb;
    vec3 daylight = (uSunE * lrSaturate(uSunDir.y) * lrCloudShadow(wxz) + uSkyE) * 0.9;
    vec3 mirrored = reflect(up, nd), through = exp(-(ab + 4.0 * bb) * deep / max(-mirrored.y, 0.08));
    vec3 glowBelow = daylight * exp(-kd * deep * 0.5) * bb / kd * 0.5 * (1.0 - through);
    vec3 below = vec3(0.42, 0.40, 0.34) / PI * daylight * exp(-kd * deep) * through + glowBelow;
    {
      // What the mirror really shows: the bed where the mirrored look comes down on it, with whatever stands
      // there (the coral, a fish, yourself), as the picture already has it; seen through the water on the way
      // down. (It was a flat colour of sand everywhere. Where that place is off the picture, it still is.)
      vec3 hit = vRel + mirrored * (deep / max(-mirrored.y, 0.08));
      vec4 clip = uViewProj * vec4(hit.x, hit.y - lrCurveDrop(hit.xz), hit.z, 1.0);
      vec2 at = clip.xy / max(clip.w, 1e-4) * 0.5 + 0.5, edge = min(at, 1.0 - at);
      float seenThere = clip.w > 0.1 ? smoothstep(0.0, 0.08, min(edge.x, edge.y)) : 0.0;
      if (seenThere > 0.0) {
        vec4 there = textureLod(tRefr, at, 0.0);
        // (A thing under water is held as what it gives back of the light and how deep it lies: lit here as the bed is.)
        if (there.a > 0.0) below = mix(below, there.rgb / PI * daylight * exp(-kd * there.a) * through + glowBelow, seenThere);
      }
    }
    vec3 c = below;
    if (dot(outDir, outDir) > 0.0) {
      float f = lrFresnel(dot(outDir, -nd));
      // The sun through the window: its disc, broken up by every ripple into darting flakes of light (the
      // roughness inside a pixel spreads it), with a glow round it from the water's own scattering.
      float spread = 0.00004 + 0.3 * max(roughness.x, roughness.y), miss = 1.0 - lrSaturate(dot(outDir, uSunDir));
      vec3 sun = uSunE * (0.00004 / spread * 5000.0 * exp(-miss / spread) + 6.0 * exp(-miss / 0.004)) * lrCloudShadow(wxz) * step(0.0, uSunDir.y);
      c = mix(lrEnv(normalize(vec3(outDir.x, abs(outDir.y) + 0.02, outDir.z)), 1e-3) + min(sun, vec3(4000.0)), below, f);
    }
    c += spray * nearby * daylight / PI * 0.3;
    outColor = vec4(c, -3000.0);
    return;
  }
  float shore, near = lrGroundNear(px);
  vec3 sandN;
  float ground = lrGroundAt(vRel.xz, px, false, shore, sandN), ridgeSlope = lrShoreSlope;
  float aboveStill = ground - uSeaLevel;
  // (How steep the bed is here against a typical beach face: on flats a little water goes a long way.)
  float steep = clamp(fwidth(ground) * 0.7 / max(px, 1e-4), 0.01, 0.3) / 0.11;
  vec4 bed0 = texelFetch(tRefr, ivec2(gl_FragCoord.xy), 0);
  // Something that must show through the sea surface: a tree's canopy seen from afar; and the inside of your
  // boat (world/penero.js writes -1800 there), where the sea is not, but only within the boat's own box: a wave
  // between you and the boat is still drawn over what is behind it.
  if (bed0.a < -1500.0) {
    if (bed0.a < -1900.0) discard;
    vec3 inBoat = (uHullIn * vec4(vRel, 1.0)).xyz;
    if (uHullHalf.x > 0.0 && abs(inBoat.x) < uHullHalf.x && abs(inBoat.z) < uHullHalf.z && inBoat.y > -0.6 && inBoat.y < uHullHalf.y) discard;
  }
  bool hasBed0 = bed0.a > -LR_WET_BAND;
  // Near the waterline the terrain is the judge of what is under water: where it drew dry or wet sand (or
  // anything else stands), there is no sea to draw, whatever this mesh makes of it.
  // (From afar this mesh's own idea of the ground is a blurred one: the further, the more the terrain rules.)
  if (!hasBed0 && aboveStill > -0.25 - 0.15 * px) discard;
  // (From far away the swash and its foam are much thinner than a pixel: they fade out.)
  float fine = 1.0 - smoothstep(0.5, 4.0, px);
  LrSwash sw = lrBeach(vRel.xz, shore, vHs, aboveStill, fine);
  // Water standing over this point right now: still level + waves + swash, minus the ground.
  float surface = vWaveY + lrShoreSurface(shore, aboveStill, vHs, sw), column = surface - aboveStill;
  float lift = lrLift(length(vec3(vGrid.x, uCamY - ground, vGrid.y)));
  bool film = column < 1.5 * lift + 0.003;
  vec2 spot = vGrid;                                        // the point of the sea this pixel shows, relative to the camera
  if (film) {
    // Thin water or none: here the mesh rides above the sand rather than at the true surface. The terrain
    // decided whether this pixel is under water; where it is, work at the terrain's own point (down the view
    // ray, at the height its alpha gives), so both passes evaluate the swash at the same place.
    if (!hasBed0) discard;                                  // (thin water over something that is not the bed)
    aboveStill = -bed0.a;
    float dy = vRel.y - uCamY;
    spot = vRel.xz * (abs(dy) > 1e-3 ? clamp((uSeaLevel + aboveStill - uCamY) / dy, 1.0, 1.6) : 1.0);
    lrGroundAt(spot, px, aboveStill > 0.0, shore, sandN);
    sw = lrBeach(spot, shore, vHs, aboveStill, fine);
    surface = vWaveY + lrShoreSurface(shore, aboveStill, vHs, sw);
    column = max(surface - aboveStill, 1e-4);
  }
  vec2 bedSlope = -sandN.xz / sandN.y;

  vec3 V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  vec3 downwelling = uSunE * lrSaturate(uSunDir.y) + uSkyE;

  // ---- The water surface. Mean slope of the waves inside this pixel, and how much they vary within it.
  vec2 slope = vec2(0.0), var = vec2(0.0);
  float fold = 0.0;
  vec4 weights = vec4(vWeights.xyz, vWeights.w * lrGust(vRel.xz));                  // (the ripples come in gusts)
  // Your boat's wake: where the hull and its wash have just been the small waves are calmed (a slick).
  float inWake = lrWakeIn(vGrid);
  vec4 wake = inWake > 0.0 ? lrWake(vGrid) * inWake : vec4(0.0);
  weights.zw *= 1.0 - vec2(0.55, 0.85) * wake.b;
  for (int i = 0; i < 4; i++) {
    float t = uWaveTile[i];
    vec3 uvw = vec3(lrWaveUV(vGrid, i), float(i));
    vec4 b = textureGrad(tWaveB, uvw, gx / t, gy / t);
    slope += weights[i] * b.xy;
    var += weights[i] * weights[i] * max(b.zw - b.xy * b.xy, 0.0);
    if (i < 2) fold += weights[i] * textureGrad(tWaveA, uvw, gx / t, gy / t).w;
  }
  if (inWake > 0.0) slope += lrWakeSlope(vGrid) * inWake * smoothstep(0.05, 0.4, column);
  // Ripples too small for the cascades. Close up they are drawn (the last cascade read twice more, smaller);
  // from further off only the roughness they add is left, where there is wind on the water at all.
  float close = 1.0 - smoothstep(0.03, 0.15, px);
  if (close > 0.0) {
    // (Water a finger deep running over sand is wrinkled by it, whatever the wind; a film thinner still is a mirror.)
    float least = 0.0012 * smoothstep(0.0, 0.012, column) * (1.0 - smoothstep(0.08, 0.3, column));
    vec2 uv = lrWaveUV(vGrid, 3), t = vec2(uWaveTile[3]), gain = max(weights.w, least) * LR_FINE_GAIN * close;
    vec4 b1 = textureGrad(tWaveB, vec3(LR_FINE_1 * uv, 3.0), LR_FINE_1 * gx / t, LR_FINE_1 * gy / t);
    vec4 b2 = textureGrad(tWaveB, vec3(LR_FINE_2 * uv, 3.0), LR_FINE_2 * gx / t, LR_FINE_2 * gy / t);
    slope += gain.x * lrFineTurn1(b1.xy) + gain.y * lrFineTurn2(b2.xy);
    var += gain.x * gain.x * max(0.5 * (b1.z + b1.w) - 0.5 * dot(b1.xy, b1.xy), 0.0) + gain.y * gain.y * max(0.5 * (b2.z + b2.w) - 0.5 * dot(b2.xy, b2.xy), 0.0);
  }
  var += 2e-4 + 0.5 * (0.0006 + 0.0003 * uWind.z) * lrSaturate(weights.w * 200.0) * (1.0 - close) + 0.012 * uRain;      // raindrops pock the surface
  var += 0.004 * smoothstep(0.0, 0.015, column) * (1.0 - smoothstep(0.06, 0.3, column)) * (1.0 - close);
  // (Right under the eye even the finest ripples drawn are magnified smooth: the wrinkles finer still keep the
  // surface from being a perfect mirror there.)
  var += 0.0012 * close * lrSaturate(weights.w * 200.0);
  // On the beach face the sheet lies on the sand, and an advancing front stands up from it.
  if (aboveStill > 0.0) slope += lrSheetSlope(bedSlope, aboveStill, sw);
  float spray = 0.0, churned = 0.0;
  if (close > 0.0 && uRain > 0.01 && column > 0.004) slope += lrRainRings(spot + uCamMod.xy, uRain, spray) * close;
  if (close > 0.0 && uRipple.w > 0.5) {
    // The ripples you make, as the water has them (sim/ripples.js).
    vec2 dr = spot + uCamMod.xy;
    float rip = lrRippleIn(dr);
    if (rip > 0.0) slope += lrRippleSlope(dr) * rip * close;
    // (And the water your legs have just pushed through is white with bubbles for a moment.)
    // (And right against a leg it climbs the skin and breaks: a thin ruff of bubbles at the waterline, always.)
    if (rip > 0.0) churned = max(lrRippleChurn(dr), 0.8 * smoothstep(0.05, 0.5, lrRippleRuff(dr))) * rip * close;
  } else if (close > 0.0) {
    // (Without that simulation: rings drawn by rule.) Rings spreading from where you wade: a short train of ripples that widens and fades.
    for (int i = 0; i < 6; i++) {
      float age = uTime - uRing[i].z;
      if (age < 0.0 || age > 5.0) continue;
      vec2 q = mod(spot + uCamMod.xy - uRing[i].xy + 32.0, 64.0) - 32.0;
      float r = length(q), x = r - 0.06 - 0.3 * age;
      slope += q / max(r, 1e-3) * uRing[i].w * close * 0.22 / (1.0 + 2.5 * age) * exp(-x * x / (0.004 + 0.012 * age)) * cos(55.0 * x);
    }
    // The water parts round your legs: a ruff of small ripples at each shin, hugging it when you stand still,
    // livelier and wider when you push through or the swash runs past you.
    for (int i = 0; i < 3; i++) {
      if (uLeg[i].z < 0.5) continue;
      vec2 q = mod(spot + uCamMod.xy - uLeg[i].xy + 32.0, 64.0) - 32.0;
      float r = length(q), lively = 0.35 + 0.65 * lrSaturate(uLeg[i].w / 0.6 + (aboveStill > 0.0 ? 1.0 - smoothstep(0.2, 0.8, sw.p) : 0.0));
      if (r < 0.7) slope += q / max(r, 1e-3) * close * 0.5 * lively * exp(-r / (0.07 + 0.08 * lively)) * cos(r * 85.0 - uTime * 8.0) * smoothstep(0.035, 0.06, r);
    }
  }
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  float cosV = max(dot(n, V), 0.0), sigma = sqrt(max(var.x, var.y));
  float fresnel = lrMeanFresnel(cosV, sigma);

  // Look through the surface: bend the view ray and find what it lands on in the scene copy.
  // From afar the depth is the one seen straight through. Close up that is the wrong one (a grazing ray meets
  // the bed far beyond the point under the surface), but there the bed under this point is known, depth and
  // slope, and the bent ray's landing point follows from them.
  float depth0 = hasBed0 ? max(bed0.a + surface, column) : column;
  vec3 T = refract(-V, n, 1.0 / 1.34);
  vec4 bed = bed0;
  if (!film) {
    vec3 hit = vRel + T * mix(min(depth0, 25.0) / max(-T.y, 0.35), column / max(dot(T.xz, bedSlope) - T.y, 0.25), near);
    vec4 clip = uViewProj * vec4(hit.x, hit.y - lrCurveDrop(hit.xz), hit.z, 1.0);
    // (From a swimmer's eye most bent rays land below the bottom of the picture, where there is nothing to read:
    // the edge row smeared up the screen in streaks. Towards the edges, ease back to looking straight through.)
    vec2 ruv = clip.xy / clip.w * 0.5 + 0.5, room = min(ruv, 1.0 - ruv);
    bed = texture(tRefr, mix(suv, ruv, smoothstep(0.0, 0.06, min(room.x, room.y))));
    // The bent ray left the water (or the screen), or landed on something far shallower than what lies straight
    // below (a hull, a swimmer's arm, a fish near the surface: smeared over the sea if taken for the bed): look
    // straight through instead.
    if (clip.w <= 0.0 || bed.a <= -LR_WET_BAND || (hasBed0 && bed.a < 0.45 * bed0.a - 0.05)) bed = bed0;
  }
  bool hasBed = bed.a > -LR_WET_BAND;
  // bed.a is the depth below STILL water of what we see; add how far the surface here stands above still water.
  float H = hasBed ? max(bed.a + surface, 1e-4) : max(column, 1e-4);
  vec3 rho = hasBed ? bed.rgb : vec3(0.3);

  float muV = max(-T.y, 0.35), muS = lrCosInWater(lrSaturate(uSunDir.y));
  float lagoon = texture(tWaterType, lrMapUV(wxz)).r;
  vec3 a = mix(uAbsOcean, uAbsLagoon, lagoon), bb = mix(uBbOcean, uBbLagoon, lagoon);
  // Light on the water here (a cloud may shade it). The bottom reflectance was scaled by the light the bed gets
  // relative to open ground, so rescale it to this light.
  float shade = lrSunThrough(lrCloudShadow(wxz), vRel, vec3(0.0, 1.0, 0.0));        // (a cloud, a hull or a pier may shade it)
  vec3 lit = uSunE * lrSaturate(uSunDir.y) * shade + uSkyE;
  vec3 leaving = lrWaterRrs(rho * downwelling / max(lit, vec3(1e-4)), lrOpticalDepth(H), muS, muV, a, bb) * lit * (1.0 - fresnel) / 0.979;

  if (uDebug.x > 4.5) {
    // More debug views: 5 = which path (red: the terrain's point, green: this mesh's own) and the column in blue,
    // 6 = wave weights, 7 = mean slope and roughness, 8 = surface height / bed depth / wave height, 9 = swash sheet / phase / shore distance.
    vec3 col;
    if (uDebug.x < 5.5) col = vec3(film ? 1.0 : 0.0, film ? 0.0 : 1.0, column * 5.0) * 2.0;
    else if (uDebug.x < 6.5) col = weights.yzw * 60.0;
    else if (uDebug.x > 7.5 && uDebug.x < 8.5) col = vec3(surface * 5.0 + 0.5, -aboveStill * 2.0, vWaveY * 5.0 + 0.5);
    else if (uDebug.x > 8.5) col = vec3(sw.e * 20.0, sw.p, shore / 10.0);
    else col = vec3(slope * 4.0 + 0.5, sigma * 4.0) * 2.0;
    outColor = vec4(col, -1000.0); return;
  }
  if (uDebug.x > 3.5) { outColor = vec4(leaving / (1.0 - fresnel) * 0.979, -1000.0); return; }   // 4: only the light leaving the water (for comparing with the satellite)
  vec3 R = reflect(-V, n);
  R.y = abs(R.y) + 0.01;
  vec3 reflected = lrEnv(normalize(R), max(var.x, var.y)) * fresnel;
  vec3 glitter = uSunE * min(lrSunGlitter(V, n, uSunDir, var), 400.0) * step(0.0, uSunDir.y) * shade;
  vec3 col = leaving + reflected + glitter;

  // ---- Foam.
  // Whitecaps: where the long waves pile the surface together (their horizontal motion converges at breaking crests).
  float foam = smoothstep(0.55, 0.85, -fold) * lrSaturate(uWind.z / 7.0 - 0.5);

  // Swash: a raft of bubbles made at the front as it runs up, thinning as they burst; out in the water only
  // where it is shallow enough for the little bore to break.
  float nearShore = fine * (1.0 - smoothstep(2.0, 12.0, shore)) * smoothstep(0.02, 0.12, vHs) * sw.open * (1.0 - smoothstep(0.0, 0.3, -aboveStill));
  float front = 0.92 * (1.0 - smoothstep(0.24, 0.36, sw.p)) * exp(-max(sw.behind, 0.0) / (0.007 * steep));
  float swash = nearShore * max(front, 0.8 * exp(-lrSwashFoamAge(aboveStill, sw) / 1.6) * smoothstep(0.0, 0.05, sw.p));
  // Where the sheets from the two sides of a sandbar run into each other (along its middle, where the shore
  // distance levels off) they pile up into a line of foam that zips along the bar as each pair of waves meets.
  // (A line a step wide: the map's shore distance is rounded off over the top of a bar, and its slope is small
  // for metres either side of the middle.)
  float meeting = (1.0 - smoothstep(0.02, 0.12, ridgeSlope)) * step(0.0, aboveStill) * near * fine * smoothstep(0.0, 0.004, column);
  swash = max(swash, 0.6 * meeting * (1.0 - smoothstep(0.1, 0.45, sw.p)));
  // Surf on the reef crests: white water where the swell breaks, torn into streaks that drift downwind and
  // pulse as each wave arrives.
  float dBreak = vWaveMap.b * vWaveMap.b * 250.0, lee = 1.0 - smoothstep(0.35, 0.8, vWaveMap.r);
  float surf = vWaveMap.a * exp(-dBreak / mix(20.0, 55.0, lee)) * smoothstep(0.3, 0.8, vHs + 0.5 * vWaveMap.a)
             * (1.0 - smoothstep(1.5, 4.0, uSeaLevel - ground));              // waves break where it is shallow
  if (surf > 0.01) {
    vec2 along = uWind.xy, across = vec2(-uWind.y, uWind.x);
    vec2 sp = vec2(dot(wxz, along) / 26.0 - uTime * 0.11, dot(wxz, across) / 7.0);     // long downwind, narrow across
    float streaks = 0.6 * lrNoise(sp) + 0.4 * lrNoise(sp * 2.7 + 5.0);
    float pulse = 0.75 + 0.25 * sin(6.2832 * (uTime / 6.5 + lrNoise(wxz / 45.0) * 3.0));
    foam = max(foam, surf * pulse * smoothstep(0.25, 0.7, streaks + 0.45 * surf));
  }
  if (foam > 0.003) {
    float cover = lrFoamPattern(spot, lrSaturate(foam), px), tone = 1.0;
    if (px < 0.6) {
      // From the beach the patches of surf are rafts of bubbles: thick and white at their hearts, thinning
      // outwards into a net of bubble walls with the water showing through, then single strands; a few metres
      // off the net blurs into soft-edged veils. (The pattern above is made for the view from the air: from
      // eye level it was flat white floes with hard edges.)
      // (Even the heart of a patch is a raft with holes in it: solid white is only where a wave is breaking this moment.)
      float near = 1.0 - smoothstep(0.2, 0.6, px), heart = lrFoamThickness(spot, lrSaturate(foam)), thick = 0.72 * heart;
      vec2 f = lrFoam(spot + uCamMod.xy, thick, px, gx, gy);
      cover = mix(cover, f.x * (0.45 + 0.55 * heart), near); tone = mix(1.0, f.y * (0.85 + 0.15 * heart), near);
    }
    col = mix(col, 0.82 * tone * lit / PI, cover);
  }
  col += spray * close * lit / PI * 0.5;
  if (wake.a > 0.01) {
    // The wash of your boat's propeller and the water its hull throws aside: milky where it is fresh, breaking
    // into streaks and then lace as it thins, the last of it single flecks. (Drawn as the surf's rafts are, it
    // was white floes with hard edges.)
    vec2 at = spot + uCamMod.xy;
    float keep = 1.0 - smoothstep(0.03, 0.3, px);
    float lace = 0.45 * lrNoise(at * 2.3 + 11.0) + 0.3 * lrNoise(at * 7.1 + vec2(0.0, uTime * 0.05)) + 0.25 * mix(0.5, lrNoise(at * 33.0 + vec2(uTime * 0.25, 0.0)), keep);
    float cover = lrSaturate((wake.a * 1.15 - lace * (1.25 - 0.55 * wake.a)) * 2.5);
    col = mix(col, (0.62 + 0.26 * lrSaturate(wake.a * 1.5)) * lit / PI, cover);
  }
  if (churned > 0.01) {
    // What your legs and hands have churned, and the ruff at your skin: small bubbles, a centimetre across and
    // less, in a pattern of their own (the surf's rafts are metres wide: drawn with those, a ring two
    // centimetres wide round a shin was nothing at all).
    vec2 at = spot + uCamMod.xy;
    float bubbles = 0.6 * lrNoise(at * 90.0 + vec2(uTime * 0.4, 0.0)) + 0.4 * lrNoise(at * 260.0 + 7.0);
    col = mix(col, 0.8 * lit / PI, lrSaturate(churned * (0.3 + 1.2 * bubbles)));
  }
  if (swash > 0.003) {
    // (The bubbles ride with the water: the pattern is read where the water came from.)
    float tilt = length(bedSlope);
    vec2 uphill = tilt > 1e-4 ? bedSlope / tilt : vec2(0.0);
    vec2 f = lrFoam(spot + uCamMod.xy - uphill * lrSwashCarry(sw.behind + aboveStill, tilt), swash, px, gx, gy);
    // (Not quite white: the raft has bubbles and thin places in it, and at 0.85 they were all lost in the glare.
    // From where you stand it is froth: thicker and thinner in patches a hand across, and grained with its bubbles.)
    float froth = 1.0;
    if (px < 0.02) { vec2 fp = spot + uCamMod.xy - uphill * lrSwashCarry(sw.behind + aboveStill, tilt); froth += (1.0 - smoothstep(0.006, 0.02, px)) * (0.26 * (lrNoiseTile(fp * 28.0, 1792.0) - 0.5) + 0.14 * (lrNoiseTile(fp * 190.0, 12160.0) - 0.5)); }
    col = mix(col, 0.74 * f.y * froth * lit / PI, f.x);
  }
  if (uDebug.x > 0.5) {
    // Debug views: 1 = what the bed lookup found (red: bent ray, green: straight through, blue: nothing),
    // 2 = depth used / 100 m, 3 = bottom reflectance used.
    if (uDebug.x < 1.5) col = vec3(hasBed && bed.a != bed0.a ? 1.0 : 0.0, hasBed ? 0.5 : 0.0, hasBed ? 0.0 : 1.0) * 3.0;
    else if (uDebug.x < 2.5) col = vec3(H / 100.0) * 3.0;
    else col = rho * 3.0;
  }
  outColor = vec4(col, -1000.0);
}`;

export class Water {
  constructor(tier) {
    this.clipmap = new Clipmap({ quads: tier.block, yRange: [-4, 4] });
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: tier.fp.shadowTaps || 4 },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...CHUNK_UNIFORMS.shore, ...CHUNK_UNIFORMS.detail, ...CHUNK_UNIFORMS.rings, ...CHUNK_UNIFORMS.ripple, ...CHUNK_UNIFORMS.shadow, ...CHUNK_UNIFORMS.optics, ...CHUNK_UNIFORMS.atmosphere, ...WAVE_UNIFORMS, ...CHUNK_UNIFORMS.cloudShadow, ...CHUNK_UNIFORMS.wake, 'uLens',
        'uFocusRel', 'uCompareX', 'uViewProj', 'tWaterType', 'uDebug', 'uRain'], { tRefr: { value: null }, uHullIn: { value: new THREE.Matrix4() }, uHullHalf: { value: new THREE.Vector3(0, 0, 0) } }),
    });
    this.mesh = new THREE.Mesh(this.clipmap.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }
  update(view) { this.clipmap.update(view.cam, view.focus, view.range, view.frustum, null, view.drop); }
}
