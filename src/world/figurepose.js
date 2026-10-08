// Turns what the pose solver decides (bodyshape.js: where the hips, knees, ankles, shoulders, elbows and wrists
// are, how each foot is tipped and each hand held) into where every bone of the real body is (figure.js).
//
// Plain arrays, no three: it is measured in a test. Each bone gets a 3 x 4 matrix (rows, 12 numbers) taking a
// point of the body at rest to where the bone carries it: a rotation R about the bone's head and the head's new
// place. A bone that nothing drives moves with its parent. Limbs are aimed, not rotated joint by joint: the
// thigh from the hip to the knee, the shin from the knee to the ankle, both turned so that the knee's hinge
// lies across the plane of the leg; arms likewise, the hand's turn spread up the forearm.
import { reach } from './bodyshape.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** A frame from a direction and a hint for what is square to it: columns x = d, z = the hint made square, y = z x x. */
function frame(d, hint) {
  const x = unit(d), k = dot(hint, x);
  let z = [hint[0] - x[0] * k, hint[1] - x[1] * k, hint[2] - x[2] * k];
  if (len(z) < 1e-5) z = Math.abs(x[1]) < 0.9 ? cross(x, [0, 1, 0]) : cross(x, [1, 0, 0]);
  z = unit(z);
  return [x, cross(z, x), z];
}
/** The rotation (3 x 3, rows) that takes frame a to frame b. */
function between(a, b) {
  const R = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] = b[0][r] * a[0][c] + b[1][r] * a[1][c] + b[2][r] * a[2][c];
  return R;
}
const aim = (d0, n0, d1, n1) => between(frame(d0, n0), frame(d1, n1));
const mul = (A, B) => { const R = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return R; };
const turn = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
/** A turn by `angle` about the unit axis k. */
function about(k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c, [x, y, z] = k;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

const transpose = R => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
/** The part k (0..1) of the turn R: the same axis, that much of the angle. */
function fraction(R, k) {
  const angle = Math.acos(Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2)));
  if (angle < 1e-5) return IDENTITY;
  const axis = [R[7] - R[5], R[2] - R[6], R[3] - R[1]];
  return len(axis) < 1e-9 ? IDENTITY : about(unit(axis), angle * k);
}

export class FigureRig {
  /** @param {{bones: {name: string, parent: number, head: number[], tail: number[]}[], eyeHeight: number}} info  body.json */
  constructor(info) {
    this.bones = info.bones; this.eye = info.eyeHeight;
    this.id = new Map(info.bones.map((b, i) => [b.name, i]));
    this.matrices = new Float32Array(info.bones.length * 12);
    this.R = info.bones.map(() => IDENTITY);
    // (Which frame each bone's matrix was last worked out in.)
    this.stamp = new Int32Array(info.bones.length).fill(-1); this.frame = 0;
    const head = name => this.bones[this.need(name)].head;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    this.hip0 = mid(head('upperleg01.L'), head('upperleg01.R')); this.chest0 = mid(head('upperarm01.L'), head('upperarm01.R'));
    // Each side: our left (-x, the solver's first of every pair) is her left.
    this.sides = ['L', 'R'].map((s, i) => {
      const side = i ? 1 : -1, H = head(`upperleg01.${s}`), K = head(`lowerleg01.${s}`), A = head(`foot.${s}`), S = head(`upperarm01.${s}`), E = head(`lowerarm01.${s}`), W = head(`wrist.${s}`);
      // The hand at rest: the way it points, across it towards the thumb, and the way its palm faces.
      const f = unit(sub(head(`finger3-1.${s}`), W)), across = sub(head(`finger2-1.${s}`), head(`finger5-1.${s}`)), k = dot(across, f);
      const Ax = unit([across[0] - f[0] * k, across[1] - f[1] * k, across[2] - f[2] * k]), N = cross(Ax, f).map(v => v * side);
      const fingers = [2, 3, 4, 5].map(n => [1, 2, 3].map(j => {
        const b = this.bones[this.need(`finger${n}-${j}.${s}`)], d = unit(sub(b.tail, b.head));
        return { bone: this.id.get(b.name), curl: Math.atan2(dot(d, N), dot(d, f)) };          // (how far it is curled towards the palm at rest)
      }));
      return {
        side, H, K, A, S, E, W, f, Ax, N, fingers, thigh: len(sub(K, H)), shin: len(sub(A, K)), upper: len(sub(E, S)), fore: len(sub(W, E)),
        armPlane: unit(cross(sub(E, S), sub(W, E))),
        bone: Object.fromEntries(['upperleg01', 'lowerleg01', 'foot', 'clavicle', 'shoulder01', 'upperarm01', 'lowerarm01', 'lowerarm02', 'wrist'].map(n => [n, this.need(`${n}.${s}`)])),
        toes: this.bones.map((b, j) => (new RegExp(`^toe\\d-1\\.${s}$`).test(b.name) ? j : -1)).filter(j => j >= 0),
      };
    });
    this.head = this.need('head'); this.neck = ['neck01', 'neck02', 'neck03'].map(n => this.need(n)); this.trunk = this.need('root');
    this.spine = ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'].map(n => this.need(n));        // from the hips up to the chest
  }
  need(name) { const i = this.id.get(name); if (i === undefined) throw new Error(`the body has no bone ${name}`); return i; }

  /** What the solver should take this body's proportions to be (bodyshape.js: setProportions). */
  get proportions() {
    const [L] = this.sides;
    return {
      stand: this.eye, crouchBy: 0.9 * this.eye / 1.65, eyeToShoulder: this.eye - this.chest0[1], back: this.chest0[2] - 0.02, thigh: L.thigh, shin: L.shin, ankle: L.A[1],
      torso: this.chest0[1] - this.hip0[1], hip: Math.abs(L.H[0]), shoulder: Math.abs(L.S[0]), upperArm: L.upper, forearm: L.fore,
    };
  }

  /** Bone b turns by R about its head, which goes to `at`. */
  drive(b, R, at) {
    const h = this.bones[b].head, o = b * 12, m = this.matrices;
    for (let r = 0; r < 3; r++) { m[o + r * 4] = R[r * 3]; m[o + r * 4 + 1] = R[r * 3 + 1]; m[o + r * 4 + 2] = R[r * 3 + 2]; m[o + r * 4 + 3] = at[r] - (R[r * 3] * h[0] + R[r * 3 + 1] * h[1] + R[r * 3 + 2] * h[2]); }
    this.R[b] = R; this.stamp[b] = this.frame;
  }
  /** Makes sure bone b's matrix is this frame's: a bone nothing drives moves with its parent (twist bones, the bones of the palm, the face, the further toe joints). */
  current(b) {
    if (this.stamp[b] === this.frame) return;
    const p = this.bones[b].parent >= 0 ? this.bones[b].parent : this.trunk;
    this.current(p);
    this.matrices.copyWithin(b * 12, p * 12, p * 12 + 12); this.R[b] = this.R[p]; this.stamp[b] = this.frame;
  }
  /** Where a point of the body at rest is carried by bone b. */
  carry(b, p) { this.current(b); const o = b * 12, m = this.matrices; return [m[o] * p[0] + m[o + 1] * p[1] + m[o + 2] * p[2] + m[o + 3], m[o + 4] * p[0] + m[o + 5] * p[1] + m[o + 6] * p[2] + m[o + 7], m[o + 8] * p[0] + m[o + 9] * p[1] + m[o + 10] * p[2] + m[o + 11]]; }
  /** Bone b turns by R (in all) about its head, which stays where its parent has carried it. */
  hinge(b, R) { this.drive(b, R, this.carry(this.bones[b].parent, this.bones[b].head)); }

  /**
   * Hand i (0 left, 1 right) as it is posed now, in the body's frame: { wrist, bases: where the four fingers
   * (index to little) leave the palm, knuckles: their middle, centre: the middle of the palm, half: half the
   * palm's length, f: the way the hand points, N: the way the palm faces, A: across it towards the thumb,
   * us: how far along A each finger's root is from the centre }.
   */
  hand(i) {
    const s = this.sides[i], L = i ? 'R' : 'L', at = name => { const b = this.need(name); return this.carry(b, this.bones[b].head); };
    const wrist = at(`wrist.${L}`), bases = [2, 3, 4, 5].map(n => at(`finger${n}-1.${L}`));
    const knuckles = [0, 1, 2].map(c => (bases[0][c] + bases[1][c] + bases[2][c] + bases[3][c]) / 4), f = unit(sub(knuckles, wrist));
    const palm = turn(this.R[s.bone.wrist], s.N), k = dot(palm, f), N = unit([palm[0] - f[0] * k, palm[1] - f[1] * k, palm[2] - f[2] * k]), A = cross(f, N).map(v => v * s.side);
    const centre = [0, 1, 2].map(c => (wrist[c] + knuckles[c]) / 2);
    return { wrist, bases, knuckles, centre, half: len(sub(knuckles, wrist)) / 2, f, N, A, us: bases.map(b => dot(sub(b, centre), A)) };
  }

  /**
   * @param {object} j  the solver's joints (poseBody or poseSwim)
   * @param {number} eye  the eye's height in the solver's frame (above the feet walking; 0 swimming)
   * @returns {Float32Array} 12 numbers a bone
   */
  pose(j, eye) {
    this.frame++;
    const chest = j.shoulder || j.chest, across = [1, 0, 0];
    // The trunk: hips where the solver has them, leaning the way it leans. The hips turn with the stride (the
    // hip of the leading leg forward) and the chest against them; the chest also goes a little way round with
    // the head. The spine takes the difference, a part at each of its five joints.
    const lean = aim(sub(this.chest0, this.hip0), across, sub(chest, j.hip), across), trunk = this.trunk, along = unit(sub(chest, j.hip));
    const low = j.pelvis || 0, high = -0.6 * low - 0.3 * (j.headTurn || 0), Rp = mul(about(along, low), lean), Rt = mul(about(along, high), lean);
    this.drive(trunk, Rp, add(j.hip, turn(Rp, sub(this.bones[trunk].head, this.hip0))));
    this.spine.forEach((b, k) => this.hinge(b, mul(about(along, low + (high - low) * (k + 1) / 5), lean)));
    const carried = p => this.carry(trunk, p), twisted = about(along, high);

    for (const [i, s] of this.sides.entries()) {
      // The leg: from where the trunk has put the hip joint to the solver's ankle, the knee bending the way it bends there.
      const H = carried(s.H), ankle = j.ankles[i].slice(), kneeTo = sub(j.knees[i], [(H[0] + ankle[0]) / 2, (H[1] + ankle[1]) / 2, (H[2] + ankle[2]) / 2]);
      const K = reach(H, ankle, s.thigh, s.shin, len(kneeTo) > 1e-4 ? kneeTo : [0, 0, -1]);
      let hinge = cross(sub(K, H), sub(ankle, K));
      hinge = len(hinge) > 1e-4 ? unit(hinge) : [-1, 0, 0];
      this.drive(s.bone.upperleg01, aim(sub(s.K, s.H), [-1, 0, 0], sub(K, H), hinge), H);
      this.hinge(s.bone.lowerleg01, aim(sub(s.A, s.K), [-1, 0, 0], sub(ankle, this.carry(s.bone.upperleg01, s.K)), hinge));
      // The foot keeps level, tipped by the solver (toes up as the heel lands, heel up as you push off); with the
      // heel up the toes stay flat on the ground.
      // (Turned the way it was put down: `out` from straight ahead, where at rest it is turned out by its own share.)
      // (Swimming there is no ground to be level with: the foot goes with the shin, pointed along it as the legs
      // trail and kick, and drawn up square to it as the knees come up for the next kick. It used to be tipped
      // by a fixed angle from where it is standing: on a swimmer lying flat, that is toes stuck up in the air.)
      const foot = j.feet ? j.feet[i] : { pitch: -0.9 }, Rf = !j.feet ? mul(about(hinge, 1.1 - 1.25 * (j.drawn || 0)), this.R[s.bone.lowerleg01])
        : foot.out === undefined ? about([1, 0, 0], foot.pitch) : mul(about([0, 1, 0], -(foot.out - s.side * 0.12)), about([1, 0, 0], foot.pitch));
      this.hinge(s.bone.foot, Rf);
      // (With the heel up the toes stay flat on the ground; otherwise they go with the foot, and can curl up or grip.)
      const Rtoes = foot.pitch < 0 && j.feet ? (foot.out === undefined ? IDENTITY : about([0, 1, 0], -(foot.out - s.side * 0.12))) : foot.toes ? mul(Rf, about([1, 0, 0], foot.toes)) : Rf;
      for (const t of s.toes) this.hinge(t, Rtoes);

      // The arm: the shoulder joint goes where the solver has it (it comes forward when you reach).
      // (The solver's shoulders go round with the chest.)
      // The shoulder girdle goes with the arm: with the arm hanging, the collar bone slopes down to the shoulder
      // (the body is modelled with its arms held out, where it is level), and the shoulder joint with it.
      const S0 = add(chest, turn(twisted, sub(j.shoulders[i], chest))), hang = unit(sub(j.elbows[i], j.shoulders[i])), down = turn(Rt, [0, -1, 0]);
      const raised = Math.acos(Math.max(-1, Math.min(1, dot(hang, down)))), drop = 0.11 * (1 - Math.min(1, Math.max(0, (raised - 0.25) / 1.1)));
      const Rclav = mul(Rt, about([0, 0, 1], -s.side * drop)), c0 = this.bones[s.bone.clavicle].head;
      this.hinge(s.bone.clavicle, Rclav);
      const S = add(S0, sub(turn(Rclav, sub(s.S, c0)), turn(Rt, sub(s.S, c0)))), wrist = j.wrists[i].slice(), elbowTo = sub(j.elbows[i], [(S[0] + wrist[0]) / 2, (S[1] + wrist[1]) / 2, (S[2] + wrist[2]) / 2]);
      const E = reach(S, wrist, s.upper, s.fore, len(elbowTo) > 1e-4 ? elbowTo : [0, -1, 0.3]);
      let plane = cross(sub(E, S), sub(wrist, E));
      plane = len(plane) > 1e-4 ? unit(plane) : turn(Rt, s.armPlane);
      // (The cap of the shoulder goes a third of the way round with the upper arm: it does not stay out where the arm was.)
      const Rupper = aim(sub(s.E, s.S), s.armPlane, sub(E, S), plane), Rcap = mul(fraction(mul(Rupper, transpose(Rclav)), 0.35), Rclav);
      this.drive(s.bone.shoulder01, Rcap, add(S, turn(Rcap, sub(this.bones[s.bone.shoulder01].head, s.S))));
      this.drive(s.bone.upperarm01, Rupper, S);
      const Rfore = aim(sub(s.W, s.E), s.armPlane, sub(wrist, this.carry(s.bone.upperarm01, s.E)), plane);
      // The hand: the way the solver holds it; without that (swimming), flat along the forearm, palm down.
      const along = unit(sub(wrist, E)), h = j.hands?.[i] || { f: along, N: frame(along, [0, -1, 0])[2], curl: 0.1, spread: 0 };
      const rest = [s.f, s.N, cross(s.f, s.N).map(v => v * s.side)], held = [unit(h.f), h.N, cross(unit(h.f), h.N).map(v => v * s.side)];
      const Rhand = between(rest, held);
      // (The hand's turn about the forearm is shared up the forearm, as the two bones in it do: none at the elbow.)
      const Q = mul(Rhand, [Rfore[0], Rfore[3], Rfore[6], Rfore[1], Rfore[4], Rfore[7], Rfore[2], Rfore[5], Rfore[8]]), v = plane, w = turn(Q, v);
      const k = dot(w, along), flat = [w[0] - along[0] * k, w[1] - along[1] * k, w[2] - along[2] * k], twist = Math.atan2(dot(along, cross(v, flat)), dot(v, flat));
      this.hinge(s.bone.lowerarm01, mul(about(along, 0.15 * twist), Rfore));
      this.hinge(s.bone.lowerarm02, mul(about(along, 0.6 * twist), Rfore));
      this.hinge(s.bone.wrist, Rhand);
      // Fingers: each bone curled towards the palm as far as the solver's hand is, and fanned apart.
      const axis = s.Ax.map(c => c * s.side);
      s.fingers.forEach((finger, n) => {
        const c1 = h.curl * (0.4 + 0.1 * n), want = [c1, c1 + h.curl * 0.7, c1 + h.curl * 1.25], fan = about(s.N.map(c => -c * s.side), (1.5 - n) * 0.13 * (h.spread || 0));
        finger.forEach((part, q) => this.hinge(part.bone, mul(Rhand, mul(about(axis, want[q] - part.curl), fan))));
      });
    }
    // The head stays on the eye (the camera is between its eyes), upright; the neck goes between it and the trunk.
    if (j.eye) {
      // The head: its eye where the solver has yours, turned and nodding as you look; the neck goes from the
      // chest to it, each of its three bones a part of the way round.
      const Rh = mul(about([0, 1, 0], -(j.headTurn || 0)), about([1, 0, 0], j.headNod || 0)), h0 = this.bones[this.head].head, at = add(j.eye, turn(Rh, sub(h0, [0, this.eye, 0])));
      const between = mul(transpose(Rt), Rh);
      this.neck.forEach((b, k) => {
        const w = [0.2, 0.5, 0.8][k], held = add(at, turn(Rh, sub(this.bones[b].head, h0))), hung = this.carry(this.bones[b].parent, this.bones[b].head);
        this.drive(b, mul(Rt, fraction(between, w)), [0, 1, 2].map(c => hung[c] + (held[c] - hung[c]) * w));
      });
      this.drive(this.head, Rh, at);
    } else {
      // (Swimming: the head stays on the eye, upright; the neck goes between it and the trunk.)
      const lift = [0, eye - this.eye, 0];
      this.drive(this.head, IDENTITY, add(this.bones[this.head].head, lift));
      const top = this.neck[2];
      this.drive(top, IDENTITY, add(this.bones[top].head, lift));
      this.current(this.neck[0]);
      { const a = this.neck[0] * 12, b = top * 12, o = this.neck[1] * 12; for (let q = 0; q < 12; q++) this.matrices[o + q] = (this.matrices[a + q] + this.matrices[b + q]) / 2; this.stamp[this.neck[1]] = this.frame; }
    }
    for (let b = 0; b < this.bones.length; b++) this.current(b);
    return this.matrices;
  }
}
