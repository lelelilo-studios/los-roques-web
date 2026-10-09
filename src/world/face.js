// Her eyes, her lashes and her brows (web/data/body, put on her head by pipeline/body/build.mjs from MakeHuman's
// pieces), and what makes a face alive from a few metres off: eyes that look where she looks, a catch of the sun
// in each, the lid's shade across the top of it, and a blink.
//
// Her eyes are two balls in her head, each turned about its own middle (`gaze`) on top of what her head does:
// her head nods six tenths of the way to where you look, and her eyes take the rest. Her lashes are hung on the
// lids' own vertices: the build fitted them to her eyes open and shut, and a blink goes from the one to the other,
// as the skin of the lids does (figure.js, `aBlink`).
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { shadowGLSL } from './shadow.js';

const eyeVertex = skinning => /* glsl */`
#include <lr_common>
${skinning}
uniform float uHeadBone;
uniform vec3 uEyeAt[2];     // the middle of each eye, at rest
uniform mat3 uGaze[2];      // how each is turned in her head
in float aSide;
out vec3 vRel;
out vec3 vN;
out vec3 vOwn;              // the point on the ball, from its middle, before it was turned (which way is up in her head)
out vec3 vBall;             // and after: where the iris now is
out vec2 vUv;
void main() {
  int i = int(aSide + 0.5);
  vec3 from = position - uEyeAt[i], turned = uGaze[i] * from;
  mat4 head = lrBone(uHeadBone);
  vec4 wp = modelMatrix * (head * vec4(uEyeAt[i] + turned, 1.0));
  vRel = wp.xyz; vN = mat3(modelMatrix) * (mat3(head) * (uGaze[i] * normal)); vOwn = normalize(turned); vBall = normalize(from); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - lrCurveDrop(wp.xz), wp.z, 1.0);
}`;

const eyeFragment = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
${shadowGLSL}
uniform sampler2D tEye;
uniform float uSeen;        // how much of her head is drawn (0: you look out of it)
uniform float uBlink;       // 0 open .. 1 shut
uniform float uWaterY;
uniform float uShowUnder;
in vec3 vRel;
in vec3 vN;
in vec3 vOwn;
in vec3 vBall;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (uSeen < 0.02 + 0.96 * grain) discard;
  vec3 n = normalize(vN), V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  vec3 base = pow(texture(tEye, vUv).rgb, vec3(2.2));
  // (Dark brown eyes: the picture's iris is a studio's bright hazel, which in this sun came out red. What is
  // coloured in the picture is the iris, what is not is the white: only the iris is darkened.)
  float most = max(base.r, max(base.g, base.b)), coloured = smoothstep(0.008, 0.04, most - min(base.r, min(base.g, base.b)));
  base = mix(base * vec3(0.92, 0.9, 0.88), most * vec3(0.5, 0.3, 0.17), coloured);
  // (The white of an eye is not white: it is in the shade of its lids and lashes, darkest along the top. The
  // lid comes down over it in a blink.)
  float lid = smoothstep(0.75 - 1.6 * uBlink, 0.05 - 1.6 * uBlink, vOwn.y);
  float cloud = lrCloudShadow(uCamXZ + vRel.xz), nl = dot(n, uSunDir), sun = lrSunThrough(cloud, vRel, n) * smoothstep(-0.05, 0.3, nl);
  vec3 light = uSunE * sun * lrSaturate(nl) * 0.8 + uSkyE * (0.45 + 0.35 * n.y) + (uSunE * lrSaturate(uSunDir.y) * cloud + uSkyE) * vec3(0.6, 0.55, 0.47) * 0.25;
  vec3 col = base * light / PI * (0.35 + 0.65 * lid);
  // The catch of light: the eye is wet, and the bright sky and the sun show in it as a small sharp glint.
  vec3 h = normalize(uSunDir + V);
  col += uSunE * sun * pow(lrSaturate(dot(n, h)), 900.0) * 0.6 * lid + (0.02 + 0.3 * pow(1.0 - lrSaturate(dot(n, V)), 5.0)) * uSkyE / PI * lid;
  float below = uWaterY - vRel.y;
  if (below > 0.0 && uShowUnder > 0.5) { outColor = vec4(col * PI / max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4)), below); return; }
  outColor = vec4(col, -1000.0);
}`;

const lashVertex = skinning => /* glsl */`
#include <lr_common>
${skinning}
uniform float uBlink;
uniform float uBlinkBy;     // metres a lash goes when the bytes of aBlink say one
in vec3 aBlink;
in float aKind;             // 0 a lash, 1 a brow
out vec3 vRel;
out vec3 vN;
out vec2 vUv;
out float vKind;
void main() {
  mat4 skin = lrSkin();
  vec4 wp = modelMatrix * (skin * vec4(position + aBlink * (uBlink * uBlinkBy), 1.0));
  vRel = wp.xyz; vN = mat3(modelMatrix) * (mat3(skin) * normal); vUv = uv; vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - lrCurveDrop(wp.xz), wp.z, 1.0);
}`;

const lashFragment = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
uniform sampler2D tLash;
uniform sampler2D tBrow;
uniform float uSeen;
in vec3 vRel;
in vec3 vN;
in vec2 vUv;
in float vKind;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 tex = vKind > 0.5 ? texture(tBrow, vUv) : texture(tLash, vUv);
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (tex.a < 0.15 + 0.5 * grain || uSeen < 0.02 + 0.96 * grain) discard;
  // (Dark hairs: her own dark brown, lit a little by sun and sky.)
  float cloud = lrCloudShadow(uCamXZ + vRel.xz);
  vec3 col = vec3(0.03, 0.02, 0.015) * (uSunE * cloud * 0.5 + uSkyE) / PI;
  outColor = vec4(col, -1000.0);
}`;

export class Face {
  /**
   * @param {{info: object, arrays: object, pictures: {eye: THREE.Texture, lash: THREE.Texture, brow: THREE.Texture}}} data
   * @param {string} skinning  the body's skinning GLSL (figure.js)
   * @param {object} of  the body's uniforms: its bones, and the sea she is in
   * @param {number} shadowTaps
   */
  constructor({ info, arrays, pictures }, skinning, of, shadowTaps) {
    const head = info.bones.findIndex(b => b.name === 'head'), at = name => new THREE.Vector3(...info.bones.find(b => b.name === name).head);
    this.gaze = [new THREE.Matrix3(), new THREE.Matrix3()];
    const seen = { value: 0 }, blink = { value: 0 };
    const e = new THREE.BufferGeometry();
    e.setAttribute('position', new THREE.BufferAttribute(arrays['eye.position'], 3));
    e.setAttribute('normal', new THREE.BufferAttribute(arrays['eye.normal'], 3, true));
    e.setAttribute('uv', new THREE.BufferAttribute(arrays['eye.uv'], 2, true));
    e.setAttribute('aSide', new THREE.BufferAttribute(arrays['eye.side'], 1, false));
    e.setIndex(new THREE.BufferAttribute(arrays['eye.index'], 1));
    this.eyes = new THREE.Mesh(e, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: eyeVertex(skinning), fragmentShader: eyeFragment, side: THREE.FrontSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.cloudShadow, ...CHUNK_UNIFORMS.shadow], {
        tBones: of.tBones, uHeadBone: { value: head }, uEyeAt: { value: [at('eye.L'), at('eye.R')] }, uGaze: { value: this.gaze }, tEye: { value: pictures.eye }, uSeen: seen, uBlink: blink, uWaterY: of.uWaterY, uShowUnder: of.uShowUnder }),
    }));
    const l = new THREE.BufferGeometry();
    l.setAttribute('position', new THREE.BufferAttribute(arrays['lash.position'], 3));
    l.setAttribute('normal', new THREE.BufferAttribute(arrays['lash.normal'], 3, true));
    l.setAttribute('uv', new THREE.BufferAttribute(arrays['lash.uv'], 2, true));
    l.setAttribute('aJoints', new THREE.BufferAttribute(arrays['lash.joints'], 4, false));
    l.setAttribute('aWeights', new THREE.BufferAttribute(arrays['lash.weights'], 4, true));
    l.setAttribute('aBlink', new THREE.BufferAttribute(arrays['lash.blink'], 3, true));
    l.setAttribute('aKind', new THREE.BufferAttribute(arrays['lash.kind'], 1, false));
    l.setIndex(new THREE.BufferAttribute(arrays['lash.index'], 1));
    this.hairs = new THREE.Mesh(l, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: lashVertex(skinning), fragmentShader: lashFragment, side: THREE.DoubleSide,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.cloudShadow], { tBones: of.tBones, tLash: { value: pictures.lash }, tBrow: { value: pictures.brow }, uSeen: seen, uBlink: blink, uBlinkBy: { value: info.face.lashes.blinkScale } }),
    }));
    for (const m of [this.eyes, this.hairs]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false; }
    this.seen = seen; this.blinkNow = blink;
    this.state = { next: 2.5, t: -1, count: 0, turned: 0, dart: [0, 0], dartTo: [0, 0], dartIn: 1.5 };
  }

  /** Where she is (the body's own matrix), and how much of her head is drawn. */
  place(matrix, seen) { for (const m of [this.eyes, this.hairs]) { m.matrix.copy(matrix); m.matrixWorld.copy(matrix); m.visible = seen > 0; } this.seen.value = seen; }

  /**
   * Her eyes for this frame.
   * @param {number} dt
   * @param {number} yaw  how far to her right of her head's own facing she is looking (radians), and
   * @param {number} pitch  how far above it (what of your look her head has not taken; or towards the camera, when she glances at it)
   * @param {number} turning  how fast her head is turning (rad/s): a quick turn brings on a blink
   * @param {() => number} random  0..1
   * @returns {number} how far her eyes are shut, 0..1 (the skin of her lids takes the same: figure.js)
   */
  update(dt, yaw, pitch, turning, random = Math.random) {
    const s = this.state;
    if (dt > 0) {
      // A blink: twelve to twenty a minute, a fifth of a second each, shut quicker than opened; and one as her head swings round.
      s.next -= dt; s.turned = Math.max(0, s.turned - dt);
      if (s.t < 0 && (s.next <= 0 || (Math.abs(turning) > 2.2 && s.turned <= 0))) { s.t = 0; s.count++; s.next = 3 + 2 * random(); s.turned = 1.2; }
      if (s.t >= 0) { s.t += dt; if (s.t > 0.24) s.t = -1; }
      // Her eyes are never quite still: every second or two they move a degree or two and settle.
      s.dartIn -= dt;
      if (s.dartIn <= 0) { s.dartTo = [(random() - 0.5) * 0.07, (random() - 0.5) * 0.04]; s.dartIn = 0.8 + 1.8 * random(); }
      for (let c = 0; c < 2; c++) s.dart[c] += (s.dartTo[c] - s.dart[c]) * (1 - Math.exp(-dt * 40));
    }
    const shut = s.t < 0 ? 0 : s.t < 0.07 ? s.t / 0.07 : s.t < 0.1 ? 1 : Math.max(0, 1 - (s.t - 0.1) / 0.14), blink = shut * shut * (3 - 2 * shut);
    this.blinkNow.value = blink;
    // (An eye turns no further than an eye does: 35 degrees to the side, 25 up, 30 down.)
    const a = Math.max(-0.6, Math.min(0.6, yaw + s.dart[0])), b = Math.max(-0.52, Math.min(0.44, pitch + s.dart[1])), ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    // (Forward is -z: turning right about +y by -a; looking up about +x by +b.)
    for (const g of this.gaze) g.set(ca, -sa * sb, -sa * cb, 0, cb, -sb, sa, ca * sb, ca * cb);
    return blink;
  }

  /** How many times she has blinked (tests). */
  get blinks() { return this.state.count; }
}
