// Bloom: the glow of things brighter than the display can show (sun glitter, the sun's disc, white sand at noon).
// A chain of half-size blurs added back at a few percent, so nothing gains or loses energy overall.
import * as THREE from 'three';
import { FullscreenPass } from '../core/framegraph.js';

// "Dual filter" blur (Bjorge 2015): each step down reads 5 bilinear taps, each step up 8.
const downFragment = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;        // one source texel
uniform float uClamp;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(min(c / 8.0, vec3(uClamp)), 1.0);   // the first step also tames single-pixel sparkles
}`;
const upFragment = /* glsl */`
uniform sampler2D tSrc;
uniform sampler2D tAdd;     // the sharper level this one is folded into
uniform vec2 uTexel;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 c = texture(tSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb + texture(tSrc, vUv + uTexel * vec2(2.0, 0.0)).rgb
         + texture(tSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb + texture(tSrc, vUv + uTexel * vec2(0.0, 2.0)).rgb;
  c += 2.0 * (texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
            + texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  outColor = vec4(c / 12.0 + texture(tAdd, vUv).rgb, 1.0);
}`;

export class Bloom {
  constructor(levels = 6) {
    const rt = () => new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace,
    });
    this.down = Array.from({ length: levels }, rt);
    this.up = Array.from({ length: levels - 1 }, rt);
    this.downPass = new FullscreenPass(downFragment, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uClamp: { value: 1e4 } });
    this.upPass = new FullscreenPass(upFragment, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.levels = levels;
  }
  setSize(w, h) {
    this.down.forEach((t, i) => t.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
    this.up.forEach((t, i) => t.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
  }
  /** Blurs `source` (a render target); the result is in `this.texture`, normalised to the source's brightness. */
  render(renderer, source) {
    const d = this.downPass.material.uniforms, u = this.upPass.material.uniforms;
    let src = source;
    this.down.forEach((t, i) => {
      d.tSrc.value = src.texture; d.uTexel.value.set(1 / src.width, 1 / src.height); d.uClamp.value = i === 0 ? 60 : 1e4;
      this.downPass.render(renderer, t);
      src = t;
    });
    // Fold the levels back up: each result = blur of the level below + this level.
    for (let i = this.levels - 2; i >= 0; i--) {
      u.tSrc.value = src.texture; u.tAdd.value = this.down[i].texture; u.uTexel.value.set(1 / src.width, 1 / src.height);
      this.upPass.render(renderer, this.up[i]);
      src = this.up[i];
    }
    this.texture = src.texture;
    this.gain = 1 / this.levels;
  }
}
