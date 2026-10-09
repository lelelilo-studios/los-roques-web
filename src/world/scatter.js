// Small things in great numbers near the eye: seagrass, corals, fish, starfish, shells, shrubs, trees.
//
// Each kind is one instanced mesh whose instances sit on a lattice of cells centred on the camera. The lattice
// moves in whole cells, and everything about a cell's thing (whether there is one, where in the cell, how big,
// which way round) comes from a hash of the cell's own index: so things stay put as you move, and nothing is
// stored. Whether a cell holds a thing is decided in the vertex shader from the same maps the terrain is drawn
// from (seagrass where the data says seagrass), by a GLSL rule each kind supplies.
//
// Output follows the scene's convention (see terrain.js): under water, reflectance and depth; above, radiance.
import * as THREE from 'three';
import { CHUNK_UNIFORMS, uniformsFor } from '../core/uniforms.js';
import { WAVE_UNIFORMS, wavesGLSL } from './waves.js';
import { CASTER_UNIFORMS, casterFragment, casterGLSL, shadowGLSL } from './shadow.js';

const vertexShader = (rule, move) => /* glsl */`
#include <lr_common>
#include <lr_geo>
${wavesGLSL}
uniform sampler2D tBenthic;   // r seagrass, g coral/algae, b rubble, a confidence
uniform sampler2D tLand;      // r mangrove, g scrub, b built-up, a canopy height / 25.5 m
uniform vec4 uLattice;        // xy = index of the middle cell (wrapped to 4096), zw = that cell's corner relative to the camera
uniform vec4 uKind;           // cell size (m), half the lattice (cells), seed, sway
uniform vec4 uSize;           // smallest and largest scale, height above the ground, 1 = lean with the ground
#ifdef LR_CASTER
${casterGLSL}
#endif
in vec2 aCell;                // this instance's cell, counted from the middle one
in float aBend;               // how much this vertex moves with the water or the wind (0 at the root)
out vec3 vRel;
out vec3 vColor;
out float vFade;
out vec4 vLocal;              // the vertex in the thing's own frame (metres, before it sways or turns), and how leafy it is (aBend)
out float vSeed;
void main() {
  vec2 cell = mod(uLattice.xy + aCell, 4096.0);
  vec4 h = vec4(lrHash22(cell + uKind.z), lrHash22(cell + uKind.z + 71.3));
  vec2 rel = uLattice.zw + (aCell + 0.1 + 0.8 * h.xy) * uKind.x, wxz = uCamXZ + rel;
  float shore, ground = lrGround(wxz, 1.0, shore), water = uSeaLevel - ground;
  vec4 benthic = textureLod(tBenthic, lrMapUV(wxz), 0.0), land = textureLod(tLand, lrMapUV(wxz), 0.0);
  // The kind's rule: how likely a cell like this holds a thing (0..1), from the ground and the maps.
  float keep = 0.0;
  ${rule}
  float edge = length(aCell) / uKind.y;
  // (Strictly more than the cell's draw: the hash comes out as exactly 0 for one cell in some hundreds, and
  // a rule that says "none here" must mean none.)
  vFade = keep > max(h.z, 1e-4) ? 1.0 - smoothstep(0.7, 1.0, edge) : 0.0;
  float size = mix(uSize.x, uSize.y, h.w) * smoothstep(0.0, 0.25, vFade);
  float turn = 6.2832 * h.x * 7.0;                          // which way it faces (radians from +x towards +z)
  vec3 p = position * size, colour = color, shift = vec3(0.0);
  float t = uTime, bend = aBend;
  // The kind's own movement: p is the vertex (metres, about the thing's foot, before it is turned), 'shift'
  // moves the whole thing, 'turn' may be set.
  ${move}
  float ct = cos(turn), st = sin(turn);
  p = vec3(p.x * ct - p.z * st, p.y, p.x * st + p.z * ct) + shift;
  vRel = vec3(rel.x + p.x, ground + uSize.z + p.y, rel.y + p.z);
  vColor = colour;
  vLocal = vec4(position * size, aBend); vSeed = h.x * 61.0 + h.y * 17.0;
#ifdef LR_CASTER
  gl_Position = vFade > 0.0 ? lrShadowClip(vRel) : vec4(2.0, 2.0, 2.0, 1.0);
#else
  gl_Position = vFade > 0.0 ? projectionMatrix * viewMatrix * vec4(vRel.x, vRel.y - lrCurveDrop(vRel.xz), vRel.z, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
#endif
}`;

const fragmentShader = /* glsl */`
#include <lr_common>
#include <lr_cloud_shadow>
#include <lr_caustics>
${shadowGLSL}
uniform vec4 uLook;           // x = 1: lit from both sides (leaves, blades); y = gloss; z = how much light comes through; w = leaf size, m (0: not foliage)
in vec3 vRel;
in vec3 vColor;
in float vFade;
in vec4 vLocal;
in float vSeed;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  vec3 toEye = normalize(vec3(-vRel.x, uCamY - vRel.y, -vRel.z));
  if (dot(n, toEye) < 0.0) n = -n;
  float water = uSeaLevel - vRel.y, facing = dot(n, uSunDir);
  vec3 albedo = vColor;
  if (uLook.w > 0.0) {
    if (vLocal.w > 0.32) {
      // Foliage: a mass of leaves, in clumps a little lighter or darker than their neighbours, ragged where
      // the crown turns away from the eye (leaf-sized pieces are missing there). The pattern rides on the
      // plant, so it sways with it. (Smooth noise on three planes: cells of a grid showed as squares.)
      vec3 q = vLocal.xyz / uLook.w + vSeed;
      float clumps = lrNoise(q.xy) + lrNoise(q.yz + 17.3) + lrNoise(q.zx + 31.7);
      float leaves = lrNoise(q.xy * 2.9 + 5.0) + lrNoise(q.yz * 2.9 + 9.0) + lrNoise(q.zx * 2.9 + 13.0);
      float leafy = (clumps + 0.6 * leaves) / 4.8;
      if (leafy > 0.4 + 0.75 * abs(dot(n, toEye))) discard;
      albedo *= 0.5 + leafy;
    } else {
      // Bark: streaked along the limb, blotched.
      albedo *= 0.75 + 0.5 * lrNoise(vec2(atan(vLocal.z, vLocal.x) * 5.0 + vSeed, vLocal.y * 9.0)) * lrNoise(vLocal.xz * 40.0 + vLocal.y * 3.0);
    }
  }
  // Thin things (blades, leaves, fins) glow when the sun is behind them.
  float sun = mix(lrSaturate(facing), 0.35 + 0.65 * abs(facing), uLook.x) + uLook.z * lrSaturate(-facing);
  // Under water the sunlight has come down through 'water' metres of sea, and the waves over it have gathered
  // it into the same dancing net that lies on the sand beside it.
  vec3 open = max(uSunE * lrSaturate(uSunDir.y) + uSkyE, vec3(1e-4));
  if (water > 0.02 && vFade > 0.2) sun *= lrCausticsHere(vRel.xz, water);
  vec3 light = uSunE * sun * lrSunThrough(lrCloudShadow(uCamXZ + vRel.xz), vRel, n) + uSkyE * (0.55 + 0.45 * n.y) + open * 0.12 * (0.5 - 0.5 * n.y);
  if (water > 0.0) outColor = vec4(albedo * light / open, water);
  else outColor = vec4(albedo * light / PI + uLook.y * uSunE * pow(lrSaturate(dot(reflect(-toEye, n), uSunDir)), 60.0) * 0.05, -1000.0);
}`;

/**
 * @param {object} o
 * @param {THREE.BufferGeometry} o.geometry  position, color, and optionally aBend (0..1)
 * @param {number} o.cell  metres between things   @param {number} o.grid  cells across the lattice (even)
 * @param {string} o.rule  GLSL setting `keep` (0..1) from wxz, ground, water, shore, benthic, land, h (hashes), vWeights-free
 * @param {string} [o.move]  GLSL changing p, colour (uses t, bend, h, water, size, wxz)
 * @param {[number, number]} [o.size]  scale range   @param {number} [o.lift]  metres above the ground
 * @param {number} [o.seed]   @param {object} [o.look]  { twoSided, gloss, through, leaf: size of a leaf in metres (foliage and bark) }
 * @param {boolean} [o.casts]  casts a shadow
 * @param {object} textures  { benthic, land }   @param {number} shadowTaps
 */
export class Scatter {
  constructor({ geometry, cell, grid, rule, move = '', size = [1, 1], lift = 0, seed = 1, sway = 0, look = {}, casts = false }, textures, shadowTaps = 4) {
    this.cell = cell; this.grid = grid;
    const g = new THREE.InstancedBufferGeometry();
    g.index = geometry.index;
    for (const name of Object.keys(geometry.attributes)) g.setAttribute(name, geometry.attributes[name]);
    if (!g.attributes.aBend) g.setAttribute('aBend', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    const cells = new Float32Array(grid * grid * 2);
    for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) { cells[(j * grid + i) * 2] = i - grid / 2; cells[(j * grid + i) * 2 + 1] = j - grid / 2; }
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    g.instanceCount = grid * grid;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: vertexShader(rule, move), fragmentShader, vertexColors: true, side: THREE.DoubleSide, defines: { LR_SHADOW_TAPS: shadowTaps },
      uniforms: uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...WAVE_UNIFORMS, 'uWaveHere', ...CHUNK_UNIFORMS.cloudShadow, ...CHUNK_UNIFORMS.shadow], {
        tBenthic: { value: textures.benthic }, tLand: { value: textures.land },
        uLattice: { value: new THREE.Vector4() }, uKind: { value: new THREE.Vector4(cell, grid / 2, seed * 13.7, sway) },
        uSize: { value: new THREE.Vector4(size[0], size[1], lift, 0) }, uLook: { value: new THREE.Vector4(look.twoSided ? 1 : 0, look.gloss || 0, look.through || 0, look.leaf || 0) },
      }),
    });
    /** The same thing drawn into the shadow map (same vertex shader, so shadows sway with what casts them), or null. */
    this.caster = casts ? new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: vertexShader(rule, move), fragmentShader: casterFragment, vertexColors: true, side: THREE.DoubleSide, defines: { LR_CASTER: 1 },
      uniforms: { ...uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...WAVE_UNIFORMS, ...CASTER_UNIFORMS]),
        tBenthic: this.material.uniforms.tBenthic, tLand: this.material.uniforms.tLand, uLattice: this.material.uniforms.uLattice, uKind: this.material.uniforms.uKind, uSize: this.material.uniforms.uSize },
    }) : null;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
    /** Things further than this from the eye are not drawn (metres). */
    this.reach = cell * grid / 2;
  }

  /** @param {{x: number, y: number, z: number}} eye */
  update(eye) {
    const c = this.cell, i = Math.floor(eye.x / c), j = Math.floor(eye.z / c), wrap = v => ((v % 4096) + 4096) % 4096;
    this.material.uniforms.uLattice.value.set(wrap(i), wrap(j), i * c - eye.x, j * c - eye.z);
    // (From high up there is nothing this small to see.)
    this.mesh.visible = eye.y < this.reach * 1.5 + 30;
  }
}

/** Collects triangles with a colour and a "bend" per vertex; a small sibling of landmarks.js's MeshBuilder. */
export class Shape {
  constructor() { this.pos = []; this.col = []; this.bend = []; }
  tri(a, b, c, color, bends = [0, 0, 0]) { this.pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) { this.col.push(...(Array.isArray(color[0]) ? color[i] : color)); this.bend.push(bends[i]); } }
  quad(a, b, c, d, color, bends = [0, 0, 0, 0]) {
    const col = Array.isArray(color[0]) ? color : [color, color, color, color];
    this.tri(a, b, c, [col[0], col[1], col[2]], [bends[0], bends[1], bends[2]]); this.tri(a, c, d, [col[0], col[2], col[3]], [bends[0], bends[2], bends[3]]);
  }
  /** A squashed ball: rings of quads. `colour(u, v)` may vary over it (u round, v bottom to top, both 0..1). */
  ball(cx, cy, cz, rx, ry, rz, rings, sides, colour, bend = 0, from = 0, to = 1) {
    const at = (u, v) => { const a = u * 2 * Math.PI, b = (v - 0.5) * Math.PI; return [cx + Math.cos(a) * Math.cos(b) * rx, cy + Math.sin(b) * ry, cz + Math.sin(a) * Math.cos(b) * rz]; };
    const col = typeof colour === 'function' ? colour : () => colour;
    for (let r = 0; r < rings; r++) for (let s = 0; s < sides; s++) {
      const u0 = s / sides, u1 = (s + 1) / sides, v0 = from + (to - from) * r / rings, v1 = from + (to - from) * (r + 1) / rings;
      this.quad(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), [col(u0, v0), col(u1, v0), col(u1, v1), col(u0, v1)], [bend, bend, bend, bend]);
    }
  }
  /** A tube along a list of points with a radius at each; bends per point optional. */
  tube(points, radii, sides, color, bends = null) {
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k], b = points[k + 1], dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...dir) || 1;
      const up = Math.abs(dir[1] / len) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = [dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]], ul = Math.hypot(...u) || 1;
      const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]], vl = Math.hypot(...v) || 1;
      const ring = (p, r, s) => { const t = s / sides * 2 * Math.PI, c = Math.cos(t) * r, d = Math.sin(t) * r; return [p[0] + u[0] / ul * c + v[0] / vl * d, p[1] + u[1] / ul * c + v[1] / vl * d, p[2] + u[2] / ul * c + v[2] / vl * d]; };
      const b0 = bends ? bends[k] : 0, b1 = bends ? bends[k + 1] : 0;
      for (let s = 0; s < sides; s++) this.quad(ring(a, radii[k], s), ring(a, radii[k], s + 1), ring(b, radii[k + 1], s + 1), ring(b, radii[k + 1], s), color, [b0, b0, b1, b1]);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBend', new THREE.Float32BufferAttribute(this.bend, 1));
    return g;
  }
}
