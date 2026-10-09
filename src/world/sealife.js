// Life on the seabed and over it, where the maps say it lives: turtle grass on the seagrass beds; brain and star
// corals, elkhorn on the crests the swell breaks on, staghorn, sea fans, sea rods, sponges and long-spined
// urchins on the reef; cushion stars on the sand; and the fishes of the reef, the grass and the flats, each in
// its own shape and markings (world/faunaref.js lists them, with the record each is shown on).
// All of it through world/scatter.js: the shapes are built here, and each kind's GLSL says where it lives and
// how it moves. A fish keeps away from you when you are in the water with it.
import { Scatter, Shape } from './scatter.js';

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

/** A clump of turtle grass (Thalassia testudinum): flat ribbons 15-30 cm long, a centimetre or two wide. */
function grassClump() {
  const s = new Shape(), r = rand(5);
  for (let b = 0; b < 9; b++) {
    const a = r() * 6.283, d = 0.03 + 0.07 * r(), x0 = Math.cos(a) * d, z0 = Math.sin(a) * d, len = 0.16 + 0.16 * r(), w = 0.006 + 0.004 * r();
    const lean = [Math.cos(a + r()) * 0.08, Math.sin(a + r()) * 0.08], face = a + 1.57 + r() * 0.8, fx = Math.cos(face) * w, fz = Math.sin(face) * w;
    // Old blades are brown at the tip and grey with what grows on them.
    const base = [0.025, 0.065, 0.02], mid = [0.04, 0.1, 0.028], tip = r() > 0.5 ? [0.1, 0.105, 0.055] : [0.05, 0.115, 0.035];
    const at = k => { const t = k / 3; return [x0 + lean[0] * t * t, len * t, z0 + lean[1] * t * t]; };
    for (let k = 0; k < 3; k++) {
      const p = at(k), q = at(k + 1), n = k === 2 ? 0.5 : 1, c0 = k === 0 ? base : k === 1 ? mid : mix(mid, tip, 0.5), c1 = k === 0 ? mid : k === 1 ? mix(mid, tip, 0.5) : tip;
      s.quad([p[0] - fx, p[1], p[2] - fz], [p[0] + fx, p[1], p[2] + fz], [q[0] + fx * n, q[1], q[2] + fz * n], [q[0] - fx * n, q[1], q[2] - fz * n], [c0, c0, c1, c1],
        [(k / 3) ** 2, (k / 3) ** 2, ((k + 1) / 3) ** 2, ((k + 1) / 3) ** 2]);
    }
  }
  return s.geometry();
}

/** A head of brain or star coral: a lumpy boulder (its grooves or cups are its skin: scatter.js lrSkin). */
function coralHead(seed, tint, flat = 0.76) {
  const s = new Shape(), r = rand(seed), lumps = Array.from({ length: 9 }, () => [r() * 6.283, 0.4 + r() * 1.4, 0.1 + 0.2 * r()]);
  const swell = (u, v) => 1 + lumps.reduce((t, [a, b, k]) => t + k * Math.cos(u * 6.283 * Math.round(1 + b) - a) * Math.sin(v * 3.1416 * b), 0) * 0.3;
  const rings = 9, sides = 20, at = (u, v) => { const a = u * 6.283, e = (v - 0.5) * Math.PI, k = swell(u % 1, v); return [Math.cos(a) * Math.cos(e) * 0.34 * k, Math.sin(e) * 0.34 * flat * k, Math.sin(a) * Math.cos(e) * 0.32 * k]; };
  // (Darker towards its foot, where it is in its own shade and overgrown.)
  const col = v => { const g = 0.62 + 0.38 * Math.min(1, (v - 0.4) / 0.35); return [tint[0] * g, tint[1] * g, tint[2] * g]; };
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const u0 = j / sides, u1 = (j + 1) / sides, v0 = 0.4 + 0.6 * i / rings, v1 = 0.4 + 0.6 * (i + 1) / rings;
    s.quad(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), [col(v0), col(v0), col(v1), col(v1)]);
  }
  return s.geometry(true);
}

/** Elkhorn coral (Acropora palmata): broad flat branches like a moose's antlers, spread towards the light, pale at their growing edges. */
function elkhorn() {
  const s = new Shape(), r = rand(71), amber = [0.5, 0.36, 0.16], edge = [0.78, 0.68, 0.46];
  s.tube([[0, 0, 0], [0.02, 0.18, 0.01]], [0.11, 0.09], 8, mix(amber, [0.2, 0.16, 0.1], 0.5));
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * 6.283 + r() * 0.6, len = 0.45 + 0.4 * r(), rise = 0.12 + 0.3 * r(), wide = 0.12 + 0.1 * r(), dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx, y0 = 0.16 + 0.08 * r();
    // A branch: a plank that widens and forks at its end, a hand thick.
    const at = (f, w, lift = 0) => [dx * len * f + px * w, y0 + rise * f * f + lift, dz * len * f + pz * w];
    for (const [f0, f1] of [[0, 0.4], [0.4, 0.75], [0.75, 1]]) {
      const w0 = wide * (0.5 + 0.7 * f0), w1 = wide * (0.5 + 0.7 * f1), c0 = mix(amber, edge, f0 * f0 * 0.6), c1 = mix(amber, edge, f1 * f1);
      s.quad(at(f0, -w0, 0.03), at(f0, w0, 0.03), at(f1, w1, 0.03), at(f1, -w1, 0.03), [c0, c0, c1, c1]);
      s.quad(at(f0, w0, -0.02), at(f0, -w0, -0.02), at(f1, -w1, -0.02), at(f1, w1, -0.02), [c0, c0, c1, c1].map(c => mix(c, [0.1, 0.08, 0.05], 0.5)));
      s.quad(at(f0, -w0, -0.02), at(f0, -w0, 0.03), at(f1, -w1, 0.03), at(f1, -w1, -0.02), [c0, c0, c1, c1]); s.quad(at(f0, w0, 0.03), at(f0, w0, -0.02), at(f1, w1, -0.02), at(f1, w1, 0.03), [c0, c0, c1, c1]);
    }
    s.quad(at(1, -wide * 1.2, -0.02), at(1, wide * 1.2, -0.02), at(1.04, wide, 0.02), at(1.04, -wide, 0.02), edge);
  }
  return s.geometry(true);
}

/** Branching coral (staghorn, finger coral): a thicket of stubby branches, pale at the growing tips. */
function branchCoral() {
  const s = new Shape(), r = rand(31), tan = [0.5, 0.36, 0.14], tip = [0.76, 0.66, 0.4];
  for (let k = 0; k < 11; k++) {
    const a = r() * 6.283, out = 0.03 + 0.1 * r(), x = Math.cos(a) * out, z = Math.sin(a) * out, h = 0.12 + 0.22 * r(), lean = 0.04 + 0.1 * r();
    const mid = [x + Math.cos(a) * lean * 0.4, h * 0.55, z + Math.sin(a) * lean * 0.4], top = [x + Math.cos(a) * lean, h, z + Math.sin(a) * lean];
    s.tube([[x, 0, z], mid, top], [0.022, 0.017, 0.008], 6, tan);
    s.ball(top[0], top[1], top[2], 0.011, 0.011, 0.011, 2, 6, tip);
    if (r() > 0.4) {
      const b = a + 1.2 + r(), end = [mid[0] + Math.cos(b) * 0.07, mid[1] + 0.08 + 0.06 * r(), mid[2] + Math.sin(b) * 0.07];
      s.tube([mid, end], [0.014, 0.007], 6, tan); s.ball(end[0], end[1], end[2], 0.009, 0.009, 0.009, 2, 6, tip);
    }
  }
  return s.geometry(true);
}

/** A common sea fan (Gorgonia ventalina): a flat purple net on a short stem, swaying with the surge. A sheet here; the holes of the net are its skin. */
function seaFan() {
  const s = new Shape(), purple = [0.3, 0.13, 0.38], pale = [0.46, 0.26, 0.5];
  s.quad([-0.012, 0, 0], [0.012, 0, 0], [0.012, 0.06, 0], [-0.012, 0.06, 0], purple, [0, 0, 0.05, 0.05]);
  const rim = a => 0.34 + 0.14 * Math.cos(a * 1.4) + 0.03 * Math.sin(a * 7);
  for (let k = 0; k < 16; k++) {
    const a0 = -1.15 + k * 2.3 / 16, a1 = a0 + 2.3 / 16;
    for (let j = 0; j < 4; j++) {
      const f0 = j / 4, f1 = (j + 1) / 4, p = (a, f) => [Math.sin(a) * (0.03 + rim(a) * f), 0.05 + Math.cos(a) * (0.03 + rim(a) * f), 0];
      s.quad(p(a0, f0), p(a1, f0), p(a1, f1), p(a0, f1), [mix(purple, pale, f0), mix(purple, pale, f0), mix(purple, pale, f1), mix(purple, pale, f1)], [0.06 + f0 * 0.94, 0.06 + f0 * 0.94, 0.06 + f1 * 0.94, 0.06 + f1 * 0.94]);
    }
  }
  return s.geometry();
}

/** Sea rods and sea plumes (soft corals): a few tall whips from one foot, furred with polyps, swaying. */
function seaRods(seed, colour) {
  const s = new Shape(), r = rand(seed);
  for (let k = 0; k < 6; k++) {
    const a = k * 1.1 + r(), lean = 0.08 + 0.12 * r(), h = 0.35 + 0.45 * r(), pts = [], rad = [], bend = [];
    for (let j = 0; j <= 5; j++) { const f = j / 5; pts.push([Math.cos(a) * lean * f * (0.4 + f), h * f, Math.sin(a) * lean * f * (0.4 + f)]); rad.push(0.016 - 0.008 * f); bend.push(f * f); }
    s.tube(pts, rad, 6, colour, bend);
    if (r() > 0.5) { const j = 2, p = pts[j], b = a + 1.4, end = [p[0] + Math.cos(b) * 0.1, p[1] + 0.22, p[2] + Math.sin(b) * 0.1]; s.tube([p, [(p[0] + end[0]) / 2 + 0.02, (p[1] + end[1]) / 2, (p[2] + end[2]) / 2], end], [0.012, 0.01, 0.006], 6, colour, [0.16, 0.4, 0.8]); }
  }
  return s.geometry(true);
}

/** Tube sponges: a few leaning pipes, yellow-brown or dull purple, dark inside. */
function sponges() {
  const s = new Shape(), r = rand(23);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + r(), x = Math.cos(a) * 0.07, z = Math.sin(a) * 0.07, h = 0.18 + 0.2 * r(), lean = 0.05 + 0.05 * r(), col = k % 2 ? [0.55, 0.38, 0.1] : [0.34, 0.2, 0.36];
    const top = [x + Math.cos(a) * lean, h, z + Math.sin(a) * lean];
    s.tube([[x, 0, z], [x + Math.cos(a) * lean * 0.5, h * 0.55, z + Math.sin(a) * lean * 0.5], top], [0.035, 0.047, 0.04], 10, col);
    s.ball(top[0], top[1] - 0.004, top[2], 0.032, 0.012, 0.032, 2, 10, [0.03, 0.02, 0.02]);
  }
  return s.geometry(true);
}

/** A long-spined urchin (Diadema antillarum): a black ball the size of a fist, its spines a hand long and longer. */
function urchin() {
  const s = new Shape(), r = rand(91), black = [0.02, 0.02, 0.025];
  s.ball(0, 0.035, 0, 0.04, 0.03, 0.04, 4, 8, black);
  for (let k = 0; k < 42; k++) {
    const a = r() * 6.283, e = Math.asin(r() * 0.95 + 0.02), len = 0.1 + 0.12 * r(), d = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)], base = [d[0] * 0.03, 0.035 + d[1] * 0.025, d[2] * 0.03], tip = [base[0] + d[0] * len, base[1] + d[1] * len, base[2] + d[2] * len], w = 0.0022;
    s.tri([base[0] - d[2] * w, base[1], base[2] + d[0] * w], [base[0] + d[2] * w, base[1], base[2] - d[0] * w], tip, black, [0, 0, 1]);
    s.tri([base[0], base[1] - w, base[2]], [base[0], base[1] + w, base[2]], tip, black, [0, 0, 1]);
  }
  return s.geometry();
}

/** A cushion star (Oreaster reticulatus): thick, five short arms, orange with paler knobs. */
function cushionStar() {
  const s = new Shape(), orange = [0.62, 0.22, 0.04], pale = [0.8, 0.5, 0.18], under = [0.5, 0.36, 0.2];
  const rim = [];
  for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283, rad = k % 2 ? 0.068 : 0.17; rim.push([Math.cos(a) * rad, 0.006, Math.sin(a) * rad]); }
  const mid = rim.map((p, k) => [p[0] * (k % 2 ? 0.8 : 0.55), k % 2 ? 0.045 : 0.035, p[2] * (k % 2 ? 0.8 : 0.55)]);
  for (let k = 0; k < 10; k++) {
    const n = (k + 1) % 10;
    s.quad(rim[k], rim[n], mid[n], mid[k], [orange, orange, k % 2 ? pale : orange, k % 2 ? orange : pale]);
    s.tri(mid[k], mid[n], [0, 0.062, 0], [k % 2 ? orange : pale, k % 2 ? pale : orange, pale]);
    s.tri(rim[n], rim[k], [0, 0, 0], under);
  }
  return s.geometry(true);
}

/**
 * A fish, nose at +x, `long` metres from its nose to the tips of its tail. `deep`: how deep its body is, as a
 * part of its length to the root of the tail; `thick`: how thick through, likewise; `fork`: how deeply the tail
 * is forked (0 a round fan .. 1); `fins`: how tall the fins along its back and belly stand, as a part of its
 * depth; `snout`: how pointed (0.5 blunt .. 1.5 a spear).
 * At each place its colour says what the place is, for its markings (scatter.js lrFish): red = the part (1 body,
 * 0.8 head, 0.6 the tail's fin, 0.4 the other fins), green = how far from nose (0) to the root of the tail (1),
 * blue = how far up from belly (0) to back (1). Its bend runs from 0 at the nose to 1 at the tail's tips.
 */
export function fish(long, { deep = 0.34, thick = 0.14, fork = 0.6, fins = 0.3, snout = 0.9 } = {}) {
  const s = new Shape(), body = long * 0.8, D = deep * body, W = thick * body, x = t => long * 0.5 - t * body;
  const high = t => 0.5 * D * (t < 0.36 ? Math.pow(Math.sin(t / 0.36 * Math.PI / 2), snout) : 1 - 0.8 * Math.pow((t - 0.36) / 0.64, 1.7)), wide = t => 0.5 * W * (t < 0.3 ? Math.pow(Math.sin(t / 0.3 * Math.PI / 2), 0.8) : 1 - 0.9 * Math.pow((t - 0.3) / 0.7, 1.3));
  const T = [0, 0.05, 0.13, 0.24, 0.38, 0.54, 0.7, 0.86, 1], sides = 8;
  const ring = (t, k) => { const a = k / sides * 2 * Math.PI; return [x(t), Math.sin(a) * Math.max(high(t), 0.002 * long), Math.cos(a) * Math.max(wide(t), 0.001 * long)]; };
  const paint = (t, k, part) => [part ?? (t < 0.22 ? 0.8 : 1), t, (Math.sin(k / sides * 2 * Math.PI) + 1) / 2];
  for (let i = 0; i + 1 < T.length; i++) for (let k = 0; k < sides; k++) {
    const t0 = T[i], t1 = T[i + 1], b0 = t0 * t0 * 0.75, b1 = t1 * t1 * 0.75;
    s.quad(ring(t0, k), ring(t0, k + 1), ring(t1, k + 1), ring(t1, k), [paint(t0, k), paint(t0, k + 1), paint(t1, k + 1), paint(t1, k)], [b0, b0, b1, b1]);
  }
  // The tail's fin: two lobes from the root, forked between.
  { const xr = x(1), h = high(1), span = 0.5 * D * (0.75 + 0.5 * fork), tipX = xr - long * 0.2, notch = [xr - long * 0.2 * (1 - 0.75 * fork), 0, 0], F = 0.6;
    s.tri([xr, h, 0], [tipX, span, 0], notch, [[F, 1, 1], [F, 1, 1], [F, 1, 0.5]], [0.75, 1, 0.92]); s.tri([xr, -h, 0], notch, [tipX, -span, 0], [[F, 1, 0], [F, 1, 0.5], [F, 1, 0]], [0.75, 0.92, 1]); s.tri([xr, h, 0], notch, [xr, -h, 0], [[F, 1, 1], [F, 1, 0.5], [F, 1, 0]], [0.75, 0.92, 0.75]); }
  // The fins along the back and the belly, the two at its breast, the pair under it.
  const strip = (t0, t1, up, tall) => { const n = 4; for (let j = 0; j < n; j++) { const a = t0 + (t1 - t0) * j / n, b = t0 + (t1 - t0) * (j + 1) / n, ha = tall * D * Math.sin(Math.PI * (0.15 + 0.85 * j / n)) , hb = tall * D * Math.sin(Math.PI * (0.15 + 0.85 * (j + 1) / n)) * (j + 1 === n ? 0.35 : 1), lean = 0.03 * long;
    s.quad([x(a), up * high(a) * 0.96, 0], [x(b), up * high(b) * 0.96, 0], [x(b) - lean, up * (high(b) + hb), 0], [x(a) - lean, up * (high(a) + ha), 0], [[0.4, a, up > 0 ? 1 : 0], [0.4, b, up > 0 ? 1 : 0], [0.4, b, up > 0 ? 1 : 0], [0.4, a, up > 0 ? 1 : 0]], [a * a * 0.75, b * b * 0.75, b * b * 0.75, a * a * 0.75]); } };
  strip(0.26, 0.88, 1, fins); strip(0.56, 0.9, -1, fins * 0.8);
  for (const side of [-1, 1]) {
    const t = 0.27, root = [x(t), -0.15 * high(t), side * wide(t) * 0.95];
    s.tri(root, [root[0] - 0.13 * long, root[1] + 0.03 * long, root[2] + side * 0.05 * long], [root[0] - 0.11 * long, root[1] - 0.05 * long, root[2] + side * 0.035 * long], [[0.4, t, 0.4], [0.4, t, 0.4], [0.4, t, 0.4]], [0.05, 0.3, 0.3]);
    const under = [x(0.36), -high(0.36) * 0.95, side * wide(0.36) * 0.3];
    s.tri(under, [under[0] - 0.08 * long, under[1] - 0.06 * long, under[2] + side * 0.01 * long], [under[0] - 0.1 * long, under[1] - 0.005 * long, under[2]], [[0.4, 0.4, 0], [0.4, 0.4, 0], [0.4, 0.4, 0]], [0.1, 0.2, 0.2]);
  }
  return s.geometry(true);
}

/**
 * @param {{benthic: THREE.Texture, land: THREE.Texture}} textures
 * @param {{life: number, shadowTaps: number}} fp  the tier's settings: life 0 (none), 1 (half), 2 (all)
 * @returns {Scatter[]}
 */
export function buildSeaLife(textures, fp) {
  if (!fp.life) return [];
  const n = g => (fp.life > 1 ? g : Math.round(g * 0.7 / 2) * 2), make = o => new Scatter(o, textures, fp.shadowTaps);
  // Everything rooted sways with the surge: back and forth along the wind's line, the tips most.
  const surge = `vec2 push = uWind.xy * sin(t * 1.4 + dot(wxz, uWind.xy) * 0.35 + h.y * 2.0) + vec2(-uWind.y, uWind.x) * 0.4 * sin(t * 0.9 + h.x * 6.0);`;
  // A fish: where it is put (`shift`, from its home in its cell), the way it heads, the beat of its tail; and how
  // it keeps off you: nearer than two metres it goes the other way, and is gone from an arm's length.
  const swim = beat => `p.z += bend * ${beat} * size * sin(t * (7.0 + 5.0 * h.w) - bend * 2.6 + h.x * 30.0);`;
  const shy = `{ vec3 at = vec3(rel.x, ground + uSize.z, rel.y) + shift; vec3 off = at - vec3(uYou.x, uYou.z - 0.25, uYou.y); float near = uYou.w * (1.0 - smoothstep(0.7, 2.4, length(off)));
      if (near > 0.0) { vec2 away = normalize(off.xz + vec2(1e-3)); shift.xz += away * near * 1.5; shift.y += 0.25 * near * sign(off.y); turn = mix(turn, atan(away.y, away.x), near); } }`;
  const D = { deep: 0.52, thick: 0.12, fork: 0.5, fins: 0.2, snout: 0.6 }, M = { deep: 0.34, thick: 0.15, fork: 0.6, fins: 0.26, snout: 0.9 }, S = { deep: 0.2, thick: 0.13, fork: 0.5, fins: 0.3, snout: 1.1 }, LONG = { deep: 0.085, thick: 0.07, fork: 0.5, fins: 0.5, snout: 1.4 };
  const body = (long, o, kinds) => [long, o.deep * long * 0.8, o.thick * long * 0.8, kinds];
  return [
    make({
      geometry: grassClump(), cell: 0.3, grid: n(72), seed: 1, size: [0.7, 1.35], look: { twoSided: true, through: 0.5 },
      rule: `keep = smoothstep(0.25, 0.6, benthic.r) * step(0.2, water) * step(water, 7.0) * 0.95;`,
      move: `${surge} p.xz += push * bend * (0.07 + 0.03 * h.w);`,
    }),
    // Brain coral, mustard to tan; star coral, olive brown; and now and then a great old head of either.
    make({ geometry: coralHead(11, [0.52, 0.38, 0.2]), cell: 1.7, grid: n(40), seed: 2, size: [0.45, 1.25], skin: 1, bumpy: 1, rule: `keep = smoothstep(0.3, 0.75, benthic.g) * step(0.7, water) * 0.36;` }),
    make({ geometry: coralHead(47, [0.4, 0.33, 0.22], 0.9), cell: 2.3, grid: n(30), seed: 8, size: [0.35, 0.95], skin: 2, bumpy: 1, rule: `keep = smoothstep(0.3, 0.75, benthic.g) * step(0.7, water) * 0.35;` }),
    make({ geometry: coralHead(83, [0.46, 0.36, 0.24], 0.62), cell: 6.5, grid: n(16), seed: 18, size: [1.6, 3.2], skin: 2, bumpy: 1.5, rule: `keep = smoothstep(0.45, 0.8, benthic.g) * step(2.2, water) * 0.3;` }),
    // Elkhorn: on the crests the swell breaks over, in water to the waist and the chest, as it was surveyed here.
    make({ geometry: elkhorn(), cell: 2.6, grid: n(28), seed: 19, size: [0.7, 1.6], skin: 3, bumpy: 1,
      rule: `keep = smoothstep(0.3, 0.7, benthic.g) * step(0.6, water) * step(water, 3.4) * smoothstep(0.12, 0.45, lrWaveMap(wxz).a) * 0.6;` }),
    make({ geometry: branchCoral(), cell: 1.3, grid: n(44), seed: 9, size: [0.7, 1.6], skin: 3, bumpy: 1, rule: `keep = smoothstep(0.4, 0.8, benthic.g) * step(0.8, water) * step(water, 6.0) * 0.3;` }),
    make({
      geometry: seaFan(), cell: 1.3, grid: n(40), seed: 3, size: [0.5, 1.25], look: { twoSided: true, through: 0.6 }, skin: 4,
      rule: `keep = smoothstep(0.35, 0.8, benthic.g) * step(1.0, water) * 0.16;`,
      move: `${surge} p.x += dot(push, vec2(1.0, 0.3)) * bend * 0.09; p.z += bend * bend * 0.05 * sin(t * 1.4 + h.y * 6.0);`,
    }),
    make({ geometry: seaRods(61, [0.34, 0.24, 0.3]), cell: 1.6, grid: n(36), seed: 20, size: [0.7, 1.5], skin: 7,
      rule: `keep = smoothstep(0.35, 0.8, benthic.g) * step(1.2, water) * 0.2;`, move: `${surge} p.xz += push * bend * 0.16;` }),
    make({ geometry: seaRods(67, [0.46, 0.36, 0.2]), cell: 2.1, grid: n(28), seed: 21, size: [0.8, 1.7], skin: 7,
      rule: `keep = smoothstep(0.3, 0.8, benthic.g + 0.5 * benthic.b) * step(1.5, water) * 0.16;`, move: `${surge} p.xz += push * bend * 0.2;` }),
    make({ geometry: sponges(), cell: 1.9, grid: n(32), seed: 4, size: [0.7, 1.6], skin: 5, rule: `keep = smoothstep(0.35, 0.8, benthic.g) * step(1.2, water) * 0.22;` }),
    make({ geometry: urchin(), cell: 1.1, grid: n(40), seed: 22, size: [0.8, 1.3], skin: 8, rule: `keep = smoothstep(0.4, 0.8, benthic.g + 0.6 * benthic.b) * step(0.6, water) * step(water, 8.0) * 0.1;`,
      move: `p.xz += bend * 0.012 * vec2(sin(t * 0.7 + position.x * 90.0 + h.x * 9.0), cos(t * 0.6 + position.z * 90.0));` }),
    make({ geometry: cushionStar(), cell: 5.0, grid: n(20), seed: 5, size: [0.75, 1.3], lift: 0.004, rule: `keep = (1.0 - smoothstep(0.1, 0.35, benthic.r + benthic.g)) * step(0.35, water) * step(water, 3.2) * 0.16;` }),
    // Silversides: hundreds in a dark band along the beach, in knee-deep water, turning together.
    make({
      geometry: fish(0.075, S), cell: 0.2, grid: n(64), seed: 6, size: [0.8, 1.25], look: { gloss: 1 }, skin: 6, body: body(0.075, S, 1),
      rule: `vec2 school = floor(cell / 14.0); keep = step(0.55, lrHash12(school + 3.0)) * step(0.12, water) * step(water, 0.7) * step(shore, 9.0) * 0.5;`,
      move: `float sh = lrHash12(school + 9.0); kind = 15.0;
        turn = 6.2832 * sh + 0.9 * sin(t * 0.23 + sh * 20.0) + 0.25 * sin(t * 1.7 + h.x * 6.0);
        shift = vec3(cos(turn), 0.0, sin(turn)) * 0.5 * sin(t * 0.31 + sh * 9.0) + vec3(0.0, water * (0.3 + 0.35 * h.w), 0.0);
        ${swim('0.08')} ${shy}`,
    }),
    // Over the coral, each about its own place: blue tangs, sergeant majors, foureye butterflyfish in pairs, now and then a queen angelfish.
    make({
      geometry: fish(0.2, D), cell: 2.0, grid: n(30), seed: 7, size: [0.85, 1.15], look: { gloss: 1 }, skin: 6, body: body(0.2, D, 4),
      rule: `keep = smoothstep(0.3, 0.7, benthic.g) * step(1.0, water) * 0.6;`,
      move: `float pick = fract(h.x * 5.0 + h.z * 3.0); kind = pick < 0.4 ? 0.0 : pick < 0.75 ? 5.0 : pick < 0.95 ? 10.0 : 9.0;
        p *= kind == 0.0 ? 1.25 : kind == 5.0 ? 0.75 : kind == 10.0 ? 0.4 : 1.5;
        float way = h.z > 0.5 ? 1.0 : -1.0, a = way * t * (0.22 + 0.25 * h.w) + h.x * 6.2832, rad = 0.5 + 1.1 * h.y, wob = sin(a * 2.3 + h.y * 9.0);
        shift = vec3(cos(a) * rad * (1.0 + 0.3 * wob), min((kind == 5.0 ? 1.0 : 0.3) + 0.9 * h.w + 0.12 * sin(t * 0.7 + h.x * 9.0), water * 0.75), sin(a) * rad);
        turn = a + way * 1.5708 + 0.3 * wob;
        ${swim('0.035')} ${shy}`,
    }),
    // Grunts by day: a school hanging still in the lee of a coral head, all facing one way. And yellowtail snappers going about over the reef.
    make({
      geometry: fish(0.19, M), cell: 0.42, grid: n(44), seed: 23, size: [0.8, 1.15], look: { gloss: 1 }, skin: 6, body: body(0.19, M, 2),
      rule: `vec2 school = floor(cell / 9.0); float has = step(0.72, lrHash12(school + 31.0)); keep = has * smoothstep(0.35, 0.7, benthic.g) * step(1.5, water) * step(length(fract(cell / 9.0) - 0.5), 0.33) * 0.75;`,
      move: `float sh = lrHash12(school + 41.0); kind = 1.0;
        turn = 6.2832 * sh + 0.35 * sin(t * 0.21 + sh * 20.0) + 0.12 * sin(t * 1.3 + h.x * 6.0);
        shift = vec3(0.12 * sin(t * 0.5 + h.x * 20.0), 0.35 + 0.7 * h.w + 0.05 * sin(t * 0.9 + h.y * 9.0), 0.12 * cos(t * 0.43 + h.y * 20.0));
        ${swim('0.02')} ${shy}`,
    }),
    make({
      geometry: fish(0.19, M), cell: 3.4, grid: n(22), seed: 24, size: [0.9, 1.2], look: { gloss: 1 }, skin: 6, body: body(0.19, M, 6),
      rule: `keep = smoothstep(0.25, 0.7, benthic.g + 0.4 * benthic.r) * step(1.2, water) * 0.7;`,
      move: `float pick = fract(h.x * 7.0 + h.z * 5.0); kind = pick < 0.3 ? 4.0 : pick < 0.62 ? 7.0 : pick < 0.72 ? 6.0 : pick < 0.82 ? 8.0 : pick < 0.93 ? 12.0 : 11.0;
        p *= kind == 4.0 ? 2.1 : kind == 7.0 || kind == 6.0 ? 2.0 : kind == 8.0 ? 1.7 : 1.3;
        float low = kind == 4.0 ? 0.0 : 1.0, way = h.z > 0.5 ? 1.0 : -1.0, a = way * t * (0.1 + 0.12 * h.w) + h.x * 6.2832, rad = 1.2 + 2.2 * h.y, wob = sin(a * 1.7 + h.y * 9.0);
        // (A snapper keeps to mid-water; a parrotfish goes along the bottom and tips down to bite the coral; a squirrelfish hangs under its ledge.)
        float peck = low * smoothstep(0.75, 1.0, sin(t * 0.37 + h.x * 30.0));
        shift = vec3(cos(a) * rad * (1.0 + 0.25 * wob), mix(min(1.2 + 1.2 * h.w, water * 0.6), 0.28 + 0.25 * h.w - 0.12 * peck, low), sin(a) * rad * (1.0 - 0.25 * wob));
        if (kind == 11.0) shift = vec3(0.25 * sin(t * 0.2 + h.x * 9.0), 0.2, 0.25 * cos(t * 0.17 + h.y * 9.0));
        turn = a + way * 1.5708 + 0.25 * wob;
        p.y -= peck * p.x * 0.55;
        ${swim(`(low > 0.5 ? 0.012 : 0.03)`)} ${shy}`,
    }),
    // Bluehead wrasses, darting about the tops of the coral heads; most of them yellow, an old male here and there with his blue head.
    make({
      geometry: fish(0.11, S), cell: 1.1, grid: n(40), seed: 25, size: [0.75, 1.2], look: { gloss: 1 }, skin: 6, body: body(0.11, S, 2),
      rule: `keep = smoothstep(0.35, 0.75, benthic.g) * step(0.8, water) * 0.5;`,
      move: `kind = h.z > 0.9 ? 3.0 : 2.0; p *= kind == 3.0 ? 1.3 : 1.0;
        float a = t * (0.9 + 0.8 * h.w) * (h.z > 0.5 ? 1.0 : -1.0) + h.x * 6.2832, dart = sin(a * 1.9 + h.y * 7.0);
        shift = vec3(cos(a) * (0.3 + 0.3 * dart), 0.3 + 0.25 * h.w + 0.1 * sin(a * 2.7), sin(a) * (0.3 - 0.2 * dart));
        turn = a + (h.z > 0.5 ? 1.5708 : -1.5708) + 0.5 * dart;
        ${swim('0.02')} ${shy}`,
    }),
    // Trumpetfish, hanging head down among the sea rods; and houndfish, just under the surface.
    make({
      geometry: fish(0.6, LONG), cell: 5.5, grid: n(16), seed: 26, size: [0.8, 1.25], look: { gloss: 0.6, leaf: 0 }, skin: 6, body: body(0.6, LONG, 2),
      rule: `keep = smoothstep(0.35, 0.8, benthic.g) * step(1.5, water) * 0.3;`,
      move: `kind = 13.0; float hang = 0.5 + 0.5 * sin(t * 0.13 + h.x * 20.0);
        shift = vec3(0.3 * sin(t * 0.11 + h.y * 9.0), 0.55 + 0.2 * h.w, 0.3 * cos(t * 0.09 + h.x * 9.0));
        turn = h.x * 6.2832 + 0.4 * sin(t * 0.15 + h.y * 5.0);
        { float tip = -0.9 * hang, c = cos(tip), s2 = sin(tip); p.xy = vec2(p.x * c - p.y * s2, p.x * s2 + p.y * c); }
        ${swim('0.01')} ${shy}`,
    }),
    make({
      geometry: fish(0.9, LONG), cell: 9.0, grid: n(14), seed: 27, size: [0.8, 1.2], look: { gloss: 1 }, skin: 6, body: body(0.9, LONG, 1),
      rule: `keep = step(1.0, water) * step(shore, 400.0) * step(0.5, lrHash12(floor(cell / 6.0) + 77.0)) * 0.35;`,
      move: `kind = 21.0; float sh = lrHash12(floor(cell / 6.0) + 78.0);
        turn = 6.2832 * sh + 0.5 * sin(t * 0.07 + sh * 20.0);
        shift = vec3(cos(turn), 0.0, sin(turn)) * (2.0 * sin(t * 0.09 + h.x * 9.0)) + vec3(0.0, water - 0.12 - 0.1 * h.w, 0.0);
        ${swim('0.025')} ${shy}`,
    }),
    // Mullet, in a school over the sand of the flats.
    make({
      geometry: fish(0.3, S), cell: 0.6, grid: n(40), seed: 28, size: [0.85, 1.15], look: { gloss: 1 }, skin: 6, body: body(0.3, S, 1),
      rule: `vec2 school = floor(cell / 22.0); keep = step(0.8, lrHash12(school + 51.0)) * step(0.4, water) * step(water, 1.6) * (1.0 - smoothstep(0.1, 0.4, benthic.g)) * step(length(fract(cell / 22.0) - 0.5), 0.2) * 0.8;`,
      move: `float sh = lrHash12(school + 52.0); kind = 20.0;
        turn = 6.2832 * sh + 1.2 * sin(t * 0.11 + sh * 20.0) + 0.15 * sin(t * 1.1 + h.x * 6.0);
        shift = vec3(cos(turn), 0.0, sin(turn)) * 1.5 * sin(t * 0.17 + sh * 9.0) + vec3(0.0, water * (0.35 + 0.3 * h.w), 0.0);
        ${swim('0.03')} ${shy}`,
    }),
  ];
}
