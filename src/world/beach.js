// Day-trip beaches: the sun umbrellas, loungers and cool boxes the boatmen set up on the sand at the cays
// people are taken to. Placed on dry sand a few metres above the swash, facing the water.
import { MeshBuilder } from './landmarks.js';
import * as THREE from 'three';

// People on the beaches are only chosen here (who, where, standing or strolling): world/people.js draws and
// moves them.
const SKINS = [[0.5, 0.36, 0.27], [0.42, 0.27, 0.18], [0.3, 0.19, 0.12], [0.56, 0.4, 0.3], [0.36, 0.23, 0.15]];
const SHIRTS = [[0.78, 0.78, 0.75], [0.1, 0.3, 0.55], [0.7, 0.12, 0.1], [0.85, 0.65, 0.1], [0.1, 0.45, 0.35], [0.8, 0.4, 0.5], null, null];       // null: no shirt
const SHORTS_ = [[0.06, 0.14, 0.24], [0.5, 0.08, 0.08], [0.05, 0.05, 0.06], [0.1, 0.4, 0.45], [0.7, 0.5, 0.1], [0.35, 0.36, 0.38]];
const HAIRS = [[0.03, 0.025, 0.02], [0.08, 0.05, 0.03], [0.02, 0.02, 0.02], [0.2, 0.14, 0.08], [0.45, 0.43, 0.4]];

/** Someone at (x, z) facing along `dir` (unit, east/south): colours, height and temperament from the random source `r`. */
function person(x, z, dir, r, stroll = null) {
  const pick = list => list[Math.floor(r() * list.length)], skin = pick(SKINS);
  return { x, z, yaw: Math.atan2(dir[0], -dir[1]), scale: 0.9 + 0.16 * r(), beat: r() * 100, stroll,
    colours: { skin, shirt: pick(SHIRTS) || skin, shorts: pick(SHORTS_), hair: pick(HAIRS) } };
}

const rand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const CLOTH = [[0.1, 0.35, 0.75], [0.8, 0.15, 0.12], [0.9, 0.7, 0.1], [0.1, 0.55, 0.45], [0.85, 0.4, 0.1], [0.82, 0.82, 0.8]];
const SPOTS = [[/francisqu/, 14], [/madrisqu|pirata/, 12], [/crasqu/, 10], [/agua isthmus|agua-isthmus/, 8], [/noronqu/, 6], [/cay$/, 6]];

export function buildBeachSets(places, ground, material, tombolo = null) {
  const group = new THREE.Group();
  group.userData.people = [];                               // who is on the beaches (see person())
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
      // People: someone standing by the umbrella looking out to sea, and now and then someone strolling along
      // the water's edge, ankle deep, a few metres each way.
      if (r() < 0.7) {
        const a = rot + (r() - 0.5) * 2.4, d = 1.7 + 1.2 * r(), turn = rot + (r() - 0.5) * 1.2;
        group.userData.people.push(person(x + Math.cos(a) * d, z + Math.sin(a) * d, [Math.cos(turn), Math.sin(turn)], r));
      }
      if (r() < 0.45) {
        const out = -s + 0.3 + 1.2 * r(), along = (r() - 0.5) * 8, px = x + way[0] * out - way[1] * along, pz = z + way[1] * out + way[0] * along;
        const bed = ground.heightAt(px, pz);
        if (bed > -0.4 && bed < 0.25) group.userData.people.push(person(px, pz, [-way[1], way[0]], r, { dir: [-way[1], way[0]], reach: 5 + 6 * r(), speed: 0.9 + 0.35 * r() }));
      }
    }
    if (!taken.length) continue;
    const m = new THREE.Mesh(mb.geometry(), material);
    m.userData.world = { x: place.pos[0], z: place.pos[1] };
    m.frustumCulled = false;
    group.add(m);
  }
  // The sandbar of Cayo de Agua, the most photographed spot of the archipelago: people walking its length
  // between the two seas, and a few standing about on it.
  const crest = tombolo?.crest || [];
  if (crest.length > 6) {
    const r = rand(4711), mid = k => ground.ridge(crest[k][0], crest[k][1]), n = crest.length;
    for (const [k, reach, speed] of [[Math.round(n * 0.45), 34, 1.0], [Math.round(n * 0.7), 22, 1.15]]) {
      const p = mid(k), q = mid(Math.min(n - 1, k + 2)), l = Math.hypot(q.x - p.x, q.z - p.z) || 1, dir = [(q.x - p.x) / l, (q.z - p.z) / l];
      group.userData.people.push(person(p.x - dir[1] * (r() - 0.5) * 3, p.z + dir[0] * (r() - 0.5) * 3, dir, r, { dir, reach, speed }));
    }
    for (const frac of [0.3, 0.55, 0.58, 0.85]) {
      const k = Math.round(n * frac), p = mid(k), a = r() * 6.283, off = 1 + 3 * r();
      const turn = r() * 6.283;
      group.userData.people.push(person(p.x + Math.cos(a) * off, p.z + Math.sin(a) * off, [Math.cos(turn), Math.sin(turn)], r));
    }
  }
  return group;
}
