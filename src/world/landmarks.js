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
void main() {
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
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
layout(location = 0) out vec4 outColor;
void main() {
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  vec3 toEye = vec3(-vRel.x, uCamY - vRel.y, -vRel.z);
  if (dot(n, toEye) < 0.0) n = -n;
  // Colours above 1 mark things that give off light (lamps, lit windows): negative alpha channel is not available,
  // so the convention is simply "brighter than white".
  float glow = max(max(vColor.r, vColor.g), vColor.b) > 1.0 ? 1.0 : 0.0;
  vec3 albedo = glow > 0.5 ? vec3(0.05) : vColor;
  // Sun, sky, and the light the pale ground throws back up (what keeps a shaded wall from going sky-blue).
  vec3 bounce = (uSunE * lrSaturate(uSunDir.y) + uSkyE) * vec3(0.46, 0.43, 0.36) * 0.5;
  vec3 light = uSunE * lrSaturate(dot(n, uSunDir)) * lrCloudShadow(uCamXZ + vRel.xz) * lrShadow(vRel, n) + uSkyE * (0.55 + 0.45 * n.y) + bounce * (0.5 - 0.5 * n.y);
  float water = uSeaLevel - vRel.y;
  // Same convention as the terrain: under water write reflectance and depth, above it radiance.
  if (water > 0.0) outColor = vec4(albedo * light / max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4)), water);
  else outColor = vec4(albedo * light / PI + glow * (vColor - 1.0) * uNight * 0.02, -1000.0);
}`;

export function createObjectMaterial(shadowTaps = 8) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader, fragmentShader, vertexColors: true, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
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

/** Houses from footprints: walls in paint colours, flat roofs, a darker band of doors and windows. */
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
  const out = [];
  for (const list of clusters.values()) {
    const ox = list.reduce((s, b) => s + b.poly[0][0], 0) / list.length, oz = list.reduce((s, b) => s + b.poly[0][1], 0) / list.length;
    const mb = new MeshBuilder();
    list.forEach((b, index) => {
      const r = rand(index * 7919 + Math.round(b.poly[0][0] * 13 + b.poly[0][1] * 7));
      let poly = b.poly.slice();
      if (poly.length > 3 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly.pop();
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const base = Math.max(ground.heightAt(cx, cz), 0.3), height = (b.levels || 1) * 2.9 + 0.3 + r() * 0.5, top = base + height;
      const wall = PAINT[Math.floor(r() * PAINT.length)], roof = ROOFS[Math.floor(r() * ROOFS.length)], trim = wall.map(v => v * 0.35);
      const pts = poly.map(p => [p[0] - ox, p[1] - oz]);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        mb.quad([a[0], base - 1.5, a[1]], [c[0], base - 1.5, c[1]], [c[0], top, c[1]], [a[0], top, a[1]], wall);
        // Doors and shuttered windows as a dark strip set a hair outside the wall, broken into bays.
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]), bays = Math.floor(len / 2.6);
        const nx = (c[1] - a[1]) / (len || 1) * 0.03, nz = -(c[0] - a[0]) / (len || 1) * 0.03;
        for (let k = 0; k < bays; k++) {
          if (r() < 0.25) continue;
          const t0 = (k + 0.28) / bays, t1 = (k + 0.72) / bays, door = r() < 0.2;
          const p0 = [a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0], p1 = [a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1];
          const y0 = base + (door ? 0 : 0.95), y1 = base + 2.05;
          for (const sgn of [1, -1]) {
            // A lit window by night (colour above 1 = gives off light) on some of them.
            const colour = !door && r() < 0.35 ? [1.9, 1.55, 1.0] : trim;
            mb.quad([p0[0] + nx * sgn, y0, p0[1] + nz * sgn], [p1[0] + nx * sgn, y0, p1[1] + nz * sgn], [p1[0] + nx * sgn, y1, p1[1] + nz * sgn], [p0[0] + nx * sgn, y1, p0[1] + nz * sgn], colour);
          }
        }
      }
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), [])) {
        mb.tri([pts[i][0], top, pts[i][1]], [pts[j][0], top, pts[j][1]], [pts[k][0], top, pts[k][1]], roof);
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
