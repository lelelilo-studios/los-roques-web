// Boats at anchor: peñeros (the open outboard skiffs that are the taxis of Los Roques) and cruising catamarans,
// off the beaches people go to. They point into the wind and ride the same waves the water is drawn with.
import * as THREE from 'three';
import { MeshBuilder } from './landmarks.js';

const rand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

/** A hull lofted through cross-sections from stern (t = 0) to bow (t = 1). Bow points along +x; y = 0 is the waterline. */
function loft(mb, { length, beam, draft, freeboard, rise, x0 = 0, z0 = 0 }, hull, inside) {
  const N = 9, sec = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = x0 + (t - 0.5) * length;
    const half = beam / 2 * Math.min(1, 0.72 + 0.9 * t) * Math.pow(Math.max(1 - Math.pow(t, 2.6), 0), 0.75);
    const keel = -draft * (1 - Math.pow(t, 3) * 0.8), sheer = freeboard + rise * t * t;
    sec.push([[x, sheer, z0 - half], [x, -0.05, z0 - half * 0.82], [x, keel, z0], [x, -0.05, z0 + half * 0.82], [x, sheer, z0 + half]]);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < 4; j++) mb.quad(sec[i][j], sec[i + 1][j], sec[i + 1][j + 1], sec[i][j + 1], hull);
  mb.quad(sec[0][0], sec[0][1], sec[0][3], sec[0][4], hull); mb.tri(sec[0][1], sec[0][2], sec[0][3], hull);       // transom
  // Floor inside, a little below the gunwale.
  for (let i = 0; i < N; i++) {
    const a = sec[i], b = sec[i + 1], y = Math.min(a[0][1], b[0][1]) - 0.38;
    mb.quad([a[0][0], y, a[0][2] * 0.9 + z0 * 0.1], [b[0][0], y, b[0][2] * 0.9 + z0 * 0.1], [b[4][0], y, b[4][2] * 0.9 + z0 * 0.1], [a[4][0], y, a[4][2] * 0.9 + z0 * 0.1], inside);
  }
}

function penero() {
  const mb = new MeshBuilder(), white = [1, 1, 1];
  loft(mb, { length: 7.6, beam: 2.0, draft: 0.32, freeboard: 0.62, rise: 0.5 }, white, [0.75, 0.75, 0.72]);
  for (const x of [-1.6, 0.2, 1.8]) mb.box(x, 0.42, 0, 0.16, 0.03, 0.82, [0.8, 0.78, 0.7]);     // thwarts
  mb.box(-3.95, 0.55, 0, 0.2, 0.35, 0.22, [0.08, 0.08, 0.09]);                                  // outboard
  mb.box(-4.0, -0.15, 0, 0.07, 0.4, 0.07, [0.1, 0.1, 0.1]);
  // The sun canopy the boatmen rig over the passengers: a flat awning on four posts.
  for (const [x, z] of [[-2.0, -0.82], [-2.0, 0.82], [1.6, -0.74], [1.6, 0.74]]) mb.tube(x, z, 0.6, 2.05, 0.022, 0.022, 4, [0.75, 0.75, 0.75]);
  mb.box(-0.2, 2.07, 0, 2.0, 0.025, 0.95, white, 0, [0.92, 0.92, 0.9]);
  return mb.geometry();
}
function catamaran() {
  const mb = new MeshBuilder(), white = [1, 1, 1], deck = [0.9, 0.9, 0.88], glass = [0.06, 0.09, 0.12], metal = [0.6, 0.6, 0.62];
  for (const z of [-2.9, 2.9]) loft(mb, { length: 12.5, beam: 1.5, draft: 0.75, freeboard: 1.15, rise: 0.25, z0: z }, white, deck);
  mb.box(-0.6, 1.0, 0, 4.4, 0.16, 2.9, deck);                    // bridge deck
  mb.box(-0.9, 1.75, 0, 2.5, 0.62, 2.2, white, 0, deck);         // cabin
  mb.box(1.45, 1.8, 0, 0.12, 0.4, 2.0, glass);                   // windscreen
  mb.box(-3.0, 2.75, 0, 1.5, 0.05, 2.3, deck);                   // cockpit roof
  mb.tube(0.9, 0, 2.3, 17.5, 0.1, 0.07, 6, metal);               // mast
  mb.box(-1.9, 3.3, 0, 2.9, 0.09, 0.09, metal);                  // boom with the sail furled on it
  mb.box(-1.9, 3.45, 0, 2.7, 0.14, 0.13, [0.85, 0.83, 0.75]);
  return mb.geometry();
}

// Hull paint: mostly white with the bright colours the fishermen use.
const HULLS = [[0.85, 0.85, 0.82], [0.85, 0.85, 0.82], [0.1, 0.36, 0.7], [0.75, 0.16, 0.12], [0.9, 0.7, 0.1], [0.1, 0.55, 0.45], [0.85, 0.4, 0.1], [0.2, 0.6, 0.8]];
// How many of each to anchor off a place, by words in its name.
const FLEETS = [[/gran roque|pueblo|village/, 14, 3], [/francisqu/, 10, 4], [/madrisqu|pirata/, 7, 2], [/crasqu/, 5, 2], [/agua isthmus|agua-isthmus/, 4, 2],
  [/noronqu/, 4, 1], [/mosquises/, 2, 0], [/carenero|espenqu|sarqu/, 2, 1], [/rock|cay/, 4, 1]];

export class Boats {
  /**
   * @param {{name: string, id?: string, pos: [number, number]}[]} places  anchorages are found near these
   * @param {Ground} ground  @param {Waves} waves  @param {{rgba: Uint8Array, width: number, height: number}} waveMap
   * @param {{x, z, w, h}} rect  @param {THREE.Material} material
   */
  constructor(places, ground, waves, waveMap, rect, material) {
    Object.assign(this, { ground, waves, waveMap, rect });
    this.group = new THREE.Group();
    this.fleets = [];
    const kinds = [{ geometry: penero(), length: 7.6, draft: 0.05 }, { geometry: catamaran(), length: 12.5, draft: 0.1 }];
    const colour = new THREE.Color();
    for (const place of places) {
      const label = `${place.id || ''} ${place.name || ''}`.toLowerCase(), fleet = FLEETS.find(f => f[0].test(label));
      if (!fleet) continue;
      const r = rand(Math.round(place.pos[0] * 31 + place.pos[1] * 17)), taken = [];
      [fleet[1], fleet[2]].forEach((want, k) => {
        const boats = [];
        for (let tries = 0; tries < want * 60 && boats.length < want; tries++) {
          const a = r() * 2 * Math.PI, d = 40 + r() * 620, x = place.pos[0] + Math.cos(a) * d, z = place.pos[1] + Math.sin(a) * d;
          const h = ground.heightAt(x, z), s = ground.shoreAt(x, z);
          // Room to float and swing: shallow enough to anchor, clear of the beach and of each other.
          if (h > -(k ? 1.6 : 0.8) || h < -6 || s < 18 || s > 280 || taken.some(t => Math.hypot(t[0] - x, t[1] - z) < 22)) continue;
          taken.push([x, z]);
          boats.push({ x, z, swing: (r() - 0.5) * 0.5, phase: r() * 6.28, hull: HULLS[Math.floor(r() * (k ? 2 : HULLS.length))] });
        }
        if (!boats.length) return;
        const mesh = new THREE.InstancedMesh(kinds[k].geometry, material, boats.length);
        mesh.frustumCulled = false;
        boats.forEach((b, i) => mesh.setColorAt(i, colour.setRGB(b.hull[0], b.hull[1], b.hull[2])));
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.userData.world = { x: place.pos[0], z: place.pos[1] };
        this.group.add(mesh);
        this.fleets.push({ mesh, boats, kind: kinds[k], centre: place.pos });
      });
    }
    this.count = this.fleets.reduce((s, f) => s + f.boats.length, 0);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._w = [0, 0, 0, 0];
  }

  /** Local wave heights (std dev of each cascade) at a world point, as the shader computes them. */
  weightsAt(x, z, depth) {
    const m = this.waveMap, u = (x - this.rect.x) / this.rect.w, v = (z - this.rect.z) / this.rect.h, w = this._w;
    if (u < 0 || u > 1 || v < 0 || v > 1) this.waves.weightsAt(1, 1, w);
    else { const i = (Math.min(m.height - 1, Math.floor(v * m.height)) * m.width + Math.min(m.width - 1, Math.floor(u * m.width))) * 4; this.waves.weightsAt(m.rgba[i + 1] / 255, m.rgba[i] / 255, w); }
    const cap = Math.min(1, 0.4 * Math.max(depth, 0) / Math.max(2 * Math.hypot(w[0], w[1], w[2]), 1e-4));
    for (let i = 0; i < 4; i++) w[i] *= cap;
    return w;
  }

  /** @param {{x, y, z}} eye  @param {number} t wave clock (s)  @param {number} seaLevel */
  update(eye, t, seaLevel) {
    const wind = this.waves.wind, into = Math.atan2(Math.cos(wind.from * Math.PI / 180), Math.sin(wind.from * Math.PI / 180));   // bow towards where the wind comes from
    for (const f of this.fleets) {
      const dx = f.centre[0] - eye.x, dz = f.centre[1] - eye.z, dist = Math.hypot(dx, dz, eye.y);
      f.mesh.visible = dist < 9000;
      if (!f.mesh.visible) continue;
      f.mesh.position.set(dx, 0, dz);
      f.mesh.updateMatrixWorld();
      const animate = dist < 2500, half = f.kind.length * 0.4;
      if (!animate && f.settled) continue;
      f.boats.forEach((b, i) => {
        // Heading: into the wind, slowly sheering about the anchor.
        const heading = into + b.swing + (animate ? 0.12 * Math.sin(t * 0.07 + b.phase) : 0), cx = Math.cos(heading), sz = Math.sin(heading);
        let y = seaLevel, pitch = 0, roll = 0;
        if (animate) {
          const w = this.weightsAt(b.x, b.z, seaLevel - this.ground.heightAt(b.x, b.z));
          const h0 = this.waves.heightAt(b.x, b.z, t, w), hb = this.waves.heightAt(b.x + cx * half, b.z - sz * half, t, w), hs = this.waves.heightAt(b.x + sz * 0.9, b.z + cx * 0.9, t, w);
          y += h0; pitch = Math.atan2(hb - h0, half); roll = Math.atan2(hs - h0, 0.9);
        }
        this._e.set(roll, heading, pitch, 'YZX');
        this._m.compose(this._p.set(b.x - f.centre[0], y - f.kind.draft, b.z - f.centre[1]), this._q.setFromEuler(this._e), this._s);
        f.mesh.setMatrixAt(i, this._m);
      });
      f.mesh.instanceMatrix.needsUpdate = true;
      f.settled = !animate;
    }
  }
}
