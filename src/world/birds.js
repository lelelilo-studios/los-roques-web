// Seabirds: frigatebirds circling high on the trade wind and pelicans gliding low over the water in a line.
// Each bird is a body and two wings (three instanced meshes per flock), moved on simple paths.
import * as THREE from 'three';
import { MeshBuilder } from './landmarks.js';

const rand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

// Body along +x (head at +x), wings along +-z from the body's centre line; sizes in metres.
function parts(kind) {
  const dark = kind === 'frigate' ? [0.02, 0.02, 0.025] : [0.16, 0.14, 0.12], span = kind === 'frigate' ? 2.2 : 2.0;
  const body = new MeshBuilder(), wing = new MeshBuilder();
  const len = kind === 'frigate' ? 1.0 : 1.2;
  body.tri([len * 0.5, 0, 0], [-len * 0.2, 0, 0.09], [-len * 0.2, 0, -0.09], dark);
  if (kind === 'frigate') {              // long forked tail
    body.tri([-len * 0.2, 0, 0.07], [-len * 0.75, 0, 0.16], [-len * 0.25, 0, 0], dark);
    body.tri([-len * 0.2, 0, -0.07], [-len * 0.75, 0, -0.16], [-len * 0.25, 0, 0], dark);
  } else {                               // short tail, big bill
    body.tri([-len * 0.2, 0, 0.09], [-len * 0.45, 0, 0], [-len * 0.2, 0, -0.09], dark);
    body.tri([len * 0.5, 0, 0.02], [len * 0.82, -0.04, 0], [len * 0.5, 0, -0.02], [0.5, 0.42, 0.25]);
  }
  // One wing (the +z one): an angled, pointed blade; the other is its mirror.
  const w = span / 2;
  wing.tri([0.18, 0, 0], [-0.16, 0, 0], [0.02, 0, w * 0.5], dark);
  wing.tri([0.02, 0, w * 0.5], [-0.16, 0, 0], [-0.2, 0, w * 0.55], dark);
  wing.tri([0.02, 0, w * 0.5], [-0.2, 0, w * 0.55], [-0.32, 0, w], dark);
  return { body: body.geometry(), wing: wing.geometry() };
}

// Where birds gather, by words in a place's name: [pattern, frigatebirds, pelicans].
const FLOCKS = [[/faro|holand/, 9, 0], [/gran roque|village/, 3, 5], [/francisqu/, 4, 5], [/madrisqu|pirata/, 2, 5], [/agua isthmus|agua-isthmus/, 4, 4],
  [/mosquises/, 6, 0], [/crasqu/, 2, 4], [/grande/, 5, 3], [/noronqu/, 2, 3], [/rock|cay/, 3, 4]];

export class Birds {
  constructor(places, ground, material) {
    this.group = new THREE.Group();
    this.flocks = []; this.ground = ground;
    /** Where a pelican went into the sea this frame: [{ x, z }] (the world). app.js makes the splash. */
    this.splashes = [];
    const geo = { frigate: parts('frigate'), pelican: parts('pelican') };
    for (const place of places) {
      const label = `${place.id || ''} ${place.name || ''}`.toLowerCase(), f = FLOCKS.find(x => x[0].test(label));
      if (!f) continue;
      const r = rand(Math.round(place.pos[0] * 7 + place.pos[1] * 13) + 5), base = Math.max(ground.heightAt(place.pos[0], place.pos[1]), 0);
      for (const [kind, n] of [['frigate', f[1]], ['pelican', f[2]]]) {
        if (!n) continue;
        const birds = [];
        if (kind === 'frigate') {
          for (let i = 0; i < n; i++) birds.push({ cx: (r() - 0.5) * 500, cz: (r() - 0.5) * 500, radius: 50 + r() * 160, alt: base + 35 + r() * 110, speed: (r() < 0.5 ? -1 : 1) * (8 + r() * 4), phase: r() * 6.28 });
        } else {
          // A line astern, flying a long oval low over the sea beside the place.
          const cx = (r() - 0.5) * 400, cz = (r() - 0.5) * 400, radius = 220 + r() * 200, squash = 0.25 + r() * 0.2, turn = r() * 6.28, dir = r() < 0.5 ? -1 : 1;
          for (let i = 0; i < n; i++) birds.push({ cx, cz, radius, squash, turn, alt: 2.5 + r() * 1.5, speed: dir * 11, phase: -i * 0.022 * dir, line: true });
          // And one that fishes: round and round higher up, and every minute or so it folds its wings and drops into the sea, sits a while, and takes off again.
          birds.push({ cx: cx + (r() - 0.5) * 120, cz: cz + (r() - 0.5) * 120, radius: 45 + r() * 50, squash: 1, turn: 0, alt: 6.5, speed: dir * 9, phase: r() * 6.28, diver: true, period: 44 + 30 * r(), was: 0 });
        }
        const meshes = ['body', 'wing', 'wing'].map(part => {
          const m = new THREE.InstancedMesh(geo[kind][part], material, birds.length);
          m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.group.add(m);
          return m;
        });
        this.flocks.push({ centre: place.pos, kind, birds, meshes });
      }
    }
    this.count = this.flocks.reduce((s, f) => s + f.birds.length, 0);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._qw = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._axis = new THREE.Vector3(1, 0, 0);
  }

  update(eye, t, seaLevel = 0) {
    this.splashes.length = 0;
    /** How near the nearest bird is to the eye, metres (for tests: none should skim past at arm's length). */
    this.nearest = Infinity;
    for (const f of this.flocks) {
      const dx = f.centre[0] - eye.x, dz = f.centre[1] - eye.z, visible = dx * dx + dz * dz < 3500 * 3500;
      for (const m of f.meshes) { m.visible = visible; if (visible) { m.position.set(dx, 0, dz); m.updateMatrixWorld(); } }
      if (!visible) continue;
      f.birds.forEach((b, i) => {
        // (The one that fishes: its time in the air is all but ten seconds of each round; then two to climb, one to fall, five on the water, two to get off it.)
        let fishing = -1, flown = t;
        if (b.diver) { const u = t % b.period, fly = b.period - 10; flown = Math.floor(t / b.period) * fly + Math.min(u, fly); fishing = u - fly; }
        const a = b.phase + flown * b.speed / b.radius, ca = Math.cos(a), sa = Math.sin(a), k = b.line ? b.squash : 1;
        let x = ca * b.radius, z = sa * b.radius * k, vx = -sa * Math.sign(b.speed), vz = ca * k * Math.sign(b.speed);
        if (b.line) { const c = Math.cos(b.turn), s = Math.sin(b.turn); [x, z, vx, vz] = [x * c - z * s, x * s + z * c, vx * c - vz * s, vx * s + vz * c]; }
        const heading = Math.atan2(-vz, vx), bank = b.line ? 0 : b.diver ? -0.2 * Math.sign(b.speed) : -0.35 * Math.sign(b.speed);
        // Frigatebirds hold their wings out and barely move them; pelicans give a few slow beats, then glide.
        let beat = b.line ? Math.max(0, Math.sin(t * 0.9 + b.phase * 40)) * Math.sin(t * 5.5 + i) * 0.55 : b.diver ? Math.sin(t * 5.0 + i) * 0.3 * Math.max(0, Math.sin(t * 0.6 + i)) : Math.sin(t * 1.3 + i * 2.1) * 0.06;
        let y = b.alt + (b.line ? 0.4 * Math.sin(t * 0.5 + b.phase * 30) : b.diver ? 0.3 * Math.sin(t * 0.4 + i) : 6 * Math.sin(t * 0.11 + i)), pitch = 0, fold = 1;
        if (b.diver && fishing >= 0) {
          // (Not over dry sand or the shallows: there it only looks, and flies on.)
          const wx = f.centre[0] + b.cx + x, wz = f.centre[1] + b.cz + z, deep = seaLevel - this.ground.heightAt(wx, wz);
          if (deep > 0.6) {
            const e = v => v * v * (3 - 2 * v);
            if (fishing < 2) { y = b.alt + 3 * e(fishing / 2); pitch = 0.25 * e(fishing / 2); beat = Math.sin(t * 7) * 0.5; }
            else if (fishing < 3) { const d = fishing - 2; y = (b.alt + 3) * (1 - d * d) + seaLevel + 0.05; pitch = -1.25; fold = 0.3; beat = 0.5; }
            else if (fishing < 8) { y = seaLevel + 0.06 + 0.03 * Math.sin(t * 2); fold = 0.3; beat = 0.6; }
            else { const d = e((fishing - 8) / 2); y = seaLevel + 0.06 + (b.alt - seaLevel) * d; pitch = 0.3 * (1 - d); beat = Math.sin(t * 9) * 0.6; }
            if (b.was < 3 && fishing >= 3 && fishing < 3.5) this.splashes.push({ x: wx, z: wz });
          }
        }
        if (b.diver) b.was = fishing;
        // (A bird does not skim past someone standing on the beach at arm's length: it rises over you as it
        // comes near. They are a few flat triangles, made to be seen at a distance.)
        const near = Math.hypot(dx + b.cx + x, dz + b.cz + z);
        if (eye.y < 30 && !(b.diver && fishing >= 0)) y += 14 * (1 - Math.min(1, Math.max(0, (near - 25) / 45)) ** 2) * (b.line ? 1 : 0.4);
        this.nearest = Math.min(this.nearest, Math.hypot(near, y - eye.y));
        this._e.set(bank, heading, pitch, 'YXZ');
        this._q.setFromEuler(this._e);
        this._p.set(b.cx + x, y, b.cz + z);
        f.meshes[0].setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
        // Wings: the same pose, rolled up or down about the body's long axis; the second wing is mirrored in z.
        this._qw.setFromAxisAngle(this._axis, -(0.12 + beat));
        f.meshes[1].setMatrixAt(i, this._m.compose(this._p, this._qw.premultiply(this._q), this._s.set(1, 1, fold)));
        this._qw.setFromAxisAngle(this._axis, 0.12 + beat);
        f.meshes[2].setMatrixAt(i, this._m.compose(this._p, this._qw.premultiply(this._q), this._s.set(1, 1, -fold)));
        this._s.set(1, 1, 1);
      });
      for (const m of f.meshes) m.instanceMatrix.needsUpdate = true;
    }
  }
}
