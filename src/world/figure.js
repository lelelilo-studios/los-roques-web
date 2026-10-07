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
out vec3 vRel;
out vec3 vNormal;
out vec3 vRest;         // the point on the body at rest (patterns that must stay on the skin are drawn in this)
out vec2 vUv;
out float vCloth;
out float vThin;
void main() {
  mat4 skin = lrSkin();
  vec4 wp = modelMatrix * (skin * vec4(position, 1.0));
  vNormal = mat3(modelMatrix) * (mat3(skin) * normal);
  vRel = wp.xyz; vRest = position; vUv = uv; vCloth = aCloth; vThin = aThin;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - lrCurveDrop(wp.xz), wp.z, 1.0);
}`;

const fragmentShader = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
${shadowGLSL}
uniform sampler2D tSkin;
uniform vec3 uTone;         // what the skin's own colour is multiplied by: her tan
uniform vec3 uClothColour;
in vec3 vRel;
in vec3 vNormal;
in vec3 vRest;
in vec2 vUv;
in float vCloth;
in float vThin;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal), V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  float cloud = lrCloudShadow(uCamXZ + vRel.xz), nl = dot(n, uSunDir);
  // (A round limb turns away from the sun gradually; where its skin is nearly edge-on to the light the shadow
  // map cannot tell lit from self-shadowed: there the turning away alone does the darkening.)
  float sun = mix(cloud, lrSunThrough(cloud, vRel, n), smoothstep(0.05, 0.45, nl));
  vec3 skin = pow(texture(tSkin, vUv).rgb, vec3(2.2)) * uTone;
  // The bikini: where the field is positive. Its edge is a line a pixel wide however near you look; the skin
  // beside it is a little shaded by it, and the cloth has a weave.
  float edge = fwidth(vCloth) + 1e-5, cloth = smoothstep(-edge, edge, vCloth), hem = 1.0 - smoothstep(0.0, 0.25, abs(vCloth));
  float weave = 0.9 + 0.1 * sin(vRest.x * 2600.0) * sin(vRest.y * 2600.0) + 0.06 * (lrNoise(vRest.xy * 400.0 + vRest.z * 300.0) - 0.5);
  vec3 albedo = mix(skin * (1.0 - 0.25 * hem * (1.0 - cloth)), uClothColour * weave * (1.0 - 0.18 * hem), cloth);
  // Skin is not a hard surface: light spreads a little under it. The lit side wraps round further than a
  // plaster cast's would, and the edge of the shade is warm.
  float wrap = lrSaturate((nl + 0.3) / 1.3), soft = mix(wrap * wrap, lrSaturate(nl), cloth);
  vec3 bleed = vec3(0.5, 0.12, 0.05) * smoothstep(-0.3, 0.05, nl) * (1.0 - smoothstep(0.05, 0.5, nl)) * (1.0 - cloth);
  // (The sunlit sand lights the body from below.)
  vec3 bounce = uSunE * lrSaturate(uSunDir.y) * cloud * 0.22 * vec3(0.76, 0.7, 0.6) * (0.5 - 0.5 * n.y);
  vec3 light = uSunE * sun * (soft + 0.12 * bleed) + uSkyE * (0.5 + 0.5 * n.y) + bounce;
  // Light through the thin parts (fingers, toes, the edge of the hand) when the sun is behind them.
  float through = (1.0 - smoothstep(0.006, 0.02, vThin)) * lrSaturate(-nl) * lrSaturate(dot(V, -uSunDir) * 0.5 + 0.5) * (1.0 - cloth);
  light += uSunE * cloud * through * vec3(0.55, 0.14, 0.07);
  vec3 col = albedo * light / PI;
  // The sheen of skin: broad and faint.
  vec3 h = normalize(uSunDir + V);
  float fresnel = 0.028 + 0.972 * pow(1.0 - lrSaturate(dot(n, V)), 5.0);
  col += uSunE * sun * lrSaturate(nl) * (0.35 * pow(lrSaturate(dot(n, h)), 28.0) + 0.9 * pow(lrSaturate(dot(n, h)), 140.0)) * 0.06 * (1.0 - 0.6 * cloth) + fresnel * uSkyE / PI * 0.25 * (1.0 - cloth);
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

export class Figure {
  /**
   * @param {{info: object, arrays: object, texture: THREE.Texture}} data  from loadFigure()
   * @param {number} shadowTaps
   */
  constructor({ info, arrays, texture }, shadowTaps = 8) {
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
        ...own, tSkin: { value: texture }, uTone: { value: new THREE.Vector3(0.66, 0.62, 0.55) }, uClothColour: { value: new THREE.Vector3(0.62, 0.07, 0.06) } }),
    }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.visible = false;
    /** What draws it into a shadow map (Shadows.render looks for this). */
    this.mesh.userData.caster = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: casterVertex, fragmentShader: casterFragment, side: THREE.DoubleSide,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CASTER_UNIFORMS], own),
    });
  }

  /** Every bone where it is at rest. */
  rest() {
    for (let b = 0, o = 0; b < this.bones.length; b++, o += 12) { this.matrices.fill(0, o, o + 12); this.matrices[o] = this.matrices[o + 5] = this.matrices[o + 10] = 1; }
    this.boneTexture.needsUpdate = true;
  }

  /** Stands the body with its feet at height y, heading `yaw` (as Body.place). */
  place(x, y, z, yaw, pitch = 0) {
    const m = this.mesh;
    m.position.set(x, y, z); m.rotation.set(pitch, -yaw, 0, 'YXZ'); m.updateMatrix(); m.matrixWorld.copy(m.matrix);
  }
}
