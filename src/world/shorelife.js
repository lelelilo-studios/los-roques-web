// What lies and lives on the beach: bits of coral, shells and seaweed on the tide line, the odd queen conch,
// gulls standing at the water's edge, black lizards on the backshore, and the conch mounds of Crasqui.
import * as THREE from 'three';
import { Scatter, Shape } from './scatter.js';

const rand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// Dry sand that is neither mangrove nor scrub nor under a house.
const SAND = `float sand = 1.0 - lrSaturate((land.r + land.g + land.b) * 2.5);`;

/** A few pieces of finger coral, bleached white, the size of a finger. */
function coralBits() {
  const s = new Shape(), r = rand(3), white = [0.74, 0.72, 0.64], grey = [0.58, 0.57, 0.52];
  for (let k = 0; k < 3; k++) {
    const a = r() * 6.283, x = (r() - 0.5) * 0.12, z = (r() - 0.5) * 0.12, len = 0.025 + 0.035 * r(), rad = 0.004 + 0.004 * r();
    const b = [x + Math.cos(a) * len, 0.004 + rad, z + Math.sin(a) * len];
    s.tube([[x, rad, z], b], [rad, rad * 0.7], 5, k ? white : grey);
    if (r() > 0.5) s.tube([[(x + b[0]) / 2, rad, (z + b[2]) / 2], [(x + b[0]) / 2 + Math.cos(a + 1.1) * len * 0.5, rad * 1.5, (z + b[2]) / 2 + Math.sin(a + 1.1) * len * 0.5]], [rad * 0.8, rad * 0.5], 4, white);
  }
  return s.geometry();
}

/** Small shells: a snail's cone, half a clam, a flake or two of dried Halimeda. */
function shells() {
  const s = new Shape(), cream = [0.78, 0.7, 0.56], pink = [0.8, 0.56, 0.5], weed = [0.62, 0.66, 0.5];
  s.tube([[0, 0.006, 0], [0.012, 0.007, 0.004], [0.022, 0.004, 0.006]], [0.007, 0.005, 0.0008], 6, cream);                    // a little whelk, lying down
  s.ball(-0.05, 0.002, 0.03, 0.011, 0.005, 0.009, 2, 7, pink, 0, 0.5, 1);                                                       // half a tellin
  for (const [x, z] of [[0.04, -0.04], [0.055, -0.03], [-0.02, -0.05]]) s.quad([x, 0.002, z], [x + 0.008, 0.002, z + 0.002], [x + 0.007, 0.003, z + 0.009], [x - 0.001, 0.002, z + 0.007], weed);
  return s.geometry();
}

/** A queen conch (Aliger gigas), 22 cm: knobbed spire, flared lip pink inside. */
function conch() {
  const s = new Shape(), outer = [0.72, 0.6, 0.44], pink = [0.86, 0.5, 0.46], lipEdge = [0.9, 0.78, 0.66];
  s.ball(0, 0.055, 0, 0.085, 0.055, 0.06, 4, 10, (u, v) => (v > 0.75 ? outer.map(c => c * 0.85) : outer));                     // body whorl
  s.tube([[0.06, 0.06, 0], [0.11, 0.058, 0], [0.145, 0.052, 0]], [0.045, 0.026, 0.004], 8, outer);                                // spire
  for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; s.ball(0.075, 0.06 + Math.sin(a) * 0.04, Math.cos(a) * 0.045, 0.011, 0.011, 0.011, 2, 4, outer); }   // knobs
  // The flared lip: a fan from the body out to one side, pink where the animal lay.
  const fan = [];
  for (let k = 0; k <= 6; k++) { const t = k / 6; fan.push([-0.085 + 0.15 * t, 0.012 + 0.03 * Math.sin(t * 3.14), 0.05 + 0.065 * Math.sin(t * 3.14)]); }
  for (let k = 0; k < 6; k++) s.tri([-0.01 + 0.02 * k / 6, 0.02, 0.03], fan[k], fan[k + 1], [pink, lipEdge, lipEdge]);
  s.tube([[-0.07, 0.04, 0], [-0.12, 0.03, 0.005]], [0.03, 0.012], 6, outer);                                                    // the canal end
  return s.geometry();
}

/** A laughing gull standing: white, grey-backed, black-headed in summer, 40 cm long. Beak towards +x. */
function gull() {
  const s = new Shape(), white = [0.82, 0.82, 0.8], grey = [0.32, 0.34, 0.38], black = [0.03, 0.03, 0.035], red = [0.35, 0.05, 0.04];
  s.ball(0, 0.2, 0, 0.13, 0.07, 0.065, 4, 8, (u, v) => (v > 0.55 ? grey : white));                                                // body
  s.tri([-0.1, 0.22, 0.03], [-0.1, 0.22, -0.03], [-0.25, 0.2, 0], black);                                                        // wing tips and tail
  s.tube([[0.09, 0.23, 0], [0.12, 0.3, 0]], [0.035, 0.03], 6, white);                                                            // neck
  s.ball(0.13, 0.32, 0, 0.04, 0.036, 0.034, 3, 7, black);                                                                         // head
  s.tube([[0.16, 0.32, 0], [0.215, 0.31, 0]], [0.01, 0.003], 4, red);                                                            // beak
  for (const z of [-0.025, 0.025]) s.tube([[0.0, 0.14, z], [0.005, 0.0, z]], [0.006, 0.005], 4, red);                            // legs
  return s.geometry();
}

/** A black whiptail lizard of the cays, 20 cm with its tail. Head towards +x. */
function lizard() {
  const s = new Shape(), black = [0.035, 0.035, 0.04], dark = [0.07, 0.07, 0.075];
  s.tube([[0.06, 0.013, 0], [0.03, 0.014, 0], [-0.02, 0.012, 0], [-0.06, 0.008, 0.004], [-0.13, 0.004, -0.008]], [0.006, 0.01, 0.009, 0.005, 0.001], 5, black, [0, 0, 0.1, 0.6, 1]);
  s.ball(0.07, 0.015, 0, 0.012, 0.007, 0.008, 2, 5, dark);
  for (const [x, z] of [[0.035, 0.02], [0.035, -0.02], [-0.02, 0.022], [-0.02, -0.022]]) s.tube([[x, 0.012, Math.sign(z) * 0.006], [x + 0.008, 0.002, z]], [0.003, 0.002], 3, dark);
  return s.geometry();
}

/** @returns {Scatter[]} */
export function buildShoreLife(textures, fp) {
  if (!fp.life) return [];
  const n = g => (fp.life > 1 ? g : Math.round(g * 0.7 / 2) * 2), make = o => new Scatter(o, textures, fp.shadowTaps);
  // The tide line: what the highest water of the last days carried is left in a wandering line a few metres up
  // the beach from the waterline; beyond it only the odd piece.
  const line = `${SAND} float above = -water, off = shore + 3.6 + 1.6 * (lrNoise(wxz / 6.0) - 0.5) + 0.8 * (lrNoise(wxz / 1.7) - 0.5);
    // (In clumps with gaps between them: an unbroken row of bits read as a pencil line drawn along the beach.)
    float clump = smoothstep(0.4, 0.62, lrNoise(wxz / 2.7 + 3.0)) * (0.5 + 0.5 * lrNoise(wxz / 9.0 + 11.0));
    keep = sand * step(0.1, above) * max((1.0 - smoothstep(0.15, 0.7, abs(off))) * clump, 0.01 * step(above, 2.0));`;
  return [
    make({ geometry: coralBits(), cell: 0.3, grid: n(60), seed: 21, size: [0.7, 1.8], lift: 0.002, rule: `${line} keep *= 0.55;` }),
    make({ geometry: shells(), cell: 0.42, grid: n(48), seed: 22, size: [0.8, 1.7], lift: 0.002, rule: `${line} keep *= 0.5;` }),
    make({ geometry: conch(), cell: 7.0, grid: n(16), seed: 23, size: [0.8, 1.15], lift: 0.0, look: { gloss: 1 },
      rule: `${SAND} keep = sand * step(0.2, -water) * step(-water, 1.5) * step(-26.0, shore) * 0.07;` }),
    // Gulls stand about on the wet sand, facing into the wind; they shift their feet now and then.
    make({ casts: true, geometry: gull(), cell: 9.0, grid: n(14), seed: 24, size: [0.72, 0.88], lift: 0.0,
      rule: `${SAND} keep = sand * step(0.03, -water) * step(-water, 0.4) * step(-12.0, shore) * 0.08;`,
      move: `turn = atan(-uWind.y, -uWind.x) + (h.x - 0.5) * 0.9 + 0.3 * sin(t * 0.21 + h.y * 9.0); p.y += 0.004 * sin(t * 2.3 + h.x * 30.0) * step(0.1, position.y);` }),
    // Lizards: still for a while, then a dash of a metre, tail swinging.
    make({ geometry: lizard(), cell: 3.5, grid: n(22), seed: 25, size: [0.8, 1.25], lift: 0.001,
      rule: `keep = step(0.45, -water) * (0.04 + 0.25 * smoothstep(0.1, 0.5, land.g)) * (1.0 - smoothstep(0.3, 0.6, land.r)) * (1.0 - step(0.5, land.b));`,
      move: `float beat = t * 0.19 + h.y * 7.0, lap = floor(beat), dash = smoothstep(0.0, 0.12, fract(beat));
        float a0 = 6.2832 * lrHash12(cell + lap), a1 = 6.2832 * lrHash12(cell + lap + 1.0);
        turn = a1;
        shift = vec3(cos(a1), 0.0, sin(a1)) * (dash - 1.0) * 0.9 * step(0.4, lrHash12(cell + lap + 5.0));
        p.z += bend * 0.012 * sin(t * 22.0) * (1.0 - step(0.999, dash)) + bend * 0.004 * sin(t * 1.7 + h.x * 9.0);` }),
  ];
}

/**
 * The conch mounds of Crasqui: generations of fishermen's discarded queen conch shells, heaped by the shore.
 * A few low heaps of weathered shells near the place's beach.
 */
export function buildConchMounds(places, ground, material) {
  const place = places.find(p => /crasqu/i.test(`${p.id} ${p.name}`));
  if (!place) return null;
  // Find dry sand a little back from the water near the place.
  let spot = null;
  for (let r = 0; r < 500 && !spot; r += 8) for (let a = 0; a < 6.283 && !spot; a += Math.max(0.1, 8 / (r + 1))) {
    const x = place.pos[0] + Math.cos(a) * r, z = place.pos[1] + Math.sin(a) * r, s = ground.shoreAt(x, z), h = ground.heightAt(x, z), c = ground.coverAt('land', x, z);
    if (s < -9 && s > -16 && h > 0.5 && h < 1.4 && c[0] + c[1] + c[2] < 0.15) spot = { x, z };
  }
  if (!spot) return null;
  const s = new Shape(), r = rand(77), tones = [[0.72, 0.66, 0.56], [0.78, 0.6, 0.52], [0.6, 0.57, 0.5], [0.84, 0.8, 0.7]];
  for (const [mx, mz, radius, high] of [[0, 0, 3.2, 1.1], [5.5, 2.5, 2.2, 0.7], [-3, 4.5, 1.6, 0.5]]) {
    // A heap is hundreds of shells: each a knobbly lump the size of two fists, on the surface of a low mound.
    const count = Math.round(radius * radius * 26);
    for (let k = 0; k < count; k++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * radius, x = mx + Math.cos(a) * d, z = mz + Math.sin(a) * d;
      const y = ground.heightAt(spot.x + x, spot.z + z) + high * Math.cos(Math.min(1, d / radius) * 1.5708) ** 1.3 + 0.03;
      const tone = tones[Math.floor(r() * tones.length)], b = r() * 6.283, sx = 0.07 + 0.05 * r();
      s.ball(x, y, z, sx, 0.05 + 0.03 * r(), sx * 0.7, 2, 5, tone);
      if (r() > 0.6) s.tri([x, y + 0.03, z], [x + Math.cos(b) * 0.16, y + 0.05, z + Math.sin(b) * 0.16], [x + Math.cos(b + 0.9) * 0.13, y + 0.01, z + Math.sin(b + 0.9) * 0.13], [0.84, 0.52, 0.48]);   // a pink lip showing
    }
  }
  const mesh = new THREE.Mesh(s.geometry(), material);
  mesh.geometry.computeBoundingSphere();
  mesh.userData.world = spot;
  return mesh;
}
