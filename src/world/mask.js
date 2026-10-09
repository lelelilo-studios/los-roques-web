// Her diving mask and snorkel. On the sand the mask is pushed up on her forehead and the snorkel hangs by her
// jaw; as she starts to swim it comes down over her eyes and the mouthpiece goes in. Both go with her head
// (the same matrix her hair has: world/hair.js `links[0]`). Through her own eyes it is not drawn: what you see
// of it there is its rim round the picture (core/framegraph.js).
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { shadowGLSL } from './shadow.js';
import { Builder } from './penero.js';

const SKIRT = [0.035, 0.035, 0.04], FRAME = [0.7, 0.07, 0.06], STRAP = [0.05, 0.05, 0.055], TUBE = [0.72, 0.08, 0.06], BAND = [0.9, 0.86, 0.78];
// (Her head at rest: eyes 2.9 cm either side of the middle, 1.524 m up, looking along -z; the tip of her nose at
// z = -0.041, her mouth at 1.445 m; her skull a ball of 10 cm about [0, 1.555, 0.065]. pipeline/body/build.mjs.)
const EYES = 1.5236, EAR = [0, 1.53, 0.065];
const outline = (z, grow, n = 28) => [...Array(n + 1)].map((_, k) => { const a = k / n * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a), e = 2 / 3.2; return [0.079 * grow * Math.sign(c) * Math.abs(c) ** e, EYES + 0.004 + 0.044 * grow * Math.sign(s) * Math.abs(s) ** e - (s < 0 ? 0.012 * Math.exp(-(((c * 0.079 * grow) / 0.022) ** 2)) * grow : 0), z]; });

function maskGeometry() {
  const b = new Builder();
  // The frame round the glass, the skirt from it back to her face, the pocket for her nose.
  const rim = outline(-0.06, 1);
  for (let k = 0; k < rim.length - 1; k++) b.bar(rim[k], rim[k + 1], 0.0055, FRAME, 6);
  b.sheet([outline(-0.058, 0.98), outline(-0.04, 1.03), outline(-0.022, 1.07)], SKIRT);
  b.sheet([[0.02, 0.9], [0.5, 1], [0.85, 0.75], [1, 0.02]].map(([t, w]) => [...Array(9)].map((_, k) => { const a = (k / 8 - 0.5) * Math.PI; return [Math.sin(a) * 0.019 * w, EYES - 0.012 - 0.03 * t, -0.058 - 0.014 * Math.cos(a) * w * (0.4 + 0.6 * t)]; })), SKIRT);
  // The strap: from each side of the frame round the back of her head, a little higher behind.
  const round = [];
  for (let k = 0; k <= 22; k++) { const f = 0.62 + (2 * Math.PI - 1.24) * k / 22; round.push([0.09 * Math.sin(f), EYES + 0.006 + 0.03 * (1 - Math.cos(f)) / 2, 0.065 - 0.108 * Math.cos(f)]); }
  for (let k = 0; k < round.length - 1; k++) b.bar(round[k], round[k + 1], 0.0045, STRAP, 5);
  b.bar([0.079, EYES + 0.004, -0.05], round[0], 0.0045, STRAP, 5); b.bar([-0.079, EYES + 0.004, -0.05], round[round.length - 1], 0.0045, STRAP, 5);
  return b.geometry();
}
function snorkelGeometry() {
  const b = new Builder(), way = [[0.0, 1.445, -0.047], [-0.03, 1.441, -0.052], [-0.066, 1.452, -0.03], [-0.09, 1.49, 0.02], [-0.097, 1.56, 0.052], [-0.096, 1.66, 0.068], [-0.094, 1.77, 0.08], [-0.093, 1.815, 0.084]];
  for (let k = 0; k < way.length - 1; k++) b.bar(way[k], way[k + 1], k < 2 ? 0.012 : 0.0105, k < 2 ? SKIRT : k === way.length - 2 ? BAND : TUBE, 8);
  b.box([0.0, 1.445, -0.04], [0.016, 0.008, 0.006], SKIRT);
  return b.geometry();
}

const vertexShader = /* glsl */`
#include <lr_common>
out vec3 vRel;
out vec3 vN;
out vec3 vColor;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz; vN = mat3(modelMatrix) * normal; vColor = color;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - lrCurveDrop(wp.xz), wp.z, 1.0);
}`;
const fragmentShader = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
${shadowGLSL}
uniform float uWaterY;      // the sea's surface where she is
uniform float uSeen;        // how much of it is drawn: 0 when the camera is in her head
in vec3 vRel;
in vec3 vN;
in vec3 vColor;
layout(location = 0) out vec4 outColor;
void main() {
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (uSeen < 0.02 + 0.96 * grain) discard;
  vec3 n = normalize(vN), e = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  if (dot(n, e) < 0.0) n = -n;
  float cloud = lrCloudShadow(uCamXZ + vRel.xz), sun = lrSunThrough(cloud, vRel, n);
  vec3 light = uSunE * lrSaturate(dot(n, uSunDir)) * sun + uSkyE * (0.55 + 0.45 * n.y) + (uSunE * lrSaturate(uSunDir.y) * cloud + uSkyE) * 0.2 * (0.5 - 0.5 * n.y);
  // (Silicone and plastic: a soft shine.)
  vec3 col = vColor * light / PI + uSunE * sun * 0.06 * pow(lrSaturate(dot(n, normalize(uSunDir + e))), 60.0) + 0.04 * pow(1.0 - lrSaturate(dot(n, e)), 5.0) * uSkyE / PI;
  float below = uWaterY - vRel.y;
  if (below > 0.0) { outColor = vec4(col * PI / max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4)), below); return; }
  outColor = vec4(col, -1000.0);
}`;

export class Mask {
  /** @param {number} shadowTaps  @param {{uWaterY: {value: number}}} shared  the body's own uniform, so that both are under the same sea */
  constructor(shadowTaps, shared) {
    const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, vertexColors: true, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.cloudShadow, ...CHUNK_UNIFORMS.shadow], { uWaterY: shared.uWaterY, uSeen: { value: 0 } }) });
    this.mask = new THREE.Mesh(maskGeometry(), material); this.snorkel = new THREE.Mesh(snorkelGeometry(), material);
    for (const m of [this.mask, this.snorkel]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false; }
    this.meshes = [this.mask, this.snorkel]; this.material = material; this.down = 0;
    this._a = new THREE.Matrix4(); this._b = new THREE.Matrix4();
  }

  /**
   * @param {THREE.Matrix4} head  her head at rest to where it is (relative to the camera): hair.js `links[0]`
   * @param {number} down  0 pushed up on her forehead .. 1 over her eyes, the mouthpiece in
   * @param {number} seen  how much of it is drawn, 0..1 (0: the camera is in her head)
   */
  place(head, down, seen) {
    this.down = down; this.material.uniforms.uSeen.value = seen;
    const k = 1 - down;
    // (Up: turned back about the line through her ears, half a radian: on to her forehead.)
    this._a.makeTranslation(EAR[0], EAR[1], EAR[2]).multiply(this._b.makeRotationX(-0.5 * k)).multiply(this._b.makeTranslation(-EAR[0], -EAR[1], -EAR[2]));
    this.mask.matrix.multiplyMatrices(head, this._a); this.mask.matrixWorld.copy(this.mask.matrix);
    // (The snorkel, out of her mouth: hung from where it is clipped to the strap, its mouthpiece swung down beside her jaw.)
    const clip = [-0.095, 1.545, 0.045];
    this._a.makeTranslation(clip[0], clip[1] - 0.012 * k, clip[2]).multiply(this._b.makeRotationZ(-0.16 * k)).multiply(this._b.makeRotationX(0.3 * k)).multiply(this._b.makeTranslation(-clip[0], -clip[1], -clip[2]));
    this.snorkel.matrix.multiplyMatrices(head, this._a); this.snorkel.matrixWorld.copy(this.snorkel.matrix);
    for (const m of this.meshes) m.visible = seen > 0;
  }
}
