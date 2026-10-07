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
uniform float uRain;
uniform sampler2D tAlbedo;
uniform sampler2D tSatellite;
uniform sampler2D tBenthic;   // r seagrass, g coral/algae, b rubble, a confidence
uniform sampler2D tLand;      // r mangrove, g scrub, b built-up, a canopy height / 25.5 m
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
// traced back to where it entered; the sun's width blurs the pattern with depth (a coarser mip).
float lrCaustics(vec2 rel, float water, float px) {
  vec3 s = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.34);
  float path = water / max(-s.y, 0.3);
  vec2 entry = rel - s.xz * path;
  float blur = path * 0.0093 + px, kd = 0.254 * path;
  vec3 h = vec3(0.0);
  for (int i = 1; i < 3; i++) {
    h += vWeights[i] * textureLod(tWaveC, vec3(lrWaveUV(entry, i), float(i)), log2(max(blur * 256.0 / uWaveTile[i], 1.0))).xyz;
  }
  float det = (1.0 + kd * h.x) * (1.0 + kd * h.y) - kd * kd * h.z * h.z;
  return min(1.0 / max(abs(det), 0.08), 6.0);
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
  float stand = smoothstep(0.34, 0.62, land.r + (lrNoise(wxz / 11.0) - 0.5) * 0.5 * (1.0 - smoothstep(4.0, 16.0, px)));
  if (vCanopy > 0.3 || stand > 0.5) {
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
  albedo *= 1.0 + (lrNoise(dxz * 6.0) - 0.5) * 0.07 * (1.0 - smoothstep(0.05, 0.6, px));
  vec3 n = nG;

  // The beach face: where the swash is right now, and how wet it has left the sand.
  bool covered = water > 0.0 && vCanopy < 0.02, beach = water > -LR_WET_BAND && water <= 0.0 && vCanopy < 0.02;
  LrSwash sw;
  float wetness = 0.0, wetLine = 0.0, fine = 1.0 - smoothstep(0.5, 4.0, px);
  if (beach) {
    sw = lrBeach(wxz, shore, vHs, -water, fine);
    covered = sw.behind > 0.0;
    // Wet up to the highest line the waves reach (a sharp edge), with a damp halo above it.
    float edge = max(0.0015, fwidth(water));
    wetLine = 1.0 - smoothstep(sw.top - edge, sw.top + edge, -water);
    wetness = max(wetLine, 0.35 * (1.0 - smoothstep(0.0, 0.4 * sw.top + 0.01, -water - sw.top)) * lrSaturate(sw.top * 40.0));
  }
  // Soaked sand: the wet beach face, the sand under the swash, and on down under the first hand's breadth of sea.
  albedo *= mix(1.0, LR_SOAKED, fine * (covered ? smoothstep(-0.25, 0.0, -water) : wetness));

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
  float sandy = (1.0 - lrSaturate(benthic.r + benthic.g + land.r + land.g)) * (1.0 - rocky) * (1.0 - smoothstep(wetBed ? 0.03 : 0.004, wetBed ? 0.2 : 0.03, px));
  if (sandy > 0.01 && ground < uSeaLevel + 3.0) {
    vec2 d = lrDetailXZ(vRel.xz);
    // Ripple crests wander: the direction swings with position, and patches of the bed have none.
    float swing = (lrNoise(d * 0.13) - 0.5) * 1.6, cs = cos(swing), sn = sin(swing);
    vec2 w0 = normalize(uWind.xy + 1e-4), wd = vec2(w0.x * cs - w0.y * sn, w0.x * sn + w0.y * cs);
    // (The swash smooths the sand it runs over: no wind ripples below the wet line.)
    float spacing = wetBed ? 0.5 : 0.09, tall = wetBed ? 0.007 * (1.0 - smoothstep(2.0, 5.0, water)) : 0.0012 * (1.0 - wetness) * step(water, 0.0);
    float patches = smoothstep(0.35, 0.65, lrNoise(d * 0.21 + 9.0));
    float phase = dot(d, wd) * 6.2832 / spacing + 3.0 * lrNoise(d * 0.9) + 1.2 * lrNoise(d * 2.9);
    n = normalize(n + vec3(wd.x, 0.0, wd.y) * tall * 6.2832 / spacing * sin(phase) * sandy * patches);
  }
  float focus = water > 0.0 ? lrCaustics(vRel.xz, water, px) : 1.0, shade = lrCloudShadow(wxz);
  vec3 light = uSunE * lrSaturate(dot(n, uSunDir)) * focus * shade + uSkyE * (0.5 + 0.5 * n.y);
  if (covered) {
    // Under water: reflectance times the light it gets relative to open flat ground. The water pass multiplies
    // the flat-ground light back in.
    outColor = vec4(albedo * light / max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4)), water);
    return;
  }
  vec3 col = albedo * light / PI;
  if (wetness > 0.0) {
    // Wet sand is darker by exactly what the water model gives for water of no depth. On top lies the film the
    // sea leaves behind: a mirror for the sky and the sun just after the water has gone, matt a few seconds
    // later; the foot of the beach, where the water table comes out, never dries. With gloss = 1 this is the
    // water pass's own shading at zero depth, so the edge of the sheet has no step in it.
    vec3 lit = max(uSunE * lrSaturate(uSunDir.y) * shade + uSkyE, vec3(1e-4));
    float gloss = wetLine * max(exp(-sw.age / 3.0), 0.85 * (1.0 - smoothstep(0.0, 0.3 * sw.top + 0.01, -water)));
    vec3 V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
    vec2 fs = lrSheetSlope(-nG.xz / nG.y, -water, LrSwash(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0));
    vec3 nf = normalize(vec3(-fs.x, 1.0, -fs.y));
    float rough = mix(0.02, 2e-4 + 0.012 * uRain, gloss);
    float fresnel = lrMeanFresnel(max(dot(nf, V), 0.0), sqrt(rough));
    vec3 mirror = reflect(-V, nf);
    mirror.y = abs(mirror.y) + 0.01;
    col *= mix(vec3(1.0), lrWetSand(albedo * light / lit), wetness) * mix(1.0, (1.0 - fresnel) / 0.979, gloss);
    col += gloss * (fresnel * lrSkyRadiance(normalize(mirror)) + uSunE * min(lrSunGlitter(V, nf, uSunDir, vec2(rough)), 400.0) * step(0.0, uSunDir.y) * shade);
  }
  outColor = vec4(col, -1000.0);
}`;

export class Terrain {
  constructor(tier) {
    this.clipmap = new Clipmap({ quads: tier.block, yRange: [-70, 140] });
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...CHUNK_UNIFORMS.shore, ...CHUNK_UNIFORMS.optics, ...CHUNK_UNIFORMS.atmosphere, ...WAVE_UNIFORMS, ...CHUNK_UNIFORMS.cloudShadow,
        'uFocusRel', 'tAlbedo', 'tSatellite', 'tBenthic', 'tLand', 'uCompareX', 'uRain']),
    });
    this.mesh = new THREE.Mesh(this.clipmap.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }
  update(view, rect) { this.clipmap.update(view.cam, view.focus, view.range, view.frustum, rect, view.drop); }
}
