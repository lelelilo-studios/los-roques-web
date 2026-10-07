// Full-screen passes and the order of the frame.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, shared, uniformsFor } from './uniforms.js';
import { Bloom } from '../post/bloom.js';

const TRIANGLE = new THREE.BufferGeometry();
TRIANGLE.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const NO_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);   // unused by the shader; the renderer still wants a full camera
const FULLSCREEN_VERTEX = /* glsl */`
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.5, 1.0); }`;

/** A fragment shader run over the whole target (`in vec2 vUv`, write `outColor`). */
export class FullscreenPass {
  constructor(fragmentShader, uniforms = {}) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(TRIANGLE, this.material);
    this.mesh.frustumCulled = false;
  }
  render(renderer, target, layer = 0) { renderer.setRenderTarget(target, layer); renderer.render(this.mesh, NO_CAMERA); }
}

const copyFragment = /* glsl */`
uniform sampler2D tSrc;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() { outColor = texture(tSrc, vUv); }`;

// Sky behind everything, the sea beyond the edge of the mesh, and the haze of distance.
const compositeFragment = /* glsl */`
#include <lr_common>
#include <lr_optics>
#include <lr_atmosphere>
uniform highp sampler2DArray tWaveC;   // curvature of the wave cascades (for the light shafts under water)
uniform vec4 uWaveTile;
uniform vec2 uWaveCamMod[4];
uniform vec4 uWaveCurve;
uniform vec4 uWaveHere;                // height of each cascade's waves where the camera is
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tCloud;      // rgb = cloud radiance, a = how much shows through (1 = no cloud)
uniform float uCloudOn;
uniform float uStarTurn;       // radians the star field has turned
uniform vec3 uWind;
uniform float uRain;
uniform float uUnderEye;       // 1 when the eye itself is under the sea surface
uniform sampler2D tWaterType;

// Falling rain. The drops are streaks on cylinders round the eye whose axis is the way they fall (down, slanted
// by the wind): looking level they cross the view at that slant, looking down they run together towards your
// feet, as rain does. Three cylinders, 1.5 to 10 m away; nothing is drawn beyond what the pixel shows.
float lrRain(vec3 dir, float far) {
  vec3 fall = normalize(vec3(uWind.x * uWind.z, -9.0, uWind.y * uWind.z));               // drops fall at about 9 m/s
  vec3 e1 = normalize(cross(fall, vec3(0.0, 0.0, 1.0))), e2 = cross(fall, e1);
  float along = dot(dir, fall), across = sqrt(max(1.0 - along * along, 1e-4));
  float az = atan(dot(dir, e1), dot(dir, e2)) * 0.15915494 + 0.5, h = along / across;     // round the axis (0..1); along it, per metre of radius
  float pixel = length(dFdx(dir)) / across * 0.15915494, a = 0.0;
  for (int i = 0; i < 3; i++) {
    float radius = i == 0 ? 1.5 : i == 1 ? 4.0 : 10.0;
    if (radius / across > far) continue;
    // (The eye holds a drop for about a thirtieth of a second: a streak a foot long. Each cell of the cylinder
    // holds one or none, somewhere across it; a streak thinner than a pixel is drawn a pixel wide and fainter.)
    float count = floor(6.2832 * radius / (0.035 + 0.015 * float(i))), tall = 0.7;
    vec2 p = vec2(az * count, (h * radius - uTime * 9.0) / tall);
    p.y += lrHash12(vec2(floor(p.x), 3.0 + float(i))) * 31.0;                    // (each column on its own beat: no rows of drops)
    vec2 cell = floor(p), f = fract(p);
    float pick = lrHash12(cell + 17.0 * float(i)), at = 0.5 + (lrHash12(cell + 5.0) - 0.5) * 0.7, len = 0.3 + 0.25 * lrHash12(cell + 9.0);
    float thick = 0.0015 / (6.2832 * radius) * count, wide = max(pixel * count, thick);
    a += step(0.5, pick) * (0.4 + 0.6 * pick) * smoothstep(wide, 0.0, abs(f.x - at)) * min(thick / wide * 2.2, 1.0)
       * smoothstep(0.0, 0.06, f.y) * smoothstep(len, len * 0.5, f.y);
  }
  return a * smoothstep(0.05, 0.3, across);
}
uniform vec3 uCamRight, uCamUp, uCamFwd;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 scene = texture(tScene, vUv);
  float depth = texture(tDepth, vUv).r;
  vec3 ray = uCamFwd + (vUv.x * 2.0 - 1.0) * uCamRight + (vUv.y * 2.0 - 1.0) * uCamUp;
  vec3 dir = normalize(ray);
  vec3 col;
  // Is this pixel looked at through water? Decided per pixel from what was drawn, so the waterline across the
  // lens falls exactly where the sea surface cuts the view: a submerged thing the water pass did not cover
  // (alpha = its depth, positive; only next to the lens, where the surface is cut by the near plane, or with
  // the eye under water) or the surface seen from below (alpha -3000); empty pixels go by where the eye is.
  bool near = !lrIsSky(depth) && lrViewZ(depth) < 1.0;
  bool throughWater = (scene.a > 0.0 && (near || uUnderEye > 0.5)) || scene.a < -2500.0 || (lrIsSky(depth) && uUnderEye > 0.5);
  if (throughWater) {
    // Things under water write reflectance and their depth below the surface: light them with what daylight
    // is left at that depth, then let the water between dim them and add its own glow.
    float lagoon = texture(tWaterType, lrMapUV(uCamXZ)).r;
    vec3 a = mix(uAbsOcean, uAbsLagoon, lagoon), bb = mix(uBbOcean, uBbLagoon, lagoon), kd = a + bb, c = a + 4.0 * bb;
    vec3 surfaceLight = uSunE * lrSaturate(uSunDir.y) + uSkyE;
    float far = lrIsSky(depth) ? 1e4 : lrViewZ(depth) * length(ray);
    vec3 seen = scene.a > 0.0 ? scene.rgb / PI * surfaceLight * 0.9 * exp(-kd * scene.a) : scene.rgb;
    if (lrIsSky(depth)) seen = vec3(0.0);
    // The water's own glow: daylight scattered back towards the eye, brighter looking up, darker looking down.
    float eyeDepth = max(uSeaLevel - uCamY, 0.0);
    vec3 glow = surfaceLight * 0.9 * exp(-kd * max(eyeDepth - dir.y * 3.0, 0.0)) * bb / kd * 0.5;
    vec3 through = exp(-c * far);
    if (uSunDir.y > 0.05) {
      // Shafts of sunlight: the water glows more where the waves above focus the sun and less between. A few
      // samples along the first metres of the view, each traced up the (bent) sunlight to the surface.
      vec3 sunIn = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.34);
      vec4 w = uWaveHere;
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))), beams = 0.0, total = 0.0;
      for (int i = 0; i < 6; i++) {
        float t = (float(i) + jitter) * 0.55;
        if (t > far) break;
        vec3 p = vec3(0.0, uCamY, 0.0) + dir * t;
        float under = uSeaLevel - p.y;
        if (under < 0.03) continue;
        float path = under / max(-sunIn.y, 0.3), kd = 0.254 * path, weight = exp(-0.35 * t);
        vec2 entry = p.xz - sunIn.xz * path;
        vec3 h = vec3(0.0);
        for (int k = 2; k < 4; k++) {
          float bend = kd * w[k] * uWaveCurve[k];
          h += w[k] / (1.0 + bend * bend) * textureLod(tWaveC, vec3((entry + uWaveCamMod[k]) / uWaveTile[k], float(k)), log2(max((path * 0.0093 + 0.03) * 256.0 / uWaveTile[k], 1.0))).xyz;
        }
        beams += weight * min(1.0 / max(abs((1.0 + kd * h.x) * (1.0 + kd * h.y) - kd * kd * h.z * h.z), 0.2), 3.5);
        total += weight;
      }
      // (Looking along the light the beams are strongest.)
      if (total > 0.0) glow *= mix(1.0, pow(beams / total, 1.6), 0.9) * (1.0 + 1.2 * pow(lrSaturate(dot(dir, -sunIn)), 3.0));
    }
    col = seen * through + glow * (1.0 - through);
    // Motes: specks of drifting matter catching the light, near the eye.
    for (int l = 0; l < 3; l++) {
      float t = 0.3 + 0.45 * float(l);
      if (t > far) break;
      vec3 p = (vec3(uCamMod.x, uCamY, uCamMod.y) + dir * t + vec3(0.03, -0.012, 0.017) * uTime) * 7.0, cell = floor(p);
      vec2 h = lrHash22(cell.xz + cell.y * 37.0 + float(l) * 11.0);
      vec3 q = fract(p) - 0.5 - (vec3(h, fract(h.x * 7.3)) - 0.5) * 0.7;
      float miss = length(q - dir * dot(q, dir)) / 7.0;
      col += surfaceLight / PI * 0.3 * step(0.72, h.y) * (1.0 - smoothstep(0.0, 0.0018, miss)) * exp(-kd * eyeDepth);
    }
    outColor = vec4(col, 1.0);
    return;
  }
  if (lrIsSky(depth)) {
    // The horizon of a round Earth sits a little below eye level; under it lies open sea.
    float dip = -sqrt(2.0 * max(uCamY - uSeaLevel, 0.0) * uInvEarthR);
    if (dir.y >= dip) {
      col = lrSkyRadiance(dir);
      // Stars, once the sky is dark enough to show them (they turn with the hour).
      float dark = 1.0 - smoothstep(0.0005, 0.02, lrLuma(col));
      if (dark > 0.0) {
        float a = uStarTurn, ca = cos(a), sa = sin(a);
        vec3 sd = vec3(dir.x, dir.y * ca - dir.z * sa, dir.y * sa + dir.z * ca);       // tipped about the east-west axis
        vec2 cell = floor(vec2(atan(sd.z, sd.x), asin(clamp(sd.y, -1.0, 1.0))) * 180.0);
        vec2 h = lrHash22(cell);
        vec2 f = fract(vec2(atan(sd.z, sd.x), asin(clamp(sd.y, -1.0, 1.0))) * 180.0) - 0.5 - (h - 0.5) * 0.6;
        float star = step(0.992, lrHash12(cell + 7.0)) * smoothstep(0.12, 0.0, length(f));
        col += dark * star * (0.0015 + 0.018 * h.x * h.x) * mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), h.y) * smoothstep(0.0, 0.15, dir.y);
      }
      // The sun's disc (0.53 degrees across; after dark the moon's, which is as wide), dimmed by the air it
      // shines through and capped for the bloom.
      float disc = smoothstep(0.999985, 0.999991, dot(dir, uSunDir));
      if (disc > 0.0) col += disc * min(uSunToa * lrTransmittanceToSun(lrAtmoPos(uCamY), uSunDir) / 6.8e-5, 400.0 * uSunToa);
    } else {
      // The open sea beyond the mesh, shaded like the mesh: a rough surface whose slope variance follows the
      // wind (Cox & Munk), the deep-water colour under it, the sky and the sun's glitter on top.
      float mu = clamp(dip - dir.y, 0.0, 1.0);
      vec2 var = vec2(0.5 * (0.003 + 0.00512 * uWind.z));
      vec3 up = vec3(0.0, 1.0, 0.0), V = normalize(vec3(-dir.x, max(-dir.y, 0.002), -dir.z));
      float fresnel = lrMeanFresnel(mu, sqrt(var.x));
      vec3 sea = lrWaterRrs(vec3(0.0), 1000.0, lrCosInWater(lrSaturate(uSunDir.y)), lrCosInWater(mu), uAbsOcean, uBbOcean)
               * (uSunE * lrSaturate(uSunDir.y) + uSkyE) * (1.0 - fresnel);
      vec3 refl = reflect(-V, up);
      sea += lrEnv(normalize(vec3(refl.x, abs(refl.y) + 0.01, refl.z)), var.x) * fresnel;
      sea += uSunE * min(lrSunGlitter(V, up, uSunDir, var), 400.0) * step(0.0, uSunDir.y);
      col = lrAerial(sea, dir, min((uCamY - uSeaLevel) / max(-dir.y, 1e-4), 400000.0));
    }
  } else {
    // (Sand marked as under water that the sea's mesh did not reach, at some far shoreline: light it as it lies.)
    if (scene.a > -0.6) scene.rgb *= (uSunE * lrSaturate(uSunDir.y) + uSkyE) / PI;
    col = lrAerial(scene.rgb, dir, lrViewZ(depth) * length(ray));
  }
  if (uCloudOn > 0.5) {
    // The clouds were marched at reduced size with a different starting offset per pixel: a small tent blur
    // turns that grain into soft edges.
    vec2 t = 1.0 / vec2(textureSize(tCloud, 0));
    vec4 cloud = texture(tCloud, vUv) * 0.4 + 0.15 * (texture(tCloud, vUv + t * vec2(0.9, 0.4)) + texture(tCloud, vUv + t * vec2(-0.4, 0.9))
               + texture(tCloud, vUv + t * vec2(-0.9, -0.4)) + texture(tCloud, vUv + t * vec2(0.4, -0.9)));
    col = col * cloud.a + cloud.rgb;
  }
  if (uRain > 0.01) {
    // Rain: a grey veil that thickens with distance (over sea, land and the foot of the sky alike; overhead the
    // rain is only as deep as the cloud base is high), then the streaks nearest the eye.
    vec3 grey = uSkyE / PI;
    float far = lrIsSky(depth) ? min(30000.0, 700.0 / max(dir.y, 0.02)) : lrViewZ(depth) * length(ray);
    col = mix(col, grey, uRain * (1.0 - exp(-far / 2500.0)) * 0.9);
    col += uRain * lrRain(dir, lrIsSky(depth) ? 1e5 : far) * uSkyE / PI * 0.55;
  }
  outColor = vec4(col, 1.0);
}`;

// HDR -> display values (with a little bloom), luma in alpha for the anti-aliasing pass.
const tonemapFragment = /* glsl */`
#include <lr_common>
#include <lr_optics>
uniform sampler2D tHDR;
uniform sampler2D tBloom;
uniform float uBloom;        // share of the picture replaced by its blurred self
uniform float uBloomGain;
uniform float uExposure;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 hdr = mix(texture(tHDR, vUv).rgb, texture(tBloom, vUv).rgb * uBloomGain, uBloom);
  vec3 c = lrTonemap(hdr * uExposure, 1.25);
  outColor = vec4(c, dot(c, vec3(0.299, 0.587, 0.114)));
}`;

// FXAA (Timothy Lottes' compact version) and the copy to the canvas, which may be larger than the render size.
const fxaaFragment = /* glsl */`
#include <lr_common>
uniform sampler2D tLDR;
uniform vec2 uTexel;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 m = texture(tLDR, vUv);
  float nw = texture(tLDR, vUv + uTexel * vec2(-1.0, -1.0)).a, ne = texture(tLDR, vUv + uTexel * vec2(1.0, -1.0)).a;
  float sw = texture(tLDR, vUv + uTexel * vec2(-1.0, 1.0)).a, se = texture(tLDR, vUv + uTexel * vec2(1.0, 1.0)).a;
  float lo = min(m.a, min(min(nw, ne), min(sw, se))), hi = max(m.a, max(max(nw, ne), max(sw, se)));
  vec3 c = m.rgb;
  if (hi - lo > max(0.0312, hi * 0.125)) {
    vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
    float reduce = max((nw + ne + sw + se) * 0.03125, 0.0078125);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * uTexel;
    vec4 a = 0.5 * (texture(tLDR, vUv + dir * (1.0 / 3.0 - 0.5)) + texture(tLDR, vUv + dir * (2.0 / 3.0 - 0.5)));
    vec4 b = a * 0.5 + 0.25 * (texture(tLDR, vUv - dir * 0.5) + texture(tLDR, vUv + dir * 0.5));
    c = (b.a < lo || b.a > hi) ? a.rgb : b.rgb;
  }
  c += (lrHash12(gl_FragCoord.xy) - 0.5) / 255.0;            // dither against banding in sky and water gradients
  outColor = vec4(c, 1.0);
}`;

/** Owns the passes and runs one frame: opaque -> copy -> water -> composite -> final. */
export class FrameGraph {
  constructor(R) {
    this.R = R;
    const { targets } = R;
    this.copy = new FullscreenPass(copyFragment, { tSrc: { value: targets.scene.texture } });
    this.composite = new FullscreenPass(compositeFragment, uniformsFor(
      [...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.optics, ...CHUNK_UNIFORMS.atmosphere, 'uCamRight', 'uCamUp', 'uCamFwd', 'uWind', 'uRain', 'tWaterType', 'uUnderEye', 'tWaveC', 'uWaveTile', 'uWaveCamMod', 'uWaveCurve', 'uWaveHere'],
      { tScene: { value: targets.scene.texture }, tDepth: { value: targets.scene.depthTexture }, tCloud: { value: null }, uCloudOn: { value: 0 }, uStarTurn: { value: 0 } }));
    this.bloom = new Bloom(6);
    this.tonemap = new FullscreenPass(tonemapFragment, uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.optics, 'uExposure'],
      { tHDR: { value: targets.hdr.texture }, tBloom: { value: null }, uBloom: { value: 0.04 }, uBloomGain: { value: 1 } }));
    this.fxaa = new FullscreenPass(fxaaFragment, uniformsFor(CHUNK_UNIFORMS.common, { tLDR: { value: targets.ldr.texture }, uTexel: { value: new THREE.Vector2() } }));
    this.clearValue = new Float32Array([0, 0, 0, -1000]);
  }

  /** @param {THREE.Object3D} opaque  @param {THREE.Object3D} water  @param {THREE.Camera} camera  @param {Clouds} clouds */
  render(opaque, water, camera, clouds = null) {
    const { renderer, targets, size } = this.R;
    shared.uInvResolution.value.set(1 / size.width, 1 / size.height);
    renderer.info.reset();

    renderer.setRenderTarget(targets.scene);
    renderer.clear(false, true, false);
    // Alpha -1000 = "nothing here" for the water pass (alpha 0 would read as a bed at the surface). Float targets
    // take the value as is; three's own clear colour is meant for 0..1.
    renderer.getContext().clearBufferfv(renderer.getContext().COLOR, 0, this.clearValue);
    renderer.render(opaque, camera);

    this.copy.render(renderer, targets.refr);

    renderer.setRenderTarget(targets.scene);
    renderer.render(water, camera);

    const cu = this.composite.material.uniforms;
    cu.uCloudOn.value = clouds?.render(targets.scene.depthTexture, size.width, size.height) ? 1 : 0;
    cu.tCloud.value = clouds?.target?.texture || null;
    cu.uStarTurn.value = this.starTurn || 0;
    this.composite.render(renderer, targets.hdr);
    if (this.bloomSize !== size.width * 65536 + size.height) { this.bloom.setSize(size.width, size.height); this.bloomSize = size.width * 65536 + size.height; }
    this.bloom.render(renderer, targets.hdr);
    const t = this.tonemap.material.uniforms;
    t.tBloom.value = this.bloom.texture; t.uBloomGain.value = this.bloom.gain;
    this.tonemap.render(renderer, targets.ldr);
    this.fxaa.material.uniforms.uTexel.value.set(1 / size.width, 1 / size.height);
    this.fxaa.render(renderer, null);
  }
}
