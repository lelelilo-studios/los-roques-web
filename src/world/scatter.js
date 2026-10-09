// Small things in great numbers near the eye: seagrass, corals, fish, starfish, shells, shrubs, trees.
//
// Each kind is one instanced mesh whose instances sit on a lattice of cells centred on the camera. The lattice
// moves in whole cells, and everything about a cell's thing (whether there is one, where in the cell, how big,
// which way round) comes from a hash of the cell's own index: so things stay put as you move, and nothing is
// stored. Whether a cell holds a thing is decided in the vertex shader from the same maps the terrain is drawn
// from (seagrass where the data says seagrass), by a GLSL rule each kind supplies.
//
// Output follows the scene's convention (see terrain.js): under water, reflectance and depth; above, radiance.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { WAVE_UNIFORMS, wavesGLSL } from './waves.js';
import { CASTER_UNIFORMS, casterFragment, casterGLSL, shadowGLSL } from './shadow.js';

const vertexShader = (rule, move) => /* glsl */`
#include <lr_common>
#include <lr_geo>
${wavesGLSL}
uniform sampler2D tBenthic;   // r seagrass, g coral/algae, b rubble, a confidence
uniform sampler2D tLand;      // r mangrove, g scrub, b built-up, a canopy height / 25.5 m
uniform vec4 uLattice;        // xy = index of the middle cell (wrapped to 4096), zw = that cell's corner relative to the camera
uniform vec4 uKind;           // cell size (m), half the lattice (cells), seed, sway
uniform vec4 uSize;           // smallest and largest scale, height above the ground, 1 = lean with the ground
#ifdef LR_CASTER
${casterGLSL}
#endif
in vec2 aCell;                // this instance's cell, counted from the middle one
in float aBend;               // how much this vertex moves with the water or the wind (0 at the root)
uniform vec4 uYou;            // you, to what lives here: x, z relative to the camera, your eye's height, 1 if you are in the water
uniform vec4 uBody;           // (fishes) the body's length, depth and thickness at scale 1 (m); how many kinds share this mesh
out vec3 vN;                  // the surface's own way out (0 if the shape has none: the fragment then makes one from the facets)
out float vKind;              // which of the kinds that share this mesh this one is (set by the kind's own movement)
out vec3 vRel;
out vec3 vColor;
out float vFade;
out vec4 vLocal;              // the vertex in the thing's own frame (metres, before it sways or turns), and how leafy it is (aBend)
out float vSeed;
void main() {
  vec2 cell = mod(uLattice.xy + aCell, 4096.0);
  vec4 h = vec4(lrHash22(cell + uKind.z), lrHash22(cell + uKind.z + 71.3));
  vec2 rel = uLattice.zw + (aCell + 0.1 + 0.8 * h.xy) * uKind.x, wxz = uCamXZ + rel;
  float shore, ground = lrGround(wxz, 1.0, shore), water = uSeaLevel - ground;
  vec4 benthic = textureLod(tBenthic, lrMapUV(wxz), 0.0), land = textureLod(tLand, lrMapUV(wxz), 0.0);
  // The kind's rule: how likely a cell like this holds a thing (0..1), from the ground and the maps.
  float keep = 0.0;
  ${rule}
  float edge = length(aCell) / uKind.y;
  // (Strictly more than the cell's draw: the hash comes out as exactly 0 for one cell in some hundreds, and
  // a rule that says "none here" must mean none.)
  vFade = keep > max(h.z, 1e-4) ? 1.0 - smoothstep(0.7, 1.0, edge) : 0.0;
  float size = mix(uSize.x, uSize.y, h.w) * smoothstep(0.0, 0.25, vFade);
  float turn = 6.2832 * h.x * 7.0;                          // which way it faces (radians from +x towards +z)
  vec3 p = position * size, colour = color, shift = vec3(0.0);
  float t = uTime, bend = aBend, kind = 0.0;
  vec3 nrm = normal;
  // The kind's own movement: p is the vertex (metres, about the thing's foot, before it is turned), 'shift'
  // moves the whole thing, 'turn' may be set.
  ${move}
  float ct = cos(turn), st = sin(turn);
  p = vec3(p.x * ct - p.z * st, p.y, p.x * st + p.z * ct) + shift;
  vN = vec3(nrm.x * ct - nrm.z * st, nrm.y, nrm.x * st + nrm.z * ct); vKind = kind;
  vRel = vec3(rel.x + p.x, ground + uSize.z + p.y, rel.y + p.z);
  vColor = colour;
  vLocal = vec4(position * size, aBend); vSeed = h.x * 61.0 + h.y * 17.0;
#ifdef LR_CASTER
  gl_Position = vFade > 0.0 ? lrShadowClip(vRel) : vec4(2.0, 2.0, 2.0, 1.0);
#else
  gl_Position = vFade > 0.0 ? projectionMatrix * viewMatrix * vec4(vRel.x, vRel.y - lrCurveDrop(vRel.xz), vRel.z, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
#endif
}`;

/** For a list of triangles' corners (9 numbers a triangle): at each corner, the mean of the facets that meet at that place. */
export function smoothNormals(pos) {
  const sum = new Map(), key = i => `${Math.round(pos[i] * 2000)},${Math.round(pos[i + 1] * 2000)},${Math.round(pos[i + 2] * 2000)}`, out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2], bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
    const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];              // (as long as the facet is large: large facets count for more)
    for (let c = 0; c < 9; c += 3) { const k = key(i + c), s = sum.get(k) || [0, 0, 0]; s[0] += n[0]; s[1] += n[1]; s[2] += n[2]; sum.set(k, s); }
  }
  for (let i = 0; i < pos.length; i += 3) { const s = sum.get(key(i)), l = Math.hypot(s[0], s[1], s[2]) || 1; out[i] = s[0] / l; out[i + 1] = s[1] / l; out[i + 2] = s[2] / l; }
  return out;
}

// What a thing's surface is, beyond its colour: lrSkin changes `albedo`, may give a height `bump` (metres, turned
// into a slope by the caller) and a `gloss`, and returns true where there is no surface at all (the holes of a
// sea fan's net). It works in the thing's own frame (vLocal: metres, before it sways or turns), so the pattern
// stays on the thing.
const skinGLSL = /* glsl */`
float lrCells(vec2 p) { vec2 i = floor(p), f = fract(p); float d = 9.0; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)), o = lrHash22(i + g); d = min(d, length(g + o - f)); } return d; }
// A fish's markings, by its kind and where on its body: t from its nose (0) to the root of its tail (1), v from
// its belly (-1) to its back (1), s which side (-1, 1); part: 1 body, 0.8 head, 0.6 tail fin, 0.4 other fins.
vec3 lrFish(float kind, float t, float v, float part, vec3 base, out float shine) {
  vec3 c = base; shine = 0.6;
  float scales = 0.9 + 0.1 * sin(t * 90.0) * sin(v * 26.0 + t * 45.0);
  if (kind < 0.5) {            // blue tang: deep blue all over, the fins edged brighter, a yellow spine at the root of the tail
    c = mix(vec3(0.03, 0.07, 0.42), vec3(0.08, 0.2, 0.62), 0.5 + 0.5 * v) * scales;
    if (part < 0.7) c = vec3(0.06, 0.16, 0.6);
    if (t > 0.88 && abs(v) < 0.25 && part > 0.7) c = vec3(0.8, 0.7, 0.1);
  } else if (kind < 1.5) {     // French grunt: yellow, with silver-blue lines along it above and slanting below
    float lines = v > -0.1 ? sin(v * 26.0) : sin((v - t * 1.6) * 22.0);
    c = mix(vec3(0.78, 0.62, 0.08), vec3(0.55, 0.66, 0.72), smoothstep(0.2, 0.6, lines));
    if (part < 0.7) c = vec3(0.75, 0.6, 0.08);
  } else if (kind < 2.5) {     // bluehead wrasse, as most of them are: yellow, with a dark stripe along the side
    c = mix(vec3(0.82, 0.7, 0.1), vec3(0.9, 0.86, 0.6), smoothstep(0.0, -0.8, v));
    c = mix(c, vec3(0.05, 0.05, 0.06), (1.0 - smoothstep(0.1, 0.22, abs(v - 0.1))) * step(0.08, t) * 0.85);
  } else if (kind < 3.5) {     // bluehead wrasse, the old male: a blue head, two black bars with pale between, a green body
    c = t < 0.3 ? vec3(0.04, 0.12, 0.5) : t < 0.36 ? vec3(0.03) : t < 0.44 ? vec3(0.6, 0.7, 0.75) : t < 0.5 ? vec3(0.03) : vec3(0.08, 0.42, 0.22) * scales;
  } else if (kind < 4.5) {     // yellowtail snapper: a yellow line from the snout that widens to a yellow tail; blue-grey above with yellow spots, pale below
    float line = 1.0 - smoothstep(0.0, 0.1 + 0.25 * t, abs(v - 0.12));
    c = mix(v > 0.1 ? vec3(0.3, 0.42, 0.55) : vec3(0.72, 0.72, 0.74), vec3(0.85, 0.7, 0.05), line);
    if (v > 0.25) c = mix(c, vec3(0.85, 0.7, 0.05), step(0.82, lrNoise(vec2(t * 46.0, v * 14.0))));
    if (part < 0.7) c = vec3(0.85, 0.7, 0.05);
  } else if (kind < 5.5) {     // sergeant major: five dark bars down a pale side, yellow over the back
    c = mix(vec3(0.7, 0.72, 0.7), vec3(0.8, 0.7, 0.12), smoothstep(0.1, 0.8, v));
    c = mix(c, vec3(0.04, 0.04, 0.05), step(0.55, sin(t * 26.0 - 1.2)) * step(0.14, t) * step(t, 0.96));
  } else if (kind < 6.5) {     // stoplight parrotfish, the old male: emerald, every scale edged, a yellow spot at the root of the tail, a pink band on the cheek
    c = vec3(0.05, 0.5, 0.42) * (0.75 + 0.25 * step(0.25, lrCells(vec2(t * 16.0, v * 5.0 + t * 8.0))));
    if (t < 0.25 && abs(v + 0.1 - t) < 0.08) c = vec3(0.8, 0.35, 0.4);
    if (t > 0.9 && abs(v) < 0.3) c = vec3(0.85, 0.75, 0.1);
    if (part < 0.7) c = part > 0.5 ? vec3(0.1, 0.5, 0.45) : vec3(0.3, 0.55, 0.5);
  } else if (kind < 7.5) {     // stoplight parrotfish, as the young and the females are: brown and white scales above, a red belly and fins
    c = mix(vec3(0.3, 0.2, 0.15), vec3(0.75, 0.72, 0.66), step(0.3, lrCells(vec2(t * 15.0, v * 5.0 + t * 7.5))));
    c = mix(c, vec3(0.62, 0.1, 0.08), smoothstep(-0.15, -0.55, v));
    if (part < 0.7) c = vec3(0.62, 0.12, 0.08);
  } else if (kind < 8.5) {     // queen parrotfish: blue-green, the scales edged, darker lines about the mouth
    c = vec3(0.08, 0.42, 0.55) * (0.7 + 0.3 * step(0.25, lrCells(vec2(t * 16.0, v * 5.0 + t * 8.0))));
    if (part < 0.7) c = vec3(0.1, 0.35, 0.6);
  } else if (kind < 9.5) {     // queen angelfish: blue-green scales edged with yellow, a yellow tail and breast fins, a dark crown ringed with blue
    c = mix(vec3(0.1, 0.35, 0.55), vec3(0.8, 0.68, 0.1), step(0.32, lrCells(vec2(t * 18.0, v * 7.0 + t * 9.0))));
    if (length(vec2((t - 0.2) * 3.0, v - 0.85)) < 0.2) c = vec3(0.02, 0.05, 0.3);
    if (part < 0.7) c = part > 0.5 ? vec3(0.9, 0.72, 0.08) : vec3(0.15, 0.3, 0.75);
  } else if (kind < 10.5) {    // foureye butterflyfish: pale, with thin dark chevrons; a black spot ringed with white by the tail; a black bar through the eye
    c = vec3(0.78, 0.76, 0.66) * (0.86 + 0.14 * step(0.0, sin((t + abs(v) * 0.35) * 70.0)));
    float spot = length(vec2((t - 0.78) * 2.2, v - 0.25));
    c = spot < 0.2 ? vec3(0.03) : spot < 0.27 ? vec3(0.95) : c;
    if (abs(t - 0.13 - 0.03 * v) < 0.03) c = vec3(0.04);
    if (part < 0.7) c = vec3(0.8, 0.7, 0.3);
  } else if (kind < 11.5) {    // squirrelfish: red, with pale lines along it; a large dark eye
    c = mix(vec3(0.7, 0.14, 0.1), vec3(0.85, 0.7, 0.62), smoothstep(0.3, 0.8, sin(v * 16.0)) * step(-0.6, v));
    if (part < 0.7) c = vec3(0.75, 0.3, 0.15);
  } else if (kind < 12.5) {    // striped parrotfish: pale, with two dark stripes along it
    c = mix(vec3(0.7, 0.7, 0.62), vec3(0.12, 0.1, 0.1), max(1.0 - smoothstep(0.08, 0.16, abs(v - 0.45)), 1.0 - smoothstep(0.08, 0.16, abs(v + 0.05))));
  } else if (kind < 13.5) {    // trumpetfish: brown, with pale lines along it and dark dots; some are all yellow (told by the caller's base)
    c = base * (0.8 + 0.2 * sin(v * 9.0)) * (1.0 - 0.5 * step(0.9, lrNoise(vec2(t * 60.0, v * 5.0))));
  } else if (kind < 14.5) {    // spotted trunkfish: pale, covered with dark spots
    c = mix(vec3(0.7, 0.7, 0.62), vec3(0.06), step(lrCells(vec2(t * 13.0, v * 5.0)), 0.3));
  } else if (kind < 15.5) {    // silverside: a silver stripe along a glassy green side
    c = mix(vec3(0.2, 0.24, 0.18), vec3(0.75, 0.78, 0.78), 1.0 - smoothstep(0.1, 0.3, abs(v))); shine = 1.5;
  } else if (kind < 16.5) {    // great barracuda: silver, darker over the back, with dark blotches low on the side towards the tail
    c = mix(vec3(0.62, 0.66, 0.66), vec3(0.2, 0.26, 0.26), smoothstep(0.1, 0.7, v));
    c = mix(c, vec3(0.08), step(0.86, lrNoise(vec2(t * 14.0, v * 3.0 + 4.0))) * step(0.45, t) * step(v, 0.0)); shine = 1.3;
  } else if (kind < 17.5) {    // horse-eye jack: silver, a yellow tail
    c = mix(vec3(0.7, 0.72, 0.72), vec3(0.3, 0.36, 0.4), smoothstep(0.2, 0.9, v)); if (part < 0.7 && part > 0.5) c = vec3(0.8, 0.65, 0.1); shine = 1.3;
  } else if (kind < 18.5) {    // bonefish: silver, with faint dark lines along the back
    c = mix(vec3(0.72, 0.74, 0.72), vec3(0.4, 0.46, 0.42), smoothstep(0.0, 0.9, v) * (0.7 + 0.3 * sin(v * 30.0))); shine = 1.4;
  } else if (kind < 19.5) {    // permit: silver, a dark back, a touch of yellow before the anal fin
    c = mix(vec3(0.75, 0.76, 0.74), vec3(0.2, 0.25, 0.3), smoothstep(0.3, 1.0, v)); if (t > 0.45 && t < 0.6 && v < -0.6) c = vec3(0.8, 0.6, 0.1); if (part < 0.7) c = vec3(0.12, 0.14, 0.16); shine = 1.3;
  } else if (kind < 20.5) {    // mullet: grey-silver, faint lines
    c = mix(vec3(0.66, 0.68, 0.66), vec3(0.3, 0.34, 0.32), smoothstep(0.0, 0.8, v)) * (0.92 + 0.08 * sin(v * 24.0)); shine = 1.2;
  } else if (kind < 21.5) {    // houndfish: green-blue over silver, long and thin
    c = mix(vec3(0.7, 0.74, 0.74), vec3(0.1, 0.32, 0.36), smoothstep(-0.1, 0.5, v)); shine = 1.4;
  } else if (kind < 22.5) {    // lionfish: red-brown and white bars
    c = mix(vec3(0.42, 0.12, 0.08), vec3(0.85, 0.8, 0.72), step(0.2, sin(t * 44.0)));
  } else if (kind < 23.5) {    // nurse shark: plain yellow-brown, paler below
    c = mix(vec3(0.5, 0.42, 0.3), vec3(0.34, 0.27, 0.18), smoothstep(-0.3, 0.6, v)); shine = 0.3;
  } else if (kind < 24.5) {    // lemon shark: yellow-grey, paler below
    c = mix(vec3(0.62, 0.6, 0.48), vec3(0.42, 0.4, 0.26), smoothstep(-0.3, 0.6, v)); shine = 0.3;
  } else if (kind < 25.5) {    // tarpon: large silver scales
    c = mix(vec3(0.74, 0.76, 0.76), vec3(0.28, 0.34, 0.36), smoothstep(0.4, 1.0, v)) * (0.8 + 0.2 * step(0.2, lrCells(vec2(t * 9.0, v * 3.0 + t * 4.5)))); shine = 1.6;
  } else {                     // porcupinefish: olive with dark spots, pale below
    c = mix(vec3(0.7, 0.68, 0.56), vec3(0.4, 0.36, 0.2), smoothstep(-0.3, 0.3, v)); c = mix(c, vec3(0.08), step(lrCells(vec2(t * 10.0, v * 4.0)), 0.22) * step(-0.2, v));
  }
  // (Pale below, as nearly every fish is; and its eye: dark, ringed with pale, a tenth of the way along.)
  c *= 0.85 + 0.15 * smoothstep(-1.0, 0.2, v);
  if (part > 0.7) { float eye = length(vec2((t - 0.12) * uBody.x / (uBody.y * 0.5), v - 0.28)); c = eye < 0.13 ? vec3(0.02) : eye < 0.2 ? vec3(0.7, 0.66, 0.5) : c; }
  return c;
}
bool lrSkin(inout vec3 albedo, out float bump, inout float gloss) {
  bump = 0.0;
  vec3 q = vLocal.xyz;
  float fine = 1.0 - smoothstep(0.003, 0.03, length(fwidth(vRel))), kind = uSkin.x;
  if (kind < 1.5) {
    // Brain coral: ridges that wander and never cross, a finger's breadth apart, dark in the valleys between.
    vec2 uv = vec2(atan(q.z, q.x) * 0.32, q.y * 2.6 + length(q.xz) * 0.9) * 9.0 + vSeed;
    float w = lrNoise(uv * 0.35) * 6.0, ridges = sin(uv.x * 2.4 + 2.2 * sin(uv.y * 1.3 + w) + w);
    albedo *= 0.55 + 0.5 * smoothstep(-0.6, 0.6, ridges) * fine + 0.25 * (1.0 - fine);
    bump = 0.004 * ridges * fine * uSkin.y;
  } else if (kind < 2.5) {
    // Star coral: the cups of its polyps, close together, each a dimple with a pale rim.
    vec2 uv = vec2(atan(q.z, q.x) * 0.5, q.y * 2.2 + length(q.xz)) * 26.0 + vSeed;
    float d = lrCells(uv);
    albedo *= 0.7 + 0.4 * smoothstep(0.15, 0.45, d) * fine + 0.2 * (1.0 - fine);
    bump = 0.0025 * smoothstep(0.1, 0.5, d) * fine * uSkin.y;
  } else if (kind < 3.5) {
    // Branching coral (elkhorn, staghorn): rough with small cups, paler at the growing edges (the shape's own colour says where).
    albedo *= 0.8 + 0.25 * lrNoise(q.xz * 160.0 + q.y * 90.0) * fine;
    bump = 0.0015 * lrNoise(q.xy * 220.0 + q.z * 130.0) * fine * uSkin.y;
  } else if (kind < 4.5) {
    // A sea fan: a net. Between its ribs and their cross-threads it is holes.
    vec2 uv = vec2(atan(q.x, q.y - 0.02 * 1.0) * 14.0, length(q.xy) * 60.0);
    float net = min(abs(fract(uv.x + 0.25 * sin(uv.y * 0.7)) - 0.5), abs(fract(uv.y) - 0.5));
    if (fine > 0.3 && net > 0.2 + 0.25 * (1.0 - fine) && vLocal.w > 0.06) return true;
    albedo *= 0.85 + 0.3 * lrNoise(q.xy * 40.0);
  } else if (kind < 5.5) {
    // A sponge: pitted, soft.
    float d = lrCells(vec2(atan(q.z, q.x) * 1.6, q.y * 7.0) * 9.0 + vSeed);
    albedo *= 0.7 + 0.4 * smoothstep(0.1, 0.4, d) * fine + 0.2 * (1.0 - fine);
  } else if (kind < 6.5) {
    // A fish: its kind's markings, where on its body this is.
    // (The shape carries, at each place: which part it is, how far along the body, how far up its side.)
    float shine;
    albedo = lrFish(vKind, vColor.g, vColor.b * 2.0 - 1.0, vColor.r, uLook.w > 0.0 ? vec3(0.8, 0.66, 0.1) : vec3(0.42, 0.3, 0.2), shine);
    gloss = shine;
  } else if (kind < 7.5) {
    // A soft coral (sea rod, sea plume): furred with its polyps.
    albedo *= 0.75 + 0.5 * lrNoise(q.xy * 300.0 + q.z * 170.0) * fine;
  } else {
    albedo *= 0.9;
  }
  return false;
}`;

const fragmentShader = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
#include <lr_caustics>
${shadowGLSL}
uniform vec4 uLook;           // x = 1: lit from both sides (leaves, blades); y = gloss; z = how much light comes through; w = leaf size, m (0: not foliage)
uniform vec4 uSkin;           // x: what its surface is (0 plain; 1 brain coral; 2 star coral; 3 branching coral; 4 a sea fan's net; 5 sponge; 6 a fish; 7 a soft coral's polyps; 8 an urchin), y: how bumpy
uniform vec4 uBody;
in vec3 vN;
in float vKind;
in vec3 vRel;
in vec3 vColor;
in float vFade;
in vec4 vLocal;
in float vSeed;
layout(location = 0) out vec4 outColor;
${skinGLSL}
void main() {
  // (Its own way out where the shape says one, so that a coral head is round and not a cut stone; from its facets otherwise.)
  vec3 flatN = normalize(cross(dFdx(vRel), dFdy(vRel)));
  vec3 n = dot(vN, vN) > 0.25 ? normalize(vN) : flatN;
  vec3 toEye = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  if (dot(n, toEye) < 0.0) n = -n;
  float water = uSeaLevel - vRel.y;
  vec3 albedo = vColor;
  // What its surface is: a coral's grooves or cups, the holes of a sea fan's net, a fish's markings.
  float bump = 0.0, gloss = uLook.y;
  if (uSkin.x > 0.5) { if (lrSkin(albedo, bump, gloss)) discard; }
  if (bump != 0.0) {
    // (Its height made into a slope. Edge-on to the eye there is no slope to be had from the picture: the surface is left as it is there. Without that it was not a number, and the picture's glow spread it in white clouds.)
    vec3 dpdx = dFdx(vRel), dpdy = dFdy(vRel), r1 = cross(dpdy, n), r2 = cross(n, dpdx);
    float det = dot(dpdx, r1);
    vec3 tilted = abs(det) * n - sign(det) * (dFdx(bump) * r1 + dFdy(bump) * r2);
    if (abs(det) > 1e-10 && dot(tilted, tilted) > 1e-20) n = normalize(mix(n * length(tilted), tilted, smoothstep(0.05, 0.3, abs(dot(n, toEye)))));
  }
  float facing = dot(n, uSunDir);
  if (uLook.w > 0.0) {
    if (vLocal.w > 0.32) {
      // Foliage: a mass of leaves, in clumps a little lighter or darker than their neighbours, ragged where
      // the crown turns away from the eye (leaf-sized pieces are missing there). The pattern rides on the
      // plant, so it sways with it. (Smooth noise on three planes: cells of a grid showed as squares.)
      vec3 q = vLocal.xyz / uLook.w + vSeed;
      float clumps = lrNoise(q.xy) + lrNoise(q.yz + 17.3) + lrNoise(q.zx + 31.7);
      float leaves = lrNoise(q.xy * 2.9 + 5.0) + lrNoise(q.yz * 2.9 + 9.0) + lrNoise(q.zx * 2.9 + 13.0);
      float leafy = (clumps + 0.6 * leaves) / 4.8;
      if (leafy > 0.4 + 0.75 * abs(dot(n, toEye))) discard;
      albedo *= 0.5 + leafy;
    } else {
      // Bark: streaked along the limb, blotched.
      albedo *= 0.75 + 0.5 * lrNoise(vec2(atan(vLocal.z, vLocal.x) * 5.0 + vSeed, vLocal.y * 9.0)) * lrNoise(vLocal.xz * 40.0 + vLocal.y * 3.0);
    }
  }
  // Thin things (blades, leaves, fins) glow when the sun is behind them.
  float sun = mix(lrSaturate(facing), 0.35 + 0.65 * abs(facing), uLook.x) + uLook.z * lrSaturate(-facing);
  // Under water the sunlight has come down through 'water' metres of sea, and the waves over it have gathered
  // it into the same dancing net that lies on the sand beside it.
  vec3 open = max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4));
  if (water > 0.02 && vFade > 0.2) sun *= lrCausticsHere(vRel.xz, water);
  vec3 light = uSunE * sun * lrSunThrough(lrCloudShadow(uCamXZ + vRel.xz), vRel, n) + uSkyE * (0.55 + 0.45 * n.y) + open * 0.12 * (0.5 - 0.5 * n.y);
  if (water > 0.0) outColor = vec4(albedo * light / open, water);
  else outColor = vec4(albedo * light / PI + gloss * uSunE * pow(lrSaturate(dot(reflect(-toEye, n), uSunDir)), 60.0) * 0.05, -1000.0);
}`;

/**
 * @param {object} o
 * @param {THREE.BufferGeometry} o.geometry  position, color, and optionally aBend (0..1)
 * @param {number} o.cell  metres between things   @param {number} o.grid  cells across the lattice (even)
 * @param {string} o.rule  GLSL setting `keep` (0..1) from wxz, ground, water, shore, benthic, land, h (hashes), vWeights-free
 * @param {string} [o.move]  GLSL changing p, colour (uses t, bend, h, water, size, wxz)
 * @param {[number, number]} [o.size]  scale range   @param {number} [o.lift]  metres above the ground
 * @param {number} [o.seed]   @param {object} [o.look]  { twoSided, gloss, through, leaf: size of a leaf in metres (foliage and bark) }
 * @param {boolean} [o.casts]  casts a shadow
 * @param {object} textures  { benthic, land }   @param {number} shadowTaps
 */
export class Scatter {
  constructor({ geometry, cell, grid, rule, move = '', size = [1, 1], lift = 0, seed = 1, sway = 0, look = {}, casts = false, skin = 0, bumpy = 0, body = [1, 1, 1, 1] }, textures, shadowTaps = 4) {
    this.cell = cell; this.grid = grid;
    const g = new THREE.InstancedBufferGeometry();
    g.index = geometry.index;
    for (const name of Object.keys(geometry.attributes)) g.setAttribute(name, geometry.attributes[name]);
    if (!g.attributes.aBend) g.setAttribute('aBend', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    // (A shape without normals of its own is shaded by its facets: the fragment shader sees a normal of nought.)
    if (!g.attributes.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    const cells = new Float32Array(grid * grid * 2);
    for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) { cells[(j * grid + i) * 2] = i - grid / 2; cells[(j * grid + i) * 2 + 1] = j - grid / 2; }
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    g.instanceCount = grid * grid;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: vertexShader(rule, move), fragmentShader, vertexColors: true, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...WAVE_UNIFORMS, 'uWaveHere', ...CHUNK_UNIFORMS.cloudShadow, ...CHUNK_UNIFORMS.shadow], {
        tBenthic: { value: textures.benthic }, tLand: { value: textures.land },
        uLattice: { value: new THREE.Vector4() }, uKind: { value: new THREE.Vector4(cell, grid / 2, seed * 13.7, sway) },
        uSize: { value: new THREE.Vector4(size[0], size[1], lift, 0) }, uLook: { value: new THREE.Vector4(look.twoSided ? 1 : 0, look.gloss || 0, look.through || 0, look.leaf || 0) },
        uSkin: { value: new THREE.Vector4(skin, bumpy, 0, 0) }, uBody: { value: new THREE.Vector4(...body) }, uYou: YOU,
      }),
    });
    /** The same thing drawn into the shadow map (same vertex shader, so shadows sway with what casts them), or null. */
    this.caster = casts ? new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: vertexShader(rule, move), fragmentShader: casterFragment, vertexColors: true, side: THREE.DoubleSide, defines: { LR_CASTER: 1 },
      uniforms: { ...uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...WAVE_UNIFORMS, ...CASTER_UNIFORMS]),
        tBenthic: this.material.uniforms.tBenthic, tLand: this.material.uniforms.tLand, uLattice: this.material.uniforms.uLattice, uKind: this.material.uniforms.uKind, uSize: this.material.uniforms.uSize, uYou: YOU, uBody: this.material.uniforms.uBody },
    }) : null;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
    /** Things further than this from the eye are not drawn (metres). */
    this.reach = cell * grid / 2;
  }

  /** @param {{x: number, y: number, z: number}} eye */
  update(eye) {
    const c = this.cell, i = Math.floor(eye.x / c), j = Math.floor(eye.z / c), wrap = v => ((v % 4096) + 4096) % 4096;
    this.material.uniforms.uLattice.value.set(wrap(i), wrap(j), i * c - eye.x, j * c - eye.z);
    // (From high up there is nothing this small to see.)
    this.mesh.visible = eye.y < this.reach * 1.5 + 30;
  }
}

/** Where you are, for whatever lives here and minds you (one for all the kinds): x, z relative to the camera, your eye's height, 1 if you are in the water. app.js sets it. */
export const YOU = { value: new THREE.Vector4(0, 0, 0, 0) };

/** Collects triangles with a colour and a "bend" per vertex; a small sibling of landmarks.js's MeshBuilder. */
export class Shape {
  constructor() { this.pos = []; this.col = []; this.bend = []; }
  tri(a, b, c, color, bends = [0, 0, 0]) { this.pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) { this.col.push(...(Array.isArray(color[0]) ? color[i] : color)); this.bend.push(bends[i]); } }
  quad(a, b, c, d, color, bends = [0, 0, 0, 0]) {
    const col = Array.isArray(color[0]) ? color : [color, color, color, color];
    this.tri(a, b, c, [col[0], col[1], col[2]], [bends[0], bends[1], bends[2]]); this.tri(a, c, d, [col[0], col[2], col[3]], [bends[0], bends[2], bends[3]]);
  }
  /** A squashed ball: rings of quads. `colour(u, v)` may vary over it (u round, v bottom to top, both 0..1). */
  ball(cx, cy, cz, rx, ry, rz, rings, sides, colour, bend = 0, from = 0, to = 1) {
    const at = (u, v) => { const a = u * 2 * Math.PI, b = (v - 0.5) * Math.PI; return [cx + Math.cos(a) * Math.cos(b) * rx, cy + Math.sin(b) * ry, cz + Math.sin(a) * Math.cos(b) * rz]; };
    const col = typeof colour === 'function' ? colour : () => colour;
    for (let r = 0; r < rings; r++) for (let s = 0; s < sides; s++) {
      const u0 = s / sides, u1 = (s + 1) / sides, v0 = from + (to - from) * r / rings, v1 = from + (to - from) * (r + 1) / rings;
      this.quad(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), [col(u0, v0), col(u1, v0), col(u1, v1), col(u0, v1)], [bend, bend, bend, bend]);
    }
  }
  /** A tube along a list of points with a radius at each; bends per point optional. */
  tube(points, radii, sides, color, bends = null) {
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k], b = points[k + 1], dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...dir) || 1;
      const up = Math.abs(dir[1] / len) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = [dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]], ul = Math.hypot(...u) || 1;
      const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]], vl = Math.hypot(...v) || 1;
      const ring = (p, r, s) => { const t = s / sides * 2 * Math.PI, c = Math.cos(t) * r, d = Math.sin(t) * r; return [p[0] + u[0] / ul * c + v[0] / vl * d, p[1] + u[1] / ul * c + v[1] / vl * d, p[2] + u[2] / ul * c + v[2] / vl * d]; };
      const b0 = bends ? bends[k] : 0, b1 = bends ? bends[k + 1] : 0;
      for (let s = 0; s < sides; s++) this.quad(ring(a, radii[k], s), ring(a, radii[k], s + 1), ring(b, radii[k + 1], s + 1), ring(b, radii[k + 1], s), color, [b0, b0, b1, b1]);
    }
  }
  /** @param {boolean} smooth  give every vertex the mean of the facets that meet at its place (a round thing shaded as round) */
  geometry(smooth = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBend', new THREE.Float32BufferAttribute(this.bend, 1));
    if (smooth) g.setAttribute('normal', new THREE.Float32BufferAttribute(smoothNormals(this.pos), 3));
    return g;
  }
}
