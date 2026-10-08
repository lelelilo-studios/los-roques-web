// The hand as anatomy, in numbers: which bones are its fingers, how far each joint is bent, how the hand is held
// on the forearm and the forearm turned, and the round rods (capsules) that stand for the skin of each finger,
// to tell how far apart two fingers are. This is what the hand is measured with (tools/handcheck.mjs,
// tests/hand.test.mjs) against what a person's hand can do (humanref.js).
//
// Plain arrays, no imports: it is measured in a test. Angles are radians. A hand's own frame is `f` (the way it
// points, from the wrist to the knuckles), `N` (the way the palm faces) and `A` (across it, towards the thumb).
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** `a` with what it has of the unit direction `d` taken out, made a unit: what is square to `d`. */
const square = (a, d) => { const k = dot(a, d); return unit([a[0] - d[0] * k, a[1] - d[1] * k, a[2] - d[2] * k]); };

export const FINGERS = ['index', 'middle', 'ring', 'little'];

/** The bones of one hand and its forearm, by their names in body.json. `s`: 'L' or 'R'. */
export function handBones(s) {
  return {
    upper: `upperarm01.${s}`, forearm: [`lowerarm01.${s}`, `lowerarm02.${s}`], wrist: `wrist.${s}`,
    thumb: [1, 2, 3].map(j => `finger1-${j}.${s}`),
    fingers: [2, 3, 4, 5].map(n => [1, 2, 3].map(j => `finger${n}-${j}.${s}`)),        // index to little, each from the knuckle out
    palm: [1, 2, 3, 4].map(n => `metacarpal${n}.${s}`),                                 // the bone of the palm behind each finger
  };
}

/**
 * How the hand is held on the arm, as a doctor would measure it. `S`, `E`, `W`: shoulder joint, elbow, wrist;
 * `f`, `N`: the hand's direction and the way its palm faces; `side`: 1 right, -1 left.
 *
 * `sup`: how far the forearm is turned, 0 with the thumb up (the palm facing your other arm, as when you hold
 * out a hand to shake), positive palm up (supination), negative palm down (pronation). A forearm turns about
 * 80 degrees each way.
 * `flex`: the wrist bent towards the palm (positive) or back (negative: extension).
 * `dev`: the hand tilted towards the thumb (positive: radial) or towards the little finger (negative: ulnar).
 *
 * `hinge`: the axis the elbow bends about, if the caller knows it better than three points can say (an arm
 * that is nearly straight has no plane to speak of).
 */
export function wristAngles(S, E, W, f, N, side, hinge = null) {
  // (Bent by less than three degrees, the arm's own plane is not to be trusted.)
  const along = unit(sub(W, E)), bend = cross(sub(E, S), sub(W, E)), bent = len(bend) > 0.05 * len(sub(E, S)) * len(sub(W, E));
  const h = square(bent || !hinge ? (len(bend) > 1e-9 ? bend : [1, 0, 0]) : hinge, along);
  // The side of the forearm that faces the shoulder as the elbow bends (where a palm turned up faces), and the
  // way the palm faces with the thumb up.
  const up = cross(h, along), level = h.map(v => -v * side);
  const fu = unit(f), A = cross(fu, N).map(v => v * side);
  // (The hand's own bend at the wrist is undone first: what is left is the turn of the forearm.)
  const flex = Math.atan2(-dot(along, N), dot(along, fu)), dev = Math.atan2(-dot(along, A), Math.hypot(dot(along, fu), dot(along, N)));
  const axis = cross(fu, along), s = len(axis), c = dot(fu, along);
  let n = N;
  if (s > 1e-6) { const k = unit(axis), kn = dot(k, N), kxn = cross(k, N); n = [0, 1, 2].map(i => N[i] * c + kxn[i] * s + k[i] * kn * (1 - c)); }
  return { sup: Math.atan2(dot(n, up), dot(n, level)), flex, dev };
}

/**
 * How far the joints of one finger are bent, from the directions of its three bones (knuckle outward) in the
 * hand's frame. `mcp`: the knuckle at the palm, towards the palm positive; `abd`: the finger leaning towards the
 * thumb (positive) in the palm's plane; `pip`: the middle joint; `dip`: the end joint.
 */
export function fingerAngles(d1, d2, d3, f, N, A) {
  const a = unit(d1), b = unit(d2), c = unit(d3);
  const n1 = square(N, a), hinge = cross(a, n1), n2 = unit(cross(hinge, b));
  return {
    mcp: Math.atan2(dot(a, N), Math.hypot(dot(a, f), dot(a, A))), abd: Math.atan2(dot(a, A), dot(a, f)),
    pip: Math.atan2(dot(b, n1), dot(b, a)), dip: Math.atan2(dot(c, n2), dot(c, b)),
  };
}

/**
 * How the thumb lies, from the directions of its three bones: `plane`: the line from its root to its tip, round
 * from the hand's direction towards the thumb's side, in the palm's plane; `lift`: that line raised out of the
 * plane, towards the way the palm faces; `mcp` and `ip`: the bend at its second and last joints.
 */
export function thumbAngles(d1, d2, d3, lengths, f, N, A) {
  const a = unit(d1), b = unit(d2), c = unit(d3), chord = unit([0, 1, 2].map(i => a[i] * lengths[0] + b[i] * lengths[1] + c[i] * lengths[2]));
  return { plane: Math.atan2(dot(chord, A), dot(chord, f)), lift: Math.asin(Math.max(-1, Math.min(1, dot(chord, N)))), mcp: Math.acos(Math.max(-1, Math.min(1, dot(a, b)))), ip: Math.acos(Math.max(-1, Math.min(1, dot(b, c)))) };
}

/**
 * The round rods that stand for the skin of one hand, measured from the mesh at rest: for each bone of the
 * fingers, the thumb and the palm, { head, tail: the rod's axis (the bone's line moved to the middle of the
 * skin round it: a finger's bone runs along its back), r: its radius, w: half its width across the hand,
 * t: half its thickness from back to pad }. `info`: body.json; `arrays`: { position, joints, weights } of body.bin.
 */
export function fitHand(info, arrays, s) {
  const names = handBones(s), id = new Map(info.bones.map((b, i) => [b.name, i])), bone = n => info.bones[id.get(n)];
  const W = bone(names.wrist).head, knuckles = names.fingers.map(fi => bone(fi[0]).head), side = s === 'R' ? 1 : -1;
  const f = unit(sub([0, 1, 2].map(c => (knuckles[0][c] + knuckles[1][c] + knuckles[2][c] + knuckles[3][c]) / 4), W)), across = square(sub(knuckles[0], knuckles[3]), f), N = cross(across, f).map(v => v * side);
  const wanted = new Map([...names.thumb, ...names.fingers.flat(), ...names.palm].map(n => [id.get(n), { name: n, q: [] }]));
  const { position, joints, weights } = arrays;
  for (let v = 0; v < info.vertices; v++) {
    // (A vertex belongs to the bone that holds it most: the strongest comes first.)
    const hit = wanted.get(joints[v * 4]);
    if (!hit || weights[v * 4] < 128) continue;
    hit.q.push([position[v * 3], position[v * 3 + 1], position[v * 3 + 2]]);
  }
  const fit = {};
  for (const [b, { name, q }] of wanted) {
    const { head, tail } = info.bones[b], u = unit(sub(tail, head)), L = len(sub(tail, head));
    // Each vertex beside the bone's own stretch: where it is off the bone's line.
    // (Its middle half only: at its ends are the swellings of the joints, and at a finger's root the web.)
    const off = q.map(p => { const d = sub(p, head), k = dot(d, u); return k < 0.25 * L || k > 0.75 * L ? null : [d[0] - u[0] * k, d[1] - u[1] * k, d[2] - u[2] * k]; }).filter(Boolean);
    if (off.length < 8) { fit[name] = { head, tail, r: 0.008, w: 0.008, t: 0.008, n: off.length }; continue; }
    // The middle of the skin round the bone: half way between its furthest points across the hand and through it.
    const side2 = square(across, u), thick = cross(u, side2), span = d => { let lo = Infinity, hi = -Infinity; for (const o of off) { const k = dot(o, d); lo = Math.min(lo, k); hi = Math.max(hi, k); } return [lo, hi]; };
    const [a0, a1] = span(side2), [t0, t1] = span(thick), c = [0, 1, 2].map(i => side2[i] * (a0 + a1) / 2 + thick[i] * (t0 + t1) / 2);
    let r = 0; for (const o of off) r += len(sub(o, c)); r /= off.length;
    fit[name] = { head: add(head, c), tail: add(tail, c), r, w: (a1 - a0) / 2, t: (t1 - t0) / 2, n: off.length };
  }
  return { rods: fit, f, N, A: cross(f, N).map(v => v * side) };
}

/** The least distance between two stretches of line, a0..a1 and b0..b1. */
export function between(a0, a1, b0, b1) {
  const u = sub(a1, a0), v = sub(b1, b0), w = sub(a0, b0), a = dot(u, u), b = dot(u, v), c = dot(v, v), d = dot(u, w), e = dot(v, w), D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-12) { sN = 0; sD = 1; tN = e; tD = c; } else { sN = b * e - c * d; tN = a * e - b * d; if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; } }
  if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
  else if (tN > tD) { tN = tD; if (-d + b < 0) sN = 0; else if (-d + b > a) sN = sD; else { sN = -d + b; sD = a; } }
  const sc = Math.abs(sN) < 1e-12 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-12 ? 0 : tN / tD;
  return len([w[0] + u[0] * sc - v[0] * tc, w[1] + u[1] * sc - v[1] * tc, w[2] + u[2] * sc - v[2] * tc]);
}

/**
 * How much room there is between the fingers of a hand, seen square on to the palm: from its rods as posed
 * (`caps`: for each finger, index to little, its three rods { a, b, r, w }) and the palm's own directions (`A`
 * across it, `f` along it), the least gap between each finger and the next along their middle and end bones
 * (metres; negative: one lies over the other). It is the gap sand falls through; and fingers that are apart seen
 * so are apart. (Measured in the round it would not do: a little finger more bent than its neighbour passes
 * under it, and the two are never near.)
 */
export function fingerGaps(caps, A, f) {
  const flat = p => [dot(p, A), dot(p, f), 0];
  // (Beyond their first bones: at their roots fingers are joined by the web, and are never apart.)
  return [0, 1, 2].map(n => { let least = Infinity; for (const j of [1, 2]) for (const k of [1, 2]) { const p = caps[n][j], q = caps[n + 1][k]; least = Math.min(least, between(flat(p.a), flat(p.b), flat(q.a), flat(q.b)) - p.w - q.w); } return least; });
}

/**
 * How near the parts of a posed hand come to one another (metres; negative: one passes through another), from
 * its rods (`caps`: { fingers, thumb, palm }): `fingers`: a finger and the next, anywhere beyond their roots;
 * `palm`: a fingertip and the palm; `thumb`: the thumb beyond its root and the first finger.
 */
export function clearance(caps) {
  let fingers = Infinity, palm = Infinity, thumb = Infinity;
  for (let n = 0; n < 3; n++) for (const j of [1, 2]) for (const k of [1, 2]) { const p = caps.fingers[n][j], q = caps.fingers[n + 1][k]; fingers = Math.min(fingers, between(p.a, p.b, q.a, q.b) - p.r - q.r); }
  for (const f of caps.fingers) for (const m of caps.palm) palm = Math.min(palm, between(f[2].a, f[2].b, m.a, m.b) - f[2].r - m.t);
  for (const t of [caps.thumb[1], caps.thumb[2]]) for (const q of caps.fingers[0]) thumb = Math.min(thumb, between(t.a, t.b, q.a, q.b) - t.r - q.r);
  return { fingers, palm, thumb };
}

/** How near two posed hands come to one another (metres), by the rods of their fingers and thumbs. */
export function handsApart(a, b) {
  let least = Infinity;
  const rods = c => [...c.fingers.flat(), ...c.thumb, ...c.palm];
  for (const p of rods(a)) for (const q of rods(b)) least = Math.min(least, between(p.a, p.b, q.a, q.b) - p.r - q.r);
  return least;
}

// ---------------------------------------------------------------------------------------------------------------
// A hand's pose, and the hand that takes it.
//
// A pose is twenty-one angles (radians): for each finger, index to little, how far its knuckle at the palm is
// bent (MCP), how far it leans towards the thumb in the palm's plane (ABD), and the bend of its middle and end
// joints (PIP, DIP); for the thumb, where the line from its root to its tip lies (T_PLANE: round from the hand's
// direction towards the thumb's side; T_LIFT: raised towards the way the palm faces) and the bend of its second
// and last joints (T_MCP, T_IP); and how far the palm is hollowed (ARCH: the bones of the palm behind the little
// and ring fingers come forward, as when you cup your hand). The angles are those fingerAngles and thumbAngles
// measure, near enough: a finger bends about its own axis, which is not quite square to the palm.
export const MCP = 0, ABD = 4, PIP = 8, DIP = 12, T_PLANE = 16, T_LIFT = 17, T_MCP = 18, T_IP = 19, ARCH = 20, POSE_LENGTH = 21;
const RAD = Math.PI / 180, I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul = (A, B) => { const R = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return R; };
const turn = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
/** A turn by `angle` about the unit axis k (3 x 3, rows). */
function about(k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c, [x, y, z] = k;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
/** The shortest turn that takes the unit direction a to b. */
function swing(a, b) {
  const k = cross(a, b), s = len(k), c = dot(a, b);
  return s < 1e-9 ? I3 : about([k[0] / s, k[1] / s, k[2] / s], Math.atan2(s, c));
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Part of the way (k) from pose a to pose b, joint by joint. */
export function mixPose(a, b, k, out = new Array(POSE_LENGTH)) {
  for (let i = 0; i < POSE_LENGTH; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}

/**
 * A hand's frame (the way it points `f`, the way its palm faces `N`) part of the way (k) from one way of holding
 * it to another, by the one turn that takes the first to the second: [f, N]. (Each of the two directions moved
 * straight to its new one and made a unit again is not a turn: between a palm down and a palm up the hand
 * would flip in a few frames, and half way it has no palm.)
 */
export function slerpFrame(f0, N0, f1, N1, k) {
  const a = unit(f0), an = square(N0, a), b = unit(f1), bn = square(N1, b);
  if (k <= 0) return [a, an];
  if (k >= 1) return [b, bn];
  const ac = cross(a, an), bc = cross(b, bn), R = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] = b[r] * a[c] + bn[r] * an[c] + bc[r] * ac[c];
  const angle = Math.acos(clamp((R[0] + R[4] + R[8] - 1) / 2, -1, 1)), axis = [R[7] - R[5], R[2] - R[6], R[3] - R[1]], l = len(axis);
  if (angle < 1e-6 || l < 1e-9) return [a, an];
  const Rk = about([axis[0] / l, axis[1] / l, axis[2] / l], angle * k);
  return [turn(Rk, a), turn(Rk, an)];
}

// The hand's attitudes, as a person's hand takes them (degrees; fingers index to little): [knuckles at the palm],
// [middle joints], [end joints], [the gaps between neighbouring fingers at their middle bones, mm], how far the
// palm is hollowed, and the thumb: [where its line lies in the palm's plane, how far it is raised from it, its
// second joint and its last bent beyond where they are at rest]. A hand at ease is never flat: each finger is
// a little more curled than the one before it, and they lie together. (Joint ranges: humanref.js HAND.)
const ATTITUDES = {
  rest: [[30, 33, 36, 39], [33, 33, 33, 33], [20, 20, 20, 20], [3, 2, 2], 3, { beside: 2, lift: 14, mcp: 5, ip: 5 }],            // hanging at your side
  flat: [[5, 5, 6, 7], [6, 6, 6, 6], [3, 3, 3, 3], [4, 3, 3], 0, { plane: 34, lift: 8, mcp: 0, ip: 0 }],                        // laid on the sand, or pulling at the water
  reach: [[10, 12, 14, 18], [15, 15, 15, 15], [8, 8, 8, 8], [12, 9, 9], 0, { plane: 44, lift: 28, mcp: 0, ip: 0 }],             // on its way to take something: opened out
  contact: [[22, 25, 27, 30], [28, 28, 30, 32], [8, 8, 8, 8], [9, 7, 7], 0, { plane: 42, lift: 10, mcp: 0, ip: 5 }],            // the pads coming down on the sand
  dig: [[28, 32, 34, 36], [40, 42, 42, 44], [20, 20, 20, 20], [8, 6, 6], 2, { plane: 38, lift: 16, mcp: 5, ip: 8 }],            // the fingers gone in
  closed: [[52, 56, 59, 62], [60, 64, 65, 66], [38, 40, 40, 41], [0.5, 0.5, 0.5], 10, { beside: 1, lift: 20, mcp: 15, ip: 20 }], // closed on a handful
  cup: [[24, 27, 29, 33], [20, 20, 21, 22], [12, 12, 12, 12], [0.3, 0.3, 0.3], 10, { beside: 0.5, lift: 10, mcp: 8, ip: 10 }],   // holding sand: a shallow bowl, fingers together
  cupWater: [[30, 33, 35, 36], [26, 26, 27, 28], [16, 16, 16, 16], [0, 0, 0], 13, { beside: 0, lift: 12, mcp: 10, ip: 12 }],     // holding water: deeper, and pressed tight
  sift: [[23, 26, 28, 31], [19, 20, 20, 21], [11, 11, 11, 11], [2.5, 2, 2], 8, { beside: 2, lift: 12, mcp: 6, ip: 8 }],          // the fingers a little apart
  siftWide: [[20, 22, 24, 27], [16, 17, 17, 18], [10, 10, 10, 10], [8, 7, 7], 5, { beside: 6, lift: 16, mcp: 5, ip: 6 }],        // and wide apart
  rake: [[35, 38, 40, 42], [45, 45, 45, 45], [28, 28, 28, 28], [9, 8, 8], 0, { plane: 40, lift: 12, mcp: 5, ip: 10 }],           // bent like the tines of a rake
  release: [[14, 16, 18, 22], [12, 14, 15, 16], [8, 8, 8, 8], [10, 8, 8], 0, { plane: 38, lift: 26, mcp: 0, ip: 0 }],            // opening as it lets go
};
// How far the middle finger leans towards the thumb's side of where the body was modelled with it, when the
// fingers lie together (radians): the hand was modelled with its fingers fanned, the middle one pointing a
// little towards the little finger; closed, the fingers lie along the hand.
const MIDDLE_IN = 5 * RAD;

/**
 * One hand of the body: its bones at rest, the axis each joint turns about, and where a pose puts every bone of
 * it. `bones`: body.json's; `s`: 'L' or 'R'; `fit`: fitHand(...) for that side, for the rods of the fingers.
 * Plain arrays: the rig (figurepose.js) drives the mesh from it, the pose solver takes the fingertip's place
 * from it, and it is measured in a test.
 */
export class HandModel {
  constructor(bones, s, fit = null) {
    const id = new Map(bones.map((b, i) => [b.name, i])), names = handBones(s), side = s === 'R' ? 1 : -1;
    const need = n => { const i = id.get(n); if (i === undefined) throw new Error(`the body has no bone ${n}`); return i; }, bone = n => bones[need(n)];
    this.side = side; this.names = names; this.fit = fit;
    // The hand's frame at rest, as the rig has it: towards the middle finger's knuckle, across from the little
    // finger's to the first's, and the way the palm faces.
    const W = bone(names.wrist).head, f = unit(sub(bone(names.fingers[1][0]).head, W)), A = square(sub(bone(names.fingers[0][0]).head, bone(names.fingers[3][0]).head), f), N = cross(A, f).map(v => v * side);
    this.W = W; this.f = f; this.A = A; this.N = N;
    /** A joint's axis: the bone's own (body.json `normal`: the plane it bends in), made square to `along`, turned so that a positive turn bends towards `to`. */
    const axisOf = (b, along, to) => { const k = square(b.normal, along), way = cross(k, along); return dot(way, to) >= 0 ? k : k.map(v => -v); };
    this.fingers = names.fingers.map((list, n) => {
      const bs = list.map(bone), heads = bs.map(b => b.head), tip = bs[2].tail, dirs = bs.map(b => unit(sub(b.tail, b.head)));
      const axis = axisOf(bs[0], unit(sub(tip, heads[0])), N), palmBone = bone(names.palm[n]);
      return { ids: list.map(need), heads, tip, dirs, lengths: bs.map(b => len(sub(b.tail, b.head))), axis, rest: fingerAngles(dirs[0], dirs[1], dirs[2], f, N, A), names: list,
        // (The axis a finger leans about, towards its neighbour or away: through its first bone from back to pad.)
        lean: unit(cross(axis, dirs[0])),
        // (The bone of the palm behind it, and the axis that bone comes forward about when the palm is hollowed.)
        palm: { id: need(names.palm[n]), head: palmBone.head, axis: axisOf(palmBone, unit(sub(palmBone.tail, palmBone.head)), N), name: names.palm[n] } };
    });
    {
      const bs = names.thumb.map(bone), dirs = bs.map(b => unit(sub(b.tail, b.head))), lengths = bs.map(b => len(sub(b.tail, b.head)));
      // (The thumb's two further joints bend the way they are already bent at rest.)
      const hinge = (b, d0, d1) => { const k = square(b.normal, d1), way = cross(d0, d1); return dot(k, way) >= 0 ? k : k.map(v => -v); };
      this.thumb = { ids: names.thumb.map(need), heads: bs.map(b => b.head), tip: bs[2].tail, dirs, lengths, chord: unit(sub(bs[2].tail, bs[0].head)), axes: [null, hinge(bs[1], dirs[0], dirs[1]), hinge(bs[2], dirs[1], dirs[2])],
        rest: thumbAngles(dirs[0], dirs[1], dirs[2], lengths, f, N, A), names: names.thumb };
    }
    /** The pose the body was modelled in. */
    this.rest = new Array(POSE_LENGTH).fill(0);
    this.fingers.forEach((q, n) => { this.rest[MCP + n] = q.rest.mcp; this.rest[ABD + n] = q.rest.abd; this.rest[PIP + n] = q.rest.pip; this.rest[DIP + n] = q.rest.dip; });
    Object.assign(this.rest, { [T_PLANE]: this.thumb.rest.plane, [T_LIFT]: this.thumb.rest.lift, [T_MCP]: this.thumb.rest.mcp, [T_IP]: this.thumb.rest.ip });
    this.scratch = this.blank();
    this.poses = null; this.table = null;
    if (fit) this.learn();
  }

  /** Somewhere for solve() to put its answer. */
  blank() {
    return { rot: [], fingers: this.fingers.map(() => ({ heads: [null, null, null], tip: null, R: [I3, I3, I3], pad: null })), thumb: { heads: [null, null, null], tip: null, R: [I3, I3, I3] }, palm: [I3, I3, I3, I3], caps: null };
  }

  /**
   * Where a pose puts the hand, the hand itself not turned (the wrist where it is at rest: the caller turns the
   * whole by the hand's own turn): { rot: [[bone, R], ...] the turn of every bone a pose moves, parents first;
   * fingers: [{ heads, tip, R, pad: the middle of the pad of its last joint }]; thumb: { heads, tip, R };
   * caps: the rods of its fingers, thumb and palm, when the model has their fit }.
   */
  solve(pose, out = this.scratch) {
    const { N, side } = this, arch = pose[ARCH];
    out.rot.length = 0;
    for (let n = 0; n < 4; n++) {
      const q = this.fingers[n], o = out.fingers[n];
      // (The palm hollows by the bones behind the little finger and, a little over half as far, the ring finger.)
      const Rp = n === 3 ? about(q.palm.axis, arch) : n === 2 ? about(q.palm.axis, 0.55 * arch) : I3;
      out.palm[n] = Rp;
      if (n >= 2) out.rot.push([q.palm.id, Rp]);
      // (A finger leans in its own frame and then bends: bent, it keeps its place beside its neighbour. Leaning
      // about the palm's own normal after bending, a bent finger only turned about itself and never came nearer.)
      const R1 = mul(Rp, mul(about(q.axis, pose[MCP + n] - q.rest.mcp), about(q.lean, -side * (pose[ABD + n] - q.rest.abd))));
      const R2 = mul(R1, about(q.axis, pose[PIP + n] - q.rest.pip)), R3 = mul(R2, about(q.axis, pose[DIP + n] - q.rest.dip));
      const h1 = n >= 2 ? add(q.palm.head, turn(Rp, sub(q.heads[0], q.palm.head))) : q.heads[0], h2 = add(h1, turn(R1, sub(q.heads[1], q.heads[0]))), h3 = add(h2, turn(R2, sub(q.heads[2], q.heads[1])));
      o.heads[0] = h1; o.heads[1] = h2; o.heads[2] = h3; o.tip = add(h3, turn(R3, sub(q.tip, q.heads[2]))); o.R[0] = R1; o.R[1] = R2; o.R[2] = R3;
      out.rot.push([q.ids[0], R1], [q.ids[1], R2], [q.ids[2], R3]);
    }
    {
      const t = this.thumb, o = out.thumb, cl = Math.cos(pose[T_LIFT]), to = [0, 1, 2].map(i => cl * (Math.cos(pose[T_PLANE]) * this.f[i] + Math.sin(pose[T_PLANE]) * this.A[i]) + Math.sin(pose[T_LIFT]) * N[i]);
      const R1 = swing(t.chord, to), R2 = mul(R1, about(t.axes[1], pose[T_MCP] - t.rest.mcp)), R3 = mul(R2, about(t.axes[2], pose[T_IP] - t.rest.ip));
      const h2 = add(t.heads[0], turn(R1, sub(t.heads[1], t.heads[0]))), h3 = add(h2, turn(R2, sub(t.heads[2], t.heads[1])));
      o.heads[0] = t.heads[0]; o.heads[1] = h2; o.heads[2] = h3; o.tip = add(h3, turn(R3, sub(t.tip, t.heads[2]))); o.R[0] = R1; o.R[1] = R2; o.R[2] = R3;
      out.rot.push([t.ids[0], R1], [t.ids[1], R2], [t.ids[2], R3]);
    }
    if (this.fit) {
      const rods = this.fit.rods, rod = (name, head0, head, R) => { const r = rods[name]; return { a: add(head, turn(R, sub(r.head, head0))), b: add(head, turn(R, sub(r.tail, head0))), r: r.r, w: r.w, t: r.t }; };
      out.caps = {
        fingers: this.fingers.map((q, n) => q.names.map((name, j) => rod(name, q.heads[j], out.fingers[n].heads[j], out.fingers[n].R[j]))),
        thumb: this.thumb.names.map((name, j) => rod(name, this.thumb.heads[j], out.thumb.heads[j], out.thumb.R[j])),
        palm: this.fingers.map((q, n) => rod(q.palm.name, q.palm.head, q.palm.head, out.palm[n])),
      };
      // (The pad of a fingertip: on the palm's side of its last rod, a little beyond its middle.)
      this.fingers.forEach((q, n) => { const c = out.caps.fingers[n][2], d = unit(sub(c.b, c.a)), pad = cross(turn(out.fingers[n].R[2], q.axis), d); out.fingers[n].pad = [0, 1, 2].map(i => c.a[i] + (c.b[i] - c.a[i]) * 0.6 + pad[i] * c.t); });
    } else out.caps = null;
    return out;
  }

  /** A point as solve() has it, in the hand's own frame from the wrist: [across towards the thumb, along the hand, out of the palm] (m). */
  local(p) { const d = sub(p, this.W); return [dot(d, this.A), dot(d, this.f), dot(d, this.N)]; }

  /** The gaps between neighbouring fingers (at their middle bones, m) in a pose. Needs the fit. */
  gaps(pose) { return fingerGaps(this.solve(pose).caps.fingers, this.A, this.f); }

  /**
   * The pose with its fingers leaning so that the gaps between them are `want` (three, metres). The middle
   * finger comes in along the hand as the gaps close; the others lean towards it or away. (Fingers lie together
   * by leaning, the first finger most: its root is the furthest from its neighbour's.)
   */
  openTo(pose, want, out = pose.slice()) {
    if (out !== pose) for (let i = 0; i < POSE_LENGTH; i++) out[i] = pose[i];
    const trial = out;
    out[ABD + 1] = this.rest[ABD + 1] + MIDDLE_IN * clamp(1 - (want[0] + want[1]) / 0.02, 0, 1);
    // (Each in turn, working outward from the middle finger: index against middle, ring against middle, little against ring.)
    for (const [n, gap, to] of [[0, 0, 1], [2, 1, -1], [3, 2, -1]]) {
      let lo = -60 * RAD, hi = 45 * RAD;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        trial[ABD + n] = this.rest[ABD + n] + to * mid;
        // (Leaning away from the middle finger, positive `mid`, widens the gap.)
        if (this.gaps(trial)[gap] < want[gap]) lo = mid; else hi = mid;
      }
      out[ABD + n] = this.rest[ABD + n] + to * (lo + hi) / 2;
    }
    return out;
  }

  /**
   * The pose with its thumb lying beside the first finger, `room` metres of air between them: the thumb's line
   * is turned in the palm's plane until it is that near. (A hand at ease, or cupped, has its thumb along the
   * side of the first finger; the body is modelled with it held out.)
   */
  thumbBeside(pose, room, out = pose) {
    if (out !== pose) for (let i = 0; i < POSE_LENGTH; i++) out[i] = pose[i];
    let lo = -10 * RAD, hi = 70 * RAD;
    for (let k = 0; k < 16; k++) { out[T_PLANE] = (lo + hi) / 2; if (clearance(this.solve(out).caps).thumb < room) lo = out[T_PLANE]; else hi = out[T_PLANE]; }
    out[T_PLANE] = (lo + hi) / 2;
    return out;
  }

  /** Works out the attitudes (this.poses) and the table fromCurl reads, once the rods are known. */
  learn() {
    const pose = ([mcp, pip, dip, gaps, arch, thumb]) => {
      const p = this.rest.slice();
      for (let n = 0; n < 4; n++) { p[MCP + n] = mcp[n] * RAD; p[PIP + n] = pip[n] * RAD; p[DIP + n] = dip[n] * RAD; }
      p[ARCH] = arch * RAD; p[T_LIFT] = thumb.lift * RAD; p[T_MCP] = this.rest[T_MCP] + thumb.mcp * RAD; p[T_IP] = this.rest[T_IP] + thumb.ip * RAD;
      // (Fingers bent far come together of themselves: if they would pass through one another, the gaps asked for are widened.)
      for (let more = 0; more < 0.008; more += 0.0005) { this.openTo(p, gaps.map(g => g / 1000 + more), p); if (clearance(this.solve(p).caps).fingers >= 0.0003) break; }
      if (thumb.plane !== undefined) p[T_PLANE] = thumb.plane * RAD; else this.thumbBeside(p, thumb.beside / 1000);
      return p;
    };
    this.poses = Object.fromEntries(Object.entries(ATTITUDES).map(([name, a]) => [name, pose(a)]));
    // For fromCurl: how the fingers lean, lying together and fanned wide, and where the thumb lies beside them, at each curl.
    this.table = [];
    for (let i = 0; i <= 8; i++) {
      const p = this.curled(i * 0.2, this.rest.slice()), together = i < 6 ? [0.003, 0.002, 0.002] : [0.0015, 0.001, 0.001];
      p[T_LIFT] = (14 + 4 * Math.min(i * 0.2, 1.6)) * RAD;
      const wide = this.openTo(p, [0.015, 0.012, 0.012]).slice(ABD, ABD + 4);
      for (let more = 0; more < 0.008; more += 0.0005) { this.openTo(p, together.map(g => g + more), p); if (clearance(this.solve(p).caps).fingers >= 0.0003) break; }
      this.table.push({ together: p.slice(ABD, ABD + 4), wide, thumb: this.thumbBeside(p, 0.002)[T_PLANE] });
    }
  }

  /** The bends of fromCurl, without the leaning. */
  curled(curl, out) {
    for (let n = 0; n < 4; n++) { out[MCP + n] = curl * (35 + 3.5 * n) * RAD; out[PIP + n] = curl * 38 * RAD; out[DIP + n] = 0.62 * out[PIP + n]; }
    // (The thumb lies in beside the first finger, as a hand at ease has it: the body is modelled with it held out.)
    const c = Math.min(curl, 1.6);
    out[T_MCP] = this.rest[T_MCP] + 5 * RAD * c; out[T_IP] = this.rest[T_IP] + 5 * RAD * c; out[ARCH] = 3 * RAD * Math.min(c, 1.2);
    return out;
  }

  /**
   * The pose for the one number the hand used to be held by: `curl` 0 (flat) .. 1 (a hand at ease is about
   * 0.86) .. 1.6 (a loose fist), `spread` 0 (fingers together) .. 1 (fanned wide). The bend is mostly at the
   * knuckles, a little more in each finger towards the little one. (It used to be mostly in the two end joints,
   * the knuckle at the palm hardly bent: a claw.)
   */
  fromCurl(curl, spread = 0, out = new Array(POSE_LENGTH)) {
    this.curled(curl, out);
    const s = clamp(spread, 0, 1), c = Math.min(Math.max(curl, 0), 1.6);
    out[T_LIFT] = (14 + 4 * c + 12 * s) * RAD;
    if (this.table) {
      const x = c / 0.2, i = Math.min(7, Math.floor(x)), k = x - i, a = this.table[i], b = this.table[i + 1];
      for (let n = 0; n < 4; n++) { const t = a.together[n] + (b.together[n] - a.together[n]) * k, w = a.wide[n] + (b.wide[n] - a.wide[n]) * k; out[ABD + n] = t + (w - t) * s; }
      // (The thumb comes away from the fingers as they part.)
      const beside = a.thumb + (b.thumb - a.thumb) * k; out[T_PLANE] = beside + (Math.max(beside, 40 * RAD) - beside) * s;
    } else {
      for (let n = 0; n < 4; n++) out[ABD + n] = this.rest[ABD + n] + (1.5 - n) * 0.13 * (s - 0.6);
      out[T_PLANE] = this.rest[T_PLANE] + (16 * RAD - this.rest[T_PLANE]) * (0.85 - 0.4 * s);
    }
    return out;
  }

  /**
   * The pose kept within what a hand does (humanref.js HAND, and what this body's skin will bear: see
   * the plan's appendix D): joints within their ranges, the end joint following the middle one, neighbouring
   * knuckles not too far apart, the thumb and the hollow of the palm within what the mesh takes without tearing.
   */
  limit(pose, out = pose) {
    for (let n = 0; n < 4; n++) {
      out[MCP + n] = clamp(pose[MCP + n], -10 * RAD, 85 * RAD); out[PIP + n] = clamp(pose[PIP + n], 0, 90 * RAD);
      out[DIP + n] = clamp(clamp(pose[DIP + n], 0.67 * out[PIP + n] - 15 * RAD, 0.67 * out[PIP + n] + 15 * RAD), -10 * RAD, 75 * RAD);
      out[ABD + n] = clamp(pose[ABD + n], this.rest[ABD + n] - 65 * RAD, this.rest[ABD + n] + 65 * RAD);
    }
    // (A finger cannot bend at the palm far from its neighbour: they share their muscles. The ring finger least.)
    for (const [a, b, most] of [[0, 1, 30], [1, 2, 20], [2, 3, 25]]) { const d = out[MCP + b] - out[MCP + a], over = Math.abs(d) - most * RAD; if (over > 0) { out[MCP + a] += Math.sign(d) * over / 2; out[MCP + b] -= Math.sign(d) * over / 2; } }
    out[T_PLANE] = pose[T_PLANE]; out[T_LIFT] = pose[T_LIFT];
    out[T_MCP] = clamp(pose[T_MCP], this.rest[T_MCP] - 10 * RAD, this.rest[T_MCP] + 35 * RAD); out[T_IP] = clamp(pose[T_IP], this.rest[T_IP] - 10 * RAD, this.rest[T_IP] + 45 * RAD);
    out[ARCH] = clamp(pose[ARCH], 0, 16 * RAD);
    return out;
  }
}
