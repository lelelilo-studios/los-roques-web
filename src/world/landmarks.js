// Man-made things, all generated from the feature list (no model files): the houses of Gran Roque from their
// footprints, the airstrip, piers and the lighthouses. Everything here is drawn in the opaque pass with one
// material; pieces are flat-shaded (normals from screen derivatives), coloured per vertex.
//
// Each object keeps its true position in `userData.world` and is re-placed relative to the camera every frame,
// like the terrain, so nothing jitters far from the origin.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { shadowGLSL } from './shadow.js';

const vertexShader = /* glsl */`
#include <lr_common>
out vec3 vRel;
out vec3 vColor;
#ifdef LR_SMOOTH
out vec3 vNormal;           // (round things: normals come with the mesh; everything else is flat-shaded)
#endif
void main() {
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
#endif
#ifdef LR_SMOOTH
  vNormal = mat3(modelMatrix) * normal;
#endif
  vRel = wp.xyz;
  vColor = color;
#ifdef USE_INSTANCING_COLOR
  vColor *= instanceColor;
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - lrCurveDrop(wp.xz), wp.z, 1.0);
}`;
const fragmentShader = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
${shadowGLSL}
uniform float uNight;       // 0 by day, 1 at night: windows and lamps glow
in vec3 vRel;
in vec3 vColor;
#ifdef LR_SMOOTH
in vec3 vNormal;
#endif
layout(location = 0) out vec4 outColor;
void main() {
#ifdef LR_SMOOTH
  vec3 n = normalize(vNormal);
#else
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
#endif
  vec3 toEye = vec3(-vRel.x, uCamY - vRel.y, -vRel.z);
  if (dot(n, toEye) < 0.0) n = -n;
  // Colours above 1 mark things that give off light (lamps, lit windows): negative alpha channel is not available,
  // so the convention is simply "brighter than white".
  float glow = max(max(vColor.r, vColor.g), vColor.b) > 1.0 ? 1.0 : 0.0;
  vec3 albedo = glow > 0.5 ? vec3(0.05) : vColor;
  // Sun, sky, and the light the pale ground throws back up (what keeps a shaded wall from going sky-blue).
  vec3 bounce = (uSunE * lrSaturate(uSunDir.y) + uSkyE) * vec3(0.46, 0.43, 0.36) * 0.5;
  float sunLit = lrCloudShadow(uCamXZ + vRel.xz) * lrShadow(vRel, n);
  vec3 light = uSunE * lrSaturate(dot(n, uSunDir)) * sunLit + uSkyE * (0.55 + 0.45 * n.y) + bounce * (0.5 - 0.5 * n.y);
  vec3 sheen = vec3(0.0);
#ifdef LR_SMOOTH
  // (Skin has a sheen, and catches the sky along its edges.)
  vec3 e = normalize(toEye);
  sheen = uSunE * sunLit * 0.05 * pow(lrSaturate(dot(reflect(-e, n), uSunDir)), 30.0) + uSkyE / PI * 0.25 * pow(1.0 - lrSaturate(dot(n, e)), 4.0);
#endif
  float water = uSeaLevel - vRel.y;
  // Same convention as the terrain: under water write reflectance and depth, above it radiance.
  if (water > 0.0) outColor = vec4(albedo * light / max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4)), water);
  else outColor = vec4(albedo * light / PI + sheen + glow * (vColor - 1.0) * uNight * 0.02, -1000.0);
}`;

export function createObjectMaterial(shadowTaps = 8, smooth = false) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader, fragmentShader, vertexColors: true, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps, ...(smooth ? { LR_SMOOTH: 1 } : {}) },
    uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.cloudShadow, ...CHUNK_UNIFORMS.shadow], { uNight: { value: 0 } }),
  });
}

/** Collects triangles with a colour each, then makes a geometry (positions relative to `origin`). */
export class MeshBuilder {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, color) { this.pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) this.col.push(color[0], color[1], color[2]); }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  /** A box from its centre, half sizes and a rotation about the vertical (radians). */
  box(cx, cy, cz, hx, hy, hz, color, rot = 0, topColor = color) {
    const s = Math.sin(rot), c = Math.cos(rot), p = (x, y, z) => [cx + x * c - z * s, cy + y, cz + x * s + z * c];
    const v = [p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, -hy, hz), p(-hx, -hy, hz), p(-hx, hy, -hz), p(hx, hy, -hz), p(hx, hy, hz), p(-hx, hy, hz)];
    for (const [a, b, e, f] of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) this.quad(v[a], v[b], v[e], v[f], color);
    this.quad(v[4], v[5], v[6], v[7], topColor); this.quad(v[0], v[3], v[2], v[1], color);
  }
  /** A vertical tapering tube with `sides` faces between heights y0 and y1 (radii r0, r1), optionally capped. */
  tube(cx, cz, y0, y1, r0, r1, sides, color, cap = false, rot = 0) {
    for (let i = 0; i < sides; i++) {
      const a0 = rot + i / sides * 2 * Math.PI, a1 = rot + (i + 1) / sides * 2 * Math.PI;
      const p = (a, r, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      this.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), p(a0, r1, y1), color);
      if (cap) this.tri([cx, y1, cz], p(a0, r1, y1), p(a1, r1, y1), color);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// Paint of the posadas: whites and bright Caribbean colours (linear reflectance).
const PAINT = [[0.86, 0.85, 0.8], [0.86, 0.85, 0.8], [0.8, 0.62, 0.12], [0.1, 0.5, 0.56], [0.78, 0.3, 0.33], [0.82, 0.42, 0.2], [0.35, 0.6, 0.2],
  [0.2, 0.42, 0.72], [0.75, 0.72, 0.5], [0.6, 0.22, 0.4], [0.9, 0.78, 0.55], [0.3, 0.62, 0.6]];
const ROOFS = [[0.72, 0.7, 0.66], [0.55, 0.22, 0.14], [0.45, 0.45, 0.46], [0.7, 0.68, 0.6]];
const rand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

function mesh(builder, material, x, z) {
  const m = new THREE.Mesh(builder.geometry(), material);
  m.userData.world = { x, z };
  m.frustumCulled = false;       // placed relative to the camera each frame; culled by distance instead
  return m;
}

// Door and shutter paint, and bare wood.
const JOINERY = [[0.1, 0.22, 0.42], [0.08, 0.3, 0.3], [0.45, 0.1, 0.1], [0.32, 0.2, 0.1], [0.2, 0.34, 0.14], [0.6, 0.6, 0.56], [0.5, 0.36, 0.08]];
const WHITE = [0.84, 0.83, 0.79];

/**
 * Houses from footprints, at the size people build them: a floor 2.9 m high, doors 0.9 x 2.05 m with a frame
 * and a step, shuttered windows a metre wide with their sills at 0.95 m, a painted band along the foot of the
 * wall, and a roof slab with eaves or a parapet. Colours vary house by house.
 */
function buildVillage(buildings, ground, material) {
  if (!buildings.length) return [];
  // One mesh per cluster of ~1 km, with coordinates relative to the cluster's centre.
  const clusters = new Map();
  for (const b of buildings) {
    if (!b.poly || b.poly.length < 3) continue;
    const key = `${Math.round(b.poly[0][0] / 1200)},${Math.round(b.poly[0][1] / 1200)}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(b);
  }
  const inside = (pts, x, z) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > z) !== (pts[j][1] > z) && x < (pts[j][0] - pts[i][0]) * (z - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) hit = !hit;
    return hit;
  };
  const out = [];
  for (const list of clusters.values()) {
    const ox = list.reduce((s, b) => s + b.poly[0][0], 0) / list.length, oz = list.reduce((s, b) => s + b.poly[0][1], 0) / list.length;
    const mb = new MeshBuilder();
    list.forEach((b, index) => {
      const r = rand(index * 7919 + Math.round(b.poly[0][0] * 13 + b.poly[0][1] * 7));
      let poly = b.poly.slice();
      if (poly.length > 3 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly.pop();
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      // The floor stands a step above the highest ground the house touches.
      const base = Math.max(0.3, ground.heightAt(cx, cz), ...poly.map(q => ground.heightAt(q[0], q[1]))) + 0.12;
      const levels = b.levels || 1, parapet = r() < 0.4, height = levels * 2.9 + (parapet ? 0.45 : 0.12) + r() * 0.2, top = base + height;
      const wall = PAINT[Math.floor(r() * PAINT.length)], roof = ROOFS[Math.floor(r() * ROOFS.length)];
      const joinery = JOINERY[Math.floor(r() * JOINERY.length)], white = wall[0] > 0.8 && wall[2] > 0.7;
      // The band along the foot of the wall: a deeper shade of the wall, or a colour of its own on a white house.
      const band = white ? JOINERY[Math.floor(r() * JOINERY.length)].map(v => v * 0.9 + 0.05) : wall.map(v => v * 0.62), frame = white ? joinery.map(v => v * 0.5 + 0.35) : WHITE;
      const pts = poly.map(q => [q[0] - ox, q[1] - oz]);
      // Walls, and which one is longest (the front door goes there).
      const walls = pts.map((a, i) => {
        const c = pts[(i + 1) % pts.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1e-6, d = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
        let n = [d[1], -d[0]];
        if (inside(pts, (a[0] + c[0]) / 2 + n[0] * 0.15, (a[1] + c[1]) / 2 + n[1] * 0.15)) n = [-n[0], -n[1]];
        return { a, c, len, d, n };
      });
      const front = walls.reduce((best, w) => (w.len > best.len ? w : best), walls[0]);
      let awning = r() < 0.35;
      for (const w of walls) {
        const { a, c, len, d, n } = w;
        mb.quad([a[0], base - 1.6, a[1]], [c[0], base - 1.6, c[1]], [c[0], top, c[1]], [a[0], top, a[1]], wall);
        // A rectangle on this wall: from s0 to s1 metres along it, y0 to y1 above the floor, `off` metres out from it.
        const panel = (s0, s1, y0, y1, off, colour) => {
          const p0 = [a[0] + d[0] * s0 + n[0] * off, a[1] + d[1] * s0 + n[1] * off], p1 = [a[0] + d[0] * s1 + n[0] * off, a[1] + d[1] * s1 + n[1] * off];
          mb.quad([p0[0], base + y0, p0[1]], [p1[0], base + y0, p1[1]], [p1[0], base + y1, p1[1]], [p0[0], base + y1, p0[1]], colour);
        };
        const block = (s0, s1, y0, y1, depth, colour) => {
          const m = (s0 + s1) / 2;
          mb.box(a[0] + d[0] * m + n[0] * depth / 2, base + (y0 + y1) / 2, a[1] + d[1] * m + n[1] * depth / 2, (s1 - s0) / 2, (y1 - y0) / 2, depth / 2, colour, Math.atan2(d[1], d[0]));
        };
        if (len > 1.2) panel(0, len, -1.6, 0.8, 0.02, band);
        const bays = Math.max(0, Math.floor((len - 0.5) / 2.3));
        for (let k = 0; k < bays; k++) {
          const mid = (k + 0.5) / bays * len, isFront = w === front && k === Math.floor(bays / 2);
          const blank = r() < 0.22, door = isFront || r() < 0.12, open = r() < 0.4;
          if (blank && !isFront) continue;
          if (door) {
            // Door: frame, leaf (two boards' worth of shade), a step down to the ground outside.
            panel(mid - 0.53, mid + 0.53, 0, 2.13, 0.035, frame);
            panel(mid - 0.45, mid + 0.45, 0, 2.05, 0.05, joinery);
            panel(mid - 0.02, mid + 0.02, 0.05, 2.0, 0.055, joinery.map(v => v * 0.55));
            const outside = ground.heightAt(ox + a[0] + d[0] * mid + n[0] * 0.6, oz + a[1] + d[1] * mid + n[1] * 0.6);
            block(mid - 0.65, mid + 0.65, Math.min(outside - base - 0.05, -0.2), 0, 0.38, [0.6, 0.59, 0.55]);
            if (isFront && awning && levels === 1) {
              // A porch roof on two posts over the front door.
              awning = false;
              const e0 = [a[0] + d[0] * (mid - 1.3), a[1] + d[1] * (mid - 1.3)], e1 = [a[0] + d[0] * (mid + 1.3), a[1] + d[1] * (mid + 1.3)], deep = 1.5;
              mb.quad([e0[0], base + 2.75, e0[1]], [e1[0], base + 2.75, e1[1]], [e1[0] + n[0] * deep, base + 2.4, e1[1] + n[1] * deep], [e0[0] + n[0] * deep, base + 2.4, e0[1] + n[1] * deep], roof);
              for (const e of [e0, e1]) mb.tube(e[0] + n[0] * (deep - 0.08), e[1] + n[1] * (deep - 0.08), outside - 0.3, base + 2.4, 0.045, 0.045, 5, WHITE);
            }
          }
          for (let level = door ? 1 : 0; level < levels; level++) {
            const y = level * 2.9 + 0.95;
            // Window: frame, sill, and two shutters, closed or folded back against the wall beside a dark opening
            // (which glows at night: colours above 1 give off light).
            panel(mid - 0.58, mid + 0.58, y - 0.06, y + 1.23, 0.035, frame);
            block(mid - 0.62, mid + 0.62, y - 0.1, y - 0.04, 0.09, frame);
            if (open) {
              panel(mid - 0.5, mid + 0.5, y, y + 1.15, 0.045, r() < 0.5 ? [1.9, 1.55, 1.0] : [0.03, 0.03, 0.035]);
              panel(mid - 1.02, mid - 0.54, y, y + 1.15, 0.05, joinery); panel(mid + 0.54, mid + 1.02, y, y + 1.15, 0.05, joinery);
            } else {
              panel(mid - 0.5, mid - 0.01, y, y + 1.15, 0.05, joinery); panel(mid + 0.01, mid + 0.5, y, y + 1.15, 0.05, joinery);
              for (const q of [-0.25, 0.25]) panel(mid + q - 0.17, mid + q + 0.17, y + 0.12, y + 1.03, 0.055, joinery.map(v => v * 0.7));     // louvred panels
            }
          }
        }
      }
      // The roof: a slab with eaves all round, or one set down inside a parapet.
      const tris = THREE.ShapeUtils.triangulateShape(pts.map(q => new THREE.Vector2(q[0], q[1])), []);
      if (parapet) {
        for (const [i, j, k] of tris) mb.tri([pts[i][0], top - 0.4, pts[i][1]], [pts[j][0], top - 0.4, pts[j][1]], [pts[k][0], top - 0.4, pts[k][1]], roof);
        for (const w of walls) mb.quad([w.a[0] + w.n[0] * 0.03, top, w.a[1] + w.n[1] * 0.03], [w.c[0] + w.n[0] * 0.03, top, w.c[1] + w.n[1] * 0.03], [w.c[0] - w.n[0] * 0.17, top, w.c[1] - w.n[1] * 0.17], [w.a[0] - w.n[0] * 0.17, top, w.a[1] - w.n[1] * 0.17], WHITE);
      } else {
        // Each corner pushed out along both walls that meet there.
        const eave = 0.32, outer = pts.map((q, i) => {
          const w0 = walls[(i + walls.length - 1) % walls.length], w1 = walls[i], dot = w0.n[0] * w1.n[0] + w0.n[1] * w1.n[1], k = eave / Math.max(1 + dot, 0.35);
          return [q[0] + (w0.n[0] + w1.n[0]) * k, q[1] + (w0.n[1] + w1.n[1]) * k];
        });
        for (const [i, j, k] of tris) mb.tri([outer[i][0], top + 0.14, outer[i][1]], [outer[j][0], top + 0.14, outer[j][1]], [outer[k][0], top + 0.14, outer[k][1]], roof);
        for (let i = 0; i < outer.length; i++) {
          const o0 = outer[i], o1 = outer[(i + 1) % outer.length], q0 = pts[i], q1 = pts[(i + 1) % pts.length];
          mb.quad([o0[0], top, o0[1]], [o1[0], top, o1[1]], [o1[0], top + 0.14, o1[1]], [o0[0], top + 0.14, o0[1]], roof.map(v => v * 0.8));     // the slab's edge
          mb.quad([q0[0], top, q0[1]], [q1[0], top, q1[1]], [o1[0], top, o1[1]], [o0[0], top, o0[1]], WHITE.map(v => v * 0.85));                 // under the eaves
        }
      }
    });
    out.push(mesh(mb, material, ox, oz));
  }
  return out;
}

/** The four lights of Los Roques, by name: an old white stone tower, a small orange pillar, banded fibreglass towers. */
function buildLighthouse(light, ground, material) {
  const [x, z] = light.pos, base = Math.max(ground.heightAt(x, z), 0.2), mb = new MeshBuilder();
  const name = (light.name || '').toLowerCase(), white = [0.85, 0.84, 0.8], orange = [0.85, 0.3, 0.06], lamp = [3.0, 2.8, 2.2];
  let height = 12;
  if (/holand|dutch|viejo|antiguo/.test(name)) {
    // Faro Holandés (1870s): a square, tapering stone tower about 18 m tall, white.
    height = 18;
    mb.tube(0, 0, base - 1, base + 15, 3.6, 2.4, 4, white, false, Math.PI / 4);
    mb.tube(0, 0, base + 15, base + 15.5, 2.9, 2.9, 4, [0.6, 0.6, 0.58], true, Math.PI / 4);
    mb.tube(0, 0, base + 15.5, base + 17.3, 1.1, 1.1, 8, [0.2, 0.25, 0.28]);
    mb.tube(0, 0, base + 17.3, base + 18.2, 1.3, 0.1, 8, [0.3, 0.3, 0.3]);
  } else {
    // Fibreglass towers: orange and white bands, 6 to 15 m.
    height = light.tower_m || (/agua/.test(name) ? 15 : /sebastopol/.test(name) ? 10 : 6);
    const bands = Math.max(2, Math.round(height / 3)), r0 = 0.5 + height * 0.035;
    for (let i = 0; i < bands; i++) mb.tube(0, 0, base - (i ? 0 : 1) + i * height / bands, base + (i + 1) * height / bands, r0, r0, 8, i % 2 ? white : orange);
    mb.tube(0, 0, base + height, base + height + 0.3, r0 * 1.4, r0 * 1.4, 8, [0.3, 0.3, 0.3], true);
  }
  mb.box(0, base + height - 0.9 + (height === 18 ? -1.2 : 0.8), 0, 0.35, 0.35, 0.35, lamp);
  const m = mesh(mb, material, x, z);
  m.userData.light = { height: base + height };
  return m;
}

/** A paved strip draped on the ground between two points. */
function buildRunway(runway, ground, material) {
  const [ax, az] = runway.a, [bx, bz] = runway.b, len = Math.hypot(bx - ax, bz - az), w = (runway.width || 25) / 2, mb = new MeshBuilder();
  const ux = (bx - ax) / len, uz = (bz - az) / len, px = -uz, pz = ux, n = Math.max(2, Math.ceil(len / 25));
  const asphalt = [0.11, 0.11, 0.12], paint = [0.75, 0.75, 0.72];
  const at = (t, side, lift) => { const x = (bx - ax) * t + px * side * w, z = (bz - az) * t + pz * side * w; return [x, Math.max(ground.heightAt(ax + x, az + z), 0.4) + lift, z]; };
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    mb.quad(at(t0, -1, 0.06), at(t1, -1, 0.06), at(t1, 1, 0.06), at(t0, 1, 0.06), asphalt);
    if (i % 2 === 0 && i > 1 && i < n - 2) mb.quad(at(t0, -0.035, 0.09), at(t1, -0.035, 0.09), at(t1, 0.035, 0.09), at(t0, 0.035, 0.09), paint);   // centre line
  }
  for (const t of [0.012, 0.988]) for (let k = -3; k <= 3; k++) {                                                                           // threshold bars
    if (k === 0) continue;
    mb.quad(at(t - 0.008, k / 4 - 0.06, 0.09), at(t + 0.008, k / 4 - 0.06, 0.09), at(t + 0.008, k / 4 + 0.06, 0.09), at(t - 0.008, k / 4 + 0.06, 0.09), paint);
  }
  return mesh(mb, material, ax, az);
}

/** A wooden pier on piles along a polyline. */
function buildPier(pier, material) {
  const line = pier.line || [];
  if (line.length < 2) return null;
  const [ox, oz] = line[0], w = Math.max(pier.width || 2.5, 1.5) / 2, mb = new MeshBuilder(), wood = [0.36, 0.28, 0.2], pile = [0.2, 0.16, 0.12];
  for (let i = 0; i < line.length - 1; i++) {
    const ax = line[i][0] - ox, az = line[i][1] - oz, bx = line[i + 1][0] - ox, bz = line[i + 1][1] - oz, len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const rot = Math.atan2(bz - az, bx - ax);
    mb.box((ax + bx) / 2, 1.05, (az + bz) / 2, len / 2 + w * 0.2, 0.09, w, wood, rot);
    for (let d = 1; d < len; d += 4) for (const side of [-1, 1]) {
      const t = d / len, x = ax + (bx - ax) * t - Math.sin(rot) * side * (w - 0.15), z = az + (bz - az) * t + Math.cos(rot) * side * (w - 0.15);
      mb.tube(x, z, -3.5, 1.35, 0.11, 0.11, 6, pile);
    }
  }
  return mesh(mb, material, ox, oz);
}

export class Landmarks {
  /** @param {object} features  parsed features.json  @param {Ground} ground */
  /** `extra(material)` may return more meshes (with userData.world) to manage alongside. */
  constructor(features, ground, extraBuilder = null) {
    this.material = createObjectMaterial();
    this.group = new THREE.Group();
    const add = m => { if (m) this.group.add(m); };
    const built = extraBuilder ? extraBuilder(this.material) : null, extra = built ? [...built.children] : [];
    /** Where the beach umbrellas stand: [x, z, bearing to the water]. */
    this.umbrellas = built?.userData.spots || [];
    /** Where people stand on the beaches: [x, z]. */
    this.people = built?.userData.people || [];
    for (const m of buildVillage(features.buildings || [], ground, this.material)) add(m);
    for (const l of features.lighthouses || []) if (l.pos) add(buildLighthouse(l, ground, this.material));
    for (const r of features.runways || []) if (r.a && r.b) add(buildRunway(r, ground, this.material));
    for (const p of features.piers || []) add(buildPier(p, this.material));
    for (const m of extra) add(m);
  }

  /** Places everything relative to the camera; hides what is too far to see. `night`: 0..1. */
  update(eye, night) {
    this.material.uniforms.uNight.value = night;
    for (const m of this.group.children) {
      const w = m.userData.world, dx = w.x - eye.x, dz = w.z - eye.z;
      m.visible = dx * dx + dz * dz < 4.5e8 + m.geometry.boundingSphere.radius ** 2;      // 21 km
      if (m.visible) { m.position.set(dx, 0, dz); m.updateMatrixWorld(); }
    }
  }
}
