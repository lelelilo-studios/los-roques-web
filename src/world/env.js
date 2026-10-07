// The sky as the sea sees it: a small panorama of the upper half of the sky, clouds and all, drawn from just
// above the water under the camera and refreshed a few times a second. Reflections (the sea, the film on wet
// sand, the surface seen from below) look things up in it through lrEnv() in lr_atmosphere; its mips serve
// rough water. The sun itself is not in it: the glitter draws that.
import * as THREE from 'three';
import { FullscreenPass } from '../core/framegraph.js';
import { CHUNK_UNIFORMS, shared, uniformsFor } from '../core/uniforms.js';

const W = 512, H = 160;

const envFragment = /* glsl */`
#include <lr_common>
#include <lr_atmosphere>
#include <lr_clouds>
uniform float uEnvClouds;
uniform vec2 uSteps;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  // u = bearing (clockwise from north), v = square root of the elevation: more rows near the horizon, where
  // most of what a level surface reflects towards a low eye comes from.
  float az = vUv.x * 6.28318530718, el = vUv.y * vUv.y * 1.57079632679;
  vec3 dir = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
  vec3 col = lrSkyRadiance(normalize(vec3(dir.x, max(dir.y, 0.004), dir.z)));
  if (uEnvClouds > 0.5) {
    float dist, jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 from = vec3(0.0, uSeaLevel + 2.0, 0.0);
    vec4 c = lrCloudMarch(from, dir, jitter, int(uSteps.x), int(uSteps.y), 1e9, 0.0123, dist);
    if (c.a < 0.999) {
      vec3 lum, trans;
      lrScatter(lrAtmoPos(from.y), dir, uSunDir, dist * 1e-3, 4, lum, trans);
      c.rgb = c.rgb * trans + uSunToa * lum * (1.0 - c.a);
    }
    col = col * c.a + c.rgb;
  }
  outColor = vec4(min(col, vec3(6000.0)), 1.0);
}`;

export class EnvMap {
  /** @param {object|null} quality  the tier's cloud settings (null: no clouds, the panorama is clear sky) */
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace });
    Object.assign(this.target.texture, { wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true });
    this.pass = new FullscreenPass(envFragment, uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.atmosphere.filter(n => n !== 'tEnv'), ...CHUNK_UNIFORMS.clouds],
      { uEnvClouds: { value: 0 }, uSteps: { value: new THREE.Vector2(quality ? Math.min(quality.steps, 32) : 1, quality ? Math.min(quality.lightSteps, 3) : 1) } }));
    shared.tEnv.value = this.target.texture;
    this.frame = 0;
  }

  /** Call once per frame after the sky and the clouds are up to date. `still` (a frozen clock) redraws every time. */
  update(cloudsOn, still) {
    if (!still && this.frame++ % 6 !== 0) return;
    this.pass.material.uniforms.uEnvClouds.value = cloudsOn ? 1 : 0;
    const previous = this.renderer.getRenderTarget();
    this.pass.render(this.renderer, this.target);
    this.renderer.setRenderTarget(previous);
  }
}
