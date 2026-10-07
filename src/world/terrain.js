// Land and seabed: one clipmap mesh shaded from the data maps.
//
// Output convention for everything opaque (the water pass relies on it):
//   under water right now (the sea, or the sheet of swash on the beach face):
//     rgb = lit reflectance (the water pass turns it into what you see through the water),
//     alpha = sea level - ground (negative on the beach face, never below -LR_WET_BAND);
//   otherwise: rgb = radiance, alpha = -1000 (or -2000 for tree canopy the sea must not draw over).
// The terrain alone decides which of the two a pixel of the beach is (lrBeach in lr_shore), and shades the sand
// the sea has left: dry, damp, wet, or wet and still glossy.
import * as THREE from 'three';
import { Clipmap, clipmapFragment, clipmapVertex } from '../core/clipmap.js';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { WAVE_UNIFORMS, wavesGLSL } from './waves.js';
import { detailGLSL } from './detail.js';
import { shadowGLSL } from './shadow.js';

// Lumpy tops of tree crowns: 1 = average height. Used for the canopy's shape (vertices) and its shading (pixels).
const crownsGLSL = /* glsl */`
float lrCrowns(vec2 wxz) { return 0.72 + 0.36 * lrNoise(wxz / 4.3) + 0.2 * lrNoise(wxz / 1.7); }
`;

const vertexShader = /* glsl */`
#include <lr_common>
#include <lr_geo>
${wavesGLSL}
${clipmapVertex}
${crownsGLSL}
uniform sampler2D tLand;   // r mangrove, g scrub, b built-up, a canopy height / 25.5 m
uniform float uTreesNear;  // 1 when mangroves are drawn as trees near the eye
out vec3 vRel;      // position relative to the camera in x/z, absolute height in y (before the curvature drop)
out float vViewZ;
out vec4 vWeights;  // local wave heights (for the caustics)
out float vHs;      // height of the waves arriving here (for the swash)
out float vCanopy;  // height of the tree canopy drawn above the ground here, metres
void main() {
  float cell, shore;
  vec2 rel = lrClipmapRel(cell), wxz = uCamXZ + rel;
  float h = lrGround(wxz, cell, shore);
  vec4 raw = lrWaveWeightsRaw(lrWaveMap(wxz));
  vWeights = lrWaveCap(raw, uSeaLevel - h);
  vHs = lrWaveHs(raw);
  // Mangrove stands are drawn as a shell over the ground: the data says where and how tall, noise makes the
  // edge ragged and the top lumpy like tree crowns. (The ground function itself stays the ground: mangroves stand in water.)
  vec4 land = textureLod(tLand, lrMapUV(wxz), log2(max(cell / uMpp, 1.0)));
  float stand = smoothstep(0.34, 0.62, land.r + (lrNoise(wxz / 11.0) - 0.5) * 0.5 * step(cell, 16.0));
  // (Cells too coarse to carry the crowns get the average height; the shading still shows them.)
  // From far away the trees are too small to matter as geometry (and coarse cells would smear the shell over
  // sand and water): there the canopy is only shaded, per pixel.
  vCanopy = stand * max(land.a * 25.5, 3.0) * mix(lrCrowns(wxz), 1.0, smoothstep(1.0, 3.0, cell)) * (1.0 - smoothstep(4.0, 10.0, cell));
  // (Near the eye the mangroves are trees of their own, world/plants.js: the shell sinks away under them.)
  vCanopy *= mix(1.0, smoothstep(24.0, 40.0, length(vec3(rel.x, uCamY - h, rel.y))), uTreesNear);
  h += vCanopy;
  vRel = vec3(rel.x, h, rel.y);
  vec4 view = viewMatrix * vec4(rel.x, h - lrCurveDrop(rel), rel.y, 1.0);
  vViewZ = -view.z;
  gl_Position = projectionMatrix * view;
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
uniform float uRain;
uniform float uWet;           // how wet the rain has left things (it lags the rain: quick to wet, slow to dry)
uniform vec4 uFoot[24];       // your footprints: x, z (detail coordinates, wrapped to 64 m), heading, time made
uniform int uFootCount;
uniform sampler2D tAlbedo;
uniform sampler2D tSatellite;
uniform sampler2D tBenthic;   // r seagrass, g coral/algae, b rubble, a confidence
uniform sampler2D tLand;      // r mangrove, g scrub, b built-up, a canopy height / 25.5 m
uniform float uTreesNear;
uniform float uCompareX;
${crownsGLSL}
in vec3 vRel;
in float vViewZ;
in vec4 vWeights;
in float vHs;
in float vCanopy;
layout(location = 0) out vec4 outColor;

// Sunlight focused and spread by the waves above a bed point 'water' metres down: the wavy surface acts as a
// sheet of weak lenses, and the brightness is one over the area a bundle of rays is squeezed into. Each ray is
// traced back to where it entered; the sun's width blurs the pattern with depth (a coarser mip). Chop draws
// the broad bands in waist-deep water, ripples the fine bright net in water to the ankle. A band of waves bent
// past its focus would turn the estimate inside out: each band is held back as it gets there.
float lrCaustics(vec2 rel, float water, float px) {
  vec3 s = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.34);
  float path = water / max(-s.y, 0.3);
  vec2 entry = rel - s.xz * path;
  float blur = path * 0.0093 + px, kd = 0.254 * path;
  vec3 h = vec3(0.0);
  for (int i = 1; i < 4; i++) {
    float w = vWeights[i] * (i == 3 ? lrGust(uCamXZ + entry) : 1.0), bend = kd * w * uWaveCurve[i];
    h += w / (1.0 + bend * bend) * textureLod(tWaveC, vec3(lrWaveUV(entry, i), float(i)), log2(max(blur * 256.0 / uWaveTile[i], 1.0))).xyz;
  }
  if (px < 0.05) {
    // (The finer ripples: the last cascade through its two similarity transforms. Curvature grows with the
    // shrinking: h(Sx)/s has s times the curvature, turned.)
    float w = vWeights.w * lrGust(uCamXZ + entry) * (1.0 - smoothstep(0.02, 0.05, px)), lod = log2(max(blur * 256.0 / uWaveTile[3], 1.0));
    vec2 uv = lrWaveUV(entry, 3);
    vec3 c1 = textureLod(tWaveC, vec3(LR_FINE_1 * uv, 3.0), lod + 1.16).xyz, c2 = textureLod(tWaveC, vec3(LR_FINE_2 * uv, 3.0), lod + 2.32).xyz;
    float b1 = kd * w * LR_FINE_GAIN.x * 2.236 * uWaveCurve[3], b2 = kd * w * LR_FINE_GAIN.y * 5.0 * uWaveCurve[3];
    // Hessians turned back: R^T H R with R = S / s.
    h += w * LR_FINE_GAIN.x * 2.236 / (1.0 + b1 * b1) * vec3(0.8 * c1.x + 0.2 * c1.y - 0.8 * c1.z, 0.2 * c1.x + 0.8 * c1.y + 0.8 * c1.z, 0.4 * (c1.x - c1.y) + 0.6 * c1.z);
    h += w * LR_FINE_GAIN.y * 5.0 / (1.0 + b2 * b2) * vec3(0.36 * c2.x + 0.64 * c2.y - 0.96 * c2.z, 0.64 * c2.x + 0.36 * c2.y + 0.96 * c2.z, 0.48 * (c2.x - c2.y) - 0.28 * c2.z);
  }
  float det = (1.0 + kd * h.x) * (1.0 + kd * h.y) - kd * kd * h.z * h.z;
  // (A smooth peak where the rays cross, 4.5 times the open light at most; a hard cap gave the bright lines
  // flat tops with sharp edges.)
  // (Scaled so that flat water, det = 1, lets through exactly the open light: the far view keeps its brightness.)
  return 1.0247 * inversesqrt(det * det + 0.05);
}

// How far your footprints press the sand in at d (metres, negative = down). 'soft' is 1 on dry sand (deep,
// slumped edges, a rim pushed up round it) and 0 on wet (shallow and crisp); prints made before 'since', when
// the sea last covered this point, have been washed out.
float lrFootprints(vec2 d, float soft, float since) {
  float h = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= uFootCount) break;
    vec4 f = uFoot[i];
    vec2 q = mod(d - f.xy + 32.0, 64.0) - 32.0;
    if (f.w < since || dot(q, q) > 0.05) continue;
    vec2 fwd = vec2(sin(f.z), -cos(f.z)), l = vec2(dot(q, fwd), dot(q, vec2(-fwd.y, fwd.x)));     // along the foot, across it
    // A sole 26 cm long, 10 cm wide at the ball and 7 at the heel (dry sand slumps: the hollow is wider),
    // pressed deepest under the heel and the ball: a bowl in dry sand, a flat floor with a crisp edge in wet.
    float along = l.x / (0.13 + 0.02 * soft), r = length(vec2(along, l.y / (mix(0.036, 0.052, smoothstep(-0.1, 0.06, l.x)) * (1.0 + 0.3 * soft))));
    h += -mix(0.007, 0.024, soft) * pow(max(1.0 - r * r, 0.0), mix(0.6, 1.4, soft)) * (0.75 + 0.4 * smoothstep(0.25, 0.85, abs(along)))
       + soft * 0.004 * smoothstep(0.8, 1.05, r) * (1.0 - smoothstep(1.05, 1.5, r));
  }
  return h;
}

// Sparkle of single grains in the sun: a lattice of facets fixed to the sand, each tilted its own way, flashing
// when it mirrors the sun into the eye. The cells are about a pixel and a half across, and two lattice sizes
// cross-fade as the footprint of a pixel changes, so sparkles neither pop nor shimmer.
float lrGlints(vec2 d, float px, vec3 N, vec3 H) {
  float level = log2(max(px * 1.5, 2e-4)), l0 = floor(level), g = 0.0;
  for (int k = 0; k < 2; k++) {
    float size = exp2(l0 + float(k));
    vec2 cell = mod(floor(d / size), 64.0 / size), h = lrHash22(cell + 0.37 * float(k));
    vec3 facet = normalize(N + vec3(h.x - 0.5, 0.0, h.y - 0.5) * 1.4);
    g += (k == 0 ? 1.0 - (level - l0) : level - l0) * step(0.5, lrHash12(cell + 11.0)) * smoothstep(0.99813, 0.99966, dot(facet, H));
  }
  return g;
}

float lrDepthFromViewZ(float z) {
  float n = uNearFar.x, f = uNearFar.y;
#ifdef USE_REVERSED_DEPTH_BUFFER
  return n * (f - z) / ((f - n) * z);
#else
  return ((f + n) - 2.0 * n * f / z) / (f - n) * 0.5 + 0.5;
#endif
}

void main() {
  lrClipmapDiscard(vRel.xz);
  vec2 wxz = uCamXZ + vRel.xz;
  vec2 uv = lrMapUV(wxz);
  float px = length(fwidth(vRel.xz)) * 0.7071;          // ground footprint of a pixel, metres
  float shore;
  vec3 nG;
  float ground = lrGroundAt(vRel.xz, px, true, shore, nG);
  float water = uSeaLevel - ground;

  // Coarse far geometry can stand above the sea where the ground function says water. Push such pixels just
  // under the surface so the water pass still covers them. (Not the beach face seen from close by: its
  // geometry is good, and things lying on the sand must be hidden where they dip into it.)
  float fz = gl_FragCoord.z;
  float under = uSeaLevel - 0.05 - 0.2 * vHs;             // (below the troughs of the waves at the shore)
  if (water > -LR_WET_BAND && vRel.y > under && uCamY > uSeaLevel + 0.05 && px > 0.08) {
    fz = lrDepthFromViewZ(vViewZ * (uCamY - under) / max(uCamY - vRel.y, 1e-3));
  }
  gl_FragDepth = fz;

  if (uCompareX >= 0.0 && gl_FragCoord.x * uInvResolution.x < uCompareX) {
    outColor = vec4(texture(tSatellite, uv).rgb * (uSunE * uSunDir.y + uSkyE) / PI, -1000.0);   // drawn as a lit flat picture
    return;
  }

  vec3 albedo = texture(tAlbedo, uv).rgb;
  vec4 land = texture(tLand, uv);
  // In the village a pixel of the satellite picture is roofs, their shade and the street all mixed: dark grey.
  // Near the eye, where the houses are drawn one by one, the streets get their own colour: pale trodden sand.
  albedo = mix(albedo, vec3(0.47, 0.43, 0.36) * (0.92 + 0.16 * lrNoise(wxz / 3.1)), smoothstep(0.3, 0.6, land.b) * (1.0 - smoothstep(1.5, 8.0, px)) * step(water, 0.0));
  float stand = smoothstep(0.34, 0.62, land.r + (lrNoise(wxz / 11.0) - 0.5) * 0.5 * (1.0 - smoothstep(4.0, 16.0, px)));
  // (Where the trees themselves are drawn, the ground under them shows instead: dark mud and leaf litter.)
  float trees = uTreesNear * (1.0 - smoothstep(24.0, 40.0, length(vec3(vRel.x, uCamY - ground, vRel.z))));
  float sift = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (stand > 0.5 && sift < trees) albedo = mix(vec3(0.07, 0.055, 0.04), vec3(0.11, 0.09, 0.05), lrNoise(wxz * 1.7));
  else if (vCanopy > 0.3 || stand > 0.5) {
    // Tree canopy: dark leaves, shaded by the bumps of the crowns (from the same noise that shapes them) and
    // darker down between them.
    float c0 = lrCrowns(wxz), e = 0.6, tall = max(vCanopy, land.a * 25.5);
    vec3 gn = normalize(vec3((c0 - lrCrowns(wxz + vec2(e, 0.0))) * tall, e, (c0 - lrCrowns(wxz + vec2(0.0, e))) * tall));
    gn = normalize(mix(gn, vec3(0.0, 1.0, 0.0), smoothstep(1.0, 8.0, px)));     // from far away the bumps average out
    float gaps = mix(smoothstep(0.55, 1.05, c0), 0.7, smoothstep(1.0, 8.0, px));
    // (Where the shell's edge hangs over sand or water the map colour is not a leaf colour.)
    vec3 leaf = mix(stand > 0.5 ? albedo : vec3(0.02, 0.045, 0.015), vec3(0.014, 0.034, 0.011), 0.5) * (0.5 + 0.65 * gaps);
    vec3 sunLit = uSunE * (0.2 + 0.8 * lrSaturate(dot(gn, uSunDir))) * lrCloudShadow(wxz);
    // Alpha below -1500: the sea surface must not be drawn over this (mangroves stand in the water, and from
    // afar their canopy is drawn at ground level).
    outColor = vec4(leaf * (sunLit + uSkyE * (0.35 + 0.65 * gn.y) * gaps) / PI, -2000.0);
    return;
  }
  // Variation finer than the 11 m data: seagrass in clumps, coral heads, grain in the sand.
  vec4 benthic = texture(tBenthic, uv);
  vec2 dxz = lrDetailXZFar(vRel.xz);
  float nearby = 1.0 - smoothstep(1.5, 9.0, px);
  albedo *= mix(1.0, 0.72 + 0.56 * lrNoise(dxz * 0.45), benthic.r * nearby);
  albedo *= mix(1.0, 0.6 + 0.8 * lrNoise(dxz * 0.9) * lrNoise(dxz * 0.23 + 3.1) * 2.0, benthic.g * nearby);
  // (Faint tonal patches in the sand, a few metres across.)
  vec2 d = lrDetailXZ(vRel.xz), ddx = dFdx(vRel.xz), ddy = dFdy(vRel.xz);
  albedo *= 1.0 + (lrDetailTap(d, mat2(8.0, 0.0, 0.0, 8.0) / 64.0, 2.0, ddx, ddy).a - uDetailMean[2].a) * 0.14 * (1.0 - smoothstep(0.05, 0.6, px));
  vec3 n = nG;

  // The beach face: where the swash is right now, and how wet it has left the sand.
  bool covered = water > 0.0 && vCanopy < 0.02, beach = water > -LR_WET_BAND && water <= 0.0 && vCanopy < 0.02;
  LrSwash sw = LrSwash(0.0, 0.0, 0.0, 1000.0, 0.0, 0.0, 0.0, 0.0, 1.0);
  float wetness = 0.0, wetLine = 0.0, fine = 1.0 - smoothstep(0.5, 4.0, px);
  if (beach) {
    sw = lrBeach(wxz, shore, vHs, -water, fine);
    covered = sw.behind > 0.0;
    // Wet up to the highest line the waves reach (a sharp edge), with a damp halo above it.
    float edge = max(0.0015, fwidth(water));
    wetLine = 1.0 - smoothstep(sw.top - edge, sw.top + edge, -water);
    wetness = max(wetLine, 0.35 * (1.0 - smoothstep(0.0, 0.4 * sw.top + 0.01, -water - sw.top)) * lrSaturate(sw.top * 40.0));
  }
  // 'wetness' is the sea's doing (it also smooths the sand); rain wets everything it falls on, as it lies.
  float wetAll = covered ? 0.0 : max(wetness, uWet);
  // Soaked sand: the wet beach face, rained-on ground, the sand under the swash, and on down under the first hand's breadth of sea.
  albedo *= mix(1.0, LR_SOAKED, covered ? fine * smoothstep(-0.25, 0.0, -water) : max(fine * wetness, uWet));

  // Rock (Gran Roque's hills): the 30 m elevation data is smooth, the real slopes are broken metamorphic rock.
  // Add ruggedness as shading, strongest on steep high ground.
  float rocky = smoothstep(0.12, 0.35, 1.0 - n.y) * smoothstep(2.0, 8.0, ground) * (1.0 - smoothstep(20.0, 120.0, px));
  if (rocky > 0.01) {
    vec2 r = (wxz + ground * vec2(1.25, 0.85)) / 9.0;                    // height in the mix, so cliffs are not streaked
    float f0 = lrFbm(r) + 0.5 * lrFbm(r * 3.7 + 11.0), e = 0.35;
    vec2 g = vec2(lrFbm(r + vec2(e, 0.0)) + 0.5 * lrFbm((r + vec2(e, 0.0)) * 3.7 + 11.0), lrFbm(r + vec2(0.0, e)) + 0.5 * lrFbm((r + vec2(0.0, e)) * 3.7 + 11.0)) - f0;
    n = normalize(n - vec3(g.x, 0.0, g.y) * 2.2 * rocky);
    albedo *= 1.0 + (f0 - 0.75) * 0.5 * rocky;                         // darker crevices, paler faces
  }
  // Sand ripples, seen only from close by: wave ripples half a metre apart under shallow water, finer wind
  // ripples on the dry beach, both lying across the wind.
  bool wetBed = water > 0.03;
  // (Sand detail fades out up the hillsides: no line across them where it stops.)
  float sand = (1.0 - lrSaturate(benthic.r + benthic.g + land.r + land.g)) * (1.0 - rocky) * (1.0 - smoothstep(2.5, 7.0, ground - uSeaLevel));
  float sandy = sand * (1.0 - smoothstep(wetBed ? 0.03 : 0.004, wetBed ? 0.2 : 0.03, px));
  float dryLand = covered ? 0.0 : 1.0 - wetness;          // dry sand, above the reach of the sea
  // Where the dry sand has been walked on (near the water, in the village, in patches elsewhere) it is lumpy
  // and the wind's ripples are gone.
  float trodden = dryLand * smoothstep(0.3, 0.6, lrNoiseTile(d * 0.1875, 12.0) + 0.5 * land.b + 0.35 * (1.0 - smoothstep(4.0, 30.0, -shore)));
  if (sandy > 0.01) {
    // Ripple crests wander, and patches of the bed have none. (The wandering is a slow warp of the phase. Turning
    // the direction itself by an angle that varies from place to place would wind the crests into rings round
    // the origin of the detail coordinates.)
    vec2 wd = normalize(uWind.xy + 1e-4);
    // (The swash smooths the sand it runs over: no wind ripples below the wet line.)
    float spacing = wetBed ? 0.5 : 0.09, tall = wetBed ? 0.004 * (1.0 - smoothstep(2.0, 5.0, water)) : 0.0012 * dryLand * (1.0 - trodden) * step(water, 0.0);
    float patches = smoothstep(0.35, 0.65, lrNoiseTile(d * 0.21875 + 9.0, 14.0));
    float phase = dot(d, wd) * 6.2832 / spacing + (wetBed ? 22.0 : 55.0) * lrNoiseTile(d * (wetBed ? 0.25 : 0.5), wetBed ? 16.0 : 32.0) + 3.0 * lrNoiseTile(d * 0.875, 56.0) + 1.2 * lrNoiseTile(d * 2.875, 184.0);
    n = normalize(n + vec3(wd.x, 0.0, wd.y) * tall * 6.2832 / spacing * sin(phase) * sandy * patches);
    albedo *= 1.0 + 0.035 * sin(phase + 1.2) * sandy * patches * step(1e-5, tall);      // (darker, heavier grains gather in the troughs)
  }
  // Up the beach, out of reach of the sea and of feet, the wind builds low ridges a step apart: a gentle
  // windward slope, a short steep lee side. Seen from a few metres to a few tens of metres.
  float ridged = sand * dryLand * (1.0 - trodden) * step(water, -0.25) * (1.0 - smoothstep(0.03, 0.12, px)) * smoothstep(6.0, 14.0, -shore);
  if (ridged > 0.01) {
    vec2 wd = normalize(uWind.xy + 1e-4);
    float spacing = 0.44, ph = dot(d, wd) / spacing + 2.6 * lrNoiseTile(d * 0.1875 + 4.0, 12.0) + 0.7 * lrNoiseTile(d * 0.4375, 28.0) + 0.25 * lrNoiseTile(d * 1.3125 + 7.0, 84.0), f = fract(ph);
    // (Height over one ridge: rising over 80 % of it, falling over 20 %; its slope along the wind.)
    // (Crests are short: they start, fork and die out within a few steps, never a line you could follow.)
    float rise = f < 0.8 ? 1.0 / 0.8 : -1.0 / 0.2, there = smoothstep(0.3, 0.6, lrNoiseTile(d * 0.15625 + 13.0, 10.0)) * smoothstep(0.3, 0.65, lrNoiseTile(d * 0.5625 + 21.0, 36.0));
    n = normalize(n - vec3(wd.x, 0.0, wd.y) * 0.016 / spacing * rise * ridged * there * smoothstep(0.0, 0.06, min(f, abs(f - 0.8))));
    albedo *= 1.0 - 0.03 * ridged * there * smoothstep(0.75, 0.8, f) * (1.0 - smoothstep(0.92, 1.0, f));      // coarse grains on the lee side
  }

  // ---- Close up: the sand itself.
  vec3 V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  float openSky = 1.0, sunCut = 1.0, grainy = sand * (1.0 - smoothstep(0.012, 0.05, px));
  float lumpy = sand * trodden * (1.0 - smoothstep(0.12, 0.3, px));
  vec2 at = d;                                              // where on the sand this pixel lands, once its relief is counted
  float hollow = 0.0;                                       // how far down in a hollow of trodden ground (0..1)
  if (lumpy > 0.01) {
    // Trodden sand: pits and lumps a few centimetres deep. The view slides over them (parallax), the pits see
    // less sky, and a low sun leaves their far sides in shadow.
    float blend = smoothstep(0.35, 0.65, lrNoiseTile(d * 0.1875 + 5.0, 12.0));
#ifdef LR_SAND_FULL
    if (px < 0.02) {
      vec2 slide = V.xz / max(V.y, 0.45) * LR_RELIEF_H * lumpy;
      for (int i = 0; i < 2; i++) {
        at = d + slide * (mix(lrDetailTap(at, LR_RELIEF_A, 1.0, ddx, ddy).b, lrDetailTap(at, LR_RELIEF_B, 1.0, ddx, ddy).b, blend) - uDetailMean[1].b);
      }
    }
#endif
    vec4 ra = lrDetailTap(at, LR_RELIEF_A, 1.0, ddx, ddy), rb = lrDetailTap(at, LR_RELIEF_B, 1.0, ddx, ddy);
    vec2 slope = mix(ra.rg - uDetailMean[1].rg, lrUnturn(rb.rg - uDetailMean[1].rg), blend) * 2.0 * lumpy;
    n = normalize(vec3(n.x - slope.x, n.y, n.z - slope.y));
    openSky = mix(1.0, mix(ra.a, rb.a, blend) / uDetailMean[1].a, lumpy);
    hollow = lumpy * (1.0 - smoothstep(0.3, 0.46, mix(ra.b, rb.b, blend)));
#ifdef LR_SAND_FULL
    float tanSun = uSunDir.y / max(length(uSunDir.xz), 1e-3);
    if (tanSun < 3.0 && uSunDir.y > 0.0 && px < 0.03) {
      vec2 toSun = normalize(uSunDir.xz);
      float h0 = mix(ra.b, rb.b, blend), rise = 0.0;
      for (int i = 0; i < 4; i++) {
        float t = i == 0 ? 0.005 : i == 1 ? 0.015 : i == 2 ? 0.035 : 0.075;
        float h = mix(lrDetailTap(at + toSun * t, LR_RELIEF_A, 1.0, ddx, ddy).b, lrDetailTap(at + toSun * t, LR_RELIEF_B, 1.0, ddx, ddy).b, blend);
        rise = max(rise, (h - h0) * LR_RELIEF_H * lumpy / t - tanSun);      // how far the sand that way stands above the sun
      }
      sunCut = 1.0 - smoothstep(0.0, 0.3, rise);
    }
#endif
  }
  if (grainy > 0.01) {
    // Grains, flakes and bits of shell. Water between the grains evens the surface out.
    float blend = smoothstep(0.35, 0.65, lrNoiseTile(d * 0.1875 + 9.0, 12.0)), evened = 1.0 - 0.6 * (covered ? 1.0 : wetAll);
    vec4 ga = lrDetailTap(at, LR_GRAIN_A, 0.0, ddx, ddy), gb = lrDetailTap(at, LR_GRAIN_B, 0.0, ddx, ddy);
    vec2 slope = mix(ga.rg - uDetailMean[0].rg, lrUnturn(gb.rg - uDetailMean[0].rg), blend) * 2.0 * grainy * evened;
    n = normalize(vec3(n.x - slope.x, n.y, n.z - slope.y));
    float tint = mix(ga.a, gb.a, blend) - uDetailMean[0].a;
    albedo *= mix(1.0, mix(ga.b, gb.b, blend) / uDetailMean[0].b, grainy)
            * mix(vec3(1.0), vec3(1.12, 0.74, 0.7), lrSaturate(tint * 2.2) * grainy) * mix(vec3(1.0), vec3(1.0, 0.9, 0.72), lrSaturate(-tint * 3.0) * grainy);
    // Wet sand: pin holes where air has escaped, in loose groups; now and then a crab's burrow.
    if (!covered && wetLine > 0.01 && px < 0.02) {
      float holes = lrDetailTap(at, LR_GRAIN_A, 2.0, ddx, ddy).b * smoothstep(0.5, 0.7, lrNoiseTile(d * 0.75 + 3.0, 48.0));
      albedo *= 1.0 - 0.65 * holes * wetLine * (1.0 - smoothstep(0.008, 0.02, px));
    }
  }
  if (!covered && uFootCount > 0 && sand > 0.5 && px < 0.03) {
    // Your own footprints.
    float soft = 1.0 - wetness, since = beach && sw.age < 900.0 ? uTime - sw.age : -1e9, e = 0.004;
    float h0 = lrFootprints(d, soft, since);
    vec2 slope = vec2(lrFootprints(d + vec2(e, 0.0), soft, since), lrFootprints(d + vec2(0.0, e), soft, since)) - h0;
    if (h0 != 0.0 || slope != vec2(0.0)) {
      n = normalize(vec3(n.x - slope.x / e, n.y, n.z - slope.y / e));
      openSky *= 1.0 + 16.0 * min(h0, 0.0);                 // (the bottom of a print 2 cm deep sees two thirds of the sky)
      albedo *= 1.0 + 4.0 * min(h0, 0.0) * soft;            // pressed sand is a shade darker
    }
  }
  float focus = water > 0.0 ? lrCaustics(vRel.xz, water, px) : 1.0, shade = lrCloudShadow(wxz);
  // Shadows of things. On the seabed the light came in through the surface up-sun of here: look there.
  vec3 sunIn = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.34);
  shade *= water > 0.0 ? lrShadow(vec3(vRel.x, uSeaLevel, vRel.z) - vec3(sunIn.x, 0.0, sunIn.z) * (water / max(-sunIn.y, 0.3)), vec3(0.0, 1.0, 0.0))
                       : lrShadow(vec3(vRel.x, ground, vRel.z), nG);
  // Dry sand is rough: it sends light back towards the sun and less of it on, away from the sun (the
  // Oren-Nayar lobe, scaled so that seen from above at noon it is as before).
  float nl = lrSaturate(dot(n, uSunDir)), nv = lrSaturate(dot(n, V)), back = dot(uSunDir, V) - nl * nv;
  float lobe = mix(1.0, 1.0 + 0.383 * back / (back > 0.0 ? max(max(nl, nv), 1e-3) : 1.0), sand * dryLand * (1.0 - uWet) * (1.0 - smoothstep(0.3, 2.0, px)));
  vec3 light = uSunE * nl * lobe * focus * shade * sunCut + uSkyE * (0.5 + 0.5 * n.y) * openSky;
  // (A pit in shadow is still lit by the sunlit sand round it.)
  light += uSunE * lrSaturate(uSunDir.y) * shade * 0.14 * lumpy * (1.0 - sunCut * nl);
  if (covered) {
    // Under water: reflectance times the light it gets relative to open flat ground. The water pass multiplies
    // the flat-ground light back in.
    outColor = vec4(albedo * light / max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4)), water);
    return;
  }
  vec3 col = albedo * light / PI;
  if (grainy > 0.01 && uSunDir.y > 0.0) {
    // Sparkle, mostly on dry sand (the film on wet sand has its own glitter).
    col += uSunE * shade * sunCut * lrGlints(d, px, n, normalize(uSunDir + V)) * 0.55 * grainy * (1.0 - 0.7 * wetAll);
  }
  float blowing = smoothstep(8.5, 13.0, uWind.z) * sand * dryLand * (1.0 - uWet) * step(water, -0.2) * (1.0 - smoothstep(0.02, 0.2, px));
  if (blowing > 0.01) {
    // A strong wind lifts the dry sand: pale streamers snaking along the ground downwind, never still.
    vec2 w0 = normalize(uWind.xy + 1e-4), q = vec2(dot(dxz, w0), dot(dxz, vec2(-w0.y, w0.x)));
    float streak = lrNoise(vec2(q.x * 0.5 - uTime * 3.2, q.y * 7.0)) * lrNoise(vec2(q.x * 0.13 - uTime * 1.1, q.y * 1.3) + 7.0)
                 + 0.35 * lrNoise(vec2(q.x * 1.7 - uTime * 6.0, q.y * 19.0) + 3.0);
    col = mix(col, albedo * (uSunE * lrSaturate(uSunDir.y) * shade + uSkyE) / PI * 1.12, 0.6 * blowing * smoothstep(0.42, 0.85, streak));
  }
  if (wetAll > 0.0) {
    // Wet sand is darker by exactly what the water model gives for water of no depth. On top lies the film the
    // sea leaves behind: a mirror for the sky and the sun just after the water has gone, matt a few seconds
    // later; the foot of the beach, where the water table comes out, never dries. With gloss = 1 this is the
    // water pass's own shading at zero depth, so the edge of the sheet has no step in it.
    vec3 lit = max(uSunE * lrSaturate(uSunDir.y) * shade + uSkyE, vec3(1e-4));
    // (The standing film is patchy, and as a film thins the grains come through it and break the mirror up.)
    float patchy = px < 0.3 ? smoothstep(0.3, 0.62, lrDetailTap(d, mat2(40.0, 0.0, 0.0, 40.0) / 64.0, 2.0, ddx, ddy).a + 0.3 * lrNoiseTile(d * 0.1875 + 2.0, 12.0)) : 0.7;
    float gloss = wetLine * max(exp(-sw.age / 3.0), 0.85 * patchy * (1.0 - smoothstep(0.0, 0.3 * sw.top + 0.01, -water)));
    // (Rain: a film in patches while it falls, a dull damp surface after.)
    gloss = max(gloss, uWet * (0.12 + 0.5 * uRain) * patchy * sand);
    // Puddles: on the hard-trodden streets of the village the rain stands in the hollows (beach sand drinks it).
    gloss = max(gloss, uWet * uWet * hollow * smoothstep(0.3, 0.6, land.b));
    vec2 fs = lrSheetSlope(-nG.xz / nG.y, -water, LrSwash(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0));
    fs += (nG.xz / nG.y - n.xz / n.y) * 0.8 * (1.0 - gloss * gloss);
    vec3 nf = normalize(vec3(-fs.x, 1.0, -fs.y));
    float rough = mix(0.02, 2e-4 + 0.012 * uRain, gloss);
    float fresnel = lrMeanFresnel(max(dot(nf, V), 0.0), sqrt(rough));
    vec3 mirror = reflect(-V, nf);
    mirror.y = abs(mirror.y) + 0.01;
    col *= mix(vec3(1.0), lrWetSand(albedo * light / lit), wetAll) * mix(1.0, (1.0 - fresnel) / 0.979, gloss);
    col += gloss * (fresnel * lrEnv(normalize(mirror), rough) + uSunE * min(lrSunGlitter(V, nf, uSunDir, vec2(rough)), 400.0) * step(0.0, uSunDir.y) * shade);
    // What the sheet leaves behind: its last bubbles, bursting within a second or so, and a line of them at the
    // top of each wave's run (this wave's, and fainter the one before).
    if (px < 0.3 && sw.top > 1e-4) {
      float a = -water, tilt = length(nG.xz / nG.y), since = lrSwashFoamAge(a, sw) - sw.age;        // how old the foam was when the sea left it
      float left = 0.8 * exp(-max(since, 0.0) / 1.6) * exp(-sw.age / 0.9) * step(sw.age, 20.0);
      float line = exp(-abs(a - sw.reach) / 0.003) * step(0.28, sw.p) * exp(-(sw.p - 0.28) * LR_SWASH_T / 4.0)
                 + 0.5 * exp(-abs(a - sw.last) / 0.003) * exp(-(sw.p + 0.72) * LR_SWASH_T / 4.0);
      // (The line is a broken one: a few bubbles here, none there.)
      float amount = max(left, 0.5 * line * smoothstep(0.3, 0.7, lrNoiseTile(d * 1.5 + 5.0, 96.0))) * fine * sw.open * smoothstep(0.02, 0.12, vHs);
      if (amount > 0.003) {
        vec2 uphill = tilt > 1e-4 ? -nG.xz / nG.y / tilt : vec2(0.0);
        vec2 f = lrFoam(d - uphill * lrSwashCarry(a, tilt), amount, px, ddx, ddy);
        col = mix(col, 0.85 * f.y * lit / PI, f.x);
      }
    }
    if (uRain > 0.01 && px < 0.03 && sand > 0.3) {
      // Rain on sand: each drop leaves a little crater (they crowd together), and where one lands this instant
      // there is a speck of spray.
      float near = 1.0 - smoothstep(0.012, 0.03, px);
      float pits = lrDetailTap(d, mat2(192.0, 0.0, 0.0, 192.0) / 64.0, 2.0, ddx, ddy).b + lrDetailTap(d, mat2(168.0, -96.0, 96.0, 168.0) / 64.0, 2.0, ddx, ddy).b;
      col *= 1.0 - 0.22 * min(pits, 1.0) * uWet * near;
      vec2 cell = floor(d / 0.03125), f = fract(d / 0.03125) - 0.5;
      float beat = uTime * 4.0 + lrHash12(cell) * 7.0, hit = step(lrHash12(cell + floor(beat) * 0.37 + 3.0), 0.05 * uRain);
      float spray = hit * (1.0 - smoothstep(0.0, 0.4, fract(beat))) * (1.0 - smoothstep(0.1, 0.32 + 0.3 * fract(beat), length(f - (lrHash22(cell + floor(beat)) - 0.5) * 0.4)));
      col += spray * near * lit / PI * 0.35;
    }
  }
  outColor = vec4(col, -1000.0);
}`;

export class Terrain {
  constructor(tier) {
    this.clipmap = new Clipmap({ quads: tier.block, yRange: [-70, 140] });
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, defines: { LR_SHADOW_TAPS: tier.fp.shadowTaps || 4, ...(tier.fp.sand === 'full' ? { LR_SAND_FULL: 1 } : {}) },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...CHUNK_UNIFORMS.shore, ...CHUNK_UNIFORMS.detail, ...CHUNK_UNIFORMS.shadow, ...CHUNK_UNIFORMS.optics, ...CHUNK_UNIFORMS.atmosphere, ...WAVE_UNIFORMS, ...CHUNK_UNIFORMS.cloudShadow,
        'uFocusRel', 'tAlbedo', 'tSatellite', 'tBenthic', 'tLand', 'uCompareX', 'uRain', 'uWet', 'uTreesNear']),
    });
    this.mesh = new THREE.Mesh(this.clipmap.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }
  update(view, rect) { this.clipmap.update(view.cam, view.focus, view.range, view.frustum, rect, view.drop); }
}
