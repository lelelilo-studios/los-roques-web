// What is on your skin, where it is: a map over the body's own surface (its texture coordinates) of how wet each
// part is and how much sand is stuck to it. Whatever of you is under the sea's surface is wet; it dries in a
// couple of minutes. Whatever of you touches the sand takes some on: a little if both are dry (it drops off
// again in seconds), a coat if either is wet (it stays until the skin dries, or the sea washes it off). So the
// palm you pressed into the sand is sandy and the back of that hand is not; you are wet to the line the water
// reached, sitting or standing; your calves carry the sand you sat on.
//
// Each frame the body is drawn once more, laid flat (each vertex at its texture coordinate), and every texel
// asks where on the beach that point of skin is now. (The figure's shader reads the map: figure.js.)
import * as THREE from 'three';
import { skinningGLSL } from '../world/figure.js';

const vertex = /* glsl */`
${skinningGLSL}
out vec3 vAt;       // where this point of skin is (x, z relative to the camera, y absolute)
out vec2 vUv;
void main() {
  vec4 wp = modelMatrix * (lrSkin() * vec4(position, 1.0));
  vAt = wp.xyz; vUv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
const fragment = /* glsl */`
precision highp float;
uniform sampler2D tPrev;
uniform sampler2D tGround;    // over the sand patch's window: r = the ground above the base (m), g = sand the sea keeps wet
uniform sampler2D tPatch;     // the patch itself: r = what the sand has gained or lost there (m), g = dampness added
uniform vec3 uToolC;          // the window's middle relative to the camera (x, z) and the base height (y)
uniform float uToolHalf, uPatchL, uWaterY, uDt;
uniform vec2 uCamDetail;      // the camera in detail coordinates (wrapped to 64 m)
in vec3 vAt;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 was = texture(tPrev, vUv);
  float wet = was.r, sand = was.g;
  // The sea: under its surface, wet (and what sand was on the skin is washed off); out of it, drying.
  float under = step(vAt.y, uWaterY - 0.004);
  wet = max(wet * exp(-uDt / 110.0), under);
  // The sand: where is the beach under this point of skin?
  vec2 win = (vAt.xz - uToolC.xz) / uToolHalf;
  if (max(abs(win.x), abs(win.y)) < 0.9) {
    vec3 g = texture(tGround, win * 0.5 + 0.5).rgb;
    vec4 p = textureLod(tPatch, (uCamDetail + vAt.xz) / uPatchL, 0.0);
    float ground = uToolC.y + g.r + p.r, touching = 1.0 - smoothstep(0.004, 0.014, vAt.y - ground);
    float sticky = max(max(wet, g.g), p.g);                  // wet skin, or sand the sea or you have wetted
    if (under < 0.5) sand = max(sand, touching * mix(0.3, 1.0, smoothstep(0.2, 0.6, sticky)));
  }
  // (Under water it washes off in half a second; on wet skin it stays; on dry skin it drops off in a few seconds.)
  sand *= under > 0.5 ? exp(-uDt * 2.2) : exp(-uDt / mix(7.0, 240.0, smoothstep(0.15, 0.5, wet)));
  outColor = vec4(clamp(wet, 0.0, 1.0), clamp(sand, 0.0, 1.0), 0.0, 1.0);
}`;

export class SkinState {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('./patch.js').SandPatch} patch  the sand patch (its window, its map of the ground, itself)
   * @param {{value: THREE.Texture}} tBones  the body's bone matrices
   */
  constructor(renderer, patch, tBones, size = 512) {
    this.renderer = renderer; this.patch = patch;
    const target = () => new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    this.targets = [target(), target()]; this.now = 0;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      uniforms: { tBones, tPrev: { value: null }, tGround: { value: patch.grid }, tPatch: { value: null }, ...patch.toolUniforms, uPatchL: { value: patch.L }, uWaterY: { value: -1e9 }, uDt: { value: 0 }, uCamDetail: { value: new THREE.Vector2() } },
    });
    /** The uniform the figure reads the map through. */
    this.uniform = { value: this.targets[0].texture };
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.reset();
  }

  /** Dry and clean all over. */
  reset() {
    const { renderer } = this, previous = renderer.getRenderTarget(), gl = renderer.getContext();
    for (const t of this.targets) { renderer.setRenderTarget(t); gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 1])); }
    renderer.setRenderTarget(previous);
  }

  /**
   * One frame, after the patch's own (it draws the maps this reads).
   * @param {number} dt  @param {THREE.Mesh} mesh  the body, posed
   * @param {number} waterY  the sea surface's height where you are (far below when you are not in it)
   * @param {{x: number, z: number}} cam  the camera in the world
   */
  update(dt, mesh, waterY, cam) {
    if (!(dt > 0)) return;
    const { renderer } = this, u = this.material.uniforms, previous = renderer.getRenderTarget(), auto = renderer.autoClear, wrap = v => ((v % 64) + 64) % 64;
    u.tPrev.value = this.targets[this.now].texture; u.tPatch.value = this.patch.targets[this.patch.now].texture;
    u.uWaterY.value = waterY; u.uDt.value = Math.min(dt, 0.05); u.uCamDetail.value.set(wrap(cam.x), wrap(cam.z));
    this.now = 1 - this.now;
    const own = mesh.material, parent = mesh.parent, seen = mesh.visible;
    if (parent) parent.remove(mesh);
    mesh.material = this.material; mesh.visible = true;
    renderer.setRenderTarget(this.targets[this.now]);
    // (What the body does not cover this frame keeps what it had: the map is copied by drawing the whole body over the old one.)
    renderer.autoClear = false;
    renderer.render(mesh, this.camera);
    renderer.autoClear = auto;
    mesh.material = own; mesh.visible = seen;
    if (parent) parent.add(mesh);
    renderer.setRenderTarget(previous);
    this.uniform.value = this.targets[this.now].texture;
  }

  /** For tests: [wet, sand] at a texture coordinate of the body. */
  read(u, v) {
    const t = this.targets[this.now], out = new Uint8Array(4);
    this.renderer.readRenderTargetPixels(t, Math.min(t.width - 1, Math.floor(u * t.width)), Math.min(t.height - 1, Math.floor(v * t.height)), 1, 1, out);
    return [out[0] / 255, out[1] / 255];
  }
}
