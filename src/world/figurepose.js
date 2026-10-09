// Turns what the pose solver decides (bodyshape.js: where the hips, knees, ankles, shoulders, elbows and wrists
// are, how each foot is tipped and each hand held) into where every bone of the real body is (figure.js).
//
// Plain arrays, no three: it is measured in a test. Each bone gets a 3 x 4 matrix (rows, 12 numbers) taking a
// point of the body at rest to where the bone carries it: a rotation R about the bone's head and the head's new
// place. A bone that nothing drives moves with its parent. Limbs are aimed, not rotated joint by joint: the
// thigh from the hip to the knee, the shin from the knee to the ankle, both turned so that the knee's hinge
// lies across the plane of the leg; arms likewise, the hand's turn spread up the forearm.
import { reach } from './bodyshape.js';
import { HandModel, POSE_LENGTH, fingerAngles, fingerGaps, fitHand, handBones, limitWrist, shoulderTurn, thumbAngles, wristAngles } from './handpose.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// What her forearm and wrist do, in degrees (humanref.js): the drawn hand is held to it whatever it is asked.
const WRIST_LIMITS = { sup: [-75, 85], flex: [-60, 60], dev: [-25, 15] };
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

/**
 * Her back taking a shoulder to what a hand reaches for: what turning her shoulders round costs, and what
 * bending over costs, against leaving the shoulder short (m2 for a radian squared: bending 17 degrees is worth
 * leaving it 2 cm short; the turn is ten times cheaper: it leaves her head where it is).
 */
const BACK_HOLD = [0.0004, 0.004];
/** How nearly straight a working arm is let get before her back is asked to take the shoulder nearer (of its length), unless the solver's own arm is straighter than that. */
const ARM_MOST = 0.96;
/** Rocking over her feet towards a reach: the share of what her back cannot give that her hips take, and how far they go at most (m). */
const ROCK = [0.7, 0.07];
/** How far her shoulders turn for a reach, and how far her back bends for one (rad). */
const BACK_MOST = [0.5, 0.6];

/** Solves the four-by-four A x = b (A is changed). */
function solve4(A, b) {
  const x = b.slice();
  for (let c = 0; c < 4; c++) {
    let best = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[best][c])) best = r;
    [A[c], A[best]] = [A[best], A[c]]; [x[c], x[best]] = [x[best], x[c]];
    if (Math.abs(A[c][c]) < 1e-12) return [0, 0, 0, 0];
    for (let r = c + 1; r < 4; r++) { const k = A[r][c] / A[c][c]; for (let q = c; q < 4; q++) A[r][q] -= k * A[c][q]; x[r] -= k * x[c]; }
  }
  for (let c = 3; c >= 0; c--) { for (let q = c + 1; q < 4; q++) x[c] -= A[c][q] * x[q]; x[c] /= A[c][c]; }
  return x;
}
/** How far a shoulder goes out on its collar bone alone, before her back turns to take it further (m). */
const GIRDLE_GIVE = 0.015;

export class FigureRig {
  /** @param {{bones: {name: string, parent: number, head: number[], tail: number[]}[], eyeHeight: number}} info  body.json */
  constructor(info) {
    this.bones = info.bones; this.eye = info.eyeHeight; this.info = info;
    // Her hands (handpose.js): [left, right]. Where a pose puts each bone of a hand is theirs to say.
    this.models = ['L', 'R'].map(s => new HandModel(info.bones, s)); this.fit = null;
    this.solved = this.models.map(m => m.blank()); this.posed = [new Array(POSE_LENGTH), new Array(POSE_LENGTH)];
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
      // The thumb. The body is modelled with it held out in front of the palm, as a hand about to take hold of
      // something; a hand at ease, or cupped, has it lying along the side of the first finger. `thumb`: its first
      // bone, and the turn (an axis in the body at rest, and an angle) that lays it there.
      const t1 = this.need(`finger1-1.${s}`), t3 = this.bones[this.need(`finger1-3.${s}`)], out0 = unit(sub(t3.tail, this.bones[t1].head));
      const along = unit([0, 1, 2].map(c => 0.95 * f[c] + 0.27 * Ax[c] + 0.14 * N[c])), swing = cross(out0, along);
      const thumb = { bone: t1, axis: unit(swing), angle: Math.asin(Math.min(1, len(swing))) };
      return {
        side, H, K, A, S, E, W, f, Ax, N, fingers, thumb, thigh: len(sub(K, H)), shin: len(sub(A, K)), upper: len(sub(E, S)), fore: len(sub(W, E)),
        armPlane: unit(cross(sub(E, S), sub(W, E))),
        bone: Object.fromEntries(['upperleg01', 'lowerleg01', 'foot', 'clavicle', 'shoulder01', 'upperarm01', 'lowerarm01', 'lowerarm02', 'wrist'].map(n => [n, this.need(`${n}.${s}`)])),
        toes: this.bones.map((b, j) => (new RegExp(`^toe\\d-1\\.${s}$`).test(b.name) ? j : -1)).filter(j => j >= 0),
        names: handBones(s), thumbBones: [1, 2, 3].map(j => this.need(`finger1-${j}.${s}`)), planeNow: null, twisted: null,
      };
    });
    this.head = this.need('head'); this.neck = ['neck01', 'neck02', 'neck03'].map(n => this.need(n)); this.trunk = this.need('root');
    this.spine = ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'].map(n => this.need(n));        // from the hips up to the chest
  }
  need(name) { const i = this.id.get(name); if (i === undefined) throw new Error(`the body has no bone ${name}`); return i; }
  /**
   * Measures her fingers from the mesh (`arrays`: { position, joints, weights } of body.bin): the rods that stand
   * for their skin. With them the hands know how to lie with their fingers together, and how far apart they are.
   */
  fitHands(arrays) {
    this.fit = ['L', 'R'].map(s => fitHand(this.info, arrays, s)); this.models.forEach((m, i) => { m.fit = this.fit[i]; m.learn(); });
    // Her hands' own skin, for what lies in them (handSkin): the vertices held most by the wrist, the bones of the
    // palm, the fingers and the thumb, and the triangles between them.
    const { joints, weights, index } = arrays;
    this.mesh = arrays;
    this.skin = this.sides.map(s => {
      const want = new Set([s.names.wrist, ...s.names.palm, ...s.names.fingers.flat(), ...s.names.thumb].map(n => this.need(n))), local = new Map(), v = [], bones = new Set();
      for (let q = 0; q < this.info.vertices; q++) if (want.has(joints[q * 4])) { local.set(q, v.length); v.push(q); for (let c = 0; c < 4; c++) if (weights[q * 4 + c]) bones.add(joints[q * 4 + c]); }
      const tri = [];
      for (let t = 0; t + 2 < index.length; t += 3) { const a = local.get(index[t]), b = local.get(index[t + 1]), c = local.get(index[t + 2]); if (a !== undefined && b !== undefined && c !== undefined) tri.push(a, b, c); }
      return { v: Uint32Array.from(v), tri: Uint32Array.from(tri), bones: [...bones], pos: new Float32Array(v.length * 3) };
    });
    return this;
  }

  /**
   * The skin of hand i where it is posed now: { pos: x, y, z of each of its vertices (the body's frame), tri: three
   * of them a triangle }, as the picture of her is skinned (each vertex by the bones that hold it), or null before
   * fitHands. For what lies in the hand: it lies on this.
   */
  handSkin(i) {
    const k = this.skin?.[i];
    if (!k) return null;
    for (const b of k.bones) this.current(b);
    const { position, joints, weights } = this.mesh, m = this.matrices, out = k.pos;
    for (let q = 0; q < k.v.length; q++) {
      const v = k.v[q], x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
      let X = 0, Y = 0, Z = 0, W = 0;
      for (let c = 0; c < 4; c++) {
        const w = weights[v * 4 + c];
        if (!w) continue;
        const o = joints[v * 4 + c] * 12;
        X += w * (m[o] * x + m[o + 1] * y + m[o + 2] * z + m[o + 3]); Y += w * (m[o + 4] * x + m[o + 5] * y + m[o + 6] * z + m[o + 7]); Z += w * (m[o + 8] * x + m[o + 9] * y + m[o + 10] * z + m[o + 11]); W += w;
      }
      out[q * 3] = X / W; out[q * 3 + 1] = Y / W; out[q * 3 + 2] = Z / W;
    }
    return k;
  }

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

  /** The rods that stand for the skin of hand i's fingers, thumb and palm, where they are posed now (the body's frame): { fingers, thumb, palm }, or null before fitHands. */
  /**
   * The whole skeleton as it is posed now, for checks that nothing is stretched (tools/bodycheck.mjs):
   * { worst: the bone whose root is furthest from where its parent carries it (metres), gaps: every such bone,
   * skew: the bone whose turn is furthest from a pure rotation, neck and neckRest: the neck's length now and at
   * rest, eye: where the head carries her eye (the body's frame), back: how far her back is turned and bent for a reach }.
   */
  probe() {
    const m = this.matrices, out = { worst: { gap: 0, bone: '' }, skew: { by: 0, bone: '' }, gaps: {}, neck: 0, eye: null };
    for (let b = 0; b < this.bones.length; b++) {
      this.current(b);
      const bone = this.bones[b], p = bone.parent, o = b * 12;
      // (Where the bone's own root is, and where its parent would carry that point: apart, the body is stretched there.)
      if (p >= 0) {
        const own = this.carry(b, bone.head), held = this.carry(p, bone.head), gap = Math.hypot(own[0] - held[0], own[1] - held[1], own[2] - held[2]);
        if (gap > 1e-5) out.gaps[bone.name] = gap;
        if (gap > out.worst.gap) out.worst = { gap, bone: bone.name };
      }
      // (How far its turn is from a pure rotation: rows of length one, at right angles.)
      const r = [[m[o], m[o + 1], m[o + 2]], [m[o + 4], m[o + 5], m[o + 6]], [m[o + 8], m[o + 9], m[o + 10]]], d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
      const by = Math.max(Math.abs(d(r[0], r[0]) - 1), Math.abs(d(r[1], r[1]) - 1), Math.abs(d(r[2], r[2]) - 1), Math.abs(d(r[0], r[1])), Math.abs(d(r[0], r[2])), Math.abs(d(r[1], r[2])));
      if (by > out.skew.by) out.skew = { by, bone: bone.name };
    }
    // The neck's length: from the root of its first bone to the root of the head (at rest: `neckRest`).
    const n0 = this.bones[this.neck[0]], h = this.bones[this.head], a = this.carry(this.neck[0], n0.head), c = this.carry(this.head, h.head);
    out.neck = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    out.neckRest = Math.hypot(h.head[0] - n0.head[0], h.head[1] - n0.head[1], h.head[2] - n0.head[2]);
    // (Where the head carries her eye: the first-person camera should be exactly there.)
    out.eye = this.carry(this.head, [0, this.eye, 0]);
    // (What her back is doing for a reach: her shoulders turned, and her back bent, radians.)
    out.back = this.backNow ? { turned: this.backNow.twist, bent: len(this.backNow.w) } : null;
    return out;
  }

  handCaps(i) {
    if (!this.fit) return null;
    const s = this.sides[i], rods = this.fit[i].rods, rod = name => { const b = this.need(name), r = rods[name]; return { a: this.carry(b, r.head), b: this.carry(b, r.tail), r: r.r, w: r.w, t: r.t }; };
    return { fingers: s.names.fingers.map(f => f.map(rod)), thumb: s.names.thumb.map(rod), palm: s.names.palm.map(rod) };
  }

  /**
   * Hand i (0 left, 1 right) as it is posed now, measured as a hand is (handpose.js), in the body's frame: what
   * hand(i) gives, and { shoulder, elbow; sup, flex, dev: how far the forearm is turned palm up and the wrist bent
   * towards the palm and towards the thumb; twists: how far each of the two bones of the forearm and the hand
   * itself are turned about the forearm's line, from the plane of the arm; fingers: for each, index to little,
   * { mcp, abd, pip, dip, tip }; thumb: { plane, lift, mcp, ip, tip }; and, once `fit` has been given (handpose.js
   * fitHand, for the left hand and the right), caps: the rods that stand for the skin of the fingers, the thumb
   * and the palm where they are now, and gaps: the room between each finger and the next }.
   */
  handProbe(i) {
    const s = this.sides[i], h = this.hand(i), head = b => this.carry(b, this.bones[b].head), tail = b => this.carry(b, this.bones[b].tail), dir = b => unit(sub(tail(b), head(b)));
    const S = head(s.bone.upperarm01), E = head(s.bone.lowerarm01), along = unit(sub(h.wrist, E));
    const fingers = s.fingers.map(finger => { const [a, b, c] = finger.map(part => part.bone); return { ...fingerAngles(dir(a), dir(b), dir(c), h.f, h.N, h.A), tip: tail(c) }; });
    const t = s.thumbBones, thumb = { ...thumbAngles(dir(t[0]), dir(t[1]), dir(t[2]), t.map(b => len(sub(this.bones[b].tail, this.bones[b].head))), h.f, h.N, h.A), tip: tail(t[2]) };
    const plane = s.planeNow || turn(this.R[s.bone.upperarm01], s.armPlane);
    const twist = b => { const v = turn(this.R[b], s.armPlane), k = dot(v, along), flat = [v[0] - along[0] * k, v[1] - along[1] * k, v[2] - along[2] * k]; return Math.atan2(dot(along, cross(plane, flat)), dot(plane, flat)); };
    let caps = null;
    if (this.fit) {
      const rods = this.fit[i].rods, rod = name => { const b = this.need(name), r = rods[name]; return { a: this.carry(b, r.head), b: this.carry(b, r.tail), r: r.r, w: r.w, t: r.t }; };
      caps = { fingers: s.names.fingers.map(f => f.map(rod)), thumb: s.names.thumb.map(rod), palm: s.names.palm.map(rod) };
    }
    // (How the hand is held on the arm is measured by the wrist's own bone: the line from the wrist to the
    // knuckles, which hand(i) goes by, moves as the palm is hollowed.)
    const Rw = this.R[s.bone.wrist];
    return { ...h, shoulder: S, elbow: E, ...wristAngles(S, E, h.wrist, turn(Rw, s.f), turn(Rw, s.N), s.side, plane), turned: shoulderTurn(S, E, h.wrist, s.side), bent: Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(E, S)), along)))), twists: [twist(s.bone.lowerarm01), twist(s.bone.lowerarm02), twist(s.bone.wrist)], fingers, thumb, caps, gaps: caps ? fingerGaps(caps.fingers, h.A, h.f) : null };
  }

  /**
   * @param {object} j  the solver's joints (poseBody or poseSwim)
   * @param {number} eye  the eye's height in the solver's frame (above the feet walking; 0 swimming)
   * @returns {Float32Array} 12 numbers a bone
   */
  pose(j, eye) {
    // (Posed, and if a hand then falls short of what it was sent to, posed once more with the back bent that much
    // further towards it: an arm is as long as it is.)
    this.more = [[0, 0, 0], [0, 0, 0]];
    let m = this.poseOnce(j, eye);
    // (From half a millimetre short, so that it does not come in with a jump; three times at most.)
    for (let again = 0; again < 3 && Math.max(len(this.short[0]), len(this.short[1])) >= 0.0005; again++) { this.more = this.more.map((v, i) => add(v, this.short[i])); m = this.poseOnce(j, eye); }
    return m;
  }

  poseOnce(j, eye) {
    this.frame++; this.short = [[0, 0, 0], [0, 0, 0]];
    const seat = j.seat ?? (j.sitting ? 1 : 0);                   // how far she is on her seat, 0..1 (between: getting down on to it, or up off it) this.more ??= [[0, 0, 0], [0, 0, 0]];
    const chest = j.shoulder || j.chest, across = [1, 0, 0];
    // The trunk: hips where the solver has them, leaning the way it leans. The hips turn with the stride (the
    // hip of the leading leg forward) and the chest against them; the chest also goes a little way round with
    // the head. The spine takes the difference, a part at each of its five joints.
    const lean = aim(sub(this.chest0, this.hip0), across, sub(chest, j.hip), across), trunk = this.trunk, along = unit(sub(chest, j.hip));
    // (And her pelvis lists with each pace, the hip of the leg in the air dropping (`list`), her shoulders
    // tilting the other way (`tiltTop`): about the line from her back to her front, a part at each joint of her spine.)
    const list = j.list || 0, tiltTop = j.tiltTop || 0, fore = unit(cross(across, along));
    const low = j.pelvis || 0, high = -0.6 * low - 0.3 * (j.headTurn || 0), Rp = mul(about(fore, list), mul(about(along, low), lean));
    const trunkAt = (shift, bend = bent) => {
      this.drive(trunk, Rp, add(add(j.hip, shift), turn(Rp, sub(this.bones[trunk].head, this.hip0))));
      this.spine.forEach((b, k) => { const part = fraction(bend, (k + 1) / 5); this.hinge(b, mul(about(fore, list + (tiltTop - list) * (k + 1) / 5), mul(about(turn(part, along), low + (high - low) * (k + 1) / 5), mul(part, lean)))); });
    };
    // A shoulder goes out to what the hand reaches for (`reached`: how far the solver has moved it for that),
    // and her back takes it there. The collar bone gives a finger's breadth; beyond that her shoulders turn
    // (about the line of her back: it brings the one shoulder forward, and down too when she is leaning
    // forward, and her head stays where it is: up to 29 degrees) and her back bends towards it, and her head
    // comes down with it (reaching for the sand beside you, you lean to it). How far of each is found on her
    // own skeleton: her back is turned and bent a little each way, to see where that carries the shoulder,
    // and then by what brings it where it is wanted, the turn before the bend. (The shoulder joint used to be
    // moved there by itself, off the end of its collar bone.)
    let bent = IDENTITY, rock = [0, 0, 0];
    this.backNow = { twist: 0, w: [0, 0, 0] };
    if (j.reached && j.eye) {
      const round = about(along, high), asks = [];
      for (const [i, sd] of this.sides.entries()) {
        // (And as much further as the arm was short of its hand's place when she was posed a moment ago: `more`.)
        const d = turn(round, j.reached[i]), far = len(d), ask = add(far > GIRDLE_GIVE ? d.map(v => v * (1 - GIRDLE_GIVE / far)) : [0, 0, 0], this.more[i]);
        if (len(ask) >= 1e-5) asks.push({ at: sd.S, top: this.bones[sd.bone.clavicle].parent, ask });
      }
      if (asks.length) {
        const backOf = p => { const by = Math.hypot(p[1], p[2], p[3]), R = by > 1e-6 ? about([p[1] / by, p[2] / by, p[3] / by], by) : IDENTITY; return Math.abs(p[0]) > 1e-6 ? mul(R, about(along, p[0])) : R; };
        const carried = p => { this.frame++; trunkAt([0, 0, 0], backOf(p)); return asks.map(a => this.carry(a.top, a.at)); };
        // (Only across the line from her hips to the shoulder: along that line a back neither lengthens nor
        // shortens. On her feet, most of that part is her hips': she rocks forward over her feet towards what she
        // reaches for, as far as her legs let her (`rock`, below). The rest is the collar bone's, as far as it
        // swings, and the arm's.)
        const want = carried([0, 0, 0, 0]).map((q, k) => { const line = unit(sub(q, j.hip)), a = asks[k].ask, along = dot(a, line); rock = add(rock, line.map(v => v * along * ROCK[0] * (1 - seat) / asks.length)); return add(q, sub(a, line.map(v => v * along))); }), p = [0, 0, 0, 0], H = 0.02;
        { const far = len(rock); if (far > ROCK[1]) rock = rock.map(v => v * ROCK[1] / far); }
        for (let step = 0; step < 5; step++) {
          const now = carried(p), e = [];
          for (const [k, q] of now.entries()) e.push(...sub(want[k], q));
          if (Math.hypot(...e) < 0.0003) break;
          const J = e.map(() => [0, 0, 0, 0]);
          for (let c = 0; c < 4; c++) { const q = p.slice(); q[c] += H; for (const [k, m] of carried(q).entries()) for (let a = 0; a < 3; a++) J[k * 3 + a][c] = (m[a] - now[k][a]) / H; }
          const A = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), b = [0, 0, 0, 0];
          for (let r = 0; r < e.length; r++) for (let c = 0; c < 4; c++) { b[c] += J[r][c] * e[r]; for (let q = 0; q < 4; q++) A[c][q] += J[r][c] * J[r][q]; }
          // (Turned as far as shoulders turn, and still asked for more: the rest is for her back to bend.)
          // (What it costs her to turn and to bend is weighed against how far short the shoulder is left: she does
          // not double over for the last centimetre. The arm has that much to give, and is asked: `more`.)
          for (let c = 0; c < 4; c++) { const hold = BACK_HOLD[c ? 1 : 0]; A[c][c] += hold; b[c] -= hold * p[c]; }
          // (Turned as far as shoulders turn, and still asked for more: the rest is for her back to bend.)
          if (Math.abs(p[0]) >= BACK_MOST[0] - 1e-9 && b[0] * p[0] > 0) A[0][0] += 1e3;
          const by = solve4(A, b);
          for (let c = 0; c < 4; c++) p[c] += by[c];
          p[0] = Math.max(-BACK_MOST[0], Math.min(BACK_MOST[0], p[0]));
          const over = Math.hypot(p[1], p[2], p[3]) / BACK_MOST[1];
          if (over > 1) for (let c = 1; c < 4; c++) p[c] /= over;
        }
        this.frame++;
        this.backNow = { twist: p[0], w: p.slice(1) };
        bent = backOf(p);
      }
    }
    const alongTop = turn(bent, along), Rt = mul(about(fore, tiltTop), mul(about(alongTop, high), mul(bent, lean)));
    // Her head is carried by her neck, and her neck by her chest: each bone turns where its parent holds it, and
    // none is moved to meet another. So where her eye is, is what the pose makes it. (The head used to be put
    // on the camera and the neck drawn out between it and the chest: half as long again, looking down.) What
    // the solver asks is the height of her eye with her head level (`eyeLevel`; swimming, where the eye is,
    // `eyeAt`): the trunk is set down, the eye it gives is found, and the trunk is moved by the difference.
    // Looking down or round then moves the eye as a head on a neck moves it.
    const HEAD = [0.18, 0.4, 0.66];                               // how much of the head's turn each neck bone has made (the head: all)
    const neckTo = Rh => { const round = mul(transpose(Rt), Rh); this.neck.forEach((b, k) => this.hinge(b, mul(Rt, fraction(round, HEAD[k])))); this.hinge(this.head, Rh); };
    // (`eyeBase`: where her eye would be with her head level and her back not bent to any reach. `eyeFree`: the
    // same with her head turned and nodding as it is: what her hands' places are reckoned from, so that leaning
    // to a place does not move the place she leans to.)
    const looking = j.eye ? mul(about([0, 1, 0], -(j.headTurn || 0)), about([1, 0, 0], j.headNod || 0)) : IDENTITY;
    let free = null;
    if (j.eye) {
      const Rb = mul(about(fore, tiltTop), mul(about(along, high), lean)), headTo = Rh => { const round = mul(transpose(Rb), Rh); this.neck.forEach((b, k) => this.hinge(b, mul(Rb, fraction(round, HEAD[k])))); this.hinge(this.head, Rh); return this.carry(this.head, [0, this.eye, 0]); };
      trunkAt([0, 0, 0], IDENTITY);
      free = headTo(looking); this.frame++;
      trunkAt([0, 0, 0], IDENTITY);
      this.eyeBase = headTo(IDENTITY); this.frame++;
    }
    const based = this.eyeBase;
    // (Swimming, a neck bends back no further than a neck does: about sixty degrees from the line of the back.
    // What is left, the head is tipped down, and the eyes look up for it.)
    const level = j.eye ? IDENTITY : (() => { const back = Math.acos(Math.max(-1, Math.min(1, along[1]))); return back > 1.05 ? mul(about([1, 0, 0], -(back - 1.05)), IDENTITY) : IDENTITY; })();
    let shift = [0, 0, 0];
    if (j.eyeLevel || !j.eye) {
      trunkAt(shift); neckTo(level);
      // (On foot: by where her eye would be were she not leaning to anything. Leaning over to reach the sand,
      // her head comes down with her back: it is not held up at the height asked.)
      const got = j.eye ? based : this.carry(this.head, [0, this.eye, 0]);
      // (Seated, her seat is on the ground and stays there: her eye is as high as her back carries it.)
      shift = j.eye ? [0, j.eyeLevel[1] - got[1], 0] : [-got[0], eye - got[1], -got[2]];
      // (Her feet come first: the trunk is not lifted further than a leg can still reach the ankle the solver gave it.)
      if (j.eye && shift[1] > 0) for (const [i, sd] of this.sides.entries()) {
        const H = this.carry(trunk, sd.H), A = j.ankles[i], L = (sd.thigh + sd.shin) * 0.999, dx = A[0] - H[0], dz = A[2] - H[2];
        shift[1] = Math.min(shift[1], Math.max(0, A[1] + Math.sqrt(Math.max(L * L - dx * dx - dz * dz, 0)) - H[1]));
      }
      // (Going down on to her seat, it is let go of by as much as she is down.)
      if (j.eye) shift[1] *= 1 - seat;
      this.frame++;
    }
    // (Rocked towards a reach no further than both legs still reach their ankles.)
    if (len(rock) > 1e-5) {
      let most = 1;
      trunkAt(shift);
      for (const [i, sd] of this.sides.entries()) {
        const H = this.carry(trunk, sd.H), A = j.ankles[i], L = (sd.thigh + sd.shin) * 0.999;
        if (len(sub(add(H, rock), A)) > L) { let lo = 0, hi = 1; for (let n = 0; n < 12; n++) { const mid = (lo + hi) / 2; if (len(sub(add(H, rock.map(v => v * mid)), A)) > L) hi = mid; else lo = mid; } most = Math.min(most, lo); }
      }
      rock = rock.map(v => v * most);
      this.frame++;
    }
    trunkAt(add(shift, rock));
    /** How far the whole of her was moved from where the solver had her, to bring her eye where it was asked (swimming: all of her; on foot: her trunk, up or down). */
    this.shiftNow = shift;
    this.eyeFree = free ? add(free, shift) : null;
    const carried = p => this.carry(trunk, p), twisted = about(along, high);
    const moved = p => add(p, shift);

    for (const [i, s] of this.sides.entries()) {
      // The leg: from where the trunk has put the hip joint to the solver's ankle, the knee bending the way it bends there.
      const afloat = !j.eye, H = carried(s.H), ankle = afloat ? moved(j.ankles[i]) : j.ankles[i].slice(), kneeTo = sub(j.knees[i], [(H[0] + ankle[0]) / 2, (H[1] + ankle[1]) / 2, (H[2] + ankle[2]) / 2]);
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
      const S0 = moved(add(chest, turn(twisted, sub(j.shoulders[i], chest)))), hang = unit(sub(j.elbows[i], j.shoulders[i])), down = turn(Rt, [0, -1, 0]);
      const raised = Math.acos(Math.max(-1, Math.min(1, dot(hang, down)))), drop = 0.11 * (1 - Math.min(1, Math.max(0, (raised - 0.25) / 1.1)));
      const Rdrop = mul(Rt, about([0, 0, 1], -s.side * drop)), c0 = this.bones[s.bone.clavicle].head;
      // (And the collar bone points to where the solver has the shoulder, as far as a collar bone swings: the
      // shoulder is on its end, and the arm on the shoulder. The shoulder used to be put where the solver had it
      // and the collar bone left behind: crouched, seven centimetres of nothing between them.)
      const cAt = this.carry(this.bones[s.bone.clavicle].parent, c0), asked = add(add(S0, this.more[i]), sub(turn(Rdrop, sub(s.S, c0)), turn(Rt, sub(s.S, c0))));      // (`more`: and as much further as her back was sent for the arm's sake)
      const from = unit(turn(Rdrop, sub(s.S, c0))), to = unit(sub(asked, cAt)), axis = cross(from, to), sine = len(axis), swung = Math.min(0.45, Math.atan2(sine, dot(from, to)));
      const Rclav = sine > 1e-6 ? mul(about(axis.map(v => v / sine), swung), Rdrop) : Rdrop;
      this.hinge(s.bone.clavicle, Rclav);
      // (Which way the elbow bends is taken from the solver's own arm, its elbow off the line from its shoulder
      // to its wrist: an arm nearly straight has its elbow a finger's breadth off that line, and against her
      // shoulder, a finger's breadth from the solver's, the way to it swung right round from frame to frame.)
      const wrist = afloat ? moved(j.wrists[i]) : j.wrists[i].slice(), elbowTo = sub(j.elbows[i], [(j.shoulders[i][0] + j.wrists[i][0]) / 2, (j.shoulders[i][1] + j.wrists[i][1]) / 2, (j.shoulders[i][2] + j.wrists[i][2]) / 2]);
      const bend = len(elbowTo) > 1e-4 ? elbowTo : [0, -1, 0.3], armFrom = from0 => { const e = reach(from0, wrist.slice(), s.upper, s.fore, bend);      // (a copy: reach() draws its target in when it is too far)
        let pl = cross(sub(e, from0), sub(wrist, e)); pl = len(pl) > 1e-4 ? unit(pl) : turn(Rt, s.armPlane); return [e, pl, aim(sub(s.E, s.S), s.armPlane, sub(e, from0), pl)]; };
      // (The cap of the shoulder goes a third of the way round with the upper arm: it does not stay out where the
      // arm was. It hangs on the collar bone, and the arm on it: so the arm is found twice, from where the collar
      // bone has the joint and then from where the cap has it, a finger's breadth away at most.)
      const [, , Rfirst] = armFrom(this.carry(s.bone.clavicle, s.S)), Rcap = mul(fraction(mul(Rfirst, transpose(Rclav)), 0.35), Rclav);
      this.hinge(s.bone.shoulder01, Rcap);
      const S = this.carry(s.bone.shoulder01, s.S), [E, plane, Rupper] = armFrom(S);
      // (What her back has still to do: from where the shoulder now is, the arm would have to be all but
      // straight to get the hand to its place, or cannot. She is posed again with her back taking the shoulder
      // that much further: `pose`.)
      // (Only for a hand at work: one at rest goes as near to where the solver had it as its arm lets it.)
      // (It comes in as the reach does, over the first three centimetres the shoulder is sent: not all at once.)
      if (j.reached) { const work = Math.min(1, len(j.reached[i]) / 0.03), gap = sub(wrist, S), far = len(gap), most = Math.min((s.upper + s.fore) * 0.995, Math.max((s.upper + s.fore) * ARM_MOST, len(sub(j.wrists[i], j.shoulders[i])))); if (work > 0 && far > most) this.short[i] = gap.map(v => v * work * (far - most) / far); }
      s.planeNow = plane;
      this.drive(s.bone.upperarm01, Rupper, S);
      const Rfore = aim(sub(s.W, s.E), s.armPlane, sub(wrist, this.carry(s.bone.upperarm01, s.E)), plane);
      // The hand: the way the solver holds it; without that (swimming), flat along the forearm, palm down.
      const along = unit(sub(wrist, E)), h = j.hands?.[i] || { f: along, N: frame(along, [0, -1, 0])[2], curl: 0.1, spread: 0 };
      // (The way the palm faces is made square to the way the hand points: two directions mixed from two poses are not.)
      // (And the hand is held on this arm as a wrist can hold it: the solver keeps to that with its own arm, a
      // finger's breadth from hers, and two poses mixed may be outside it. A little is allowed over the solver's limits.)
      const [hf, hN] = j.hands?.[i] ? limitWrist(S, E, wrist, h.f, h.N, s.side, WRIST_LIMITS, plane) : [unit(h.f), h.N];
      const rest = [s.f, s.N, cross(s.f, s.N).map(v => v * s.side)], held = [hf, hN, cross(hf, hN).map(v => v * s.side)];
      const Rhand = between(rest, held);
      // (The hand's turn about the forearm is shared up the forearm, as the two bones in it do: none at the elbow.)
      const Q = mul(Rhand, [Rfore[0], Rfore[3], Rfore[6], Rfore[1], Rfore[4], Rfore[7], Rfore[2], Rfore[5], Rfore[8]]), v = plane, w = turn(Q, v);
      const k = dot(w, along), flat = [w[0] - along[0] * k, w[1] - along[1] * k, w[2] - along[2] * k];
      let twist = Math.atan2(dot(along, cross(v, flat)), dot(v, flat));
      // (Followed round from where it was a moment ago, not taken afresh each frame: an angle read as just under
      // half a turn one frame and just over minus half a turn the next would throw the forearm right round. And
      // no further than a forearm turns, with a little to spare: the rest is left to the wrist's skin.)
      if (s.twisted !== null) { const on = twist + 2 * Math.PI * Math.round((s.twisted - twist) / (2 * Math.PI)); if (Math.abs(on) < 1.5 * Math.PI) twist = on; }
      s.twisted = twist;
      const turned = Math.max(-1.75, Math.min(1.75, twist));
      // (A third of it by the elbow's end of the forearm and three quarters by the wrist's: it was 0.15 and 0.6,
      // which left two fifths of the turn to the skin of the wrist alone.)
      this.hinge(s.bone.lowerarm01, mul(about(along, 0.3 * turned), Rfore));
      this.hinge(s.bone.lowerarm02, mul(about(along, 0.75 * turned), Rfore));
      this.hinge(s.bone.wrist, Rhand);
      // Fingers, thumb and the bones of the palm: as the hand's pose has them (handpose.js). A pose is twenty-one
      // angles (`fingers`); a hand given only the old `curl` and `spread` takes the pose those stand for.
      const model = this.models[i], pose = h.fingers || model.fromCurl(h.curl ?? 0.1, h.spread || 0, this.posed[i]);
      for (const [b, R] of model.solve(pose, this.solved[i]).rot) this.hinge(b, mul(Rhand, R));
    }
    // The head, turned and nodding as you look, on the neck (above).
    neckTo(j.eye ? looking : level);
    /** Where her head carries her eye, in the solver's frame: the first-person camera is there. */
    this.eyeNow = this.carry(this.head, [0, this.eye, 0]);
    for (let b = 0; b < this.bones.length; b++) this.current(b);
    return this.matrices;
  }
}
