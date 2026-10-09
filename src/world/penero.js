// Your peñero: the open fishing boat of Los Roques, modelled finely enough to sit in. 7.6 m, a raked bow with a
// high sheer, hard chines, three thwarts, a foredeck, floorboards and frames, an outboard on the transom with its
// tiller, a fuel tank and an anchor. White topsides, a red bottom, a yellow band under the gunwale, as the boats
// of the islands are painted. sim/boat.js says where it is; this draws it there.
//
// The sea is kept out of it by the picture's own rule (water.js): what is drawn of the inside of the hull says
// so (alpha -1800), and the sea's surface is not drawn over that, inside the hull's own box. Its outside, under
// the waterline, is handed to the water as the seabed is, against the sea as it lies along the hull (a plane
// fitted to it: sim/boat.js `waterline`), not against the still level: under a crest it does not vanish.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { shadowGLSL } from './shadow.js';

const WHITE = [0.86, 0.87, 0.84], BOTTOM = [0.5, 0.09, 0.06], BAND = [0.92, 0.7, 0.1], INSIDE = [0.62, 0.72, 0.74], WOOD = [0.5, 0.36, 0.22], DECK = [0.82, 0.82, 0.78];
const COWL = [0.1, 0.11, 0.13], LEG = [0.55, 0.57, 0.6], TANK = [0.7, 0.08, 0.06], RUST = [0.32, 0.2, 0.14], ROPE = [0.78, 0.72, 0.58];

/** The hull's shape at `t` (0 the transom .. 1 the stem): where it is along the boat, its half-breadth at the gunwale and at the chine, how high the gunwale is, how deep chine and keel. Metres; y = 0 is the waterline at rest. */
export function section(t) {
  const x = -3.8 + 7.6 * t, fine = Math.pow(Math.max(0, 1 - Math.pow(t, 2.7)), 0.62);
  const half = 1.0 * (0.8 + 0.2 * Math.min(1, t / 0.35)) * fine, sheer = 0.56 + 0.62 * t * t * t + 0.06 * t;
  const chine = half * (0.84 - 0.34 * t * t), chineY = -0.07 + 0.3 * t * t * t, keel = -0.3 + 0.36 * Math.pow(t, 3.2);
  return { x, half, sheer, chine, chineY, keel };
}

/** Half the hull's breadth outside at x along it and y over its waterline (0 above the gunwale and under the keel). */
export function breadthAt(x, y) {
  const s = section((x + 3.8) / 7.6);
  if (y > s.sheer || y < s.keel) return 0;
  if (y < s.chineY) return s.chine * (y - s.keel) / Math.max(1e-6, s.chineY - s.keel);
  return s.chine + (s.half - s.chine) * (1 - Math.pow(1 - (y - s.chineY) / (s.sheer - s.chineY), 1.8));
}

class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; this.inside = []; this.i = []; }
  vertex(p, n, c, inside = 0) { this.p.push(...p); this.n.push(...n); this.c.push(...c); this.inside.push(inside); return this.p.length / 3 - 1; }
  /** A sheet through rows of points (each row the same length), smooth across it; `colour(r, k)` for each point; faces seen from the side the rows turn clockwise on unless `flip`. */
  sheet(rows, colour, inside = 0, flip = false) {
    const R = rows.length, K = rows[0].length, at = (r, k) => rows[Math.min(R - 1, Math.max(0, r))][Math.min(K - 1, Math.max(0, k))], first = this.p.length / 3;
    for (let r = 0; r < R; r++) for (let k = 0; k < K; k++) {
      const a = at(r + 1, k), b = at(r - 1, k), c = at(r, k + 1), d = at(r, k - 1), u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map(q => q / l * (flip ? -1 : 1));
      this.vertex(rows[r][k], n, typeof colour === 'function' ? colour(r, k) : colour, inside);
    }
    for (let r = 0; r + 1 < R; r++) for (let k = 0; k + 1 < K; k++) { const a = first + r * K + k, b = a + 1, c = a + K, d = c + 1; if (flip) this.i.push(a, b, c, b, d, c); else this.i.push(a, c, b, b, c, d); }
  }
  /** A box, its faces flat. */
  box(c, h, colour, inside = 0, turn = 0) {
    const cs = Math.cos(turn), sn = Math.sin(turn), at = (x, y, z) => [c[0] + x * cs - z * sn, c[1] + y, c[2] + x * sn + z * cs];
    for (const [n, a, b] of [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]]) {
      const q = (s, t) => at(...[0, 1, 2].map(k => (n[k] + s * a[k] + t * b[k]) * h[k])), nn = [n[0] * cs - n[2] * sn, n[1], n[0] * sn + n[2] * cs];
      const v = [q(-1, -1), q(1, -1), q(1, 1), q(-1, 1)].map(p => this.vertex(p, nn, colour, inside));
      this.i.push(v[0], v[1], v[2], v[0], v[2], v[3]);
    }
  }
  /** A round bar from a to b. */
  bar(a, b, r, colour, sides = 8, inside = 0, r2 = r) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, w = d.map(v => v / l), s = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [w[1] * s[2] - w[2] * s[1], w[2] * s[0] - w[0] * s[2], w[0] * s[1] - w[1] * s[0]]; const ul = Math.hypot(...u); u = u.map(v => v / ul); const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    const rows = [[a, r], [b, r2]].map(([p, rr]) => [...Array(sides + 1)].map((_, k) => { const t = k / sides * 2 * Math.PI; return [0, 1, 2].map(q => p[q] + rr * (u[q] * Math.cos(t) + v[q] * Math.sin(t))); }));
    this.sheet(rows, colour, inside);
    for (const [p, rr, way] of [[a, r, -1], [b, r2, 1]]) { const c = this.vertex(p, w.map(q => q * way), colour, inside), ring = [...Array(sides)].map((_, k) => { const t = k / sides * 2 * Math.PI; return this.vertex([0, 1, 2].map(q => p[q] + rr * (u[q] * Math.cos(t) + v[q] * Math.sin(t))), w.map(q => q * way), colour, inside); }); for (let k = 0; k < sides; k++) { if (way > 0) this.i.push(c, ring[k], ring[(k + 1) % sides]); else this.i.push(c, ring[(k + 1) % sides], ring[k]); } }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('aInside', new THREE.Float32BufferAttribute(this.inside, 1));
    g.setIndex(this.i); g.computeBoundingSphere();
    return g;
  }
}

/** The floor's height inside at x (the floorboards follow the keel's rise towards the bow). */
export const floorAt = x => { const s = section((x + 3.8) / 7.6); return Math.max(-0.11, s.keel + 0.2); };
/** Where things are aboard (the boat's own frame): the seat at the tiller, where your feet go, the tiller's grip with the helm amidships. */
// (`seat`: where you sit on the stern bench, to starboard; `turn`: how far to starboard of the bow you face there
// (to port: half turned to the tiller); `tiller`: how long its arm is from the pin the outboard turns on.)
export const ABOARD = { seat: [-2.98, 0.33, 0.3], thwart: 0.33, turn: -40 * Math.PI / 180, feet: [-2.6, floorAt(-2.6), 0.1], pivot: [-3.9, 0.5, 0], tiller: 0.7, box: [3.95, 1.25, 1.08] };

function hullGeometry() {
  const b = new Builder(), N = 30, T = 0.028;
  // Outside: from the keel up to the chine (the bottom) and from the chine to the gunwale (the topsides), each side.
  for (const side of [-1, 1]) {
    const bottom = [], top = [], inner = [], cap = [];
    for (let k = 0; k <= N; k++) {
      const s = section(k / N), z = v => side * v;
      bottom.push([[s.x, s.keel, 0], [s.x, s.keel * 0.55 + s.chineY * 0.45, z(s.chine * 0.5)], [s.x, s.chineY, z(s.chine)]]);
      top.push([[s.x, s.chineY, z(s.chine)], [s.x, s.chineY + (s.sheer - s.chineY) * 0.35, z(s.chine + (s.half - s.chine) * 0.55)], [s.x, s.chineY + (s.sheer - s.chineY) * 0.75, z(s.chine + (s.half - s.chine) * 0.92)], [s.x, s.sheer - 0.09, z(s.half - 0.002)], [s.x, s.sheer, z(s.half)]]);
      // Inside: the same skin a plank's thickness in, down to the floor.
      const f = floorAt(s.x), ih = Math.max(0.01, s.half - T), ic = Math.max(0.005, s.chine - T);
      inner.push([[s.x, s.sheer, z(ih)], [s.x, s.chineY + (s.sheer - s.chineY) * 0.6, z(ic + (ih - ic) * 0.85)], [s.x, Math.max(f, s.chineY + 0.02), z(ic)], [s.x, f, z(ic * 0.75)], [s.x, f, 0]]);
      cap.push([[s.x, s.sheer + 0.012, z(s.half + 0.012)], [s.x, s.sheer + 0.02, z(s.half - T * 0.5)], [s.x, s.sheer + 0.012, z(ih - 0.012)]]);
    }
    b.sheet(bottom, BOTTOM, 0, side > 0);
    b.sheet(top, (r, k) => (k >= 3 ? BAND : WHITE), 0, side > 0);
    b.sheet(inner, (r, k) => (k >= 3 ? [0.56, 0.5, 0.4] : INSIDE), 1, side > 0);
    b.sheet(cap, WOOD, 1, side > 0);
  }
  // The transom, outside and in, and its top.
  { const s = section(0), f = floorAt(s.x);
    for (const [x, inside, flip] of [[s.x, 0, false], [s.x + T, 1, true]]) b.sheet([[[x, s.sheer, -s.half], [x, s.chineY, -s.chine], [x, s.keel, 0]], [[x, s.sheer, 0], [x, s.chineY, 0], [x, inside ? f : s.keel, 0]], [[x, s.sheer, s.half], [x, s.chineY, s.chine], [x, s.keel, 0]]], (r, k) => (inside ? INSIDE : k === 0 ? WHITE : BOTTOM), inside, flip);
    b.box([s.x + T / 2, s.sheer + 0.012, 0], [T * 0.9, 0.014, s.half * 0.6], WOOD, 1); }
  // Frames: a rib up each side every 60 cm, and floorboards with gaps between them.
  for (let x = -3.3; x < 2.6; x += 0.6) { const s = section((x + 3.8) / 7.6), f = floorAt(x); for (const side of [-1, 1]) b.bar([x, f + 0.01, side * (s.chine - 0.045)], [x, s.sheer - 0.04, side * (s.half - 0.05)], 0.017, [0.58, 0.66, 0.68], 5, 1); }
  for (let k = -3; k <= 3; k++) { const rows = []; for (let j = 0; j <= 12; j++) { const x = -3.7 + 6.6 * j / 12, s = section((x + 3.8) / 7.6), w = Math.min(0.105, (s.chine - 0.08) / 3.6), f = floorAt(x) + 0.016; rows.push([[x, f, k * w * 1.06 - w * 0.47], [x, f, k * w * 1.06 + w * 0.47]]); } b.sheet(rows, [0.6, 0.52, 0.4], 1, true); }
  // Three thwarts, and the stern bench you sit on to steer.
  for (const [x, wide] of [[-0.75, 0.13], [1.25, 0.13], [ABOARD.seat[0], 0.19]]) b.box([x, ABOARD.thwart - 0.02, 0], [wide, 0.018, Math.min(breadthAt(x - wide, ABOARD.thwart - 0.04), breadthAt(x + wide, ABOARD.thwart - 0.04)) - 0.03], WOOD, 1);
  // The foredeck, and the stem post.
  { const rows = []; for (let j = 0; j <= 8; j++) { const t = 0.84 + 0.155 * j / 8, s = section(t); rows.push([[s.x, s.sheer + 0.005, -Math.max(0.004, s.half - 0.03)], [s.x, s.sheer + 0.03, 0], [s.x, s.sheer + 0.005, Math.max(0.004, s.half - 0.03)]]); } b.sheet(rows, DECK, 1); }
  { const a = section(1), c = section(0.985); b.bar([c.x - 0.02, c.keel, 0], [a.x + 0.03, a.sheer + 0.1, 0], 0.03, WOOD, 6, 0, 0.022); }
  // A fuel tank by the stern, an anchor and its line in the bow.
  b.box([-3.3, floorAt(-3.3) + 0.14, -0.42], [0.21, 0.12, 0.15], TANK, 1); b.box([-3.3, floorAt(-3.3) + 0.275, -0.42], [0.04, 0.015, 0.04], [0.1, 0.1, 0.1], 1);
  { const f = floorAt(2.35) + 0.03; b.bar([2.1, f + 0.02, 0.1], [2.62, f + 0.02, 0.1], 0.014, RUST, 6, 1); b.bar([2.6, f + 0.02, -0.1], [2.6, f + 0.02, 0.3], 0.013, RUST, 6, 1); b.bar([2.12, f + 0.02, 0.02], [2.12, f + 0.02, 0.18], 0.01, RUST, 6, 1);
    for (let k = 0; k < 14; k++) { const a = k / 14 * 2 * Math.PI, c = (k + 1) / 14 * 2 * Math.PI, r = 0.13; b.bar([1.75 + r * Math.cos(a), f + 0.012 + 0.012 * (k % 3), -0.2 + r * Math.sin(a)], [1.75 + r * Math.cos(c), f + 0.012 + 0.012 * ((k + 1) % 3), -0.2 + r * Math.sin(c)], 0.011, ROPE, 5, 1); } }
  return b.geometry();
}

// A closed loop of points at height y: rx by rz, square-cornered by `power` (2 an ellipse; more, squarer).
const loop = (cx, y, cz, rx, rz, power = 2, n = 16) => [...Array(n + 1)].map((_, k) => { const a = k / n * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a), e = 2 / power; return [cx + rx * Math.sign(c) * Math.abs(c) ** e, y, cz + rz * Math.sign(sn) * Math.abs(sn) ** e]; });

/** The outboard, about the pin it turns and tilts on (its own frame: the pin is the y axis; forward +x into the boat). */
function outboardGeometry() {
  const b = new Builder(), BANDED = [0.8, 0.81, 0.82];
  // The cowl: rounded, fuller behind than before, a pale band round its foot.
  b.sheet([[0.04, 0.2, 0.125, -0.2], [0.07, 0.235, 0.15, -0.2], [0.12, 0.24, 0.155, -0.2], [0.2, 0.238, 0.155, -0.205], [0.3, 0.225, 0.148, -0.21], [0.37, 0.2, 0.132, -0.215], [0.415, 0.15, 0.1, -0.22], [0.43, 0.004, 0.003, -0.22]].map(([y, rx, rz, cx]) => loop(cx, y, 0, rx, rz, 3.2)), (r) => (r <= 1 ? BANDED : COWL));
  b.sheet([[0.04, 0.2, 0.125], [0.04, 0.004, 0.003]].map(([y, rx, rz]) => loop(-0.2, y, 0, rx, rz, 3.2)), BANDED);
  // The clamp on the transom, and the leg: a faired strut, down to the plate over the propeller.
  b.box([-0.05, -0.02, 0], [0.06, 0.11, 0.075], LEG); b.box([0.035, -0.06, 0], [0.012, 0.13, 0.06], [0.2, 0.2, 0.22]);
  b.sheet([[0.04, 0.1, 0.07, -0.17], [-0.1, 0.085, 0.05, -0.18], [-0.4, 0.075, 0.036, -0.19], [-0.72, 0.08, 0.034, -0.2]].map(([y, rx, rz, cx]) => loop(cx, y, 0, rx, rz, 2.4, 12)), LEG);
  b.sheet([loop(-0.24, -0.735, 0, 0.21, 0.1, 2.6, 14), loop(-0.24, -0.735, 0, 0.004, 0.002, 2.6, 14)], LEG); b.sheet([loop(-0.24, -0.75, 0, 0.21, 0.1, 2.6, 14), loop(-0.24, -0.75, 0, 0.004, 0.002, 2.6, 14)], LEG);
  b.sheet([[-0.735, 0.21, 0.1], [-0.75, 0.21, 0.1]].map(([y, rx, rz]) => loop(-0.24, y, 0, rx, rz, 2.6, 14)), LEG);
  b.sheet([[-0.75, 0.07, 0.03, -0.2], [-0.84, 0.075, 0.04, -0.2]].map(([y, rx, rz, cx]) => loop(cx, y, 0, rx, rz, 2.4, 12)), LEG);
  // The gear case, its skeg, and the propeller.
  b.bar([0.0, -0.92, 0], [-0.1, -0.92, 0], 0.022, LEG, 10, 0, 0.055); b.bar([-0.1, -0.92, 0], [-0.36, -0.92, 0], 0.055, LEG, 10, 0, 0.04);
  b.sheet([[-0.96, 0.1, 0.012, -0.2], [-1.06, 0.07, 0.008, -0.21], [-1.13, 0.02, 0.004, -0.24]].map(([y, rx, rz, cx]) => loop(cx, y, 0, rx, rz, 2, 8)), LEG);
  b.bar([-0.36, -0.92, 0], [-0.47, -0.92, 0], 0.03, [0.18, 0.18, 0.19], 8, 0, 0.012);
  for (let k = 0; k < 3; k++) { const a = k / 3 * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a); b.sheet([[0.03, 0.03, -0.39], [0.075, 0.05, -0.41], [0.11, 0.03, -0.43]].map(([r, w, x]) => [[x - w * 0.6, -0.92 + c * r - sn * w, sn * r + c * w], [x + w * 0.6, -0.92 + c * r + sn * w, sn * r - c * w]]), [0.2, 0.2, 0.21]); }
  return b.geometry();
}

/** The tiller: an arm forward from the pin to its grip. It is hinged where it leaves the engine, and lies level whatever the engine's tilt. */
function tillerGeometry() {
  const b = new Builder(), l = ABOARD.tiller;
  b.bar([-0.06, 0.17, 0], [l - 0.15, 0.17, 0], 0.017, LEG, 8, 0, 0.015); b.bar([l - 0.15, 0.17, 0], [l + 0.01, 0.17, 0], 0.021, [0.09, 0.09, 0.1], 10); b.box([-0.05, 0.17, 0], [0.04, 0.03, 0.03], LEG);
  return b.geometry();
}

const vertexShader = /* glsl */`
#include <lr_common>
in float aInside;
out vec3 vRel;
out vec3 vN;
out vec3 vOwn;
out vec3 vColor;
out float vInside;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz; vN = mat3(modelMatrix) * normal; vOwn = position; vColor = color; vInside = aInside;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - lrCurveDrop(wp.xz), wp.z, 1.0);
}`;
const fragmentShader = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
${shadowGLSL}
uniform vec3 uSeaAlong;     // the sea as it lies along the hull: its height at the boat's middle, and its slope east and south (the camera's frame)
uniform vec2 uBoatAt;       // the boat's middle, from the camera (x, z)
uniform float uWet;
uniform float uSpray;       // how wet its topsides are from its own spray, 0..1
uniform sampler2D tName;    // its name, as it is painted on each bow (white where there is paint)
in vec3 vRel;
in vec3 vN;
in vec3 vOwn;
in vec3 vColor;
in float vInside;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 n = normalize(vN), toEye = vec3(-vRel.x, uCamY - vRel.y, -vRel.z), e = normalize(toEye);
  if (dot(n, toEye) < 0.0) n = -n;
  // Paint that has been in the sun and the salt: a little uneven, chalky on top, scuffed along the chine.
  float fine = 1.0 - smoothstep(0.004, 0.03, length(fwidth(vRel)));
  vec3 albedo = vColor * (1.0 + fine * (0.1 * (lrNoise(vOwn.xy * 9.0 + vOwn.z * 5.0) - 0.5) + 0.06 * (lrNoise(vOwn.xz * 140.0 + vOwn.y * 90.0) - 0.5)));
  if (vInside < 0.5 && abs(vOwn.z) > 0.05) {
    // Its paint, by where on the topsides: a thin blue line under the yellow band, and its name on each bow,
    // following the sheer (read from outside on either side: the letters run aft to forward to starboard, and
    // forward to aft to port).
    float t = (vOwn.x + 3.8) / 7.6, sheer = 0.56 + 0.62 * t * t * t + 0.06 * t, down = sheer - vOwn.y;
    albedo = mix(albedo, vec3(0.05, 0.16, 0.42), (1.0 - smoothstep(0.012, 0.016, abs(down - 0.112))) * step(-3.7, vOwn.x));
    vec2 at = vec2((vOwn.x - 1.05) / 1.55, (down - 0.17) / 0.2);
    if (vOwn.z < 0.0) at.x = 1.0 - at.x;
    if (at.x > 0.0 && at.x < 1.0 && at.y > 0.0 && at.y < 1.0) albedo = mix(albedo, vec3(0.05, 0.16, 0.42), texture(tName, at).r * (0.9 + 0.1 * lrNoise(vOwn.xy * 300.0)));
  }
  float sea = uSeaAlong.x + dot(uSeaAlong.yz, vRel.xz - uBoatAt), water = sea - vRel.y;
  // (Wet a hand's breadth above the water all the time, and higher where its spray has been: darker, and it shines.)
  float wet = max(uWet, vInside > 0.5 ? 0.0 : max(1.0 - smoothstep(0.03, 0.14, -water), uSpray * (1.0 - smoothstep(0.1, 0.55, -water))));
  albedo *= 1.0 - 0.22 * wet;
  float cloud = lrCloudShadow(uCamXZ + vRel.xz), sunLit = lrSunThrough(cloud, vRel, n);
  vec3 bounce = (uSunE * lrSaturate(uSunDir.y) * cloud + uSkyE) * (vInside > 0.5 ? vec3(0.4, 0.42, 0.42) : vec3(0.2, 0.32, 0.36)) * 0.5;
  vec3 light = uSunE * lrSaturate(dot(n, uSunDir)) * sunLit + uSkyE * (0.55 + 0.45 * n.y) + bounce * (0.5 - 0.5 * n.y);
  vec3 h = normalize(uSunDir + e);
  vec3 sheen = uSunE * sunLit * lrSaturate(dot(n, uSunDir)) * (0.04 + 0.25 * wet) * pow(lrSaturate(dot(n, h)), mix(40.0, 220.0, wet)) + (0.03 + 0.5 * wet) * pow(1.0 - lrSaturate(dot(n, e)), 5.0) * uSkyE / PI * (0.5 + 0.5 * n.y);
  if (vInside > 0.5) { outColor = vec4(albedo * light / PI + sheen, -1800.0); return; }
  if (water > 0.0) outColor = vec4(albedo * light / max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4)), water);
  else outColor = vec4(albedo * light / PI + sheen, -1000.0);
}`;

/** A stake driven into the sand to make a line fast to. */
function stakeGeometry() {
  const b = new Builder();
  b.bar([0.02, -0.25, 0], [-0.05, 0.42, 0.02], 0.028, [0.42, 0.33, 0.24], 7, 0, 0.022);
  return b.geometry();
}

/**
 * A line from one place to another, hanging between them by what slack it has and lying on whatever is under it.
 * @param {number[]} a  @param {number[]} b  its two ends (world)  @param {number} length
 * @param {(x: number, z: number) => number} floorAt  what is under it (the sand, the seabed)
 * @param {number} n  how many lengths it is drawn in
 */
export function hang(a, b, length, floorAt, n = 24) {
  const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), sag = Math.sqrt(Math.max(0, 0.375 * span * (length - span))), out = [];
  for (let k = 0; k <= n; k++) { const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t; out.push([x, Math.max(a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), k === 0 || k === n ? -1e9 : floorAt(x, z) + 0.012), z]); }
  return out;
}

/** A rope: a thin round line through points given each frame. */
export class Rope {
  constructor(material, segments = 24, sides = 5, radius = 0.011) {
    Object.assign(this, { segments, sides, radius });
    const count = (segments + 1) * sides, g = new THREE.BufferGeometry(), index = [];
    this.position = new Float32Array(count * 3); this.normal = new Float32Array(count * 3);
    const colour = new Float32Array(count * 3);
    // (Laid rope: its strands show as a light and a dark turn about along it.)
    for (let k = 0; k <= segments; k++) for (let s = 0; s < sides; s++) { const shade = 0.86 + 0.14 * ((k + s) % 2); colour.set(ROPE.map(v => v * shade), (k * sides + s) * 3); }
    for (let k = 0; k < segments; k++) for (let s = 0; s < sides; s++) { const a = k * sides + s, b = k * sides + (s + 1) % sides, c = a + sides, d = b + sides; index.push(a, c, b, b, c, d); }
    g.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('normal', new THREE.BufferAttribute(this.normal, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(colour, 3)); g.setAttribute('aInside', new THREE.BufferAttribute(new Float32Array(count), 1)); g.setIndex(index);
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.visible = false;
  }

  /** @param {number[][]} points  segments + 1 of them, in the world  @param {number[]} origin  the camera's [x, z] */
  set(points, origin) {
    const { segments: n, sides, radius: r } = this;
    for (let k = 0; k <= n; k++) {
      const p = points[k], a = points[Math.max(0, k - 1)], b = points[Math.min(n, k + 1)], t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tl = Math.hypot(...t) || 1, w = t.map(v => v / tl), s = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let u = [w[1] * s[2] - w[2] * s[1], w[2] * s[0] - w[0] * s[2], w[0] * s[1] - w[1] * s[0]]; const ul = Math.hypot(...u); u = u.map(v => v / ul); const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
      for (let q = 0; q < sides; q++) {
        const a2 = q / sides * 2 * Math.PI, c = Math.cos(a2), sn = Math.sin(a2), o = (k * sides + q) * 3, nx = u[0] * c + v[0] * sn, ny = u[1] * c + v[1] * sn, nz = u[2] * c + v[2] * sn;
        this.position[o] = p[0] - origin[0] + nx * r; this.position[o + 1] = p[1] + ny * r; this.position[o + 2] = p[2] - origin[1] + nz * r;
        this.normal[o] = nx; this.normal[o + 1] = ny; this.normal[o + 2] = nz;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.normal.needsUpdate = true; this.mesh.visible = true;
  }
}

/** The boat's name. (The studio's own: say if she should be called something else.) */
export const NAME = 'Lelelilo';
/** The name as a picture to paint on the bows: white letters on black. */
function namePicture(name) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
  const c = canvas.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, 1024, 128);
  // (Painted by hand, as the names of the islands' boats are: a slanted brush letter, a little uneven.)
  c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.font = 'italic 700 96px Georgia, "Times New Roman", serif';
  let x = 512 - c.measureText(name).width / 2;
  for (const [i, letter] of [...name].entries()) { const w = c.measureText(letter).width; c.save(); c.translate(x + w / 2, 66 + 3 * Math.sin(i * 2.3)); c.rotate(0.03 * Math.sin(i * 1.7)); c.fillText(letter, 0, 0); c.restore(); x += w; }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.anisotropy = 8; texture.flipY = false;
  return texture;
}

export class Penero {
  /** @param {number} shadowTaps */
  constructor(shadowTaps = 8) {
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, vertexColors: true, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.cloudShadow, ...CHUNK_UNIFORMS.shadow, 'uWet'], { uSeaAlong: { value: new THREE.Vector3(0, 0, 0) }, uBoatAt: { value: new THREE.Vector2() }, uSpray: { value: 0 }, tName: { value: typeof document !== 'undefined' ? namePicture(NAME) : null } }),
    });
    this.hull = new THREE.Mesh(hullGeometry(), material);
    this.outboard = new THREE.Mesh(outboardGeometry(), material);
    this.tiller = new THREE.Mesh(tillerGeometry(), material);
    /** Its lines (a bow line and a stern line), and the stake on the beach the bow line is made fast to. */
    this.ropes = [new Rope(material), new Rope(material)];
    this.stake = new THREE.Mesh(stakeGeometry(), material);
    this.stake.visible = false;
    for (const m of [this.hull, this.outboard, this.tiller, this.stake]) { m.frustumCulled = false; m.matrixAutoUpdate = false; }
    /** Everything of it that is drawn. */
    this.meshes = [this.hull, this.outboard, this.tiller, this.stake, ...this.ropes.map(r => r.mesh)];
    this.material = material;
    this.triangles = this.meshes.reduce((a, m) => a + m.geometry.index.count, 0) / 3;
    this._m = new THREE.Matrix4(); this._o = new THREE.Matrix4();
    /** The world (from the camera) to the boat's own frame, and half the box the sea is kept out of: for water.js. */
    this.inverse = new THREE.Matrix4(); this.half = new THREE.Vector3(...ABOARD.box);
  }

  /**
   * @param {number[]} matrix  the boat's frame to the world, from the camera (sim/boat.js `matrix`)
   * @param {number} helm  -1..1  @param {number} tilt  0 the outboard down .. 1 tilted up out of the water
   * @param {number[]} sea  the sea along the hull: [height at the boat's middle, slope east, slope south]
   * @param {number} spray  0..1
   */
  place(matrix, helm, tilt, sea, spray = 0) {
    this._m.fromArray(matrix);
    this.hull.matrix.copy(this._m); this.hull.matrixWorld.copy(this._m);
    // (The outboard turns on its pin with the tiller: helm to starboard swings the tiller to port and the propeller to starboard. Tilted, it swings up about the transom.)
    const p = ABOARD.pivot, a = helm * 32 * Math.PI / 180;
    this._o.makeTranslation(p[0], p[1], p[2]).multiply(new THREE.Matrix4().makeRotationZ(-tilt * 1.2)).multiply(new THREE.Matrix4().makeRotationY(a));
    this.outboard.matrix.multiplyMatrices(this._m, this._o); this.outboard.matrixWorld.copy(this.outboard.matrix);
    this._o.makeTranslation(p[0], p[1], p[2]).multiply(new THREE.Matrix4().makeRotationY(a));
    this.tiller.matrix.multiplyMatrices(this._m, this._o); this.tiller.matrixWorld.copy(this.tiller.matrix);
    this.inverse.copy(this._m).invert();
    const u = this.material.uniforms; u.uSeaAlong.value.set(sea[0], sea[1], sea[2]); u.uBoatAt.value.set(matrix[12], matrix[14]); u.uSpray.value = spray;
  }

  /** Where the tiller's grip is, in the boat's own frame, for this helm (your hand goes there). */
  static grip(helm) { const p = ABOARD.pivot, a = helm * 32 * Math.PI / 180, l = ABOARD.tiller; return [p[0] + l * Math.cos(a), p[1] + 0.17, p[2] - l * Math.sin(a)]; }
}
