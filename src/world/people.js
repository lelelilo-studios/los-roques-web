// Other people on the beaches: the same jointed figure as your own body (bodyshape.js), each with their own
// colours and height. They stand at ease, shifting their weight and looking about, or stroll a few metres up
// and down the water's edge. Only those near you are re-posed (thirty times a second); the rest hold still.
import { Body } from './body.js';

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
      // Up and down the shore: a triangle wave of position, turning round at each end over a second.
      const w = s.stroll, lap = 2 * w.reach / w.speed, u = ((t + s.beat) / lap) % 2, back = u > 1, along = (back ? 2 - u : u) * 2 * w.reach - w.reach;
      const toEnd = Math.min(back ? u - 1 : u, back ? 2 - u : 1 - u) * lap, turn = Math.min(1, toEnd / 1.0);     // seconds from the nearer end
      p.x = s.x + w.dir[0] * along; p.z = s.z + w.dir[1] * along;
      const ahead = Math.atan2(w.dir[0], -w.dir[1]) + (back ? Math.PI : 0);
      // (Coming up to an end they slow and swing round the seaward way.)
      const near = (back ? u - 1 : u) < 0.5 ? -1 : 1;
      p.yaw = ahead + (1 - turn) * near * Math.PI / 2 * (back ? 1 : -1);
      p.body.pose({ phase: (t + s.beat) * w.speed / 0.72 * Math.PI, stride: 0.2 + 0.6 * turn * w.speed / 1.4, eye: 1.65, colours: s.colours });
    } else {
      // Standing: weight shifting from one leg to the other, the body turning a little to look about.
      p.yaw = s.yaw + 0.3 * Math.sin(t * 0.11 + s.beat) + 0.1 * Math.sin(t * 0.37 + 2 * s.beat);
      p.body.pose({ phase: s.beat + 0.45 * Math.sin(t * 0.23 + s.beat), stride: 0.15, eye: 1.65, look: -0.15 + 0.15 * Math.sin(t * 0.17 + s.beat), colours: s.colours });
    }
  }

  /** @param {{x: number, y: number, z: number}} eye  @param {number} t seconds */
  update(eye, t) {
    this.frame++;
    this.list.forEach((p, i) => {
      const d = Math.hypot(p.x - eye.x, p.z - eye.z), seen = d < 700;      // (beyond that a person is a couple of pixels)
      p.body.mesh.visible = p.body.headMesh.visible = seen;
      if (!seen) return;
      // Those within a few steps move every frame, those further off every third; the far ones once in a
      // while, so that a stroller is not left frozen mid-stride for good.
      const due = !p.posed || (d < 10 ? true : d < NEAR ? (i + this.frame) % 3 === 0 : (i + this.frame) % 240 === 0);
      if (due) { this.pose(p, t); p.posed = true; p.feet = this.ground.heightAt(p.x, p.z); }
      for (const m of [p.body.mesh, p.body.headMesh]) {
        m.position.set(p.x - eye.x, p.feet, p.z - eye.z); m.rotation.set(0, -p.yaw, 0); m.scale.setScalar(p.spec.scale);
        m.updateMatrix(); m.matrixWorld.copy(m.matrix);
      }
    });
  }
}
