// Other people on the beaches: the same jointed figure as your own body (bodyshape.js), each with their own
// colours and height. They stand at ease, shifting their weight and looking about, or stroll a few metres up
// and down the water's edge. Only those near you are re-posed (thirty times a second); the rest hold still.
import { Body } from './body.js';
import { strollAt } from './bodyshape.js';

const NEAR = 45;      // metres within which people move

export class People {
  /**
   * @param {object[]} specs  from world/beach.js: { x, z, yaw, scale, beat, colours, stroll: { dir, reach, speed } | null }
   * @param {{heightAt: (x: number, z: number) => number}} ground   @param {THREE.Material} material  smooth-shaded object material
   */
  constructor(specs, ground, material) {
    this.ground = ground; this.frame = 0;
    this.list = specs.map(spec => {
      const body = new Body(material);
      body.mesh.visible = body.headMesh.visible = true;
      const p = { spec, body, x: spec.x, z: spec.z, yaw: spec.yaw, posed: false };
      this.pose(p, 0);
      return p;
    });
    /** Everything to add to the scene (two meshes a person: below the neck, and the head). */
    this.meshes = this.list.flatMap(p => [p.body.mesh, p.body.headMesh]);
  }

  /** Where someone is and how they hold themselves at time t. */
  pose(p, t) {
    const s = p.spec;
    if (s.stroll) {
      const g = strollAt(s.stroll, s.x, s.z, t + s.beat);
      p.x = g.x; p.z = g.z; p.yaw = g.yaw;
      p.body.pose({ phase: g.phase, stride: g.stride, eye: 1.65, colours: s.colours });
    } else {
      // Standing: weight shifting from one leg to the other, the body turning a little to look about.
      p.yaw = s.yaw + 0.3 * Math.sin(t * 0.11 + s.beat) + 0.1 * Math.sin(t * 0.37 + 2 * s.beat);
      p.body.pose({ phase: s.beat + 0.45 * Math.sin(t * 0.23 + s.beat), stride: 0.15, eye: 1.65, look: -0.15 + 0.15 * Math.sin(t * 0.17 + s.beat), colours: s.colours });
    }
  }

  /** @param {{x: number, y: number, z: number}} eye  @param {number} t seconds  @param {boolean} still  a frozen clock (test pictures): everyone near is posed */
  update(eye, t, still = false) {
    this.frame++;
    this.list.forEach((p, i) => {
      const d = Math.hypot(p.x - eye.x, p.z - eye.z), seen = d < 700;      // (beyond that a person is a couple of pixels)
      p.body.mesh.visible = p.body.headMesh.visible = seen;
      if (!seen) return;
      // Those within a few steps move every frame, those further off every third; the far ones once in a
      // while, so that a stroller is not left frozen mid-stride for good.
      const due = !p.posed || (d < 10 || (still && d < NEAR) ? true : d < NEAR ? (i + this.frame) % 3 === 0 : (i + this.frame) % 240 === 0);
      if (due) { this.pose(p, t); p.posed = true; p.feet = this.ground.heightAt(p.x, p.z); }
      for (const m of [p.body.mesh, p.body.headMesh]) {
        m.position.set(p.x - eye.x, p.feet, p.z - eye.z); m.rotation.set(0, -p.yaw, 0); m.scale.setScalar(p.spec.scale);
        m.updateMatrix(); m.matrixWorld.copy(m.matrix);
      }
    });
  }
}
