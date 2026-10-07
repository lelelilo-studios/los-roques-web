// Day-trip beaches: the sun umbrellas, loungers and cool boxes the boatmen set up on the sand at the cays
// people are taken to. Placed on dry sand a few metres above the swash, facing the water.
import { MeshBuilder } from './landmarks.js';
import * as THREE from 'three';

const rand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const CLOTH = [[0.1, 0.35, 0.75], [0.8, 0.15, 0.12], [0.9, 0.7, 0.1], [0.1, 0.55, 0.45], [0.85, 0.4, 0.1], [0.82, 0.82, 0.8]];
const SPOTS = [[/francisqu/, 14], [/madrisqu|pirata/, 12], [/crasqu/, 10], [/agua isthmus|agua-isthmus/, 8], [/noronqu/, 6], [/cay$/, 6]];

export function buildBeachSets(places, ground, material) {
  const group = new THREE.Group();
  for (const place of places) {
    const label = `${place.id || ''} ${place.name || ''}`.toLowerCase(), spot = SPOTS.find(s => s[0].test(label));
    if (!spot) continue;
    const r = rand(Math.round(place.pos[0] * 11 + place.pos[1] * 3) + 1), mb = new MeshBuilder(), taken = [];
    for (let tries = 0; tries < spot[1] * 120 && taken.length < spot[1]; tries++) {
      const a = r() * 2 * Math.PI, d = r() * 420, x = place.pos[0] + Math.cos(a) * d, z = place.pos[1] + Math.sin(a) * d;
      const s = ground.shoreAt(x, z), h = ground.heightAt(x, z);
      if (s > -5 || s < -16 || h < 0.3 || h > 1.6 || taken.some(t => Math.hypot(t[0] - x, t[1] - z) < 7)) continue;
      // Face the water: down the gradient of the shore distance.
      const gx = ground.shoreAt(x + 2, z) - ground.shoreAt(x - 2, z), gz = ground.shoreAt(x, z + 2) - ground.shoreAt(x, z - 2);
      if (Math.hypot(gx, gz) < 0.2) continue;
      taken.push([x, z]);
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
      }
      mb.box(lx - Math.cos(rot) * 0.9, h + 0.2, lz - Math.sin(rot) * 0.9, 0.3, 0.2, 0.2, [0.1, 0.3, 0.7], rot, white);   // cool box
    }
    if (!taken.length) continue;
    const m = new THREE.Mesh(mb.geometry(), material);
    m.userData.world = { x: place.pos[0], z: place.pos[1] };
    m.frustumCulled = false;
    group.add(m);
  }
  return group;
}
