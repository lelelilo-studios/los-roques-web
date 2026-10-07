// Geometry clipmap: nested square rings of grid blocks around a focus point, each level twice as coarse.
// One instanced draw; the vertex shader places a block from `aBlock` and reads the height itself.
//
// Level l has cells of size s = s0 * 2^l and covers 4x4 blocks (each `quads` x `quads` cells) centred on the focus
// snapped to its 2s lattice. The next finer level covers its middle; the coarse level's fragments inside that
// footprint are discarded (`aHole`), and each level's outer vertices slide onto the next level's lattice
// (the morph in clipmapVertex), so there are no cracks and no skirts.
import * as THREE from 'three';

const _box = new THREE.Box3();

export class Clipmap {
  /**
   * @param {object} o
   * @param {number} o.quads      cells per block side
   * @param {number} o.minCell    finest cell size in metres
   * @param {number} o.maxCell    coarsest cell size in metres
   * @param {[number, number]} o.yRange  lowest and highest surface height, for culling
   */
  constructor({ quads = 32, minCell = 0.25, maxCell = 512, yRange = [-70, 140] } = {}) {
    Object.assign(this, { quads, minCell, maxCell, yRange });
    const n = quads + 1, pos = new Float32Array(n * n * 3), idx = new Uint32Array(quads * quads * 6);
    for (let j = 0, p = 0; j < n; j++) for (let i = 0; i < n; i++) { pos[p++] = i; pos[p++] = j; pos[p++] = 0; }
    for (let j = 0, p = 0; j < quads; j++) {
      for (let i = 0; i < quads; i++) {
        const a = j * n + i, b = a + n;     // b is one row further south
        idx[p++] = a; idx[p++] = b; idx[p++] = a + 1; idx[p++] = a + 1; idx[p++] = b; idx[p++] = b + 1;   // facing up
      }
    }
    this.maxBlocks = 16 * 14;
    this.blocks = new THREE.InstancedBufferAttribute(new Float32Array(this.maxBlocks * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.holes = new THREE.InstancedBufferAttribute(new Float32Array(this.maxBlocks * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geometry.setAttribute('aBlock', this.blocks);
    this.geometry.setAttribute('aHole', this.holes);
    this.geometry.instanceCount = 0;
    this.stats = { levels: 0, blocks: 0, cell: minCell };
  }

  /**
   * Rebuilds the block list for this frame.
   * @param {{x: number, z: number}} cam    true camera position (east, south)
   * @param {{x: number, z: number}} focus  true position the rings are centred on
   * @param {number} range                  distance from the eye to the focus: sets the finest cell
   * @param {THREE.Frustum} frustum         in render space (camera at x = z = 0)
   * @param {{x: number, z: number, w: number, h: number}|null} rect  only blocks touching this world rectangle are kept
   * @param {number} drop                   extra room below yRange for the Earth-curvature drop, metres
   */
  update(cam, focus, range, frustum, rect = null, drop = 0) {
    const { quads, blocks, holes } = this;
    const s0 = Math.min(this.maxCell, Math.max(this.minCell, this.minCell * 2 ** Math.floor(Math.log2(Math.max(range, 1e-3) / (this.minCell * 64)))));
    let count = 0, levels = 0, finer = null;
    for (let s = s0; s <= this.maxCell && count + 16 <= this.maxBlocks; s *= 2, levels++) {
      const cx = Math.round(focus.x / (2 * s)) * 2 * s, cz = Math.round(focus.z / (2 * s)) * 2 * s, half = 2 * quads * s;
      for (let by = 0; by < 4; by++) {
        for (let bx = 0; bx < 4; bx++) {
          const x0 = cx + (bx - 2) * quads * s, z0 = cz + (by - 2) * quads * s, x1 = x0 + quads * s, z1 = z0 + quads * s;
          if (finer && x0 >= finer.x0 && x1 <= finer.x1 && z0 >= finer.z0 && z1 <= finer.z1) continue;      // fully covered by the finer level
          if (rect && (x1 < rect.x || x0 > rect.x + rect.w || z1 < rect.z || z0 > rect.z + rect.h)) continue;
          // One cell of slack: morphing moves vertices by up to a cell.
          _box.min.set(x0 - cam.x - s, this.yRange[0] - drop, z0 - cam.z - s);
          _box.max.set(x1 - cam.x + s, this.yRange[1], z1 - cam.z + s);
          if (frustum && !frustum.intersectsBox(_box)) continue;
          blocks.setXYZW(count, x0 - cam.x, z0 - cam.z, s, half);
          // Hole = the finer level's footprint, relative to the camera (half-size 0: none).
          if (finer) holes.setXYZW(count, (finer.x0 + finer.x1) / 2 - cam.x, (finer.z0 + finer.z1) / 2 - cam.z, (finer.x1 - finer.x0) / 2, 0);
          else holes.setXYZW(count, 0, 0, 0, 0);
          count++;
        }
      }
      finer = { x0: cx - half, x1: cx + half, z0: cz - half, z1: cz + half };
    }
    blocks.needsUpdate = holes.needsUpdate = true;
    blocks.clearUpdateRanges(); holes.clearUpdateRanges();
    blocks.addUpdateRange(0, count * 4); holes.addUpdateRange(0, count * 4);
    this.geometry.instanceCount = count;
    this.stats = { levels, blocks: count, cell: s0 };
  }
}

/**
 * GLSL for a clipmap vertex shader: `vec2 lrClipmapRel(out float cell)` returns the vertex position relative to the
 * camera (east, south) and the cell size to sample the ground with. Needs `uFocusRel` (focus - camera, xz).
 */
export const clipmapVertex = /* glsl */`
in vec4 aBlock;   // xy = block origin relative to the camera, z = cell size, w = half-width of the level
in vec4 aHole;    // xy = centre of the finer level relative to the camera, z = its half-width (0 = none)
uniform vec2 uFocusRel;
flat out vec3 vHole;
vec2 lrClipmapRel(out float cell) {
  float s = aBlock.z;
  vec2 rel = aBlock.xy + position.xy * s;
  // Morph: towards the edge of the level, odd vertices slide onto the next level's (2s) lattice.
  vec2 d = abs(rel - uFocusRel) / aBlock.w;
  float m = clamp((max(d.x, d.y) - 0.78) / 0.16, 0.0, 1.0);
  rel -= fract(position.xy * 0.5) * 2.0 * s * m;
  cell = s * (1.0 + m);
  vHole = aHole.xyz;
  return rel;
}
`;

/** GLSL for the fragment shader: `lrClipmapDiscard(rel)` drops fragments the finer level draws. */
export const clipmapFragment = /* glsl */`
flat in vec3 vHole;
void lrClipmapDiscard(vec2 rel) {
  vec2 d = abs(rel - vHole.xy);
  if (vHole.z > 0.0 && max(d.x, d.y) < vHole.z * 0.999) discard;
}
`;
