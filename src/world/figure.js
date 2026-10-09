// Your body: a real human model (web/data/body, built by pipeline/body/build.mjs from MakeHuman's open body),
// in place of the figure of tubes (bodyshape.js), which stays for the simplest tier and as the fallback when
// these files cannot be loaded.
//
// The mesh is skinned here, not by three: every vertex names up to four bones and how much each moves it, and
// the bones' matrices come in a small float texture (three texels a bone: the rows of a 3 x 4 matrix that takes
// a point of the body at rest to where that bone has carried it). The same few lines of GLSL skin it for the
// picture and for the shadow maps.
//
// Frame, as for the tubes: +x right, +y up, forward -z, metres; the point between the eyes is above the origin
// and the feet are on y = 0. The camera sits between the eyes, inside the head, which is why the head is never
// seen: only the outside of the skin is drawn.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { CASTER_UNIFORMS, casterFragment, casterGLSL, shadowGLSL } from './shadow.js';
import { DATA_ROOT } from '../config.js';

const TYPES = { Float32Array, Int8Array, Uint8Array, Uint16Array, Uint32Array };

/** GLSL: the skinning matrix of this vertex (needs aJoints, aWeights, tBones). */
export const skinningGLSL = /* glsl */`
uniform highp sampler2D tBones;
in vec4 aJoints;
in vec4 aWeights;
mat4 lrBone(float i) {
  int b = int(i + 0.5) * 3;
  vec4 r0 = texelFetch(tBones, ivec2(b, 0), 0), r1 = texelFetch(tBones, ivec2(b + 1, 0), 0), r2 = texelFetch(tBones, ivec2(b + 2, 0), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 lrSkin() { return lrBone(aJoints.x) * aWeights.x + lrBone(aJoints.y) * aWeights.y + lrBone(aJoints.z) * aWeights.z + lrBone(aJoints.w) * aWeights.w; }
`;

const vertexShader = /* glsl */`
#include <lr_common>
${skinningGLSL}
in float aCloth;
in float aThin;
in float aPart;
out float vPart;
out vec3 vRel;
out vec3 vNormal;
out vec3 vRest;         // the point on the body at rest (patterns that must stay on the skin are drawn in this)
out float vUp;          // how high the point is above her feet as she is posed (metres)
out vec2 vUv;
out float vCloth;
out float vThin;
out vec3 vRestN;        // and which way the skin faces there, at rest
void main() {
  mat4 skin = lrSkin();
  vec4 posed = skin * vec4(position, 1.0), wp = modelMatrix * posed;
  vUp = posed.y;
  vNormal = mat3(modelMatrix) * (mat3(skin) * normal);
  vRel = wp.xyz; vRest = position; vRestN = normal; vUv = uv; vCloth = aCloth; vThin = aThin; vPart = aPart;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - lrCurveDrop(wp.xz), wp.z, 1.0);
}`;

const fragmentShader = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
${shadowGLSL}
uniform sampler2D tSkin;
uniform vec3 uTone;         // what the skin's own colour is multiplied by: her tan
uniform vec3 uClothColour;
uniform sampler2D tSkinState;  // over the body's surface: r = how wet, g = how much sand is on it (sim/skin.js)
uniform float uWaterY;      // the height of the sea's surface where you stand (far below you when you are not in it)
uniform float uShowUnder;   // 1 = hand what is under water to the water pass (0 when the camera is under water itself)
uniform float uShowHead;    // how much of the head is drawn: 0 none (you look out of it) .. 1 all of it (you are being looked at from outside)
// (Until the skin has a map of its own for what is on it: wet as far up as the sea has stood round you, the hand
// that went into it, sand on wet feet and on the hand. The same numbers the figure of tubes shows.)
uniform vec4 uBodyWet;      // wet up to this height (x) by this much (y, drying); and to z by w: the water you stand in now
uniform float uBodySand;    // sand stuck to your feet, 0..1
uniform vec4 uHandWet;      // the hand that touched: where it is (x, z relative to the camera, y absolute) and how wet
uniform float uHandSand;    // and how much sand is on it
uniform vec4 uHandWetL;     // the same for your left hand
uniform float uHandSandL;
in float vUp;
in vec3 vRel;
in vec3 vNormal;
in vec3 vRest;
in vec2 vUv;
in float vCloth;
in vec3 vRestN;
uniform vec4 uCloth;        // the bikini's measures on her: the crotch's height, where front meets back (z), the underbust's height, the base of the neck's
uniform vec3 uApex[2];      // the point of each breast
float lrFromLine(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a, ap = p - a; return length(ap - ab * clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0)); }
// Where the bikini lies, worked out at every point of the skin at rest: metres inside its edge (pipeline/body/
// build.mjs has the same shape, vertex by vertex: that one only says roughly where to look, because a line
// drawn from vertex to vertex has the mesh's corners in it).
float lrCloth(vec3 p, vec3 n) {
  // The bottom: a band low on the hips; the leg openings rise from the crotch to the hip bones, higher in front.
  float back = smoothstep(uCloth.y - 0.03, uCloth.y + 0.03, p.z);
  float f = min(uCloth.x + 0.165 - p.y, p.y - (uCloth.x + 0.012 + mix(1.02, 0.72, back) * max(abs(p.x) - mix(0.028, 0.04, back), 0.0)));
  if (p.y < uCloth.x + 0.22) return f;
  // The top: a cup over each breast, a band under the bust all the way round, straps up to the back of the neck.
  for (int i = 0; i < 2; i++) {
    vec3 a = uApex[i], d = p - a;
    float side = sign(a.x);
    float cup = n.z < 0.35 ? min(0.074 - length(d * vec3(1.02, 0.92, 0.6)), 0.058 - 0.74 * abs(d.x - 0.006 * side) - 0.5 * d.y) : -1.0;
    float strap = n.z < 0.5 && p.y > a.y ? 0.0065 - lrFromLine(p.xy, vec2(a.x + 0.006 * side, a.y + 0.07), vec2(0.052 * side, uCloth.w + 0.03)) : -1.0;
    f = max(f, max(cup, strap));
  }
  return max(f, max(0.0065 - abs(p.y - uCloth.z), n.z > 0.3 && abs(p.x) < 0.07 ? 0.0065 - abs(p.y - (uCloth.w + 0.035)) : -1.0));
}
in float vThin;
in float vPart;
layout(location = 0) out vec4 outColor;
void main() {
  // (The head is not drawn: you look out of it. It is still there for the shadow. As the camera leaves her eyes
  // for the place behind her it comes in grain by grain, between a hand's breadth and a forearm's length off.)
  if (vPart > 0.001 && uShowHead < 0.02 + 0.96 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
  // (Nothing of you is drawn nearer your eye than a hand's breadth: you cannot focus there, and the picture's
  // near edge would cut it open. It thins out over the last two centimetres.)
  if (uShowHead < 0.5 && distance(vRel, vec3(0.0, uCamY, 0.0)) < 0.055 + 0.025 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
  vec3 n = normalize(vNormal), V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  // The grain of the skin, seen from near: it breaks up the sheen (a hand at arm's length; it fades with distance).
  // (Only where a pixel is much smaller than the grain: nearer the limit it showed as stubble.)
  float fine = 1.0 - smoothstep(0.00012, 0.0004, length(fwidth(vRel)));
  vec3 pores = vec3(lrNoise(vRest.xy * 1100.0 + vRest.z * 500.0), lrNoise(vRest.yz * 1100.0 + vRest.x * 500.0 + 5.0), lrNoise(vRest.zx * 1100.0 + vRest.y * 500.0 + 9.0)) - 0.5;
  n = normalize(n + fine * 0.07 * pores);
  float cloud = lrCloudShadow(uCamXZ + vRel.xz), nl = dot(n, uSunDir);
  // (A round limb turns away from the sun gradually; where its skin is nearly edge-on to the light the shadow
  // map cannot tell lit from self-shadowed: there the turning away alone does the darkening.)
  float sun = mix(cloud, lrSunThrough(cloud, vRel, n), smoothstep(0.05, 0.45, nl));
  vec3 skin = pow(texture(tSkin, vUv).rgb, vec3(2.2)) * uTone;
  skin = mix(vec3(dot(skin, vec3(0.3, 0.59, 0.11))), skin, 0.9);
  // (The picture of the skin has flushed knees and elbows, which on a tanned body in the sun read as sunburn:
  // red is held to what the rest of the skin has of it.)
  skin.r = min(skin.r, mix(skin.r, skin.g * 1.9, 0.8));
  // The bikini: where the field is positive. Its edge is a line a pixel wide however near you look; the skin
  // beside it is a little shaded by it, and the cloth has a weave.
  // (Looked for only where the vertices say it is near: not on the arms that hang beside it.)
  // (How wide a pixel is, in the field's own terms, is taken from the field itself and held to a centimetre:
  // taken after the vertices' say-so it leapt wherever that changed, and a pixel there came out half cloth: thin
  // dashed red lines across her stomach, along the edges of the mesh.)
  float around = lrCloth(vRest, vRestN), field = vCloth > -0.019 ? around : -1.0;
  float edge = min(fwidth(around), 0.01) + 1e-5, cloth = smoothstep(-edge, edge, field), hem = 1.0 - smoothstep(0.0, 0.004, abs(field));
  // (The weave is two and a half millimetres from thread to thread: seen from further off than a pixel can
  // show that, or at a slant, it is left out. Drawn regardless it made rings and stripes across the cloth.)
  float thread = 1.0 - smoothstep(0.0005, 0.0012, max(fwidth(vRest.x), fwidth(vRest.y)));
  float weave = 0.9 + 0.1 * thread * sin(vRest.x * 2600.0) * sin(vRest.y * 2600.0) + 0.06 * (lrNoise(vRest.xy * 400.0 + vRest.z * 300.0) - 0.5);
  // (The skin beside the edge is a little shaded by it, for a few millimetres; the cloth is darker along its hem.)
  vec3 albedo = mix(skin * 0.75 * (1.0 - 0.22 * hem), uClothColour * weave * 0.82 * (1.0 - 0.12 * hem), cloth);
  float nearHand = distance(vRel, uHandWet.xyz), nearLeft = distance(vRel, uHandWetL.xyz);
  float soaked = max(uBodyWet.y * (1.0 - smoothstep(uBodyWet.x - 0.04, uBodyWet.x + 0.015, vRel.y)), uBodyWet.w * (1.0 - smoothstep(uBodyWet.z - 0.03, uBodyWet.z + 0.01, vRel.y)));
  soaked = max(soaked, max(uHandWet.w * (1.0 - smoothstep(0.17, 0.24, nearHand)), uHandWetL.w * (1.0 - smoothstep(0.17, 0.24, nearLeft))));
  // (And what this very point of skin has been in: under the sea, on the sand.)
  vec2 state = texture(tSkinState, vUv).rg;
  soaked = max(soaked, state.r);
  // (Grains: the body at rest cut into cubes two thirds of a millimetre across, each with a grain in it or not,
  // so that they are specks whichever way the skin faces. Smoothed noise drew a web of cracks; squares seen from
  // one side, dashes.)
  vec3 cube = floor(vRest * 1500.0);
  float grains = lrHash12(cube.xy + cube.z * vec2(37.0, 17.0) + 3.0);
  float line = 0.02 + 0.05 * uBodySand * (0.4 + lrNoise(vRest.xz * 70.0));
  float stuck = max(step(1.0 - 0.7 * uBodySand * (1.0 - smoothstep(0.4 * line, line, vUp)), grains), max(step(1.0 - 0.32 * uHandSand * (1.0 - smoothstep(0.085, 0.125, nearHand)), grains), step(1.0 - 0.32 * uHandSandL * (1.0 - smoothstep(0.085, 0.125, nearLeft)), grains))) * (1.0 - cloth);
  stuck = max(stuck, step(1.0 - 0.8 * state.g, grains) * (1.0 - 0.6 * cloth));
  // (Wet cloth goes much darker; wet skin a little, and it shines. Sand on it does not.)
  albedo *= 1.0 - soaked * mix(0.12, 0.34, cloth);
  albedo = mix(albedo, vec3(0.66, 0.62, 0.54) * (0.75 + 0.5 * lrHash12(cube.xy + cube.z * vec2(11.0, 29.0) + 19.0)), stuck);
  soaked *= 1.0 - stuck;
  // Skin is not a hard surface: light spreads a little under it. The lit side wraps round further than a
  // plaster cast's would, and the edge of the shade is warm.
  float wrap = lrSaturate((nl + 0.3) / 1.3), soft = mix(wrap * wrap, lrSaturate(nl), cloth);
  vec3 bleed = vec3(0.5, 0.12, 0.05) * smoothstep(-0.3, 0.05, nl) * (1.0 - smoothstep(0.05, 0.5, nl)) * (1.0 - cloth);
  // The sand lights the body from below: pale coral sand sends back six tenths of what falls on it, so what
  // faces down over a sunlit beach is lit nearly half as brightly as what faces up. (It was a third of this:
  // an arm's underside was black.) Less low down, where your own shadow lies on the sand under you.
  // And a beach is bright all round: what is in shade and faces up, with only the blue sky to light it, still
  // gets a sixth of that from the sand beyond and from your own lit skin. (Without it the shade of your
  // trunk on your thighs was black: tanned skin gives little back of blue light.)
  vec3 bounce = (uSunE * lrSaturate(uSunDir.y) * cloud + 0.8 * uSkyE) * vec3(0.6, 0.55, 0.47) * (0.17 + 0.83 * (0.5 - 0.5 * n.y)) * (0.5 + 0.3 * smoothstep(0.1, 0.9, vUp));
  vec3 light = uSunE * sun * (soft + 0.12 * bleed) + uSkyE * (0.5 + 0.5 * n.y) + bounce;
  // Light through the thin parts (fingers, toes, the edge of the hand) when the sun is behind them.
  float through = (1.0 - smoothstep(0.006, 0.02, vThin)) * lrSaturate(-nl) * lrSaturate(dot(V, -uSunDir) * 0.5 + 0.5) * (1.0 - cloth);
  light += uSunE * cloud * through * vec3(0.55, 0.14, 0.07);
  vec3 col = albedo * light / PI;
  // The sheen of skin: broad and faint.
  vec3 h = normalize(uSunDir + V);
  float fresnel = 0.028 + 0.972 * pow(1.0 - lrSaturate(dot(n, V)), 5.0);
  col += uSunE * sun * lrSaturate(nl) * (0.35 * pow(lrSaturate(dot(n, h)), 28.0) + 0.9 * pow(lrSaturate(dot(n, h)), 140.0)) * 0.06 * (1.0 - 0.6 * cloth) * (1.0 - stuck) + fresnel * uSkyE / PI * (0.25 + 0.75 * soaked) * (1.0 - cloth) * (1.0 - stuck);
  col += uSunE * sun * lrSaturate(nl) * soaked * (1.0 - cloth) * 0.5 * pow(lrSaturate(dot(n, h)), 400.0);
  // Where skin cuts the surface the water climbs it: a bright thread, the one sure sign of where the surface is.
  float below = uWaterY - vRel.y;
  col += (1.0 - smoothstep(0.0, 0.007, abs(below))) * (uSkyE + 0.25 * uSunE * lrSaturate(uSunDir.y)) / PI * 0.22;
  // What of you is under water is handed on as the seabed is: what it gives back of the light that falls on
  // it, and how deep it lies. The water (water.js) then does with your legs what it does with the sand beside
  // them: bends the view of them at the surface, colours them by the depth of water over them, and lays its
  // own glitter across them. (Drawn as lit skin, like the rest of you, the water simply painted over them:
  // below the knee your legs were gone.)
  if (below > 0.0 && uShowUnder > 0.5) { outColor = vec4(col * PI / max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4)), below); return; }
  outColor = vec4(col, -1000.0);
}`;

const casterVertex = /* glsl */`
#include <lr_common>
${casterGLSL}
${skinningGLSL}
void main() {
  vec4 wp = modelMatrix * (lrSkin() * vec4(position, 1.0));
  gl_Position = lrShadowClip(wp.xyz);
}`;

/** Fetches the body's files. `gzip`: the published site ships body.bin gzipped as a plain file. */
export async function loadFigure(gzip = false) {
  const url = file => new URL(`${DATA_ROOT}body/${file}`, document.baseURI).href;
  const info = await (await fetch(url('body.json'))).json();
  let res = await fetch(url(`body.bin${gzip ? '.gz' : ''}`));
  if (!res.ok) throw new Error(`body.bin: ${res.status}`);
  if (gzip) res = new Response(res.body.pipeThrough(new DecompressionStream('gzip')));
  const buffer = await res.arrayBuffer(), arrays = {};
  for (const [name, part] of Object.entries(info.layout)) arrays[name] = new TYPES[part.type](buffer, part.offset, part.count);
  const texture = await new THREE.TextureLoader().loadAsync(url(info.skin));
  Object.assign(texture, { colorSpace: THREE.NoColorSpace, anisotropy: 8, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  return { info, arrays, texture };
}

/** A map that says dry and clean everywhere, until there is a real one. */
function blank() { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; }

/** The bikini's measures on this body (as pipeline/body/build.mjs takes them): uniforms for lrCloth. */
function bikini(info, position) {
  const bone = name => info.bones.find(b => b.name === name), apex = [bone('breast.L').tail, bone('breast.R').tail];
  // (The crotch: the lowest skin on the middle line between her knees and her navel.)
  let crotch = Infinity;
  for (let i = 0; i < position.length; i += 3) if (Math.abs(position[i]) < 0.012 && position[i + 1] > 0.3 * info.height && position[i + 1] < 0.7 * info.height) crotch = Math.min(crotch, position[i + 1]);
  return {
    uCloth: { value: new THREE.Vector4(crotch, (bone('upperleg01.L').head[2] + bone('upperleg01.R').head[2]) / 2, Math.min(apex[0][1], apex[1][1]) - 0.062, bone('neck01').head[1]) },
    uApex: { value: apex.map(a => new THREE.Vector3(a[0], a[1], a[2])) },
  };
}

/** Her hair, in the body's frame at rest (the eye at height `eye`, forward -z): a cap over the skull and a tail from the back of the crown. */
function hairGeometry(eye) {
  const parts = [], put = (centre, radii, tilt = 0, shape = null) => {
    const g = new THREE.SphereGeometry(1, 20, 14), p = g.attributes.position, c = Math.cos(tilt), s = Math.sin(tilt);
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) * radii[0], y = p.getY(i) * radii[1], z = p.getZ(i) * radii[2];
      if (shape) [x, y, z] = shape(x, y, z, p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, centre[0] + x, centre[1] + y * c - z * s, centre[2] + y * s + z * c);
    }
    g.computeVertexNormals(); parts.push(g);
  };
  // The cap: the skull is 16 cm wide, 19 cm front to back, its top 10.5 cm over the eye. In front it stops at
  // the hairline (what would cover the face is tucked inside the head).
  put([0, eye + 0.036, 0.07], [0.089, 0.079, 0.102], 0, (x, y, z, ux, uy, uz) => (uz < -0.25 && uy < 0.55 ? [x * 0.7, y * 0.7, z * 0.7] : [x, y, z]));
  // Where it is tied, and the tail hanging from there to the base of the neck.
  put([0, eye + 0.062, 0.166], [0.03, 0.03, 0.028]);
  put([0, eye - 0.03, 0.2], [0.036, 0.098, 0.032], -0.2);
  const tailCount = parts[2].attributes.position.count;
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0), position = new Float32Array(n * 3), normal = new Float32Array(n * 3), index = [];
  let o = 0;
  for (const g of parts) { position.set(g.attributes.position.array, o * 3); normal.set(g.attributes.normal.array, o * 3); for (const i of g.index.array) index.push(i + o); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage)); out.setAttribute('normal', new THREE.BufferAttribute(normal, 3)); out.setIndex(index);
  // (The tail: its vertices, where they hang at rest, and how far down it each is, 0 where it is tied .. 1 at its end.)
  const first = n - tailCount, top = eye + 0.066, hang = new Float32Array(tailCount);
  for (let i = 0; i < tailCount; i++) hang[i] = Math.min(1, Math.max(0, (top - position[(first + i) * 3 + 1]) / 0.19));
  out.userData.tail = { first, count: tailCount, rest: position.slice(first * 3), hang, length: 0.19 };
  return out;
}

export class Figure {
  /**
   * @param {{info: object, arrays: object, texture: THREE.Texture}} data  from loadFigure()
   * @param {number} shadowTaps
   * @param {object} state  uniforms to share for what is on the skin (uBodyWet, uBodySand, uHandWet, uHandSand)
   */
  constructor({ info, arrays, texture }, shadowTaps = 8, state = {}) {
    this.info = info; this.bones = info.bones;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normal, 3, true));
    geometry.setAttribute('uv', new THREE.BufferAttribute(arrays.uv, 2, true));
    geometry.setAttribute('aJoints', new THREE.BufferAttribute(arrays.joints, 4, false));
    geometry.setAttribute('aWeights', new THREE.BufferAttribute(arrays.weights, 4, true));
    // (Bytes -1..1 of info.clothScale metres from the bikini's edge; 0..1 of info.thinScale metres of flesh.)
    const cloth = Float32Array.from(arrays.cloth, v => v / 127 * info.clothScale), thin = Float32Array.from(arrays.thin, v => v / 255 * info.thinScale);
    geometry.setAttribute('aCloth', new THREE.BufferAttribute(cloth, 1)); geometry.setAttribute('aThin', new THREE.BufferAttribute(thin, 1));
    geometry.setAttribute('aPart', new THREE.BufferAttribute(arrays.part, 1, false));
    geometry.setIndex(new THREE.BufferAttribute(arrays.index, 1));
    // The bones' matrices: three texels each.
    this.matrices = new Float32Array(info.bones.length * 12);
    this.boneTexture = new THREE.DataTexture(this.matrices, info.bones.length * 3, 1, THREE.RGBAFormat, THREE.FloatType);
    Object.assign(this.boneTexture, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.rest();
    const own = { tBones: { value: this.boneTexture } };
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.FrontSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.cloudShadow, ...CHUNK_UNIFORMS.shadow], {
        uBodyWet: { value: new THREE.Vector4(-1e9, 0, -1e9, 0) }, uBodySand: { value: 0 }, uHandWet: { value: new THREE.Vector4(0, -1e9, 0, 0) }, uHandSand: { value: 0 }, uHandWetL: { value: new THREE.Vector4(0, -1e9, 0, 0) }, uHandSandL: { value: 0 }, ...state,
        uShowHead: { value: 0 }, uShowUnder: { value: 1 }, uWaterY: { value: -1e9 }, tSkinState: { value: blank() }, ...own, ...bikini(info, arrays.position), tSkin: { value: texture }, uTone: { value: new THREE.Vector3(0.66, 0.62, 0.55) }, uClothColour: { value: new THREE.Vector3(0.62, 0.07, 0.06) } }),
    }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.visible = false;
    // Her hair, tied back: over the skull from the hairline to the nape, gathered at the back of the crown and
    // hanging from there in a tail to the base of the neck. You never see it yourself, only its outline in
    // your shadow: a head with hair, not a bare skull with ears. It goes with the head bone.
    this.hair = new THREE.Mesh(hairGeometry(info.eyeHeight), new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, side: THREE.DoubleSide, uniforms: uniformsFor(CHUNK_UNIFORMS.common, {}),
      vertexShader: /* glsl */`
#include <lr_common>
out vec3 vN;
void main() { vN = mat3(modelMatrix) * normal; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
#include <lr_common>
in vec3 vN;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 n = normalize(vN);
  outColor = vec4(vec3(0.085, 0.05, 0.03) * (uSunE * (0.25 + 0.75 * lrSaturate(dot(n, uSunDir))) + uSkyE * (0.6 + 0.4 * n.y)) / PI, -1000.0);
}`,
    }));
    this.hair.frustumCulled = false; this.hair.matrixAutoUpdate = false; this.hair.visible = false;
    this.headBone = info.bones.findIndex(b => b.name === 'head'); this.lift = 0;
    /** What draws it into a shadow map (Shadows.render looks for this). */
    this.mesh.userData.caster = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: casterVertex, fragmentShader: casterFragment, side: THREE.DoubleSide,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CASTER_UNIFORMS], own),
    });
  }

  /**
   * The tail of her hair is a pendulum hung from the back of her head: it lags as the head starts off, swings on
   * as it stops, sways with each pace, and leans downwind, fluttering. (You see it only in your shadow.)
   * @param {number} dt
   * @param {number[]} accel  how the place where it is tied is accelerating, in the head's own frame: [to the right, back] (m/s2)
   * @param {number[]} wind  the breeze there in the same frame (m/s)
   */
  swing(dt, accel, wind) {
    const tail = this.hair.geometry.userData.tail, t = this.tail ??= { x: 0, z: 0, vx: 0, vz: 0, shown: [9, 9] };
    if (dt > 0) {
      // (A pendulum 19 cm long swings 1.1 times a second; hair is well damped. A breeze of 3 m/s holds it 2 cm off.)
      const w2 = 9.81 / tail.length, damp = 2 * 0.3 * Math.sqrt(w2), step = Math.min(dt, 1 / 30);
      for (const [k, v, a, b] of [['x', 'vx', accel[0], wind[0]], ['z', 'vz', accel[1], wind[1]]]) {
        t[v] += (-w2 * t[k] - damp * t[v] - 0.42 * Math.max(-9, Math.min(9, a)) + w2 * 0.007 * b) * step;
        t[k] = Math.max(-0.1, Math.min(0.1, t[k] + t[v] * step));
      }
      // (Forward, her neck is in the way: the tail comes to rest against it.)
      if (t.z < -0.012) { t.z = -0.012; t.vz = Math.max(t.vz, 0); }
    }
    if (Math.abs(t.x - t.shown[0]) + Math.abs(t.z - t.shown[1]) < 2e-4) return;
    t.shown = [t.x, t.z];
    const p = this.hair.geometry.attributes.position, rise = (t.x * t.x + t.z * t.z) / (2 * tail.length);
    for (let i = 0; i < tail.count; i++) {
      const h = tail.hang[i] * tail.hang[i], o = i * 3;
      p.setXYZ(tail.first + i, tail.rest[o] + t.x * h, tail.rest[o + 1] + rise * h, tail.rest[o + 2] + t.z * h);
    }
    p.needsUpdate = true;
  }

  /** Every bone where it is at rest. */
  rest() {
    for (let b = 0, o = 0; b < this.bones.length; b++, o += 12) { this.matrices.fill(0, o, o + 12); this.matrices[o] = this.matrices[o + 5] = this.matrices[o + 10] = 1; }
    this.boneTexture.needsUpdate = true;
  }

  /** The bones where the rig has put them (figurepose.js: 12 numbers a bone). */
  setPose(matrices, eye = this.info.eyeHeight) { this.matrices.set(matrices); this.boneTexture.needsUpdate = true; this.lift = eye - this.info.eyeHeight; }

  /** Stands the body with its feet at height y, heading `yaw` (as Body.place). */
  place(x, y, z, yaw, pitch = 0) {
    const m = this.mesh;
    m.position.set(x, y, z); m.rotation.set(pitch, -yaw, 0, 'YXZ'); m.updateMatrix(); m.matrixWorld.copy(m.matrix);
    // (Her hair goes with her head: wherever the rig has turned that bone.)
    const b = this.matrices, o = this.headBone * 12, h = this.hair.matrix.set(b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6], b[o + 7], b[o + 8], b[o + 9], b[o + 10], b[o + 11], 0, 0, 0, 1);
    h.premultiply(m.matrix); this.hair.matrixWorld.copy(h);
  }
}
