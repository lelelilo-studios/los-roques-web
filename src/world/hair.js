// Her hair: MakeHuman's ponytail (web/data/body, fitted to her head by pipeline/body/build.mjs), tied back, a
// tail to between her shoulder blades. Over her skull it goes with her head; the tail is four lengths on a
// chain (hairtail.js) that hangs, lags, swings and leans downwind, and the hair modelled along it goes with
// the length it is on, shared with the one before so that it bends and is not hinged.
//
// It is drawn with the solid things, cut where its picture is clear: grain by grain across the edge of a
// strand, so that the edge is soft without anything having to be drawn through anything. Its light is a
// strand's: brightest seen across the strands with the sun across them, with two sheens along it, a narrow pale
// one and a broad one of its own colour (Kajiya and Kay's, as Scheuermann shifted them). Wet from a dive it is
// darker and its sheen narrow and bright; it dries over a few minutes.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { CASTER_UNIFORMS, casterGLSL, shadowGLSL } from './shadow.js';
import { Tail, TAIL } from './hairtail.js';

// Where a vertex of the hair is: with her head (aDown 0), or on the tail, between the frame of the length before
// it and its own.
const placeGLSL = /* glsl */`
uniform mat4 uLink[5];      // a point of the hair at rest to where it is (relative to the camera): [0] her head, [1..4] the tail's lengths
in float aDown;             // 0 with her head .. 1 the end of the tail
vec4 lrHair(vec3 p) {
  float c = aDown * 4.0, k = min(3.0, floor(c));
  int i = int(k);
  return mix(uLink[i] * vec4(p, 1.0), uLink[i + 1] * vec4(p, 1.0), c - k);
}
vec3 lrHairTurn(vec3 v) {
  float c = aDown * 4.0, k = min(3.0, floor(c));
  int i = int(k);
  return mix(mat3(uLink[i]) * v, mat3(uLink[i + 1]) * v, c - k);
}`;

const vertexShader = /* glsl */`
#include <lr_common>
${placeGLSL}
in vec3 aStrand;
out vec3 vRel;
out vec3 vN;
out vec3 vT;
out vec2 vUv;
void main() {
  vec4 wp = lrHair(position);
  vRel = wp.xyz; vN = lrHairTurn(normal); vT = lrHairTurn(aStrand); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - lrCurveDrop(wp.xz), wp.z, 1.0);
}`;

const fragmentShader = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
${shadowGLSL}
uniform sampler2D tHair;
uniform float uHairWet;     // 0 dry .. 1 just out of the sea
uniform float uSeen;        // how much of it is drawn: 0 none (the camera is in her head) .. 1 all of it
uniform float uWaterY;      // the sea's surface where she is
uniform float uShowUnder;   // 1 = hand what is under water to the water pass
in vec3 vRel;
in vec3 vN;
in vec3 vT;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 tex = texture(tHair, vUv);
  // (Cut grain by grain across where the picture goes clear: the edge of a strand, and the ends of the tail.)
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (tex.a < 0.2 + 0.6 * grain || uSeen < 0.02 + 0.96 * grain) discard;
  vec3 n = normalize(vN), V = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  // (A sheet of hair is seen from both sides.)
  if (dot(n, V) < 0.0) n = -n;
  vec3 T = normalize(vT - n * dot(vT, n));
  float cloud = lrCloudShadow(uCamXZ + vRel.xz), nl = dot(n, uSunDir);
  float sun = mix(cloud, lrSunThrough(cloud, vRel, n), smoothstep(-0.1, 0.35, nl));
  // (Dark brown: the picture's own brown is a studio's, and in this sun it came out ginger. Its lighter ends,
  // bleached as hair is by sun and salt, are kept.)
  vec3 base = pow(tex.rgb, vec3(2.2));
  base = mix(vec3(dot(base, vec3(0.3, 0.59, 0.11))), base, 0.7) * vec3(0.5, 0.44, 0.4) * mix(1.0, 0.42, uHairWet);
  // Lit as strands are: by how square the light is to them, and round the head as a head is, the lit side
  // wrapping well round (light goes through and between hairs).
  float tl = dot(T, uSunDir), across = sqrt(max(0.0, 1.0 - tl * tl)), wrap = lrSaturate((nl + 0.45) / 1.45);
  vec3 bounce = (uSunE * lrSaturate(uSunDir.y) * cloud + 0.8 * uSkyE) * vec3(0.6, 0.55, 0.47) * (0.17 + 0.83 * (0.5 - 0.5 * n.y)) * 0.7;
  vec3 light = uSunE * sun * wrap * (0.45 + 0.55 * across) + uSkyE * (0.55 + 0.45 * n.y) + bounce;
  vec3 col = base * light / PI;
  // The two sheens along the strands: a narrow pale one a little towards the ends, a broad one of the hair's
  // own colour a little towards the roots. Each strand has its own, a little along from its neighbours'
  // (the picture's own streaks say where).
  vec3 H = normalize(uSunDir + V);
  float streak = (tex.g - 0.5 * (tex.r + tex.b)) * 2.0 + (tex.r - 0.35) * 0.5;
  float t1 = dot(normalize(T + n * (-0.1 + 0.25 * streak)), H), t2 = dot(normalize(T + n * (0.14 + 0.25 * streak)), H);
  float s1 = pow(sqrt(max(0.0, 1.0 - t1 * t1)), mix(110.0, 320.0, uHairWet)), s2 = pow(sqrt(max(0.0, 1.0 - t2 * t2)), 22.0);
  float lit = sun * smoothstep(-0.15, 0.25, nl);
  col += uSunE * lit * (s1 * mix(0.022, 0.1, uHairWet) + s2 * base * 0.6) / PI * 3.0;
  // (What of it is under the sea is handed on to the water, as her skin is: figure.js.)
  float below = uWaterY - vRel.y;
  if (below > 0.0 && uShowUnder > 0.5) { outColor = vec4(col * PI / max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4)), below); return; }
  outColor = vec4(col, -1000.0);
}`;

const casterVertex = /* glsl */`
#include <lr_common>
${casterGLSL}
${placeGLSL}
out vec2 vUv;
void main() { vUv = uv; gl_Position = lrShadowClip(lrHair(position).xyz); }`;
// (Its shadow is cut at one level: a shadow has no grain to spare.)
const casterFragment = /* glsl */`
uniform sampler2D tHair;
in float vTowards;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() { if (texture(tHair, vUv).a < 0.4) discard; outColor = vec4(vTowards, 0.0, 0.0, 1.0); }`;

export class Hair {
  /**
   * @param {{info: object, arrays: object, hair: THREE.Texture}} data  from loadFigure(): info.hair and the arrays named hair.*
   * @param {number} shadowTaps
   * @param {{uWaterY: {value: number}, uShowUnder: {value: number}}} shared  the body's own uniforms, so that both are under the same sea
   */
  constructor({ info, arrays, hair }, shadowTaps, shared) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arrays['hair.position'], 3));
    g.setAttribute('normal', new THREE.BufferAttribute(arrays['hair.normal'], 3, true));
    g.setAttribute('aStrand', new THREE.BufferAttribute(arrays['hair.strand'], 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(arrays['hair.uv'], 2, true));
    g.setAttribute('aDown', new THREE.BufferAttribute(arrays['hair.down'], 1, true));
    g.setIndex(new THREE.BufferAttribute(arrays['hair.index'], 1));
    this.links = [0, 1, 2, 3, 4].map(() => new THREE.Matrix4());
    const own = { uLink: { value: this.links }, tHair: { value: hair } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.cloudShadow, ...CHUNK_UNIFORMS.shadow], { ...own, uHairWet: { value: 0 }, uSeen: { value: 1 }, uWaterY: shared.uWaterY, uShowUnder: shared.uShowUnder }),
    }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.visible = false;
    /** What draws it into a shadow map (Shadows.render looks for this). */
    this.mesh.userData.caster = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: casterVertex, fragmentShader: casterFragment, side: THREE.DoubleSide,
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CASTER_UNIFORMS], own),
    });
    this.tail = new Tail(info.hair.links);
    this.bone = name => info.bones.findIndex(b => b.name === name);
    this.head = this.bone('head');
    this.balls = TAIL.balls.map(b => ({ bone: this.bone(b.bone), c: b.c, r: b.r }));
    this.wet = 0;
  }

  /** How much of it is drawn (0: the camera is in her head .. 1), and how wet it is (0..1). */
  show(seen, wet = this.wet) { this.mesh.material.uniforms.uSeen.value = seen; this.mesh.material.uniforms.uHairWet.value = this.wet = wet; this.mesh.visible = seen > 0; }

  /**
   * Puts it on her head as she is posed, and moves the tail on.
   * @param {Float32Array} bones  her bones' matrices (figurepose.js: 12 numbers a bone, rows)
   * @param {THREE.Matrix4} body  where she stands (the body's frame to the world, relative to the camera)
   * @param {number[]} origin  the camera's place in the world: [x, z]
   * @param {number} dt  @param {number[]} wind  the air's speed at her head, in the world (m/s)
   * @param {number} afloat  0 in the air .. 1 her head is under water
   */
  update(bones, body, origin, dt, wind, afloat = 0) {
    const e = body.elements, ox = origin[0], oz = origin[1];
    // (A point of her body at rest, carried by a bone, to the world.)
    const carried = (b, p) => {
      const o = b * 12, x = bones[o] * p[0] + bones[o + 1] * p[1] + bones[o + 2] * p[2] + bones[o + 3], y = bones[o + 4] * p[0] + bones[o + 5] * p[1] + bones[o + 6] * p[2] + bones[o + 7], z = bones[o + 8] * p[0] + bones[o + 9] * p[1] + bones[o + 10] * p[2] + bones[o + 11];
      return [e[0] * x + e[4] * y + e[8] * z + e[12] + ox, e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14] + oz];
    };
    const o = this.head * 12;
    this.links[0].set(bones[o], bones[o + 1], bones[o + 2], bones[o + 3], bones[o + 4], bones[o + 5], bones[o + 6], bones[o + 7], bones[o + 8], bones[o + 9], bones[o + 10], bones[o + 11], 0, 0, 0, 1).premultiply(body);
    this.tail.step(dt, p => carried(this.head, p), wind, this.balls.map(b => ({ c: carried(b.bone, b.c), r: b.r })), afloat);
    const h = this.links[0].elements, frames = this.tail.frames([[h[0], h[1], h[2]], [h[4], h[5], h[6]], [h[8], h[9], h[10]]], [ox, 0, oz]);
    for (let k = 0; k < 4; k++) this.links[k + 1].fromArray(frames[k]);
  }
}
