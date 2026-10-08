// The sand round you, as sand: a square of beach four metres across that keeps what is done to it. Your feet,
// hands and knees press into it exactly as they are shaped; in dry sand what they push aside wells up round
// them and slumps to the slope dry sand rests at, while damp sand packs and holds an edge; what is taken out
// leaves a hollow and what is poured on builds a heap of just that much; the sea, wherever it runs over the
// patch, planes it smooth again.
//
// It is a texture anchored to the world: a texel belongs to a place, (x, z) taken modulo the patch's length L
// (which divides the 64 m the detail coordinates wrap in), so nothing is copied as you walk; the square of it
// that is in use is centred on you, and a texel is wiped as it leaves that square by the far side.
//   r  height the sand has gained or lost here (m)        g  dampness added (wet feet, water poured), 0..1;
//                                                            below 0 on sea-wet sand: how far a foot has squeezed the water out
//   b  sand in transit: pushed out from under you and not yet settled (m)      a  pressed smooth, 0..1; 2 while your skin is on it
//
// Every frame: (1) your body is drawn from below into a small map of the lowest skin over each point;
// (2) one pass over the patch moves it on (transit, press, give and take, slump, the sea);
// (3) the terrain shader reads it (lr_patch below) for the shape, the shading and the colour of the sand.
import * as THREE from 'three';
import { FullscreenPass } from '../core/framegraph.js';
import { shared } from '../core/uniforms.js';
import { skinningGLSL } from '../world/figure.js';

export const PATCH_LENGTH = 4;                     // metres across (64 / 16)
const GRID = 13, EVENTS = 4;
/** lrScoop on the CPU (see the shader), and the area it is worth: a depth times this is the volume taken. */
export function scoopShape(lx, ly) {
  const cx = lx + 0.085, cy = ly - 0.01, ease = t => (t = Math.min(Math.max(t / 0.5, 0), 1), t * t * (3 - 2 * t));
  let k = Math.exp(-2 * (cx * cx / 0.003025 + cy * cy / 0.002025));
  for (const tip of [[-0.008, -0.024], [-0.012, 0.016], [-0.028, 0.044], [-0.056, 0.06]]) {
    const ax = -0.07 - tip[0], ay = 0.01 + 0.5 * (tip[1] - 0.01) - tip[1], t = Math.min(Math.max(((lx - tip[0]) * ax + (ly - tip[1]) * ay) / (ax * ax + ay * ay), 0), 1);
    const far = Math.hypot(lx - tip[0] - ax * t, ly - tip[1] - ay * t);
    k = Math.max(k, 0.6 * Math.exp(-2 * far * far / 0.00017) * ease(t));
  }
  return k;
}
const SCOOP_AREA = (() => { let sum = 0; for (let x = -0.25; x < 0.1; x += 0.002) for (let y = -0.15; y < 0.17; y += 0.002) sum += scoopShape(x, y) * 4e-6; return sum; })();

const simFragment = /* glsl */`
precision highp float;
uniform sampler2D tPrev;      // (always read at its finest level here: textureLod 0)
uniform sampler2D tTool;      // the lowest skin over each point of the window, above uBase (m); 1 where there is none
uniform sampler2D tGround;    // over the window: r = the ground above uBase (m), g = sand the sea keeps wet (0..1), b = depth of water over it now (m)
uniform vec2 uCentre;         // where the window's middle is (detail coordinates)
uniform float uL, uN, uDt, uFeetWet;
uniform vec2 uHop;            // this frame's hop for sand in transit (texels): a new length and direction every frame
uniform vec4 uDrop[${EVENTS}];        // sand arriving (or taken): where (detail coordinates), over what radius (m), how fast at its middle (m/s)
uniform vec4 uDropWet[${EVENTS}];     // x: dampness arriving per second; y: 1 = a right foot's print pressed in, 2 = a left foot's, 3 = a right hand's scoop, 4 = a left hand's, pointing the way zw says
in vec2 vUv;
layout(location = 0) out vec4 outColor;
// The print of a bare foot 22 cm long, about its middle (p: along it, and across it towards its outside; metres):
// the heel, the outer edge of the sole, the ball, and the five toes, the big one on the inside. Nothing under
// the arch. 1 where it presses deepest.
float lrPad(vec2 p, vec2 c, vec2 r) { return 1.0 - smoothstep(0.7, 1.0, length((p - c) / r)); }
float lrSole(vec2 p) {
  vec2 a = vec2(-0.07, 0.008), b = vec2(0.03, 0.018), ab = b - a;
  float edge = 1.0 - smoothstep(0.7, 1.0, length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0)) / 0.025);
  float k = max(max(lrPad(p, vec2(-0.078, 0.0), vec2(0.03)), 0.9 * edge), lrPad(p, vec2(0.036, 0.0), vec2(0.04, 0.044)));
  k = max(k, 0.85 * lrPad(p, vec2(0.092, -0.027), vec2(0.0145)));
  k = max(k, 0.7 * max(max(lrPad(p, vec2(0.099, -0.008), vec2(0.0105)), lrPad(p, vec2(0.096, 0.007), vec2(0.0095))), max(lrPad(p, vec2(0.089, 0.02), vec2(0.009)), lrPad(p, vec2(0.079, 0.031), vec2(0.0085)))));
  return k;
}
// The mark a hand leaves taking a handful: the furrows its fingers draw from where their tips went in, back to a
// bowl scooped from under the palm. (l: along the hand from between the first two fingertips, towards them
// positive; across it, the little finger's side positive. Where the tips went in they have already pressed their
// pits: each furrow begins at nothing there and deepens towards the palm. Taken as a round hole under the palm
// alone, it left the four pits standing apart in front of it: the print of an animal's paw.)
float lrScoop(vec2 l) {
  vec2 c = l - vec2(-0.085, 0.01);
  float k = exp(-2.0 * (c.x * c.x / 0.003025 + c.y * c.y / 0.002025));
  for (int i = 0; i < 4; i++) {
    vec2 tip = i == 0 ? vec2(-0.008, -0.024) : i == 1 ? vec2(-0.012, 0.016) : i == 2 ? vec2(-0.028, 0.044) : vec2(-0.056, 0.06);
    vec2 ab = vec2(-0.07, 0.01 + 0.5 * (tip.y - 0.01)) - tip;
    float t = clamp(dot(l - tip, ab) / dot(ab, ab), 0.0, 1.0), far = length(l - tip - ab * t);
    k = max(k, 0.6 * exp(-2.0 * far * far / 0.00017) * smoothstep(0.0, 0.5, t));
  }
  return k;
}
// (The steepest slope sand stands at between two neighbours: 33 degrees dry, 56 damp, almost flat under water.
// Damp sand was let stand as a wall, 74 degrees: a finger drawn through it, which is pressed in where it is
// frame by frame, left a string of beads with black sides. At 56 the beads slump into a groove.)
float talus(float wet, float under) { return mix(mix(0.65, 1.5, smoothstep(0.15, 0.6, wet)), 0.18, under); }
void main() {
  vec2 d = vUv * uL, q = mod(d - uCentre + 0.5 * uL, uL) - 0.5 * uL;
  float cell = uL / uN, e = 1.0 / uN;
  // Leaving the window: this texel will next be somewhere else. Clean sand. (The rim that is wiped is 15 cm
  // wide: wider than you go in a frame at a run. It was four texels, 8 mm: walking, two rows in three got
  // through it unwiped, and a print came round again four metres on as a ghost in stripes.)
  if (max(abs(q.x), abs(q.y)) > 0.5 * uL - 0.15) { outColor = vec4(0.0); return; }
  vec4 c = textureLod(tPrev, vUv, 0.0);
  vec3 g = texture(tGround, q / uL + 0.5).rgb;
  float under = smoothstep(0.003, 0.012, g.b), wet = max(g.g, c.g), h = c.r, damp = c.g, pressed = min(c.a, 1.0);

  // Slumping: sand runs to each lower neighbour by a part of what the slope between them is too steep by.
  // (Not into or out of where your body rests on it: skin holds the wall of its own print up. Without this,
  // sand ran in under a foot, was pressed away, and more ran in: the beach round a standing foot sank.)
  float tool = texture(tTool, q / uL + 0.5).r, give = 0.0;
  // (Whether skin was on a neighbour is in the patch itself, from the frame before: no need to look the skin up again.)
  bool held = tool < g.r + h + 5e-4 || c.a > 1.5;
  // (Eight neighbours, the diagonal ones further off: with four, a heap came out a pyramid.)
  vec2 at[8] = vec2[8](vec2(e, 0.0), vec2(-e, 0.0), vec2(0.0, e), vec2(0.0, -e), vec2(e, e), vec2(-e, e), vec2(e, -e), vec2(-e, -e));
  for (int i = 0; i < 8; i++) {
    vec4 nb = textureLod(tPrev, vUv + at[i], 0.0);
    if (held || nb.a > 1.5) continue;
    float dh = h - nb.r, most = talus(max(g.g, 0.5 * (c.g + nb.g)), under) * cell * (i < 4 ? 1.0 : 1.4142);
    give += sign(dh) * max(abs(dh) - most, 0.0) * (i < 4 ? 1.0 : 0.7071);
  }
  h -= 0.16 * give;

  // What your body has pushed out from under itself travels until there is room for it: a hop of a centimetre
  // or so each frame, a new length and a new direction every frame (uHop), to four sides at once. So it leaves
  // the print by the nearest way and comes down within a finger's width of the edge, at every distance from it:
  // a rounded rim. (Hops along the texture's axes, of a few fixed lengths, set it down in rows that far apart:
  // a tread like a tyre's along everything dragged through the sand.)
  vec2 hop = uHop * e, side = vec2(-hop.y, hop.x);
  float moving = 0.25 * (textureLod(tPrev, vUv + hop, 0.0).b + textureLod(tPrev, vUv - hop, 0.0).b + textureLod(tPrev, vUv + side, 0.0).b + textureLod(tPrev, vUv - side, 0.0).b);

  // The sea over it: the sheet planes the sand flat and leaves it wet.
  if (under > 0.0) {
    float k = 1.0 - exp(-uDt * 1.6 * under);
    h -= h * k; pressed -= pressed * k; damp = max(damp, under);
  }

  // On sand the sea keeps wet, a foot squeezes the water out of the sand under it and for a hand's breadth round
  // it: that sand goes pale and matt while the foot presses, and the water is back within a second of its
  // leaving. How far it is drained is kept as dampness below nothing (the second number, 0 .. -1): 1 under the
  // skin, less round it, fading. (It was kept in the fourth number, which also says 'pressed smooth' and stays:
  // wherever this pass and the picture disagreed about the sand being wet, a print stayed pale for good.)
  float drained = 0.0;
  if (g.g > 0.5 && under < 0.5) {
    float near = c.a > 1.5 ? 1.0 : 0.0;
    // (Uneven over a few centimetres; the numbers repeat with the patch, every four metres.)
    float keep = 0.5 + 0.07 * (sin(d.x * 113.1 + 1.3 * sin(d.y * 70.69)) + sin(d.y * 122.52 + 1.7 * sin(d.x * 84.82)));
    for (int i = 0; i < 6; i++) {
      // (Six ways, turned differently every frame: looked for the same six ways each time, it spread as a lattice of stripes.)
      float t = 1.0472 * float(i) + atan(uHop.y, uHop.x);
      // (From sand that skin is on, nearly all of it; from sand that is drained, about half of what it has, more
      // here and less there: so it falls away over a hand's breadth, to an uneven edge. At seven tenths, the
      // same everywhere, it reached a foot and a half from your foot as a round glow, like a lamp held to the
      // sand.)
      vec4 by = textureLod(tPrev, vUv + vec2(cos(t), sin(t)) * ((0.014 + 0.004 * float(i)) / uL), 0.0);
      near = max(near, by.a > 1.5 ? 0.85 : keep * max(-by.g, 0.0));
    }
    // (And the water is back within a second of your foot's leaving.)
    drained = max(max(-c.g, 0.0) * exp(-uDt / 0.45), near);
  }
  damp = max(damp, 0.0);

  // What arrives and what is taken.
  for (int i = 0; i < ${EVENTS}; i++) {
    if (uDrop[i].z <= 0.0) continue;
    vec2 o = mod(d - uDrop[i].xy + 0.5 * uL, uL) - 0.5 * uL;
    // (A print pressed in again has a flat floor and a steep side, which then slumps as dry sand does; what is
    // poured or scooped is a soft mound or bowl.)
    float o2 = dot(o, o) / (uDrop[i].z * uDrop[i].z), k = exp(-2.0 * o2);
    if (uDropWet[i].y > 2.5) {
      // (A hand's scoop: along the hand and across it; 4 marks a left hand.)
      vec2 f = uDropWet[i].zw;
      k = lrScoop(vec2(dot(o, f), dot(o, vec2(-f.y, f.x)) * (uDropWet[i].y > 3.5 ? -1.0 : 1.0)));
    } else if (uDropWet[i].y > 0.5) {
      // (Along the foot and across it, the outside of the foot positive: 2 marks a left foot.)
      vec2 f = uDropWet[i].zw, l = vec2(dot(o, f), dot(o, vec2(-f.y, f.x)) * (uDropWet[i].y > 1.5 ? -1.0 : 1.0));
      k = lrSole(l);
      pressed = max(pressed, min(k, 1.0));
    }
    h += uDrop[i].w * uDt * k;
    damp += uDropWet[i].x * uDt * k;
    if (uDrop[i].w > 0.0) pressed *= 1.0 - k * min(1.0, uDt * 30.0);             // (fresh sand lies loose)
  }

  // Your body. Where skin is lower than the sand, the sand is where the skin is: of what it displaced, damp
  // sand packs nearly all, dry sand sends a third aside. Where there is room, sand in transit settles.
  float surface = g.r + h;
  if (tool < surface) {
    float push = min(surface - tool, h + 0.07);            // (never more than 7 cm into the beach)
    h -= push; moving += push * mix(0.16, 0.04, smoothstep(0.15, 0.6, wet));
    pressed = 2.0; damp = max(damp, uFeetWet * (1.0 - step(0.5, g.g)));          // (2: skin is on it now)
  } else {
    // (Half of what is passing over free sand comes down each frame; the rest goes on a little further.)
    float room = tool - surface, settle = min(0.5 * moving, 0.5 * room);
    h += settle; moving -= settle;
    pressed *= 1.0 - min(1.0, settle * 400.0);
  }
  // (Skin resting on it, to within half a millimetre: marked, so that nothing slumps in under it next frame.)
  if (tool < g.r + h + 5e-4) pressed = 2.0;
  // (Dampness that was added dries; what the sea keeps wet is not in this number.)
  damp *= exp(-uDt / 40.0);
  outColor = vec4(clamp(h, -0.08, 0.2), drained > 0.003 ? -min(drained, 1.0) : clamp(damp, 0.0, 1.0), max(moving, 0.0), clamp(pressed, 0.0, 2.0));
}`;

const toolVertex = /* glsl */`
${skinningGLSL}
uniform vec3 uToolC;      // the window's middle relative to the camera (x, z), and the base height (y)
uniform float uToolHalf;
out float vAbove;
void main() {
  vec4 wp = modelMatrix * (lrSkin() * vec4(position, 1.0));
  vAbove = wp.y - uToolC.y;
  gl_Position = vec4((wp.x - uToolC.x) / uToolHalf, (wp.z - uToolC.z) / uToolHalf, 0.0, 1.0);
}`;
const toolFragment = /* glsl */`
precision highp float;
in float vAbove;
layout(location = 0) out vec4 outColor;
void main() { outColor = vec4(vAbove, 0.0, 0.0, 1.0); }`;

/**
 * GLSL for the terrain: the patch at a place. (Needs lr_common.) lrPatchIn(d) is how much the patch has to say
 * at detail coordinates d (1 inside the window, fading to 0 at its edge); lrPatch(d) its four numbers there.
 */
export const patchGLSL = /* glsl */`
uniform sampler2D tPatch;
uniform vec4 uPatch;      // the window's middle (detail coordinates), its length (m), 1 = there is a patch
float lrPatchIn(vec2 d) {
  if (uPatch.w < 0.5) return 0.0;
  // (How far the point really is from the window's middle: the detail coordinates wrap at 64 m, not at the
  // window's own length. Taken modulo that length, every place on the beach was 'inside' some copy of it.)
  vec2 q = mod(d - uPatch.xy + 32.0, 64.0) - 32.0;
  return 1.0 - smoothstep(0.4 * uPatch.z, 0.455 * uPatch.z, max(abs(q.x), abs(q.y)));
}
// (Which level of the patch to read: 0 where a pixel is no bigger than a texel; further off or at a low angle,
// the level whose texels are a pixel's reach across. Read sharp from afar, a print came out in stripes.)
float lrPatchLod = 0.0;
vec4 lrPatch(vec2 d) { return textureLod(tPatch, d / uPatch.z, lrPatchLod); }
// The height of the sand as it is to be drawn. Where your skin is in it now, the sand lies against the skin at
// the level of the beach: the hollow under a foot is full of foot, and is seen only when the foot has gone.
float lrPatchHeight(vec2 d) { vec4 t = lrPatch(d); return t.r * (1.0 - clamp(4.0 * (t.a - 1.0), 0.0, 1.0)); }
`;

export class SandPatch {
  /** @param {THREE.WebGLRenderer} renderer  @param {number} size  texels across (0 = none) */
  constructor(renderer, size = 2048) {
    this.renderer = renderer; this.size = size; this.L = PATCH_LENGTH;
    const target = () => new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: true, colorSpace: THREE.NoColorSpace });
    this.targets = [target(), target()]; this.now = 0;
    this.tool = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, colorSpace: THREE.NoColorSpace });
    this.gridData = new Uint16Array(GRID * GRID * 4);
    this.grid = new THREE.DataTexture(this.gridData, GRID, GRID, THREE.RGBAFormat, THREE.HalfFloatType);
    Object.assign(this.grid, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.events = []; this.falling = [];
    this.pass = new FullscreenPass(simFragment, {
      tPrev: { value: null }, tTool: { value: this.tool.texture }, tGround: { value: this.grid }, uCentre: { value: new THREE.Vector2() }, uL: { value: this.L }, uN: { value: size },
      uDt: { value: 0 }, uFeetWet: { value: 0 }, uHop: { value: new THREE.Vector2(4, 0) }, uDrop: { value: Array.from({ length: EVENTS }, () => new THREE.Vector4()) }, uDropWet: { value: Array.from({ length: EVENTS }, () => new THREE.Vector4()) },
    });
    /** (Shared with sim/ripples.js: the window's middle relative to the camera, the base height, half its length.) */
    this.toolUniforms = { uToolC: { value: new THREE.Vector3() }, uToolHalf: { value: this.L / 2 } };
    this.clearTool = new Float32Array([1, 0, 0, 0]); this.clearPatch = new Float32Array([0, 0, 0, 0]);
    this.reset();
  }

  /** What draws a skinned mesh into the tool map (it needs the mesh's bone texture). */
  toolMaterial(tBones) {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: toolVertex, fragmentShader: toolFragment, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MinEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { tBones, ...this.toolUniforms },
    });
  }

  /** Clean sand everywhere (you have been put down somewhere else). */
  reset() {
    const { renderer } = this, previous = renderer.getRenderTarget();
    for (const t of this.targets) { renderer.setRenderTarget(t); renderer.getContext().clearBufferfv(renderer.getContext().COLOR, 0, this.clearPatch); }
    renderer.setRenderTarget(previous);
    this.events.length = 0; this.falling.length = 0;
    shared.uPatch.value.w = 0;
  }

  /**
   * Sand arriving at (x, z) (world; or taken, with a negative rate) for `seconds`: over radius r (m), `rate`
   * metres a second at the middle; `wet` = dampness arriving per second; `foot` = [east, south, side], the
   * way a foot points and which it is (-1 left, 1 right): then it is that foot's print pressed in there (heel, outer
   * edge, ball and toes, flat-floored and steep-sided), not a soft bowl.
   */
  drop(x, z, r, rate, seconds, wet = 0, foot = null) {
    if (this.events.length >= EVENTS) this.events.shift();
    this.events.push({ x, z, r, rate, wet, foot, left: seconds });
  }
  /**
   * Sand (cubic metres) and dampness (units) let fall towards (x, z), to land `fall` seconds from now. Whatever
   * lands in the same frame is set down together.
   */
  pour(x, z, r, volume, wet, fall, time) { this.falling.push({ x, z, r, volume, wet, at: time + fall }); }
  /**
   * A handful taken by a hand whose first fingertips are at (x, z) and which points along (fx, fz), `side` > 0 the
   * right hand: `volume` cubic metres (negative: dug out) over `seconds`, in the shape lrScoop gives it.
   */
  scoop(x, z, fx, fz, side, volume, seconds) {
    if (this.events.length >= EVENTS) this.events.shift();
    this.events.push({ x, z, r: 0.2, rate: volume / SCOOP_AREA / seconds, wet: 0, foot: [fx, fz, side], hand: true, left: seconds });
  }
  /** `volume` cubic metres of sand set down round (x, z) over `seconds` (a negative volume: dug out). */
  move(x, z, r, volume, seconds, wet = 0) { this.drop(x, z, r, volume / (Math.PI * r * r / 2) / seconds, seconds, wet); }

  /**
   * One frame.
   * @param {number} dt
   * @param {object} c  x, z: where you are (world); cam: the camera (x, z); base: the height of the ground under
   *   you; meshes: [{ mesh, material }] to draw into the tool map; sample(x, z) -> [ground height, wet 0..1,
   *   depth of water now]; feetWet 0..1; time (s)
   */
  update(dt, c) {
    const { renderer, L } = this, wrap = v => ((v % 64) + 64) % 64, half = THREE.DataUtils.toHalfFloat;
    shared.uPatch.value.set(wrap(c.x), wrap(c.z), L, 1); shared.tPatch.value = this.targets[this.now].texture;
    if (!(dt > 0)) return;
    const previous = renderer.getRenderTarget();
    // (1) The lowest skin over each point.
    this.toolUniforms.uToolC.value.set(c.x - c.cam.x, c.base, c.z - c.cam.z);
    renderer.setRenderTarget(this.tool);
    renderer.getContext().clearBufferfv(renderer.getContext().COLOR, 0, this.clearTool);
    const auto = renderer.autoClear;
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
    // The ground, the wet and the water over the window.
    for (let j = 0, o = 0; j < GRID; j++) for (let i = 0; i < GRID; i++, o += 4) {
      const s = c.sample(c.x + ((i + 0.5) / GRID - 0.5) * L, c.z + ((j + 0.5) / GRID - 0.5) * L);
      this.gridData[o] = half(s[0] - c.base); this.gridData[o + 1] = half(s[1]); this.gridData[o + 2] = half(Math.max(s[2], 0)); this.gridData[o + 3] = half(1);
    }
    this.grid.needsUpdate = true;
    // What was let fall and lands now: one arrival.
    if (this.falling.length) {
      let v = 0, w = 0, x = 0, z = 0, r = 0, n = 0;
      this.falling = this.falling.filter(f => { if (f.at > c.time) return true; v += f.volume; w += f.wet; x += f.x; z += f.z; r += f.r; n++; return false; });
      if (n) { const rr = r / n; this.drop(x / n, z / n, rr, v / (Math.PI * rr * rr / 2) / dt, dt * 0.5, w / dt); }       // (for this frame only)
    }
    // (2) The patch moves on.
    const u = this.pass.material.uniforms;
    u.tPrev.value = this.targets[this.now].texture; u.uCentre.value.set(wrap(c.x), wrap(c.z)); u.uDt.value = Math.min(dt, 0.05); u.uFeetWet.value = c.feetWet || 0; 
    // (The hop: lengths between half a centimetre and a centimetre and a half, turned by the golden angle each frame.)
    { const k = this.tick = ((this.tick || 0) + 1) % 4093, r = [2.6, 5.3, 3.7, 6.9, 4.4, 8.1, 3.1][k % 7] * this.size / 2048 + 0.5, a = k * 2.399963; u.uHop.value.set(r * Math.cos(a), r * Math.sin(a)); }
    for (let i = 0; i < EVENTS; i++) {
      const e = this.events[i];
      if (e) { u.uDrop.value[i].set(wrap(e.x), wrap(e.z), e.r, e.rate); u.uDropWet.value[i].set(e.wet, e.foot ? (e.foot[2] < 0 ? 2 : 1) + (e.hand ? 2 : 0) : 0, e.foot ? e.foot[0] : 0, e.foot ? e.foot[1] : 0); e.left -= dt; } else u.uDrop.value[i].set(0, 0, 0, 0);
    }
    this.events = this.events.filter(e => e.left > 0);
    this.now = 1 - this.now;
    this.pass.render(renderer, this.targets[this.now]);
    shared.tPatch.value = this.targets[this.now].texture;
    renderer.setRenderTarget(previous);
  }

  /** For tests: the patch's four numbers at a place (world x, z), read back from the GPU. */
  read(x, z) {
    const wrap = v => ((v % this.L) + this.L) % this.L, px = Math.min(this.size - 1, Math.floor(wrap(x) / this.L * this.size)), py = Math.min(this.size - 1, Math.floor(wrap(z) / this.L * this.size));
    const out = new Uint16Array(4);
    this.renderer.readRenderTargetPixels(this.targets[this.now], px, py, 1, 1, out);
    return Array.from(out, THREE.DataUtils.fromHalfFloat);
  }
}
