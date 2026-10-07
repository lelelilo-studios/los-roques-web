// Plants up close: red mangroves standing on their arching prop roots (where the land map says mangrove; the
// terrain's canopy shell gives way to them near the eye), sea purslane and shrubs on the backshore, cacti on
// Gran Roque's hills, a few coconut palms and bougainvilleas in the village. All through world/scatter.js.
import { Scatter, Shape } from './scatter.js';

const rand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

/** A lumpy mass of leaves: a ball whose facets are each a slightly different green (flat shading does the rest). */
function leaves(s, r, cx, cy, cz, rx, ry, rz, dark, light, bend) {
  const rings = 5, sides = 9, wob = Array.from({ length: (rings + 1) * sides }, () => 0.78 + 0.44 * r());
  const at = (j, i) => { const u = (j % sides) / sides * 6.283, v = (i / rings - 0.5) * Math.PI, k = wob[i * sides + (j % sides)]; return [cx + Math.cos(u) * Math.cos(v) * rx * k, cy + Math.sin(v) * ry * k, cz + Math.sin(u) * Math.cos(v) * rz * k]; };
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const t = r(), c = dark.map((d, n) => d + (light[n] - d) * t * (0.4 + 0.6 * i / rings));
    s.quad(at(j, i), at(j + 1, i), at(j + 1, i + 1), at(j, i + 1), c, [bend, bend, bend, bend]);
  }
  // Sprays of leaves standing out of the mass, each catching the light its own way: they break the crown's
  // outline and make it read as foliage, not as a boulder. (LEAF_SPRAYS per crown; none on the lighter tiers.)
  const mean = (rx + ry + rz) / 3;
  for (let k = 0; k < LEAF_SPRAYS.count; k++) {
    const u = r() * 6.283, sv = 2 * r() - 1, cv = Math.sqrt(1 - sv * sv), dir = [Math.cos(u) * cv, sv, Math.sin(u) * cv];
    const out = 0.88 + 0.3 * r(), p = [cx + dir[0] * rx * out, cy + dir[1] * ry * out, cz + dir[2] * rz * out], size = mean * (0.12 + 0.11 * r());
    // Two directions across the spray: one round the crown, one leaning out from it.
    const w = [r() - 0.5, r() - 0.5, r() - 0.5];
    let a = [dir[1] * w[2] - dir[2] * w[1], dir[2] * w[0] - dir[0] * w[2], dir[0] * w[1] - dir[1] * w[0]];
    const al = Math.hypot(a[0], a[1], a[2]) || 1;
    a = a.map(v => v / al * size);
    const lean = 0.2 + 0.8 * r(), b = [(dir[1] * a[2] - dir[2] * a[1]) * (1 - 0.5 * lean) + dir[0] * size * lean, (dir[2] * a[0] - dir[0] * a[2]) * (1 - 0.5 * lean) + dir[1] * size * lean, (dir[0] * a[1] - dir[1] * a[0]) * (1 - 0.5 * lean) + dir[2] * size * lean];
    const t = r(), c = dark.map((d, n) => (d + (light[n] - d) * t) * (0.8 + 0.5 * r()));
    // (Pointed, like a leaf: a rhombus, longer the way it leans out.)
    s.quad([p[0] - a[0] * 0.6, p[1] - a[1] * 0.6, p[2] - a[2] * 0.6], [p[0] - b[0], p[1] - b[1], p[2] - b[2]],
      [p[0] + a[0] * 0.6, p[1] + a[1] * 0.6, p[2] + a[2] * 0.6], [p[0] + b[0] * 1.3, p[1] + b[1] * 1.3, p[2] + b[2] * 1.3], c, [bend, bend, bend, bend + 0.1]);
  }
}
const LEAF_SPRAYS = { count: 0 };

/** A red mangrove (Rhizophora mangle), 4 m: a short trunk held up on arching prop roots, a dense dark crown. */
function mangrove(seed) {
  const s = new Shape(), r = rand(seed), bark = [0.2, 0.15, 0.11], root = [0.26, 0.19, 0.13], dark = [0.02, 0.06, 0.018], light = [0.07, 0.17, 0.04];
  s.tube([[0, 0.9, 0], [0.08, 1.7, 0.05], [0.02, 2.6, -0.06]], [0.075, 0.06, 0.04], 6, bark, [0, 0.05, 0.15]);
  // Prop roots: out and down in an arch from the lower trunk, some forking, a few dropping from the branches.
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * 6.283 + r() * 0.5, from = 0.75 + 0.75 * r(), out = 0.55 + 0.75 * r(), ca = Math.cos(a), sa = Math.sin(a);
    const pts = [[ca * 0.05, from, sa * 0.05], [ca * out * 0.5, from + 0.05, sa * out * 0.5], [ca * out * 0.9, from * 0.55, sa * out * 0.9], [ca * out, -0.35, sa * out]];
    s.tube(pts, [0.03, 0.026, 0.022, 0.02], 5, root);
    if (r() > 0.45) { const b = a + 0.6 - 1.2 * r(), o2 = out * (0.7 + 0.5 * r()); s.tube([pts[1], [Math.cos(b) * o2 * 0.9, from * 0.45, Math.sin(b) * o2 * 0.9], [Math.cos(b) * o2, -0.35, Math.sin(b) * o2]], [0.022, 0.018, 0.016], 4, root); }
  }
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * 6.283 + r(), d = 0.5 + 0.8 * r(), y = 2.5 + 1.0 * r(), cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    s.tube([[0.04, 1.9 + 0.5 * r(), 0], [cx * 0.6, y - 0.5, cz * 0.6], [cx, y - 0.1, cz]], [0.035, 0.025, 0.012], 4, bark, [0.08, 0.2, 0.3]);
    leaves(s, r, cx, y + 0.1, cz, 0.85 + 0.35 * r(), 0.55 + 0.25 * r(), 0.85 + 0.35 * r(), dark, light, 0.35);
    if (r() > 0.6) s.tube([[cx * 0.8, y - 0.3, cz * 0.8], [cx * 0.9, 1.0, cz * 0.9], [cx * 0.95, -0.35, cz * 0.95]], [0.012, 0.011, 0.01], 3, root);     // an aerial root
  }
  leaves(s, r, 0, 3.5, 0, 1.0, 0.7, 1.0, dark, light, 0.4);
  return s.geometry();
}

/** A mat of sea purslane (Sesuvium portulacastrum): fleshy leaves on red runners, hugging the sand, a few pink flowers. */
function purslane() {
  const s = new Shape(), r = rand(41), green = [0.1, 0.2, 0.06], pale = [0.19, 0.28, 0.1], stem = [0.26, 0.13, 0.09], flower = [0.7, 0.3, 0.5];
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * 6.283 + r(), len = 0.2 + 0.25 * r(), ca = Math.cos(a), sa = Math.sin(a);
    s.tube([[0, 0.012, 0], [ca * len * 0.5, 0.02, sa * len * 0.5], [ca * len, 0.01, sa * len]], [0.003, 0.0025, 0.002], 3, stem);
    for (let m = 1; m <= 5; m++) for (const side of [-1, 1]) {
      const t = m / 5, x = ca * len * t, z = sa * len * t, lx = -sa * side, lz = ca * side, l = 0.035 + 0.02 * r(), c = r() > 0.5 ? green : pale;
      s.quad([x, 0.018, z], [x + lx * l * 0.5 + ca * 0.012, 0.03, z + lz * l * 0.5 + sa * 0.012], [x + lx * l, 0.024, z + lz * l], [x + lx * l * 0.5 - ca * 0.012, 0.014, z + lz * l * 0.5 - sa * 0.012], c);
    }
    if (r() > 0.6) s.ball(ca * len * 0.8, 0.035, sa * len * 0.8, 0.008, 0.006, 0.008, 2, 5, flower);
  }
  return s.geometry();
}

/** A wind-shaped shrub of the backshore, knee to chest high: grey-green, twiggy underneath. */
function shrub(seed) {
  const s = new Shape(), r = rand(seed), twig = [0.3, 0.26, 0.2], dark = [0.05, 0.1, 0.045], light = [0.14, 0.2, 0.09];
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * 6.283 + r(), d = 0.15 + 0.3 * r(), y = 0.45 + 0.4 * r(), cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    s.tube([[0, 0, 0], [cx * 0.5, y * 0.6, cz * 0.5], [cx, y, cz]], [0.022, 0.014, 0.008], 4, twig, [0, 0.1, 0.3]);
    leaves(s, r, cx, y + 0.08, cz, 0.3 + 0.15 * r(), 0.2 + 0.1 * r(), 0.3 + 0.15 * r(), dark, light, 0.4);
  }
  return s.geometry();
}

/** A columnar cactus (cardon), 2-3 m: ribbed green columns, one or two arms. */
function cardon() {
  const s = new Shape(), r = rand(51), ribs = 9;
  const column = (x, z, y0, y1, rad) => {
    for (let k = 0; k < ribs; k++) {
      const a0 = k / ribs * 6.283, a1 = (k + 0.5) / ribs * 6.283, a2 = (k + 1) / ribs * 6.283, green = [0.13, 0.25, 0.1], shade = [0.07, 0.15, 0.07];
      const p = (a, q, y) => [x + Math.cos(a) * q, y, z + Math.sin(a) * q];
      s.quad(p(a0, rad * 0.78, y0), p(a1, rad, y0), p(a1, rad, y1), p(a0, rad * 0.78, y1), [shade, green, green, shade]);
      s.quad(p(a1, rad, y0), p(a2, rad * 0.78, y0), p(a2, rad * 0.78, y1), p(a1, rad, y1), [green, shade, shade, green]);
      s.tri(p(a0, rad * 0.78, y1), p(a1, rad, y1), [x, y1 + rad * 0.6, z], green); s.tri(p(a1, rad, y1), p(a2, rad * 0.78, y1), [x, y1 + rad * 0.6, z], green);
    }
  };
  column(0, 0, 0, 2.3 + 0.5 * r(), 0.11);
  for (let k = 0; k < 2; k++) { const a = r() * 6.283, d = 0.3 + 0.1 * r(), y = 0.7 + 0.6 * r(); s.tube([[Math.cos(a) * 0.08, y, Math.sin(a) * 0.08], [Math.cos(a) * d, y + 0.05, Math.sin(a) * d]], [0.07, 0.075], 6, [0.1, 0.2, 0.09]); column(Math.cos(a) * d, Math.sin(a) * d, y + 0.02, y + 0.8 + 0.6 * r(), 0.085); }
  return s.geometry();
}

/** Prickly pear (Opuntia): flat pads growing out of one another, and a melon cactus beside it with its red cap. */
function pricklyPear() {
  const s = new Shape(), r = rand(61), pad = [0.2, 0.33, 0.14], edge = [0.13, 0.23, 0.1];
  const grow = (x, y, z, a, tilt, size, depth) => {
    const cx = x + Math.cos(a) * Math.sin(tilt) * size, cy = y + Math.cos(tilt) * size, cz = z + Math.sin(a) * Math.sin(tilt) * size;
    s.ball(cx, cy, cz, size * 0.62 * Math.abs(Math.sin(a)) + 0.02, size, size * 0.62 * Math.abs(Math.cos(a)) + 0.02, 3, 8, (u, v) => (Math.abs(v - 0.5) > 0.3 ? edge : pad));
    if (depth < 2) for (let k = 0; k < 2; k++) if (r() > 0.25) grow(cx, cy + size * 0.7, cz, a + 1.2 * (r() - 0.5) + (k ? 1.6 : 0), 0.5 * (r() - 0.5) + (k ? 0.5 : -0.4), size * 0.8, depth + 1);
  };
  for (let k = 0; k < 3; k++) grow((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3, r() * 3.14, 0.3 * (r() - 0.5), 0.13 + 0.05 * r(), 0);
  // Melocactus: a ribbed globe the size of a football with a woolly red-brown cap.
  s.ball(0.55, 0.11, 0.2, 0.13, 0.12, 0.13, 4, 12, (u, v) => (Math.sin(u * 6.283 * 6) > 0 ? [0.16, 0.28, 0.12] : [0.09, 0.18, 0.08]));
  s.tube([[0.55, 0.2, 0.2], [0.55, 0.29, 0.2]], [0.05, 0.04], 7, [0.42, 0.14, 0.1]);
  return s.geometry();
}

/** A coconut palm, 7 m: a leaning ringed trunk, a head of arching fronds, a cluster of nuts. */
function palm() {
  const s = new Shape(), r = rand(71), trunk = [0.36, 0.31, 0.25], frond = [0.1, 0.24, 0.06], pale = [0.22, 0.36, 0.1];
  const lean = 0.9, top = [lean, 6.6, 0.2], pts = [], radii = [], bends = [];
  for (let k = 0; k <= 6; k++) { const t = k / 6; pts.push([lean * t * t, 6.6 * t, 0.2 * t]); radii.push(0.2 - 0.08 * t); bends.push(0.25 * t * t); }
  s.tube(pts, radii, 7, trunk, bends);
  for (let k = 0; k < 13; k++) {
    // A frond: a rib arching out and down, leaflets hanging from both sides of it.
    const a = k / 13 * 6.283 + r() * 0.3, rise = 0.9 - 1.5 * r() * (k % 3 ? 0.5 : 1), len = 2.6 + 0.8 * r(), ca = Math.cos(a), sa = Math.sin(a), rib = [];
    for (let m = 0; m <= 5; m++) { const t = m / 5; rib.push([top[0] + ca * len * t, top[1] + rise * t * 1.2 - 1.9 * t * t, top[2] + sa * len * t]); }
    for (let m = 0; m < 5; m++) {
      const p = rib[m], q = rib[m + 1], w = 0.55 * (1 - Math.abs(m - 2) / 4), droop = 0.35, b0 = 0.4 + 0.12 * m, b1 = 0.4 + 0.12 * (m + 1);
      for (const side of [-1, 1]) s.quad(p, q, [q[0] - sa * w * side, q[1] - droop, q[2] + ca * w * side], [p[0] - sa * w * side, p[1] - droop, p[2] + ca * w * side], [frond, frond, pale, pale], [b0, b1, b1 + 0.15, b0 + 0.15]);
    }
  }
  for (let k = 0; k < 5; k++) { const a = k * 1.3; s.ball(top[0] + Math.cos(a) * 0.2, top[1] - 0.35, top[2] + Math.sin(a) * 0.2, 0.12, 0.14, 0.12, 2, 6, [0.3, 0.32, 0.12], 0.3); }
  return s.geometry();
}

/** A bougainvillea: an arching mound of magenta over dark green. */
function bougainvillea() {
  const s = new Shape(), r = rand(81);
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * 6.283 + r(), d = 0.3 + 0.6 * r(), y = 0.9 + 0.9 * r();
    leaves(s, r, Math.cos(a) * d, y, Math.sin(a) * d, 0.55, 0.4, 0.55, k % 3 === 0 ? [0.06, 0.16, 0.05] : [0.45, 0.03, 0.26], k % 3 === 0 ? [0.14, 0.3, 0.08] : [0.8, 0.12, 0.5], 0.4);
  }
  s.tube([[0, 0, 0], [0.1, 0.9, 0.05]], [0.05, 0.03], 5, [0.3, 0.25, 0.2]);
  return s.geometry();
}

/** @returns {Scatter[]} */
export function buildPlants(textures, fp) {
  if (!fp.life) return [];
  LEAF_SPRAYS.count = fp.life > 1 ? 52 : 0;
  const n = g => (fp.life > 1 ? g : Math.round(g * 0.7 / 2) * 2), make = o => new Scatter(o, textures, fp.shadowTaps);
  // The wind in the leaves: everything sways a little, the tops most.
  const wind = `float gust = sin(t * 1.1 + dot(wxz, uWind.xy) * 0.25 + h.x * 5.0) + 0.5 * sin(t * 2.7 + h.y * 9.0); p.xz += uWind.xy * gust * bend * (0.02 + 0.006 * uWind.z);`;
  const leafy = { twoSided: true, through: 0.35, leaf: 0.09 }, fronds = { twoSided: true, through: 0.35, leaf: 0.12 }, mat = { twoSided: true, through: 0.35 };
  return [
    // Mangroves stand in the water and on the mud: their own height follows the canopy map.
    make({ casts: true, geometry: mangrove(101), cell: 3.4, grid: n(26), seed: 31, size: [0.8, 1.25], look: leafy,
      rule: `keep = smoothstep(0.4, 0.6, land.r) * 0.9;`, move: `p *= 0.7 + 1.1 * land.a; ${wind}` }),
    make({ casts: true, geometry: mangrove(202), cell: 4.6, grid: n(20), seed: 32, size: [0.7, 1.1], look: leafy,
      rule: `keep = smoothstep(0.4, 0.6, land.r) * 0.8;`, move: `p *= 0.7 + 1.1 * land.a; ${wind}` }),
    make({ geometry: purslane(), cell: 0.9, grid: n(56), seed: 33, size: [0.7, 1.5], lift: 0.0, look: mat,
      rule: `keep = smoothstep(0.12, 0.45, land.g) * (1.0 - smoothstep(0.3, 0.6, land.r)) * step(0.25, -water) * step(-water, 2.5) * 0.6;` }),
    make({ casts: true, geometry: shrub(301), cell: 2.4, grid: n(34), seed: 34, size: [0.55, 1.3], look: leafy,
      rule: `keep = smoothstep(0.35, 0.7, land.g) * (1.0 - smoothstep(0.3, 0.6, land.r)) * step(0.4, -water) * 0.55;`, move: wind }),
    make({ casts: true, geometry: cardon(), cell: 8.0, grid: n(24), seed: 35, size: [0.7, 1.4],
      rule: `keep = smoothstep(5.0, 12.0, ground) * (0.1 + 0.25 * land.g) * (1.0 - step(0.4, land.b));` }),
    make({ casts: true, geometry: pricklyPear(), cell: 5.0, grid: n(26), seed: 36, size: [0.8, 1.5],
      rule: `keep = smoothstep(3.0, 9.0, ground) * 0.2 * (1.0 - step(0.4, land.b));` }),
    make({ casts: true, geometry: palm(), cell: 16.0, grid: n(14), seed: 37, size: [0.8, 1.15], look: fronds,
      rule: `keep = smoothstep(0.25, 0.5, land.b) * (1.0 - smoothstep(0.55, 0.8, land.b)) * step(0.6, -water) * 0.3;`, move: wind }),
    make({ casts: true, geometry: bougainvillea(), cell: 11.0, grid: n(16), seed: 38, size: [0.7, 1.2], look: leafy,
      rule: `keep = smoothstep(0.3, 0.55, land.b) * (1.0 - smoothstep(0.6, 0.85, land.b)) * step(0.6, -water) * 0.22;`, move: wind }),
  ];
}
