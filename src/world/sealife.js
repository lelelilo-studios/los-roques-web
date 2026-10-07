// Life on the seabed, where the maps say it grows: turtle grass on the seagrass beds, coral heads, sea fans and
// sponges on the reef, cushion stars on the sand, a band of minnows along the beach and a few reef fish.
// All of it through world/scatter.js: the shapes are built here, and each kind's GLSL says where it lives and
// how it moves.
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

/** A head of brain or star coral: a lumpy boulder, mustard to olive brown, darker in its grooves. */
function coralHead(seed, tint) {
  const s = new Shape(), r = rand(seed), lumps = Array.from({ length: 7 }, () => [r() * 6.283, 0.4 + r() * 1.0, 0.12 + 0.2 * r()]);
  // (Radius varies smoothly round the boulder: a few broad lumps, and fine meandering grooves in the colour.)
  const swell = (u, v) => 1 + lumps.reduce((t, [a, b, k]) => t + k * Math.cos(u * 6.283 - a) * Math.sin(v * 3.1416 * b), 0) * 0.35;
  const rings = 7, sides = 16, at = (u, v) => { const a = u * 6.283, e = (v - 0.5) * Math.PI, k = swell(u, v); return [Math.cos(a) * Math.cos(e) * 0.34 * k, Math.sin(e) * 0.26 * k, Math.sin(a) * Math.cos(e) * 0.32 * k]; };
  const col = (u, v) => { const g = 0.62 + 0.38 * Math.sin(u * 75 + 9 * Math.sin(v * 31)) * Math.sin(v * 47 + 5 * Math.sin(u * 23)); return [tint[0] * g, tint[1] * g, tint[2] * g]; };
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const u0 = j / sides, u1 = (j + 1) / sides, v0 = 0.42 + 0.58 * i / rings, v1 = 0.42 + 0.58 * (i + 1) / rings;
    s.quad(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), [col(u0, v0), col(u1, v0), col(u1, v1), col(u0, v1)]);
  }
  return s.geometry();
}

/** Branching coral (staghorn, finger coral): a thicket of stubby branches, pale at the growing tips. */
function branchCoral() {
  const s = new Shape(), r = rand(31), tan = [0.5, 0.36, 0.14], tip = [0.72, 0.62, 0.36];
  for (let k = 0; k < 9; k++) {
    const a = r() * 6.283, out = 0.03 + 0.1 * r(), x = Math.cos(a) * out, z = Math.sin(a) * out, h = 0.12 + 0.22 * r(), lean = 0.04 + 0.1 * r();
    const mid = [x + Math.cos(a) * lean * 0.4, h * 0.55, z + Math.sin(a) * lean * 0.4], top = [x + Math.cos(a) * lean, h, z + Math.sin(a) * lean];
    s.tube([[x, 0, z], mid, top], [0.022, 0.017, 0.008], 5, tan);
    s.ball(top[0], top[1], top[2], 0.011, 0.011, 0.011, 2, 5, tip);
    if (r() > 0.4) {                                              // a side branch
      const b = a + 1.2 + r(), end = [mid[0] + Math.cos(b) * 0.07, mid[1] + 0.08 + 0.06 * r(), mid[2] + Math.sin(b) * 0.07];
      s.tube([mid, end], [0.014, 0.007], 5, tan); s.ball(end[0], end[1], end[2], 0.009, 0.009, 0.009, 2, 5, tip);
    }
  }
  return s.geometry();
}

/** A common sea fan (Gorgonia): a flat purple lattice on a short stem, swaying with the surge. */
function seaFan() {
  const s = new Shape(), purple = [0.3, 0.12, 0.36], pale = [0.42, 0.22, 0.46];
  s.quad([-0.012, 0, 0], [0.012, 0, 0], [0.012, 0.1, 0], [-0.012, 0.1, 0], purple, [0, 0, 0.05, 0.05]);
  // The fan: ribs fanning out from the top of the stem, with gaps between them (it is a net, not a sheet).
  for (let k = 0; k < 11; k++) {
    const a0 = (-0.95 + k * 0.19) - 0.065, a1 = a0 + 0.13, len = 0.3 + 0.16 * Math.cos((k - 5) * 0.3);
    const p = a => [Math.sin(a) * len, 0.1 + Math.cos(a) * len, 0], q = a => [Math.sin(a) * 0.03, 0.1 + Math.cos(a) * 0.03, 0];
    s.quad(q(a0), q(a1), p(a1), p(a0), [purple, purple, pale, pale], [0.05, 0.05, 1, 1]);
  }
  for (const frac of [0.45, 0.75]) for (let k = 0; k < 10; k++) {                // the cross-links of the net
    const a0 = -0.95 + k * 0.19 + 0.06, a1 = a0 + 0.07, r0 = 0.03 + (0.34 * frac), r1 = r0 + 0.03;
    const p = (a, r) => [Math.sin(a) * r, 0.1 + Math.cos(a) * r, 0];
    s.quad(p(a0, r0), p(a1, r0), p(a1, r1), p(a0, r1), purple, [frac, frac, frac, frac]);
  }
  return s.geometry();
}

/** Tube sponges: a few leaning pipes, yellow-brown or dull purple, dark inside. */
function sponges() {
  const s = new Shape(), r = rand(23);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + r(), x = Math.cos(a) * 0.07, z = Math.sin(a) * 0.07, h = 0.18 + 0.2 * r(), lean = 0.05 + 0.05 * r(), col = k % 2 ? [0.5, 0.33, 0.08] : [0.3, 0.17, 0.3];
    const top = [x + Math.cos(a) * lean, h, z + Math.sin(a) * lean];
    s.tube([[x, 0, z], [x + Math.cos(a) * lean * 0.5, h * 0.55, z + Math.sin(a) * lean * 0.5], top], [0.035, 0.045, 0.04], 7, col);
    s.ball(top[0], top[1] - 0.004, top[2], 0.032, 0.01, 0.032, 2, 7, [0.03, 0.02, 0.02]);
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
  return s.geometry();
}

/** A small fish seen as a whole: body, tail, one fin. Colour channels mark the parts (see the fish's GLSL). */
function fish(long, deep) {
  const s = new Shape(), BODY = [1, 1, 1], HEAD = [0.8, 1, 1], TAIL = [0.6, 1, 1], FIN = [0.4, 1, 1], w = long * 0.12;
  // Nose at +x. The body is two shallow pyramids back to back, so it catches the light like something round.
  const nose = [long * 0.5, 0, 0], back = [-long * 0.32, 0, 0], top = [long * 0.05, deep * 0.5, 0], bottom = [long * 0.05, -deep * 0.5, 0], l = [long * 0.08, 0, w], r = [long * 0.08, 0, -w];
  for (const side of [l, r]) { s.tri(nose, top, side, [HEAD, BODY, BODY]); s.tri(nose, side, bottom, [HEAD, BODY, BODY]); s.tri(top, back, side, BODY, [0, 0.5, 0]); s.tri(side, back, bottom, BODY, [0, 0.5, 0]); }
  s.tri(back, [-long * 0.52, deep * 0.36, 0], [-long * 0.52, -deep * 0.36, 0], TAIL, [0.5, 1, 1]);
  s.tri([long * 0.12, deep * 0.5, 0], [-long * 0.18, deep * 0.72, 0], [-long * 0.2, deep * 0.3, 0], FIN, [0, 0.4, 0.3]);
  return s.geometry();
}

/**
 * @param {{benthic: THREE.Texture, land: THREE.Texture}} textures
 * @param {{life: number, shadowTaps: number}} fp  the tier's settings: life 0 (none), 1 (half), 2 (all)
 * @returns {Scatter[]}
 */
export function buildSeaLife(textures, fp) {
  if (!fp.life) return [];
  const n = g => (fp.life > 1 ? g : Math.round(g * 0.7 / 2) * 2), make = o => new Scatter(o, textures, fp.shadowTaps);
  // Everything sways with the surge: back and forth along the wind's line, the tips most.
  const surge = `vec2 push = uWind.xy * sin(t * 1.4 + dot(wxz, uWind.xy) * 0.35 + h.y * 2.0) + vec2(-uWind.y, uWind.x) * 0.4 * sin(t * 0.9 + h.x * 6.0);`;
  return [
    make({
      geometry: grassClump(), cell: 0.3, grid: n(72), seed: 1, size: [0.7, 1.35], look: { twoSided: true, through: 0.5 },
      rule: `keep = smoothstep(0.25, 0.6, benthic.r) * step(0.2, water) * step(water, 7.0) * 0.95;`,
      move: `${surge} p.xz += push * bend * (0.07 + 0.03 * h.w);`,
    }),
    make({
      geometry: coralHead(11, [0.5, 0.4, 0.12]), cell: 1.7, grid: n(40), seed: 2, size: [0.45, 1.25],
      rule: `keep = smoothstep(0.3, 0.75, benthic.g) * step(0.7, water) * 0.38;`,
    }),
    make({
      geometry: coralHead(47, [0.34, 0.36, 0.14]), cell: 2.3, grid: n(30), seed: 8, size: [0.35, 0.9],
      rule: `keep = smoothstep(0.3, 0.75, benthic.g) * step(0.7, water) * 0.35;`,
    }),
    make({
      geometry: branchCoral(), cell: 1.3, grid: n(44), seed: 9, size: [0.7, 1.6],
      rule: `keep = smoothstep(0.4, 0.8, benthic.g) * step(0.8, water) * step(water, 6.0) * 0.3;`,
    }),
    make({
      geometry: seaFan(), cell: 1.3, grid: n(40), seed: 3, size: [0.45, 1.15], look: { twoSided: true, through: 0.6 },
      rule: `keep = smoothstep(0.35, 0.8, benthic.g) * step(1.0, water) * 0.14;`,
      move: `${surge} p.x += dot(push, vec2(1.0, 0.3)) * bend * 0.09; p.z += bend * bend * 0.05 * sin(t * 1.4 + h.y * 6.0);`,
    }),
    make({
      geometry: sponges(), cell: 1.9, grid: n(32), seed: 4, size: [0.7, 1.6],
      rule: `keep = smoothstep(0.35, 0.8, benthic.g) * step(1.2, water) * 0.22;`,
    }),
    make({
      geometry: cushionStar(), cell: 5.0, grid: n(20), seed: 5, size: [0.75, 1.3], lift: 0.004,
      rule: `keep = (1.0 - smoothstep(0.1, 0.35, benthic.r + benthic.g)) * step(0.35, water) * step(water, 3.2) * 0.16;`,
    }),
    // Minnows (silversides): hundreds in a dark band along the beach, in knee-deep water, turning together.
    make({
      geometry: fish(0.07, 0.016), cell: 0.18, grid: n(72), seed: 6, size: [0.8, 1.3],
      rule: `vec2 school = floor(cell / 14.0); keep = step(0.45, lrHash12(school + 3.0)) * step(0.12, water) * step(water, 0.7) * step(shore, 9.0) * 0.85;`,
      move: `float sh = lrHash12(school + 9.0);
        turn = 6.2832 * sh + 0.9 * sin(t * 0.23 + sh * 20.0) + 0.25 * sin(t * 1.7 + h.x * 6.0);
        shift = vec3(cos(turn), 0.0, sin(turn)) * 0.5 * sin(t * 0.31 + sh * 9.0) + vec3(0.0, water * (0.3 + 0.35 * h.w), 0.0);
        p.z += bend * 0.006 * sin(t * 14.0 + h.x * 30.0);
        colour = colour.r < 0.5 ? vec3(0.05, 0.06, 0.05) : mix(vec3(0.22, 0.25, 0.24), vec3(0.03, 0.045, 0.04), step(0.0, position.y));`,
    }),
    // Reef fish, circling over the coral: blue tang, French grunt, bluehead wrasse, yellowtail snapper, sergeant major.
    make({
      geometry: fish(0.17, 0.085), cell: 2.2, grid: n(28), seed: 7, size: [0.7, 1.4], look: { gloss: 1 },
      rule: `keep = smoothstep(0.3, 0.7, benthic.g) * step(1.0, water) * 0.55;`,
      move: `float way = h.z > 0.5 ? 1.0 : -1.0, a = way * t * (0.25 + 0.3 * h.w) + h.x * 6.2832, rad = 0.5 + 1.1 * h.y;
        shift = vec3(cos(a) * rad, min(0.35 + 0.9 * h.w + 0.12 * sin(t * 0.7 + h.x * 9.0), water * 0.7), sin(a) * rad);
        turn = a + way * 1.5708;
        p.z += bend * 0.02 * sin(t * 9.0 + h.x * 30.0);
        float kind = fract(h.x * 5.0 + h.z * 3.0) * 5.0, part = color.r;
        vec3 body = kind < 1.0 ? vec3(0.03, 0.08, 0.5) : kind < 2.0 ? vec3(0.7, 0.55, 0.08) : kind < 3.0 ? vec3(0.1, 0.42, 0.2) : kind < 4.0 ? vec3(0.34, 0.4, 0.5) : vec3(0.75, 0.68, 0.2);
        vec3 tail = kind < 1.0 ? vec3(0.75, 0.6, 0.05) : kind < 2.0 ? vec3(0.6, 0.5, 0.1) : kind < 3.0 ? vec3(0.1, 0.4, 0.2) : vec3(0.8, 0.65, 0.05);
        vec3 head = kind > 2.0 && kind < 3.0 ? vec3(0.05, 0.15, 0.55) : body;
        // (French grunts and sergeant majors are striped.)
        float bars = kind >= 1.0 && kind < 2.0 ? 0.75 + 0.25 * sin(position.y * 260.0) : kind >= 4.0 ? 0.45 + 0.55 * step(0.0, sin(position.x * 110.0)) : 1.0;
        colour = part > 0.9 ? body * bars : part > 0.7 ? head : part > 0.5 ? tail : tail * 0.8;`,
    }),
  ];
}
