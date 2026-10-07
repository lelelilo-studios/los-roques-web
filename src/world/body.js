// Your own body: what you see when you look down, and what casts your shadow. The shape and its pose are in
// bodyshape.js; this wraps them in two meshes that are refilled every frame (no model file, no skinning).
import * as THREE from 'three';
import { BODY_VERTICES, HEAD_VERTICES, Tubes, poseBody } from './bodyshape.js';

export class Body {
  /** @param {THREE.Material} material  an object material with smooth normals (landmarks.js) */
  constructor(material) {
    const mesh = vertices => {
      const t = new Tubes(vertices), g = new THREE.BufferGeometry();
      for (const [name, array] of [['position', t.pos], ['normal', t.nor], ['color', t.col]]) g.setAttribute(name, new THREE.BufferAttribute(array, 3).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.Mesh(g, material);
      m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
      return { t, m };
    };
    this.body = mesh(BODY_VERTICES); this.head = mesh(HEAD_VERTICES);
    /** Everything below the neck: drawn, and casting. */
    this.mesh = this.body.m;
    /** The head: only ever drawn into the shadow map (the eye is inside it). */
    this.headMesh = this.head.m;
    this.pose({ phase: 0, stride: 0, eye: 1.65 });
  }

  /** See poseBody: { phase, stride, eye, look }. */
  pose(p) {
    poseBody(this.body.t, this.head.t, p);
    for (const { t, m } of [this.body, this.head]) {
      const a = m.geometry.attributes;
      a.position.needsUpdate = true; a.normal.needsUpdate = true; a.color.needsUpdate = true;
      m.geometry.setDrawRange(0, t.n);
    }
  }

  /** Places both meshes: `feet` is the height of the ground under you, `yaw` the walker's heading (radians). */
  place(feet, yaw) {
    for (const m of [this.mesh, this.headMesh]) { m.position.set(0, feet, 0); m.rotation.set(0, -yaw, 0); m.updateMatrix(); m.matrixWorld.copy(m.matrix); }
  }
}
