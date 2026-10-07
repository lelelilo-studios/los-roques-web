// Day-trip beaches: the sun umbrellas, loungers and cool boxes the boatmen set up on the sand at the cays
// people are taken to. Placed on dry sand a few metres above the swash, facing the water.
import { MeshBuilder } from './landmarks.js';
import { BODY_VERTICES, HEAD_VERTICES, Tubes, poseBody } from './bodyshape.js';
import * as THREE from 'three';

// People: the same jointed figure as your own body (bodyshape.js), standing at ease. They give the beach its
// scale: an umbrella is a head taller than they are, a skiff's gunwale comes to their waist.
const SKINS = [[0.5, 0.36, 0.27], [0.42, 0.27, 0.18], [0.3, 0.19, 0.12], [0.56, 0.4, 0.3], [0.36, 0.23, 0.15]];
const SHIRTS = [[0.78, 0.78, 0.75], [0.1, 0.3, 0.55], [0.7, 0.12, 0.1], [0.85, 0.65, 0.1], [0.1, 0.45, 0.35], [0.8, 0.4, 0.5], null, null];       // null: no shirt
const SHORTS_ = [[0.06, 0.14, 0.24], [0.5, 0.08, 0.08], [0.05, 0.05, 0.06], [0.1, 0.4, 0.45], [0.7, 0.5, 0.1], [0.35, 0.36, 0.38]];
const HAIRS = [[0.03, 0.025, 0.02], [0.08, 0.05, 0.03], [0.02, 0.02, 0.02], [0.2, 0.14, 0.08], [0.45, 0.43, 0.4]];
const figure = { t: new Tubes(BODY_VERTICES), h: new Tubes(HEAD_VERTICES) };

/** Adds a standing person to a MeshBuilder: feet at (x, y, z), facing along `dir` (unit, east/south). `r` is a random source. */
function addPerson(mb, x, y, z, dir, r) {
  const pick = list => list[Math.floor(r() * list.length)], skin = pick(SKINS), scale = 0.9 + 0.16 * r();
  // (Weight on one leg, the other a little forward: a random moment of a very short pace.)
  poseBody(figure.t, figure.h, { phase: r() * 6.283, stride: 0.12 + 0.1 * r(), eye: 1.65, colours: { skin, shirt: pick(SHIRTS) || skin, shorts: pick(SHORTS_), hair: pick(HAIRS) } });
  const yaw = Math.atan2(dir[0], -dir[1]), c = Math.cos(yaw), s = Math.sin(yaw);
  for (const part of [figure.t, figure.h]) for (let i = 0; i < part.n; i++) {
    const px = part.pos[i * 3] * scale, pz = part.pos[i * 3 + 2] * scale;
    mb.pos.push(x + px * c - pz * s, y + part.pos[i * 3 + 1] * scale, z + px * s + pz * c);
    mb.col.push(part.col[i * 3], part.col[i * 3 + 1], part.col[i * 3 + 2]);
  }
}

const rand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const CLOTH = [[0.1, 0.35, 0.75], [0.8, 0.15, 0.12], [0.9, 0.7, 0.1], [0.1, 0.55, 0.45], [0.85, 0.4, 0.1], [0.82, 0.82, 0.8]];
const SPOTS = [[/francisqu/, 14], [/madrisqu|pirata/, 12], [/crasqu/, 10], [/agua isthmus|agua-isthmus/, 8], [/noronqu/, 6], [/cay$/, 6]];

export function buildBeachSets(places, ground, material) {
  const group = new THREE.Group();
  group.userData.people = [];                               // where people stand: [x, z]
  group.userData.spots = [];                                // where the umbrellas stand: [x, z, bearing to the water (radians, from +x towards +z)]
  for (const place of places) {
    const label = `${place.id || ''} ${place.name || ''}`.toLowerCase(), spot = SPOTS.find(s => s[0].test(label));
    if (!spot) continue;
    const r = rand(Math.round(place.pos[0] * 11 + place.pos[1] * 3) + 1), mb = new MeshBuilder(), taken = [];
    for (let tries = 0; tries < spot[1] * 400 && taken.length < spot[1]; tries++) {
      const a = r() * 2 * Math.PI, d = r() * 420, x = place.pos[0] + Math.cos(a) * d, z = place.pos[1] + Math.sin(a) * d;
      const s = ground.shoreAt(x, z), h = ground.heightAt(x, z);
      if (s > -5 || s < -26 || h < 0.45 || h > 1.6 || taken.some(t => Math.hypot(t[0] - x, t[1] - z) < 7)) continue;
      // Face the water: down the gradient of the shore distance.
      const gx = ground.shoreAt(x + 2, z) - ground.shoreAt(x - 2, z), gz = ground.shoreAt(x, z + 2) - ground.shoreAt(x, z - 2);
      const gl = Math.hypot(gx, gz);
      if (gl < 0.2) continue;
      // On open sand by open water: not among the mangroves or the scrub, not on the shore of a pond inside the cay.
      const cover = [0, 1, 2, 3].map(k => ground.coverAt('land', x + Math.cos(k * 1.57) * 4, z + Math.sin(k * 1.57) * 4)), way = [gx / gl, gz / gl];
      if (cover.some(c => c[0] + c[1] > 0.2) || [0, 6].some(d => { const c = ground.coverAt('land', x + way[0] * (-s + d), z + way[1] * (-s + d)); return c[0] > 0.2; })) continue;
      if (ground.shoreAt(x + way[0] * (-s + 50), z + way[1] * (-s + 50)) < 20) continue;
      taken.push([x, z]);
      group.userData.spots.push([x, z, Math.atan2(gz, gx)]);
      const lx = x - place.pos[0], lz = z - place.pos[1], rot = Math.atan2(gz, gx), cloth = CLOTH[Math.floor(r() * CLOTH.length)], white = [0.85, 0.85, 0.82];
      mb.tube(lx, lz, h - 0.3, h + 2.15, 0.025, 0.025, 5, [0.75, 0.75, 0.75]);                      // pole
      for (let k = 0; k < 8; k++) {                                                                  // canopy in two colours
        const a0 = k / 8 * 2 * Math.PI, a1 = (k + 1) / 8 * 2 * Math.PI, R = 1.25;
        mb.tri([lx, h + 2.3, lz], [lx + Math.cos(a0) * R, h + 1.95, lz + Math.sin(a0) * R], [lx + Math.cos(a1) * R, h + 1.95, lz + Math.sin(a1) * R], k % 2 ? cloth : white);
      }
      for (const side of [-0.75, 0.75]) {                                                            // two loungers
        const cx = lx + Math.cos(rot) * 0.5 - Math.sin(rot) * side, cz = lz + Math.sin(rot) * 0.5 + Math.cos(rot) * side;
        mb.box(cx, h + 0.28, cz, 0.95, 0.04, 0.3, white, rot);
        mb.box(cx - Math.cos(rot) * 0.75, h + 0.45, cz - Math.sin(rot) * 0.75, 0.25, 0.04, 0.3, white, rot);
        for (const [along, across] of [[-0.85, -0.26], [-0.85, 0.26], [0.85, -0.26], [0.85, 0.26]]) {       // its legs
          mb.box(cx + Math.cos(rot) * along - Math.sin(rot) * across, h + 0.1, cz + Math.sin(rot) * along + Math.cos(rot) * across, 0.02, 0.16, 0.02, white, rot);
        }
      }
      mb.box(lx - Math.cos(rot) * 0.9, h + 0.2, lz - Math.sin(rot) * 0.9, 0.3, 0.2, 0.2, [0.1, 0.3, 0.7], rot, white);   // cool box
      // People: someone standing by the umbrella looking out to sea, and now and then someone ankle deep at the water's edge.
      if (r() < 0.7) {
        const a = rot + (r() - 0.5) * 2.4, d = 1.7 + 1.2 * r(), px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, turn = rot + (r() - 0.5) * 1.2;
        addPerson(mb, px - place.pos[0], ground.heightAt(px, pz), pz - place.pos[1], [Math.cos(turn), Math.sin(turn)], r);
        group.userData.people.push([px, pz]);
      }
      if (r() < 0.45) {
        const out = -s + 0.8 + 2.5 * r(), along = (r() - 0.5) * 8, px = x + way[0] * out - way[1] * along, pz = z + way[1] * out + way[0] * along, turn = rot + (r() < 0.3 ? Math.PI : 0) + (r() - 0.5) * 1.5;
        const bed = ground.heightAt(px, pz);
        if (bed > -0.6 && bed < 0.25) { addPerson(mb, px - place.pos[0], bed, pz - place.pos[1], [Math.cos(turn), Math.sin(turn)], r); group.userData.people.push([px, pz]); }
      }
    }
    if (!taken.length) continue;
    const m = new THREE.Mesh(mb.geometry(), material);
    m.userData.world = { x: place.pos[0], z: place.pos[1] };
    m.frustumCulled = false;
    group.add(m);
  }
  return group;
}
