// Your own body: what you see when you look down, and what casts your shadow. The shape and its pose are in
// bodyshape.js; this wraps them in two meshes that are refilled every frame (no model file, no skinning).
import * as THREE from 'three';
import { Solver } from './bodyshape.js';

export class Body {
  /**
   * @param {THREE.Material} material  an object material with smooth normals (landmarks.js)
   * @param {boolean} detail  hands with fingers, feet with toes (your own body, seen from a hand's breadth away)
   */
  constructor(material, detail = false) {
    this.detail = detail;
    // (The solving is the solver's own, with its buffers: bodyshape.js Solver. Here its buffers are two meshes.)
    this.solver = new Solver(detail);
    const mesh = t => {
      const g = new THREE.BufferGeometry();
      for (const [name, array] of [['position', t.pos], ['normal', t.nor], ['color', t.col]]) g.setAttribute(name, new THREE.BufferAttribute(array, 3).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.Mesh(g, material);
      m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
      return { t, m };
    };
    this.body = mesh(this.solver.t); this.head = mesh(this.solver.h);
    /** Everything below the neck: drawn, and casting. */
    this.mesh = this.body.m;
    /** The head: only ever drawn into the shadow map (the eye is inside it). */
    this.headMesh = this.head.m;
    this.pose({ phase: 0, stride: 0, eye: 1.65 });
  }

  /** Walking: see poseBody ({ phase, stride, eye, look }). Swimming: { swim: true, stroke, under } (see poseSwim). */
  pose(p) {
    /** Where the joints are in the body's own frame (see poseBody / poseSwim). */
    // (`seat`: you are part of the way, seat.k, between this pose on your feet and that pose sitting.)
    this.joints = this.solver.pose(p);
    for (const { t, m } of [this.body, this.head]) {
      const a = m.geometry.attributes;
      a.position.needsUpdate = true; a.normal.needsUpdate = true; a.color.needsUpdate = true;
      m.geometry.setDrawRange(0, t.n);
    }
  }

  /**
   * Places both meshes. Walking: `y` is the height of the ground under you. Swimming: the height of the eye,
   * and `pitch` (radians above the horizon) tips the body along the way you look when dived.
   * `yaw` is the walker's heading (radians).
   */
  /** Stands the body with its feet at height y, heading `yaw`. `side`: how far the eye has swung to its right of the body's own line (the head sways over each foot; the feet do not). */
  place(x, y, z, yaw, pitch = 0) {
    for (const m of [this.mesh, this.headMesh]) { m.position.set(x, y, z); m.rotation.set(pitch, -yaw, 0, 'YXZ'); m.updateMatrix(); m.matrixWorld.copy(m.matrix); }
  }
}
