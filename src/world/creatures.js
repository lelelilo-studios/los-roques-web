// One-of-a-kind things in the water: the bronze Virgen del Valle that stands on the bottom of La Piscina at
// Francisqui, and a green turtle grazing the seagrass off Noronqui. Both are ordinary objects (landmarks.js's
// material), placed from the ground data.
import * as THREE from 'three';
import { Shape } from './scatter.js';

/** The nearest point round (x, z) where the water is between `min` and `max` metres deep, or null. */
function findDepth(ground, x, z, min, max, seaLevel = 0) {
  for (let r = 0; r < 900; r += 10) for (let a = 0; a < 6.283; a += Math.max(0.1, 10 / (r + 1))) {
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, d = seaLevel - ground.heightAt(px, pz);
    if (d >= min && d <= max) return { x: px, z: pz, depth: d };
  }
  return null;
}

/** The statue: a robed, crowned figure with her hands together, on a plinth, green with the sea. */
export function buildStatue(places, ground, material) {
  const place = places.find(p => /francisqu/i.test(`${p.id} ${p.name}`)), spot = place && findDepth(ground, place.pos[0], place.pos[1], 2.6, 4.2);
  if (!spot) return null;
  const s = new Shape(), y = ground.heightAt(spot.x, spot.z), bronze = [0.1, 0.17, 0.13], worn = [0.2, 0.3, 0.22], weed = [0.06, 0.12, 0.05];
  const ring = (r, h) => [0, y + h, 0, r];
  const profile = [ring(0.32, 0.5), ring(0.27, 0.8), ring(0.21, 1.3), ring(0.2, 1.55), ring(0.24, 1.72), ring(0.2, 1.84), ring(0.07, 1.9), ring(0.06, 1.97)];
  // Plinth (overgrown at the foot), robe, shoulders under a veil, head.
  s.tube([[0, y - 0.1, 0], [0, y + 0.5, 0]], [0.42, 0.36], 8, weed);
  s.tube(profile.map(p => [p[0], p[1], p[2]]), profile.map(p => p[3]), 10, bronze);
  s.ball(0, y + 2.08, 0, 0.1, 0.115, 0.1, 5, 10, worn);
  // The veil, falling from the head over the shoulders and down the back.
  s.tube([[0, y + 2.17, -0.03], [0, y + 1.9, -0.1], [0, y + 1.5, -0.14], [0, y + 0.95, -0.12]], [0.1, 0.19, 0.22, 0.25], 8, bronze);
  // Crown and the halo of stars behind the head.
  s.tube([[0, y + 2.17, 0], [0, y + 2.28, 0]], [0.09, 0.12], 8, worn);
  for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283; s.ball(Math.cos(a) * 0.2, y + 2.1 + Math.sin(a) * 0.2, -0.05, 0.016, 0.016, 0.016, 2, 4, worn); }
  // Arms folded to hands joined at the breast.
  for (const side of [-1, 1]) s.tube([[side * 0.17, y + 1.62, 0.02], [side * 0.15, y + 1.38, 0.12], [side * 0.02, y + 1.5, 0.2]], [0.045, 0.04, 0.03], 5, bronze);
  const mesh = new THREE.Mesh(s.geometry(), material);
  mesh.geometry.computeBoundingSphere();
  mesh.userData.world = { x: spot.x, z: spot.z };
  mesh.userData.depth = spot.depth;
  return mesh;
}

/** A green turtle (Chelonia mydas), a metre long, flying slowly over the seagrass in a wide loop. */
export class Turtle {
  constructor(places, ground, material) {
    const place = places.find(p => /noronqu/i.test(`${p.id} ${p.name}`)), spot = place && findDepth(ground, place.pos[0], place.pos[1], 1.8, 3.5);
    this.mesh = null;
    if (!spot) return;
    this.ground = ground; this.home = spot;
    const s = new Shape(), shell = [0.2, 0.19, 0.1], scute = [0.3, 0.26, 0.13], skin = [0.3, 0.3, 0.24], belly = [0.6, 0.56, 0.4];
    // Nose towards +x. Carapace (a pattern of scutes in the colour), plastron, head and neck.
    s.ball(0, 0, 0, 0.42, 0.13, 0.33, 4, 12, (u, v) => (Math.sin(u * 37.7) * Math.sin(v * 25) > 0.2 ? scute : shell), 0, 0.5, 1);
    s.ball(0, 0, 0, 0.4, 0.06, 0.31, 2, 12, belly, 0, 0, 0.5);
    s.tube([[0.36, 0, 0], [0.5, 0.02, 0]], [0.07, 0.06], 6, skin);
    s.ball(0.57, 0.03, 0, 0.09, 0.065, 0.065, 3, 8, skin);
    // Flippers: long front pair swept back (they beat, see `bend`), short rear pair trailing.
    for (const side of [-1, 1]) {
      s.tri([0.26, 0, side * 0.25], [0.02, 0, side * 0.3], [-0.1, -0.03, side * 0.78], skin, [0, 0, 1]);
      s.tri([0.26, 0, side * 0.25], [-0.1, -0.03, side * 0.78], [0.12, -0.01, side * 0.72], skin, [0, 1, 0.8]);
      s.tri([-0.3, 0, side * 0.2], [-0.4, 0, side * 0.1], [-0.6, -0.02, side * 0.3], skin);
    }
    this.mesh = new THREE.Mesh(s.geometry(), material);
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
  }

  /** Where the turtle is at time t (s): a slow figure of eight round its home, between the bed and the surface. */
  at(t, seaLevel) {
    const a = t * 0.035, x = this.home.x + Math.cos(a) * 16 + Math.cos(a * 2.3) * 5, z = this.home.z + Math.sin(a * 1.0) * 11 + Math.sin(a * 1.7) * 4;
    const bed = this.ground.heightAt(x, z), y = Math.min(bed + 0.7 + 0.25 * Math.sin(t * 0.21), seaLevel - 0.35);
    return { x, y: Math.max(y, bed + 0.3), z };
  }

  update(eye, t, seaLevel) {
    if (!this.mesh) return;
    const p = this.at(t, seaLevel), q = this.at(t + 0.5, seaLevel), m = this.mesh;
    m.visible = Math.hypot(p.x - eye.x, p.z - eye.z) < 300;
    if (!m.visible) return;
    m.position.set(p.x - eye.x, p.y, p.z - eye.z);
    // Heading along the path; a gentle roll and nod as it flies.
    m.rotation.set(0.08 * Math.sin(t * 0.9), -Math.atan2(q.z - p.z, q.x - p.x), Math.atan2(q.y - p.y, Math.hypot(q.x - p.x, q.z - p.z)) + 0.05 * Math.sin(t * 1.3), 'YZX');
    m.updateMatrix(); m.matrixWorld.copy(m.matrix);
  }
}
