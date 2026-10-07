// The sea surface: the same clipmap as the terrain, displaced by the wave cascades and drawn after the opaque
// pass. It reads what lies under it from a copy of the scene (colour = lit bottom reflectance, alpha = water
// depth), bends the view through the surface, and turns the bottom into the colour of the water column with the
// shallow-water model in lr_optics. On top: the reflected sky, the sun's glitter and foam. It also finishes the
// strip of beach the swash can reach: dry sand, wet sand with a sheen, or sand under a film of water.
import * as THREE from 'three';
import { Clipmap, clipmapFragment, clipmapVertex } from '../core/clipmap.js';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { WAVE_UNIFORMS, wavesGLSL } from './waves.js';

const vertexShader = /* glsl */`
#include <lr_common>
#include <lr_geo>
#include <lr_shore>
${wavesGLSL}
${clipmapVertex}
out vec3 vRel;       // surface point: x/z relative to the camera, absolute height
out vec2 vGrid;      // the same point before the waves moved it
out vec4 vWeights;   // local height of each wave cascade
out vec4 vWaveMap;
out float vWaveY;    // height the cascades add (the swash is added per pixel)
out float vHs;       // height of the waves arriving here
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
  float hs = lrWaveHs(raw);
  float y = uSeaLevel + d.y + lrShoreSurface(wxz, shore, hs);
  // Over the strip of beach the swash can reach, ride just above the sand so this pass can finish it.
  float lift = min(0.004 + 0.0015 * length(vec3(rel.x, uCamY, rel.y)), 2.0);
  if (ground > uSeaLevel - 0.3 && ground < uSeaLevel + LR_WET_BAND) y = max(y, ground + lift);
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
uniform sampler2D tRefr;      // copy of the opaque scene: rgb = lit bottom reflectance, a = water depth
uniform sampler2D tWaterType; // 1 = lagoon water, 0 = clear ocean water
uniform mat4 uViewProj;
uniform float uCompareX;
uniform vec4 uDebug;
in vec3 vRel;
in vec2 vGrid;
in vec4 vWeights;
in vec4 vWaveMap;
in float vWaveY;
in float vHs;
layout(location = 0) out vec4 outColor;

// Foam: a lacy bubble pattern covering the share 'amount' of the surface. From far away (pixel footprint 'px'
// metres) the pattern is finer than a pixel and only its average is left.
float lrFoamPattern(vec2 rel, float amount, float px) {
  vec2 p = lrDetailXZ(rel);
  float cells = lrFbm(p * 2.3 + uTime * 0.07) * 0.65 + lrNoise(p * 9.0 - uTime * 0.11) * 0.35;
  cells = smoothstep(0.3, 0.7, cells);                       // spread the noise out to roughly even odds
  float lace = smoothstep(0.85 - amount, 1.15 - amount, cells);
  return mix(lace, amount, smoothstep(0.04, 0.3, px));
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
  float shore;
  float ground = lrGround(wxz, px, shore);
  float aboveStill = ground - uSeaLevel;
  // Water standing over this point right now: still level + waves + swash, minus the ground.
  float surface = vWaveY + lrShoreSurface(wxz, shore, vHs), column = surface - aboveStill;
  vec4 bed0 = texelFetch(tRefr, ivec2(gl_FragCoord.xy), 0);
  if (bed0.a < -1500.0) discard;                            // something that must show through the sea surface (tree canopy seen from afar)
  bool hasBed0 = bed0.a > -LR_WET_BAND;
  float lift = min(0.004 + 0.0015 * length(vec3(vGrid.x, uCamY, vGrid.y)), 2.0);
  if (column < lift + 0.02) {
    // Thin water or none: here the mesh rides above the sand rather than at the true surface, so the point under
    // this pixel is not the one this fragment sits over. Go by what the terrain wrote for this very pixel.
    if (!hasBed0) discard;                                  // beyond the swash's reach (or something else is there): already drawn
    aboveStill = -bed0.a;
    column = surface - aboveStill;
  }

  vec3 V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  vec3 downwelling = uSunE * lrSaturate(uSunDir.y) + uSkyE;

  // ---- The beach face: sand, darker and glossy where the swash has just been.
  float runup = lrRunup(vHs), level = runup * lrSwashCurve(lrSwashPhase(wxz, vHs));
  vec3 sandRho = hasBed0 ? bed0.rgb : vec3(0.45);
  // (From far away the wet strip and the foam line are much thinner than a pixel: let them fade out.)
  float fine = 1.0 - smoothstep(0.5, 4.0, px);
  float wet = fine * (1.0 - smoothstep(0.75 * runup, 1.1 * runup + 0.04, aboveStill));
  float glossy = wet * (1.0 - smoothstep(0.0, 0.12, aboveStill - level));          // just uncovered: still shining
  vec3 up = vec3(0.0, 1.0, 0.0);
  float sandF = lrFresnel(max(V.y, 0.0));
  vec3 sand = sandRho * (1.0 - 0.42 * wet) * (1.0 - 0.08 * wet * vec3(0.0, 0.3, 1.0)) * downwelling / PI
            + glossy * sandF * lrSkyRadiance(normalize(vec3(-V.x, abs(V.y) + 0.01, -V.z)));
  if (column <= 0.0) { outColor = vec4(sand, -1000.0); return; }

  // ---- The water surface. Mean slope of the waves inside this pixel, and how much they vary within it.
  vec2 slope = vec2(0.0), var = vec2(0.0);
  float fold = 0.0;
  for (int i = 0; i < 4; i++) {
    float t = uWaveTile[i];
    vec3 uvw = vec3(lrWaveUV(vGrid, i), float(i));
    vec4 b = textureGrad(tWaveB, uvw, gx / t, gy / t);
    slope += vWeights[i] * b.xy;
    var += vWeights[i] * vWeights[i] * max(b.zw - b.xy * b.xy, 0.0);
    if (i < 2) fold += vWeights[i] * textureGrad(tWaveA, uvw, gx / t, gy / t).w;
  }
  // Capillary ripples too small for the cascades, where there is wind on the water at all.
  var += 2e-4 + 0.5 * (0.0006 + 0.0003 * uWind.z) * lrSaturate(vWeights.w * 200.0);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  float cosV = max(dot(n, V), 0.0), sigma = sqrt(max(var.x, var.y));
  float fresnel = lrMeanFresnel(cosV, sigma);

  // Look through the surface: bend the view ray and find what it lands on in the scene copy.
  float depth0 = hasBed0 ? max(bed0.a + column - (uSeaLevel - ground), column) : column;
  vec3 T = refract(-V, n, 1.0 / 1.34);
  vec3 hit = vRel + T * (min(depth0, 25.0) / max(-T.y, 0.35));
  vec4 clip = uViewProj * vec4(hit.x, hit.y - lrCurveDrop(hit.xz), hit.z, 1.0);
  vec4 bed = texture(tRefr, clip.xy / clip.w * 0.5 + 0.5);
  if (clip.w <= 0.0 || bed.a <= -LR_WET_BAND) bed = bed0;             // the bent ray left the water (or the screen): look straight through
  bool hasBed = bed.a > -LR_WET_BAND;
  // bed.a is the depth below STILL water of what we see; add how far the surface here stands above still water.
  float H = hasBed ? max(bed.a + surface, 0.005) : max(column, 0.005);
  vec3 rho = hasBed ? bed.rgb : vec3(0.3);

  float muV = max(-T.y, 0.35), muS = lrCosInWater(lrSaturate(uSunDir.y));
  float lagoon = texture(tWaterType, lrMapUV(wxz)).r;
  vec3 a = mix(uAbsOcean, uAbsLagoon, lagoon), bb = mix(uBbOcean, uBbLagoon, lagoon);
  // Light on the water here (a cloud may shade it). The bottom reflectance was scaled by the light the bed gets
  // relative to open ground, so rescale it to this light.
  float shade = lrCloudShadow(wxz);
  vec3 lit = uSunE * lrSaturate(uSunDir.y) * shade + uSkyE;
  vec3 leaving = lrWaterRrs(rho * downwelling / max(lit, vec3(1e-4)), lrOpticalDepth(H), muS, muV, a, bb) * lit * (1.0 - fresnel) / 0.979;

  if (uDebug.x > 3.5) { outColor = vec4(leaving / (1.0 - fresnel) * 0.979, -1000.0); return; }   // 4: only the light leaving the water (for comparing with the satellite)
  vec3 R = reflect(-V, n);
  R.y = abs(R.y) + 0.01;
  vec3 reflected = lrSkyRadiance(normalize(R)) * fresnel;
  vec3 glitter = uSunE * min(lrSunGlitter(V, n, uSunDir, var), 400.0) * step(0.0, uSunDir.y) * shade;
  vec3 col = leaving + reflected + glitter;

  // ---- Foam.
  // Whitecaps: where the long waves pile the surface together (their horizontal motion converges at breaking crests).
  float foam = smoothstep(0.55, 0.85, -fold) * lrSaturate(uWind.z / 7.0 - 0.5);
  // Swash: a lace line at the leading edge while it runs up, thinning as it drains.
  float p = lrSwashPhase(wxz, vHs), rush = 1.0 - smoothstep(0.25, 0.75, p);
  float nearShore = fine * (1.0 - smoothstep(2.0, 12.0, shore));
  float edge = 1.0 - smoothstep(0.0, 0.012 + 0.03 * runup, column);          // the line where the water ends
  float sheet = (1.0 - smoothstep(0.0, 0.05 + 0.3 * runup, column)) * 0.3 * rush;   // thin bubbles behind it while it runs up
  foam = max(foam, nearShore * max(edge * (0.5 + 0.5 * rush), sheet) * smoothstep(0.02, 0.12, vHs));
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
    float cover = lrFoamPattern(vGrid, lrSaturate(foam), px);
    col = mix(col, 0.82 * lit / PI, cover);
  }
  if (uDebug.x > 0.5) {
    // Debug views: 1 = what the bed lookup found (red: bent ray, green: straight through, blue: nothing),
    // 2 = depth used / 100 m, 3 = bottom reflectance used.
    if (uDebug.x < 1.5) col = vec3(hasBed && bed.a != bed0.a ? 1.0 : 0.0, hasBed ? 0.5 : 0.0, hasBed ? 0.0 : 1.0) * 3.0;
    else if (uDebug.x < 2.5) col = vec3(H / 100.0) * 3.0;
    else col = rho * 3.0;
  }
  // A film of water thinner than a couple of centimetres shows the sand through.
  col = mix(sand, col, smoothstep(0.0, 0.02, column));
  outColor = vec4(col, -1000.0);
}`;

export class Water {
  constructor(tier) {
    this.clipmap = new Clipmap({ quads: tier.block, yRange: [-4, 4] });
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.DoubleSide,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...CHUNK_UNIFORMS.optics, ...CHUNK_UNIFORMS.atmosphere, ...WAVE_UNIFORMS, ...CHUNK_UNIFORMS.cloudShadow,
        'uFocusRel', 'uCompareX', 'uViewProj', 'tWaterType', 'uDebug'], { tRefr: { value: null } }),
    });
    this.mesh = new THREE.Mesh(this.clipmap.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }
  update(view) { this.clipmap.update(view.cam, view.focus, view.range, view.frustum, null, view.drop); }
}
