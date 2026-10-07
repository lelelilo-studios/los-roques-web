// Shadows of things (houses, boats, umbrellas, lighthouses, you) on the sand, on the seabed, on the water and
// on each other: one map drawn from the sun's direction over the ground near the eye. The ground itself casts
// none: the cays are flat, and a terrain that shadows itself is where most shadow-map trouble comes from.
//
// The map holds, per texel, how far towards the sun the nearest thing stands (metres from the map's centre
// plane), in a plain float texture compared by hand: no depth-compare samplers, so the reversed and the
// ordinary depth buffer behave alike (only the caster's clip-space z differs).
import * as THREE from 'three';
import { shared } from '../core/uniforms.js';

/** GLSL for receivers (needs lr_common). */
export const shadowGLSL = /* glsl */`
uniform highp sampler2D tShadow;
uniform vec3 uShadowC;                // centre of the map: x, z relative to the camera, y absolute
uniform vec3 uShadowR, uShadowU;      // its two axes across the light (unit vectors)
uniform vec4 uShadowP;                // half size (m), size of a texel (m), 1 = on, unused
uniform highp sampler2D tShadowB;     // your own shadow, in a small map of its own (see Shadows.render)
uniform vec4 uShadowB;                // its centre (x, z relative to the camera, y absolute) and its half size (m)
uniform vec2 uShadowBP;               // the size of a texel of it (m), 1 = on
const vec2 LR_SHADOW_DISC[8] = vec2[8](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
                                       vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893));
// 1 = lit by the sun, 0 = in the shadow of something, for the point p (x, z relative to the camera, y
// absolute) on a surface with normal n.
//
// The sun is a disc half a degree across, so a shadow's edge is as wide as the thing casting it is far, over
// 107: crisp at your feet, three centimetres of blur round your head's shadow at noon and more towards evening.
// A few taps first find how far towards the sun the casters over the point are; the edge is then that wide,
// from taps on a disc turned differently for every pixel.
float lrShadowDisc(highp sampler2D map, vec2 uv, vec2 spread, float towards, float turn) {
  float ca = cos(turn), sa = sin(turn), lit = 0.0;
  for (int i = 0; i < LR_SHADOW_TAPS; i++) {
    vec2 o = LR_SHADOW_DISC[i];
    lit += step(textureLod(map, uv + vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca) * spread, 0.0).r, towards);
  }
  return lit / float(LR_SHADOW_TAPS);
}
// (Mean distance towards the sun of the casters found within 'reach' of uv; 0 if there are none.)
float lrShadowCasters(highp sampler2D map, vec2 uv, vec2 reach, float towards, float turn) {
  float ca = cos(turn), sa = sin(turn), far = max(textureLod(map, uv, 0.0).r - towards, 0.0), found = step(1e-5, far);
  for (int i = 0; i < 8; i += 2) {
    vec2 o = LR_SHADOW_DISC[i];
    float d = textureLod(map, uv + vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca) * reach, 0.0).r - towards;
    if (d > 0.0) { far += d; found += 1.0; }
  }
  return found > 0.5 ? far / found : 0.0;
}
// Your own shadow. In the map of everything, 52 m across, a texel is over a centimetre, and three times that
// along the ground under a low sun: your shadow had steps down its sides. Seen along the light your body fits
// a square under three metres across wherever its shadow falls, so it has that square to itself, a texel little
// over a millimetre: fingers in the shadow of a hand, a crisp edge at the heels.
float lrShadowOwn(vec3 p, vec3 n, float turn) {
  vec3 q = p + n * 0.004 - uShadowB.xyz;
  vec2 s = vec2(dot(q, uShadowR), dot(q, uShadowU)) / uShadowB.w;
  float towards = dot(q, uSunDir) + 0.006;
  if (max(abs(s.x), abs(s.y)) >= 1.0 || towards > uShadowB.w) return 1.0;
  vec2 uv = s * 0.5 + 0.5, texel = vec2(0.5 * uShadowBP.x / uShadowB.w);
#if LR_SHADOW_TAPS >= 8
  // (No part of you is further towards the sun than the far side of the square: the widest the edge can be here.)
  float widest = 0.00465 * (uShadowB.w - towards) / uShadowBP.x;
  float far = lrShadowCasters(tShadowB, uv, texel * max(widest, 2.0), towards, turn);
  if (far <= 0.0) return 1.0;
  return lrShadowDisc(tShadowB, uv, texel * max(0.00465 * far / uShadowBP.x, 0.75), towards, turn);
#else
  return lrShadowDisc(tShadowB, uv, texel * 0.9, towards, turn);
#endif
}
float lrShadow(vec3 p, vec3 n) {
  if (uShadowP.z < 0.5) return 1.0;
  float turn = 6.2832 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))), own = uShadowBP.y > 0.5 ? lrShadowOwn(p, n, turn) : 1.0;
  vec3 q = p + n * uShadowP.y * 2.0 - uShadowC;
  vec2 s = vec2(dot(q, uShadowR), dot(q, uShadowU)) / uShadowP.x;
  float edge = max(abs(s.x), abs(s.y));
  if (edge >= 1.0) return own;
  float towards = dot(q, uSunDir) + uShadowP.y * 2.0 + 0.012, wide = 0.9;
  vec2 uv = s * 0.5 + 0.5, texel = vec2(0.5 * uShadowP.y / uShadowP.x);
#if LR_SHADOW_TAPS >= 8
  float far = lrShadowCasters(tShadow, uv, texel * 3.0, towards, turn);
  if (far <= 0.0) return own;
  wide = clamp(0.00465 * far / uShadowP.y, 0.9, 3.0);
#endif
  return min(own, mix(lrShadowDisc(tShadow, uv, texel * wide, towards, turn), 1.0, smoothstep(0.85, 1.0, edge)));
}
// Under a cloud the fifth of the sunlight that still comes through has been scattered on the way: it casts no
// sharp shadows. So things shadow the ground fully in the open, and less and less as a cloud covers the sun.
// 'cloud' is what the clouds let through at p (lrCloudShadow); returns the sun's light there, 0..1.
float lrSunThrough(float cloud, vec3 p, vec3 n) { return cloud * mix(1.0, lrShadow(p, n), smoothstep(0.22, 0.6, cloud)); }
`;
export const SHADOW_UNIFORMS = ['tShadow', 'uShadowC', 'uShadowR', 'uShadowU', 'uShadowP', 'tShadowB', 'uShadowB', 'uShadowBP'];

/**
 * GLSL for anything that draws itself into the map with its own vertex shader (needs lr_common):
 * lrShadowClip(p) is where the point p (x, z relative to the camera, y absolute) lands in the map, and sets
 * vTowards, which the caster's fragment shader writes out.
 */
export const casterGLSL = /* glsl */`
uniform vec3 uShadowC, uShadowR, uShadowU;
uniform vec4 uShadowP;
uniform vec2 uShadowZ;       // depth of the map along the light (m), 1 if the depth buffer is reversed
out float vTowards;
vec4 lrShadowClip(vec3 p) {
  vec3 q = p - uShadowC;
  vTowards = dot(q, uSunDir);
  // Nearest the sun wins the depth test, whichever way the depth buffer runs.
  float z = clamp(vTowards / uShadowZ.x, -1.0, 1.0);
  return vec4(vec2(dot(q, uShadowR), dot(q, uShadowU)) / uShadowP.x, uShadowZ.y > 0.5 ? 0.5 + 0.5 * z : -z, 1.0);
}`;
export const CASTER_UNIFORMS = ['uShadowC', 'uShadowR', 'uShadowU', 'uShadowP', 'uShadowZ'];
export const casterFragment = /* glsl */`
in float vTowards;
layout(location = 0) out vec4 outColor;
void main() { outColor = vec4(vTowards, 0.0, 0.0, 1.0); }`;

const casterVertex = /* glsl */`
#include <lr_common>
${casterGLSL}
void main() {
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
#endif
  gl_Position = lrShadowClip(wp.xyz);
}`;

export class Shadows {
  /** @param {number} size  texels across the map (0 = no shadows) */
  constructor(renderer, size, reversed) {
    this.renderer = renderer; this.size = size; this.enabled = size > 0;
    shared.uShadowZ.value.set(100, reversed ? 1 : 0);
    shared.uShadowP.value.set(1, 1, 0, 0);
    if (!this.enabled) return;
    this.target = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    shared.tShadow.value = this.target.texture;
    // (Your own shadow's map: see lrShadowOwn.)
    this.figure = new THREE.WebGLRenderTarget(2048, 2048, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    shared.tShadowB.value = this.figure.texture;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: casterVertex, fragmentShader: casterFragment, side: THREE.DoubleSide,
      uniforms: { uSunDir: shared.uSunDir, uCamXZ: shared.uCamXZ, uCamMod: shared.uCamMod, uCamY: shared.uCamY, uMapRect: shared.uMapRect, uSeaLevel: shared.uSeaLevel, uTime: shared.uTime,
        uInvEarthR: shared.uInvEarthR, uSunE: shared.uSunE, uSkyE: shared.uSkyE, uNearFar: shared.uNearFar, uInvResolution: shared.uInvResolution,
        uShadowC: shared.uShadowC, uShadowR: shared.uShadowR, uShadowU: shared.uShadowU, uShadowP: shared.uShadowP, uShadowZ: shared.uShadowZ },
    });
    // (Only used to decide what is worth drawing; the caster's shader places things itself.)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    this.empty = new Float32Array([-1e9, 0, 0, 0]);
  }

  /**
   * Draws the map. `scene` is the opaque scene; `hide` are objects in it that cast no shadow (the terrain, the
   * birds), `show` objects that exist only to cast one (your own figure).
   * @param {{x: number, y: number, z: number}} centre  middle of the map relative to the camera (y absolute)
   * @param {number} half  half its width in metres
   * @param {{mesh: THREE.Mesh, caster: THREE.Material}[]} own  things hidden above that cast with a material of
   *   their own (trees and shrubs placed by a vertex shader)
   * @param {{meshes: THREE.Mesh[], centre: {x: number, y: number, z: number}, half: number} | null} figure  your
   *   own body, drawn into the small map of its own (it should then be among `hide`)
   */
  render(scene, centre, half, hide = [], show = [], own = [], figure = null) {
    const P = shared.uShadowP.value, sun = shared.uSunDir.value;
    shared.uShadowBP.value.y = 0;
    if (!this.enabled || sun.y < 0.03) { P.z = 0; return; }
    // Axes across the light; the centre snapped to whole texels along them, so edges do not crawl as the eye moves.
    const R = shared.uShadowR.value.set(sun.z, 0, -sun.x), U = shared.uShadowU.value, C = shared.uShadowC.value, texel = 2 * half / this.size;
    if (R.lengthSq() < 1e-6) R.set(1, 0, 0);
    R.normalize(); U.crossVectors(sun, R).normalize();
    const world = this._w ??= new THREE.Vector3();
    world.set(centre.x + shared.uCamXZ.value.x, centre.y, centre.z + shared.uCamXZ.value.y);
    const r = Math.round(world.dot(R) / texel) * texel - world.dot(R), u = Math.round(world.dot(U) / texel) * texel - world.dot(U);
    C.set(centre.x, centre.y, centre.z).addScaledVector(R, r).addScaledVector(U, u);
    P.set(half, texel, 1, 0);
    const depth = shared.uShadowZ.value.x = half * 1.5 + 60;
    const cam = this.camera;
    cam.left = cam.bottom = -half * 1.5; cam.right = cam.top = half * 1.5; cam.near = 0; cam.far = 2 * depth;
    cam.position.copy(C).addScaledVector(sun, depth); cam.up.copy(U); cam.lookAt(C); cam.updateProjectionMatrix();

    const { renderer } = this, previous = renderer.getRenderTarget(), was = [...hide.map(o => o.visible), ...show.map(o => o.visible)];
    if (figure) {
      // Your own body into its own map: the caster's shader is pointed at that square for these draws.
      const mainC = this._c ??= new THREE.Vector3(), texelB = 2 * figure.half / this.figure.width;
      mainC.copy(C); C.set(figure.centre.x, figure.centre.y, figure.centre.z); P.set(figure.half, texelB, 1, 0); shared.uShadowZ.value.x = figure.half * 2;
      renderer.setRenderTarget(this.figure);
      renderer.clear(false, true, false);
      renderer.getContext().clearBufferfv(renderer.getContext().COLOR, 0, this.empty);
      for (const mesh of figure.meshes) {
        const material = mesh.material, parent = mesh.parent, seen = mesh.visible;
        if (parent) parent.remove(mesh);
        mesh.material = this.material; mesh.visible = true;
        renderer.render(mesh, cam);
        mesh.material = material; mesh.visible = seen;
        if (parent) parent.add(mesh);
      }
      shared.uShadowB.value.set(C.x, C.y, C.z, figure.half); shared.uShadowBP.value.set(texelB, 1);
      C.copy(mainC); P.set(half, texel, 1, 0); shared.uShadowZ.value.x = depth;
    }
    hide.forEach(o => { o.visible = false; }); show.forEach(o => { o.visible = true; });
    scene.overrideMaterial = this.material;
    renderer.setRenderTarget(this.target);
    renderer.clear(false, true, false);
    renderer.getContext().clearBufferfv(renderer.getContext().COLOR, 0, this.empty);
    renderer.render(scene, cam);
    scene.overrideMaterial = null;
    for (const { mesh, caster } of own) {
      if (!mesh.visible && !hide.some(h => h === mesh.parent)) continue;
      const material = mesh.material, parent = mesh.parent, seen = mesh.visible;
      // (Drawn on its own, as its parent group is hidden; a mesh without a parent draws as it stands.)
      if (parent) parent.remove(mesh);
      mesh.material = caster; mesh.visible = seen;
      renderer.render(mesh, cam);
      mesh.material = material;
      if (parent) parent.add(mesh);
    }
    [...hide, ...show].forEach((o, i) => { o.visible = was[i]; });
    renderer.setRenderTarget(previous);
  }
}
