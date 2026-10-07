// The water round you, as water: a sheet of ripples over the same four metres as the sand patch (sim/patch.js),
// set going by what crosses the surface. Your shins and your hands push it up where they come in and leave a
// trough where they go; the swash running past your ankles piles against them and trails a wake behind; every
// drop and every stream that falls from your hand rings it. The rings spread, meet, bounce off your legs and
// die away. The sea's own waves are not in this: it is what you add to them.
//
// A texture anchored to the world like the patch (a texel belongs to a place modulo L):
//   r  how far the surface stands above or below where the sea has it (m)      g  how fast that is changing (m/s)
//   b  whether something of you stood in this cell a moment ago (0..1)
// The step is the plain wave equation with a little damping, twice a frame; ripples a few centimetres long
// travel at about 0.3 m/s, and so do these.
import * as THREE from 'three';
import { FullscreenPass } from '../core/framegraph.js';
import { shared } from '../core/uniforms.js';
import { skinningGLSL } from '../world/figure.js';

const DROPS = 8, SPEED = 0.3;

const simFragment = /* glsl */`
precision highp float;
uniform sampler2D tPrev;
uniform sampler2D tCross;     // 1 where skin stands within a few centimetres of the surface (over the window)
uniform sampler2D tGround;    // over the window: r = the ground above the base, b = the depth of water over it (m)
uniform vec2 uCentre;         // the window's middle (detail coordinates)
uniform float uL, uN, uDt;
uniform vec2 uFlow;           // how the water is running over the ground here (m/s; the swash)
uniform vec4 uDrop[${DROPS}]; // what falls in: where (detail coordinates), over what radius (m), how hard (m/s)
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 d = vUv * uL, q = mod(d - uCentre + 0.5 * uL, uL) - 0.5 * uL;
  float cell = uL / uN, e = 1.0 / uN;
  if (max(abs(q.x), abs(q.y)) > 0.5 * uL - 4.0 * cell) { outColor = vec4(0.0); return; }
  vec4 c = texture(tPrev, vUv), xp = texture(tPrev, vUv + vec2(e, 0.0)), xm = texture(tPrev, vUv - vec2(e, 0.0)), zp = texture(tPrev, vUv + vec2(0.0, e)), zm = texture(tPrev, vUv - vec2(0.0, e));
  float depth = texture(tGround, q / uL + 0.5).b, wet = smoothstep(0.004, 0.02, depth), m = texture(tCross, q / uL + 0.5).r;
  float v = c.g + ${(SPEED * SPEED).toFixed(4)} * (xp.r + xm.r + zp.r + zm.r - 4.0 * c.r) / (cell * cell) * uDt;
  // What stands in the water. Coming in, it pushes the water up round it; going, it leaves a hollow. Water
  // running past it piles up on the side it comes from and falls away behind.
  v += (m - c.b) * 0.1;
  v += 0.5 * dot(uFlow, vec2(xp.b - xm.b, zp.b - zm.b)) * uDt;
  for (int i = 0; i < ${DROPS}; i++) {
    if (uDrop[i].z <= 0.0) continue;
    vec2 o = mod(d - uDrop[i].xy + 0.5 * uL, uL) - 0.5 * uL;
    // (A drop makes a dimple with a raised rim: down in the middle, up round it.)
    float r2 = dot(o, o) / (uDrop[i].z * uDrop[i].z);
    v += uDrop[i].w * (r2 - 0.6) * exp(-r2);
  }
  v *= exp(-uDt * 1.1);
  float h = (c.r + v * uDt) * exp(-uDt * 0.25);
  // (Where you stand in it the surface cannot move; where there is no water there are no ripples.)
  h *= wet * (1.0 - 0.85 * m); v *= wet * (1.0 - 0.85 * m);
  outColor = vec4(clamp(h, -0.03, 0.03), clamp(v, -1.0, 1.0), m, 1.0);
}`;

const crossVertex = /* glsl */`
${skinningGLSL}
uniform vec3 uToolC;
uniform float uToolHalf;
out float vAbove;
void main() {
  vec4 wp = modelMatrix * (lrSkin() * vec4(position, 1.0));
  vAbove = wp.y - uToolC.y;
  gl_Position = vec4((wp.x - uToolC.x) / uToolHalf, (wp.z - uToolC.z) / uToolHalf, 0.0, 1.0);
}`;
const crossFragment = /* glsl */`
precision highp float;
uniform sampler2D tGround;
uniform float uCrossN;
in float vAbove;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 g = texture(tGround, gl_FragCoord.xy / uCrossN).rgb;
  if (g.b < 0.004 || abs(vAbove - (g.r + g.b)) > 0.03) discard;
  outColor = vec4(1.0);
}`;

/** GLSL for the water and the bed: the ripples at a place (detail coordinates). Needs lr_common. */
export const ripplesGLSL = /* glsl */`
uniform sampler2D tRipple;
uniform vec4 uRipple;     // the window's middle (detail coordinates), its length (m), 1 = there are ripples
float lrRippleIn(vec2 d) {
  if (uRipple.w < 0.5) return 0.0;
  vec2 q = mod(d - uRipple.xy + 0.5 * uRipple.z, uRipple.z) - 0.5 * uRipple.z;
  return 1.0 - smoothstep(0.42 * uRipple.z, 0.47 * uRipple.z, max(abs(q.x), abs(q.y)));
}
float lrRippleH(vec2 d) { return textureLod(tRipple, d / uRipple.z, 0.0).r; }
// (The slope of the surface they add, and how sharply it bends each way: for reflections, and for the light on the bed.)
vec2 lrRippleSlope(vec2 d) {
  float e = uRipple.z / float(textureSize(tRipple, 0).x);
  return vec2(lrRippleH(d + vec2(e, 0.0)) - lrRippleH(d - vec2(e, 0.0)), lrRippleH(d + vec2(0.0, e)) - lrRippleH(d - vec2(0.0, e))) / (2.0 * e);
}
vec2 lrRippleBend(vec2 d) {
  float e = 1.5 * uRipple.z / float(textureSize(tRipple, 0).x), h = lrRippleH(d);
  return vec2(lrRippleH(d + vec2(e, 0.0)) + lrRippleH(d - vec2(e, 0.0)) - 2.0 * h, lrRippleH(d + vec2(0.0, e)) + lrRippleH(d - vec2(0.0, e)) - 2.0 * h) / (e * e);
}
`;

export class Ripples {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('./patch.js').SandPatch} patch  the sand patch: the same window, the same maps of the ground and of the body over it
   * @param {number} size  texels across
   */
  constructor(renderer, patch, size = 512) {
    this.renderer = renderer; this.patch = patch; this.size = size; this.L = patch.L;
    const target = (type, filter) => new THREE.WebGLRenderTarget(size, size, { type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: filter, magFilter: filter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    this.targets = [target(THREE.HalfFloatType, THREE.LinearFilter), target(THREE.HalfFloatType, THREE.LinearFilter)]; this.now = 0;
    this.cross = target(THREE.UnsignedByteType, THREE.LinearFilter);
    this.cross.texture.wrapS = this.cross.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.pass = new FullscreenPass(simFragment, {
      tPrev: { value: null }, tCross: { value: this.cross.texture }, tGround: { value: patch.grid }, uCentre: { value: new THREE.Vector2() }, uL: { value: this.L }, uN: { value: size },
      uDt: { value: 0 }, uFlow: { value: new THREE.Vector2() }, uDrop: { value: Array.from({ length: DROPS }, () => new THREE.Vector4()) },
    });
    this.falling = []; this.zero = new Float32Array([0, 0, 0, 0]);
    this.reset();
  }

  /** What draws a skinned mesh into the map of where skin stands at the surface. */
  crossMaterial(tBones) {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: crossVertex, fragmentShader: crossFragment, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      uniforms: { tBones, ...this.patch.toolUniforms, tGround: { value: this.patch.grid }, uCrossN: { value: this.size } },
    });
  }

  /** Still water everywhere. */
  reset() {
    const { renderer } = this, previous = renderer.getRenderTarget(), gl = renderer.getContext();
    for (const t of [...this.targets, this.cross]) { renderer.setRenderTarget(t); gl.clearBufferfv(gl.COLOR, 0, this.zero); }
    renderer.setRenderTarget(previous);
    this.falling.length = 0;
    shared.uRipple.value.w = 0;
  }

  /** Something falls in at (x, z) (world) at time `when`: `strength` 0..1 (a drop 0.2, a foot coming down 1), over `radius` metres. */
  drop(x, z, when, strength = 0.3, radius = 0.02) { if (this.falling.length < 64) this.falling.push({ x, z, when, strength, radius }); }

  /**
   * One frame, after the patch's own (which draws the maps this reads).
   * @param {number} dt
   * @param {object} c  x, z: where you are; time; flow: [east, south] m/s, how the water runs past you; meshes: [{ mesh, material }]
   */
  update(dt, c) {
    const { renderer, L } = this, wrap = v => ((v % 64) + 64) % 64, gl = renderer.getContext();
    shared.uRipple.value.set(wrap(c.x), wrap(c.z), L, 1); shared.tRipple.value = this.targets[this.now].texture;
    if (!(dt > 0)) return;
    const previous = renderer.getRenderTarget(), auto = renderer.autoClear;
    // Where skin stands at the surface.
    renderer.setRenderTarget(this.cross);
    gl.clearBufferfv(gl.COLOR, 0, this.zero);
    renderer.autoClear = false;
    for (const { mesh, material } of c.meshes) {
      const own = mesh.material, parent = mesh.parent, seen = mesh.visible;
      if (parent) parent.remove(mesh);
      mesh.material = material; mesh.visible = true;
      renderer.render(mesh, this.camera ??= new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
      mesh.material = own; mesh.visible = seen;
      if (parent) parent.add(mesh);
    }
    renderer.autoClear = auto;
    // The water moves on: two half steps (it keeps the ripples' speed steady at any frame rate down to 30 a second).
    const u = this.pass.material.uniforms, step = Math.min(dt, 1 / 30) / 2;
    u.uCentre.value.set(wrap(c.x), wrap(c.z)); u.uDt.value = step; u.uFlow.value.set(c.flow?.[0] || 0, c.flow?.[1] || 0);
    for (let half = 0; half < 2; half++) {
      // (What falls in, falls in once: in the first half step after its time.)
      let n = 0;
      if (half === 0) this.falling = this.falling.filter(f => { if (f.when > c.time || n >= DROPS) return true; u.uDrop.value[n++].set(wrap(f.x), wrap(f.z), f.radius, 0.3 * f.strength); return false; });
      for (; n < DROPS; n++) u.uDrop.value[n].set(0, 0, 0, 0);
      u.tPrev.value = this.targets[this.now].texture;
      this.now = 1 - this.now;
      this.pass.render(renderer, this.targets[this.now]);
    }
    shared.tRipple.value = this.targets[this.now].texture;
    renderer.setRenderTarget(previous);
  }

  /** For tests: [height, speed, crossing] at a place (world x, z). */
  read(x, z) {
    const wrap = v => ((v % this.L) + this.L) % this.L, px = Math.min(this.size - 1, Math.floor(wrap(x) / this.L * this.size)), py = Math.min(this.size - 1, Math.floor(wrap(z) / this.L * this.size)), out = new Uint16Array(4);
    this.renderer.readRenderTargetPixels(this.targets[this.now], px, py, 1, 1, out);
    return Array.from(out, THREE.DataUtils.fromHalfFloat);
  }
}
