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
const vec2 LR_SHADOW_DISC[8] = vec2[8](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
                                       vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893));
// 1 = lit by the sun, 0 = in the shadow of something, for the point p (x, z relative to the camera, y
// absolute) on a surface with normal n. A few taps on a disc turned differently for every pixel: soft edges.
float lrShadow(vec3 p, vec3 n) {
  if (uShadowP.z < 0.5) return 1.0;
  vec3 q = p + n * uShadowP.y * 2.0 - uShadowC;
  vec2 s = vec2(dot(q, uShadowR), dot(q, uShadowU)) / uShadowP.x;
  float edge = max(abs(s.x), abs(s.y));
  if (edge >= 1.0) return 1.0;
  float towards = dot(q, uSunDir) + uShadowP.y * 2.0 + 0.012, lit = 0.0;
  float a = 6.2832 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))), ca = cos(a), sa = sin(a);
  vec2 uv = s * 0.5 + 0.5, spread = vec2(0.9 * uShadowP.y / uShadowP.x);
  for (int i = 0; i < LR_SHADOW_TAPS; i++) {
    vec2 o = LR_SHADOW_DISC[i];
    lit += step(textureLod(tShadow, uv + vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca) * spread, 0.0).r, towards);
  }
  return mix(lit / float(LR_SHADOW_TAPS), 1.0, smoothstep(0.85, 1.0, edge));
}
`;
export const SHADOW_UNIFORMS = ['tShadow', 'uShadowC', 'uShadowR', 'uShadowU', 'uShadowP'];

const casterVertex = /* glsl */`
#include <lr_common>
uniform vec3 uShadowC, uShadowR, uShadowU;
uniform vec4 uShadowP;
uniform vec2 uShadowZ;       // depth of the map along the light (m), 1 if the depth buffer is reversed
out float vTowards;
void main() {
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
#endif
  vec3 q = wp.xyz - uShadowC;
  vTowards = dot(q, uSunDir);
  // Nearest the sun wins the depth test, whichever way the depth buffer runs.
  float z = clamp(vTowards / uShadowZ.x, -1.0, 1.0);
  gl_Position = vec4(vec2(dot(q, uShadowR), dot(q, uShadowU)) / uShadowP.x, uShadowZ.y > 0.5 ? 0.5 + 0.5 * z : -z, 1.0);
}`;
const casterFragment = /* glsl */`
in float vTowards;
layout(location = 0) out vec4 outColor;
void main() { outColor = vec4(vTowards, 0.0, 0.0, 1.0); }`;

export class Shadows {
  /** @param {number} size  texels across the map (0 = no shadows) */
  constructor(renderer, size, reversed) {
    this.renderer = renderer; this.size = size; this.enabled = size > 0;
    shared.uShadowP.value.set(1, 1, 0, 0);
    if (!this.enabled) return;
    this.target = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    shared.tShadow.value = this.target.texture;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: casterVertex, fragmentShader: casterFragment, side: THREE.DoubleSide,
      uniforms: { uSunDir: shared.uSunDir, uCamXZ: shared.uCamXZ, uCamMod: shared.uCamMod, uCamY: shared.uCamY, uMapRect: shared.uMapRect, uSeaLevel: shared.uSeaLevel, uTime: shared.uTime,
        uInvEarthR: shared.uInvEarthR, uSunE: shared.uSunE, uSkyE: shared.uSkyE, uNearFar: shared.uNearFar, uInvResolution: shared.uInvResolution,
        uShadowC: shared.uShadowC, uShadowR: shared.uShadowR, uShadowU: shared.uShadowU, uShadowP: shared.uShadowP, uShadowZ: { value: new THREE.Vector2(100, reversed ? 1 : 0) } },
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
   */
  render(scene, centre, half, hide = [], show = []) {
    const P = shared.uShadowP.value, sun = shared.uSunDir.value;
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
    const depth = this.material.uniforms.uShadowZ.value.x = half * 1.5 + 60;
    const cam = this.camera;
    cam.left = cam.bottom = -half * 1.5; cam.right = cam.top = half * 1.5; cam.near = 0; cam.far = 2 * depth;
    cam.position.copy(C).addScaledVector(sun, depth); cam.up.copy(U); cam.lookAt(C); cam.updateProjectionMatrix();

    const { renderer } = this, previous = renderer.getRenderTarget(), was = [...hide.map(o => o.visible), ...show.map(o => o.visible)];
    hide.forEach(o => { o.visible = false; }); show.forEach(o => { o.visible = true; });
    scene.overrideMaterial = this.material;
    renderer.setRenderTarget(this.target);
    renderer.clear(false, true, false);
    renderer.getContext().clearBufferfv(renderer.getContext().COLOR, 0, this.empty);
    renderer.render(scene, cam);
    scene.overrideMaterial = null;
    [...hide, ...show].forEach((o, i) => { o.visible = was[i]; });
    renderer.setRenderTarget(previous);
  }
}
