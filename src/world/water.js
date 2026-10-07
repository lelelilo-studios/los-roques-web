// The sea surface: the same clipmap as the terrain, displaced by the wave cascades and drawn after the opaque
// pass. It reads what lies under it from a copy of the scene (colour = lit bottom reflectance, alpha = water
// depth), bends the view through the surface, and turns the bottom into the colour of the water column with the
// shallow-water model in lr_optics. On top: the reflected sky, the sun's glitter and foam. On the beach face it
// draws the sheet of swash wherever the terrain marked the sand as covered (and nowhere else).
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
  float hs = lrWaveHs(raw), a = ground - uSeaLevel;
  LrSwash sw = lrBeach(wxz, shore, hs, a, 1.0);
  float y = uSeaLevel + d.y + lrShoreSurface(shore, min(a, 0.0), hs, sw);
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
    vec2 sl = vec2(0.0);
    for (int i = 0; i < 4; i++) sl += vWeights[i] * textureGrad(tWaveB, vec3(lrWaveUV(vGrid, i), float(i)), gx / uWaveTile[i], gy / uWaveTile[i]).xy;
    vec3 nd = -normalize(vec3(-sl.x, 1.0, -sl.y)), up = normalize(vec3(vRel.x, vRel.y - uCamY, vRel.z));
    vec3 outDir = refract(up, nd, 1.34);
    float shoreU, deep = max(uSeaLevel - lrGround(wxz, px, shoreU), 0.05), lagoon = texture(tWaterType, lrMapUV(wxz)).r;
    vec3 ab = mix(uAbsOcean, uAbsLagoon, lagoon), bb = mix(uBbOcean, uBbLagoon, lagoon), kd = ab + bb;
    vec3 daylight = (uSunE * lrSaturate(uSunDir.y) * lrCloudShadow(wxz) + uSkyE) * 0.9;
    vec3 mirrored = reflect(up, nd), through = exp(-(ab + 4.0 * bb) * deep / max(-mirrored.y, 0.08));
    vec3 below = vec3(0.42, 0.40, 0.34) / PI * daylight * exp(-kd * deep) * through + daylight * exp(-kd * deep * 0.5) * bb / kd * 0.5 * (1.0 - through);
    vec3 c = below;
    if (dot(outDir, outDir) > 0.0) {
      float f = lrFresnel(dot(outDir, -nd));
      c = mix(lrSkyRadiance(normalize(vec3(outDir.x, abs(outDir.y) + 0.02, outDir.z))) + uSunE * 40.0 * pow(lrSaturate(dot(outDir, uSunDir)), 600.0) * lrCloudShadow(wxz), below, f);
    }
    outColor = vec4(c, -3000.0);
    return;
  }
  float shore, near = lrGroundNear(px);
  vec3 sandN;
  float ground = lrGroundAt(vRel.xz, px, false, shore, sandN);
  float aboveStill = ground - uSeaLevel;
  // (How steep the bed is here against a typical beach face: on flats a little water goes a long way.)
  float steep = clamp(fwidth(ground) * 0.7 / max(px, 1e-4), 0.01, 0.3) / 0.11;
  vec4 bed0 = texelFetch(tRefr, ivec2(gl_FragCoord.xy), 0);
  if (bed0.a < -1500.0) discard;                            // something that must show through the sea surface (tree canopy seen from afar)
  bool hasBed0 = bed0.a > -LR_WET_BAND;
  // Near the waterline the terrain is the judge of what is under water: where it drew dry or wet sand (or
  // anything else stands), there is no sea to draw, whatever this mesh makes of it.
  // (From afar this mesh's own idea of the ground is a blurred one: the further, the more the terrain rules.)
  if (!hasBed0 && aboveStill > -0.25 - 0.15 * px) discard;
  // (From far away the swash and its foam are much thinner than a pixel: they fade out.)
  float fine = 1.0 - smoothstep(0.5, 4.0, px);
  LrSwash sw = lrBeach(wxz, shore, vHs, aboveStill, fine);
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
    sw = lrBeach(uCamXZ + spot, shore, vHs, aboveStill, fine);
    surface = vWaveY + lrShoreSurface(shore, aboveStill, vHs, sw);
    column = max(surface - aboveStill, 1e-4);
  }
  vec2 bedSlope = -sandN.xz / sandN.y;

  vec3 V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  vec3 downwelling = uSunE * lrSaturate(uSunDir.y) + uSkyE;

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
  var += 2e-4 + 0.5 * (0.0006 + 0.0003 * uWind.z) * lrSaturate(vWeights.w * 200.0) + 0.012 * uRain;      // raindrops pock the surface
  // Water a finger deep running over sand is wrinkled by it (a film thinner than that is a mirror, and deeper
  // water has its own waves).
  var += 0.005 * smoothstep(0.0, 0.015, column) * (1.0 - smoothstep(0.06, 0.3, column));
  // On the beach face the sheet lies on the sand, and an advancing front stands up from it.
  if (aboveStill > 0.0) slope += lrSheetSlope(bedSlope, aboveStill, sw);
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
    bed = texture(tRefr, clip.xy / clip.w * 0.5 + 0.5);
    if (clip.w <= 0.0 || bed.a <= -LR_WET_BAND) bed = bed0;           // the bent ray left the water (or the screen): look straight through
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
  float shade = lrCloudShadow(wxz);
  vec3 lit = uSunE * lrSaturate(uSunDir.y) * shade + uSkyE;
  vec3 leaving = lrWaterRrs(rho * downwelling / max(lit, vec3(1e-4)), lrOpticalDepth(H), muS, muV, a, bb) * lit * (1.0 - fresnel) / 0.979;

  if (uDebug.x > 4.5) {
    // More debug views: 5 = which path (red: the terrain's point, green: this mesh's own) and the column in blue,
    // 6 = wave weights, 7 = mean slope and roughness, 8 = surface height / bed depth / wave height, 9 = swash sheet / phase / shore distance.
    vec3 col;
    if (uDebug.x < 5.5) col = vec3(film ? 1.0 : 0.0, film ? 0.0 : 1.0, column * 5.0) * 2.0;
    else if (uDebug.x < 6.5) col = vWeights.yzw * 60.0;
    else if (uDebug.x > 7.5 && uDebug.x < 8.5) col = vec3(surface * 5.0 + 0.5, -aboveStill * 2.0, vWaveY * 5.0 + 0.5);
    else if (uDebug.x > 8.5) col = vec3(sw.e * 20.0, sw.p, shore / 10.0);
    else col = vec3(slope * 4.0 + 0.5, sigma * 4.0) * 2.0;
    outColor = vec4(col, -1000.0); return;
  }
  if (uDebug.x > 3.5) { outColor = vec4(leaving / (1.0 - fresnel) * 0.979, -1000.0); return; }   // 4: only the light leaving the water (for comparing with the satellite)
  vec3 R = reflect(-V, n);
  R.y = abs(R.y) + 0.01;
  vec3 reflected = lrSkyRadiance(normalize(R)) * fresnel;
  vec3 glitter = uSunE * min(lrSunGlitter(V, n, uSunDir, var), 400.0) * step(0.0, uSunDir.y) * shade;
  vec3 col = leaving + reflected + glitter;

  // ---- Foam.
  // Whitecaps: where the long waves pile the surface together (their horizontal motion converges at breaking crests).
  float foam = smoothstep(0.55, 0.85, -fold) * lrSaturate(uWind.z / 7.0 - 0.5);
  // Swash: a band of bubbles right behind the front while it runs up, a thinner veil trailing it, both
  // dissolving as the sheet drains.
  float rush = (1.0 - smoothstep(0.25, 0.75, sw.p)) * smoothstep(0.0, 0.06, sw.p);
  float nearShore = fine * (1.0 - smoothstep(2.0, 12.0, shore));
  float front = exp(-max(sw.behind, 0.0) / ((0.12 * sw.reach + 0.003) * steep));
  float veil = 0.3 * rush * (1.0 - smoothstep(0.0, sw.reach * steep + 1e-4, sw.behind));
  foam = max(foam, nearShore * max(front * (0.25 + 0.55 * rush), veil) * smoothstep(0.02, 0.12, vHs));
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
    float cover = lrFoamPattern(spot, lrSaturate(foam), px);
    col = mix(col, 0.82 * lit / PI, cover);
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
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.DoubleSide,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...CHUNK_UNIFORMS.shore, ...CHUNK_UNIFORMS.optics, ...CHUNK_UNIFORMS.atmosphere, ...WAVE_UNIFORMS, ...CHUNK_UNIFORMS.cloudShadow,
        'uFocusRel', 'uCompareX', 'uViewProj', 'tWaterType', 'uDebug', 'uRain'], { tRefr: { value: null } }),
    });
    this.mesh = new THREE.Mesh(this.clipmap.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }
  update(view) { this.clipmap.update(view.cam, view.focus, view.range, view.frustum, null, view.drop); }
}
