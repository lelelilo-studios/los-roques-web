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
 * How much room there is between the fingers of a hand, from its rods as posed (`caps`: for each finger, index
 * to little, its three rods { a, b, r, w }): the gap between each finger and the next at their middle bones
 * (metres; negative: they pass through one another), by the rods' widths across the hand.
 */
export function fingerGaps(caps) {
  // (Between their middle bones: at their roots fingers are joined by the web, and are never apart.)
  return [0, 1, 2].map(n => { const p = caps[n][1], q = caps[n + 1][1]; return between(p.a, p.b, q.a, q.b) - p.w - q.w; });
}

/**
 * How near the parts of a posed hand come to one another (metres; negative: one passes through another), from
 * its rods (`caps`: { fingers, thumb, palm }): `fingers`: a finger and the next, anywhere beyond their roots;
 * `palm`: a fingertip and the palm; `thumb`: the thumb's end and the first finger.
 */
export function clearance(caps) {
  let fingers = Infinity, palm = Infinity, thumb = Infinity;
  for (let n = 0; n < 3; n++) for (const j of [1, 2]) for (const k of [1, 2]) { const p = caps.fingers[n][j], q = caps.fingers[n + 1][k]; fingers = Math.min(fingers, between(p.a, p.b, q.a, q.b) - p.w - q.w); }
  for (const f of caps.fingers) for (const m of caps.palm) palm = Math.min(palm, between(f[2].a, f[2].b, m.a, m.b) - f[2].r - m.t);
  for (const q of caps.fingers[0]) thumb = Math.min(thumb, between(caps.thumb[2].a, caps.thumb[2].b, q.a, q.b) - caps.thumb[2].r - q.r);
  return { fingers, palm, thumb };
}

/** How near two posed hands come to one another (metres), by the rods of their fingers and thumbs. */
export function handsApart(a, b) {
  let least = Infinity;
  const rods = c => [...c.fingers.flat(), ...c.thumb, ...c.palm];
  for (const p of rods(a)) for (const q of rods(b)) least = Math.min(least, between(p.a, p.b, q.a, q.b) - p.r - q.r);
  return least;
}
