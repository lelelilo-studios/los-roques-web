// The shape of your body, as plain arrays (no three, so it can be measured in a test): a jointed figure of
// tapered tubes posed from the walker's gait. Legs reach by two bones for where each foot is in its pace, arms
// swing against them, knees fold as you crouch, and the trunk moves back from the eye as you bend your head
// to look down. In water deep enough to carry you the same figure swims breaststroke (poseSwim).
//
// Proportions are those of a person whose eyes are 1.65 m above the ground: 1.76 m tall, hips at 0.93 m,
// shoulders 0.48 m across at 1.43 m, a 0.25 m foot. Local frame: +x right, +y up, forward is -z; the eye is
// at (0, eye height, 0) and the body's axis runs a hand's breadth behind it, as a neck does.
const SIDES = 10, BACK = 0.09;
const COS = Float64Array.from({ length: SIDES + 1 }, (_, k) => Math.cos(k / SIDES * 2 * Math.PI)), SIN = Float64Array.from({ length: SIDES + 1 }, (_, k) => Math.sin(k / SIDES * 2 * Math.PI));
const RING = new Float64Array((SIDES + 1) * 12);
const SKIN0 = [0.5, 0.36, 0.27], SHIRT0 = [0.56, 0.6, 0.6], SHORTS0 = [0.06, 0.14, 0.24];
export const THIGH = 0.45, SHIN = 0.42, ANKLE = 0.06, TORSO = 0.5, HIP = 0.09, SHOULDER = 0.175;
/** Vertices the body below the neck and the head can take (see poseBody). */
export const BODY_VERTICES = 6 * SIDES * 36 + 3 * SIDES * 12, HEAD_VERTICES = 6 * SIDES * 5 + 3 * SIDES;

/** Fills position / normal / colour arrays with tubes and boxes; the same calls in the same order every frame. */
export class Tubes {
  constructor(vertices) {
    this.pos = new Float32Array(vertices * 3); this.nor = new Float32Array(vertices * 3); this.col = new Float32Array(vertices * 3);
    this.n = 0;
  }
  vertex(p, normal, colour) {
    const i = this.n * 3;
    this.pos[i] = p[0]; this.pos[i + 1] = p[1]; this.pos[i + 2] = p[2];
    this.nor[i] = normal[0]; this.nor[i + 1] = normal[1]; this.nor[i + 2] = normal[2];
    this.col[i] = colour[0]; this.col[i + 1] = colour[1]; this.col[i + 2] = colour[2];
    this.n++;
  }
  /**
   * A tube from a to b. Radii are [across, fore-and-aft] at each end, so trunks can be wider than deep; the
   * rings lie square to the tube's axis, turned so that "across" stays the body's x.
   */
  tube(a, b, ra, rb, ca, cb = ca) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-6, wx = dx / len, wy = dy / len, wz = dz / len;
    // u = the body's x made square to the axis, v = axis x u.
    let ux = 1 - wx * wx, uy = -wx * wy, uz = -wx * wz;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = wy * uz - wz * uy, vy = wz * ux - wx * uz, vz = wx * uy - wy * ux;
    // (Where the tube narrows, its skin faces partly along it: a shoulder sloping to the neck faces up.)
    const lean = ((ra[0] + ra[1]) - (rb[0] + rb[1])) / (2 * len), ring = RING;
    // Both end rings once (position and normal of each point), then the quads between them: this runs for
    // every limb of everyone near you each frame, so nothing is allocated here.
    for (let k = 0, o = 0; k <= SIDES; k++) {
      const c = COS[k], sn = SIN[k];
      for (let e = 0; e < 2; e++, o += 6) {
        const p = e ? b : a, r = e ? rb : ra, cr = c * r[0], sr = sn * r[1], nc = c / r[0], ns = sn / r[1], nl = Math.hypot(nc, ns) || 1;
        const nx = (ux * nc + vx * ns) / nl + wx * lean, ny = (uy * nc + vy * ns) / nl + wy * lean, nz = (uz * nc + vz * ns) / nl + wz * lean, l = Math.hypot(nx, ny, nz) || 1;
        ring[o] = p[0] + ux * cr + vx * sr; ring[o + 1] = p[1] + uy * cr + vy * sr; ring[o + 2] = p[2] + uz * cr + vz * sr;
        ring[o + 3] = nx / l; ring[o + 4] = ny / l; ring[o + 5] = nz / l;
      }
    }
    const { pos, nor, col } = this;
    let i = this.n * 3;
    const put = (o, colour) => {
      pos[i] = ring[o]; pos[i + 1] = ring[o + 1]; pos[i + 2] = ring[o + 2]; nor[i] = ring[o + 3]; nor[i + 1] = ring[o + 4]; nor[i + 2] = ring[o + 5];
      col[i] = colour[0]; col[i + 1] = colour[1]; col[i + 2] = colour[2]; i += 3;
    };
    for (let k = 0; k < SIDES; k++) {
      const a0 = k * 12, b0 = a0 + 6, a1 = a0 + 12, b1 = a0 + 18;
      put(a0, ca); put(a1, ca); put(b1, cb); put(a0, ca); put(b1, cb); put(b0, cb);
    }
    this.n += SIDES * 6;
  }
  /** A rounded end on a tube (a low cone of triangles to a point just beyond b). */
  cap(a, b, r, colour, bulge = 0.6) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]) || 1e-6, w = [d[0] / len, d[1] / len, d[2] / len];
    const tip = [b[0] + w[0] * r[0] * bulge, b[1] + w[1] * r[0] * bulge, b[2] + w[2] * r[0] * bulge];
    let u = [1 - w[0] * w[0], -w[0] * w[1], -w[0] * w[2]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    const at = k => { const t = k / SIDES * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t); return [[b[0] + u[0] * c * r[0] + v[0] * s * r[1], b[1] + u[1] * c * r[0] + v[1] * s * r[1], b[2] + u[2] * c * r[0] + v[2] * s * r[1]], [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s]]; };
    for (let k = 0; k < SIDES; k++) { const [p0, n0] = at(k), [p1, n1] = at(k + 1); this.vertex(p0, n0, colour); this.vertex(p1, n1, colour); this.vertex(tip, w, colour); }
  }
  /** A foot: a rounded heel behind the ankle, widest at the ball, low at the toes. `fwd` is the unit direction the toes point (x, z). */
  foot(ankle, fwd, colour) {
    const y0 = ankle[1] - ANKLE, P = (along, up) => [ankle[0] + fwd[0] * along, y0 + up, ankle[2] + fwd[1] * along];
    const heel = P(-0.05, 0.036), arch = P(0.045, 0.036), ball = P(0.13, 0.024), toes = P(0.19, 0.014);
    this.tube(heel, arch, [0.031, 0.036], [0.038, 0.034], colour);
    this.tube(arch, ball, [0.038, 0.034], [0.048, 0.022], colour);
    this.tube(ball, toes, [0.048, 0.022], [0.042, 0.012], colour);
    this.cap(ball, toes, [0.042, 0.012], colour, 0.45);
    this.cap(arch, heel, [0.031, 0.036], colour, 0.5);
    // The ankle, from the end of the shin down into the foot.
    this.tube(ankle, P(0.0, 0.045), [0.034, 0.038], [0.034, 0.05], colour);
  }
}

/** Two bones of lengths l1, l2 from `hip` reaching for `target`, the joint between them bending towards `bend`. Returns the joint. */
export function reach(hip, target, l1, l2, bend) {
  const d = [target[0] - hip[0], target[1] - hip[1], target[2] - hip[2]];
  let len = Math.hypot(d[0], d[1], d[2]);
  const max = (l1 + l2) * 0.999;
  if (len > max) { for (let i = 0; i < 3; i++) target[i] = hip[i] + d[i] / len * max; len = max; }      // (the foot cannot go further than the leg is long)
  const w = [(target[0] - hip[0]) / len, (target[1] - hip[1]) / len, (target[2] - hip[2]) / len];
  const along = (l1 * l1 - l2 * l2 + len * len) / (2 * len), off = Math.sqrt(Math.max(l1 * l1 - along * along, 0));
  // The bend direction made square to the hip-to-target line.
  const k = bend[0] * w[0] + bend[1] * w[1] + bend[2] * w[2];
  let p = [bend[0] - w[0] * k, bend[1] - w[1] * k, bend[2] - w[2] * k];
  const pl = Math.hypot(p[0], p[1], p[2]) || 1;
  p = [p[0] / pl, p[1] / pl, p[2] / pl];
  return [hip[0] + w[0] * along + p[0] * off, hip[1] + w[1] * along + p[1] * off, hip[2] + w[2] * along + p[2] * off];
}

/**
 * Fills `t` (everything below the neck) and `h` (the head) for a pose. Returns the joints, for tests.
 * @param {Tubes} t  @param {Tubes} h
 * @param {object} p
 * @param {number} p.phase  the walker's gait phase (pi per pace)   @param {number} p.stride  0 standing .. 1 walking .. 1.6 running
 * @param {number} p.eye  height of the eye above the feet (1.65 standing, less crouched)
 * @param {number} [p.look]  radians the eye looks above the horizon: bending the head down carries the eye forward of the trunk
 * @param {{skin?: number[], shirt?: number[], shorts?: number[], hair?: number[]}} [p.colours]  for other people (yours are the defaults)
 * @param {[number, number]} [p.slope]  rise of the ground per metre forward and to the right: each foot is set down on it
 * @param {number} [p.wade]  0..1: in water to the chest the arms are held up and out, hands at the surface
 */
export function poseBody(t, h, { phase, stride, eye, look = 0, colours = {}, slope = [0, 0], wade = 0 }) {
  const SKIN = colours.skin || SKIN0, SHIRT = colours.shirt || SHIRT0, SHORTS = colours.shorts || SHORTS0, HAIR = colours.hair || SKIN;
  // (You lean into a hill, and back coming down one.)
  const crouch = Math.min(1, Math.max(0, (1.65 - eye) / 0.9)), lean = 0.08 * Math.min(stride, 1.6) + 0.8 * crouch + 0.35 * Math.max(-0.5, Math.min(0.7, slope[0]));
  const sy = eye - 0.22, shoulder = [0, sy, BACK + 0.02 + 0.1 * Math.max(0, -Math.sin(look))], joints = { knees: [], ankles: [], hips: [], wrists: [] };
  // Hips: under the shoulders standing, behind and below them as the trunk leans into a crouch.
  const hip = [0, Math.max(sy - TORSO * Math.cos(lean), 0.2), shoulder[2] + TORSO * Math.sin(lean) * 0.75];
  t.n = 0;
  // (Crouched you shuffle: short paces, the feet kept ahead of the hips, the knees up in front.)
  const s = Math.min(stride, 1.6), swing = 0.34 * s * (1 - 0.75 * crouch), lift = (0.1 * s + 0.02 * Math.max(s - 1, 0)) * (1 - 0.6 * crouch);
  // Where each foot is: planted and passing back under the body, then lifted and carried forward; set down on
  // the ground under it, which on a slope is higher or lower than the ground under you.
  const balance = shoulder[2] + (hip[2] - shoulder[2]) * (0.45 - 0.2 * crouch);
  const feet = [-1, 1].map(side => {
    const ph = phase + (side < 0 ? 0 : Math.PI), ankle = [side * (HIP + 0.01 + 0.05 * crouch), ANKLE + lift * Math.max(0, -Math.sin(ph)), balance - swing * Math.cos(ph) - 0.03];
    ankle[1] += Math.max(-0.35, Math.min(0.45, slope[0] * -ankle[2] + slope[1] * ankle[0]));
    return ankle;
  });
  // The hips ride just low enough for the more stretched leg to reach its foot: they dip at each pace when both
  // feet are down and far apart, and on a slope (without this the feet hung in the air at full stride).
  // (By a hand's breadth at most, more on a slope: at a run the feet are further apart than the legs can
  // span, and the trailing one is simply off the ground.)
  const standing = hip[1];
  feet.forEach((ankle, i) => {
    const dx = ankle[0] - (i ? HIP : -HIP), dz = ankle[2] - hip[2], most = (THIGH + SHIN) * 0.995;
    hip[1] = Math.max(standing - 0.11 - 0.45 * Math.min(Math.abs(slope[0]), 0.7) - 0.2 * Math.min(Math.abs(slope[1]), 0.7), Math.min(hip[1], ankle[1] + Math.sqrt(Math.max(most * most - dx * dx - dz * dz, 0.04))));
  });
  for (const side of [-1, 1]) {
    const ph = phase + (side < 0 ? 0 : Math.PI), c = Math.cos(ph);
    const hipJ = [side * HIP, hip[1], hip[2]], ankle = feet[side < 0 ? 0 : 1];
    const knee = reach(hipJ, ankle, THIGH, SHIN, [side * 0.12 * (1 + crouch), 0, -1]);
    const hem = [hipJ[0] + (knee[0] - hipJ[0]) * 0.55, hipJ[1] + (knee[1] - hipJ[1]) * 0.55, hipJ[2] + (knee[2] - hipJ[2]) * 0.55];
    t.tube(hipJ, hem, [0.088, 0.092], [0.074, 0.076], SHORTS);
    t.tube(hem, knee, [0.07, 0.072], [0.056, 0.058], SKIN);
    const calf = [knee[0] + (ankle[0] - knee[0]) * 0.35, knee[1] + (ankle[1] - knee[1]) * 0.35, knee[2] + (ankle[2] - knee[2]) * 0.35 + 0.012];
    t.tube(knee, calf, [0.054, 0.056], [0.052, 0.058], SKIN);
    t.tube(calf, ankle, [0.052, 0.058], [0.034, 0.038], SKIN);
    t.foot(ankle, [side * 0.12, -0.993], SKIN);
    joints.hips.push(hipJ); joints.knees.push(knee); joints.ankles.push(ankle);
    // The arm swings against its leg; the elbow bends more the faster you go.
    const sh = [side * SHOULDER, sy - 0.01, shoulder[2]], a = (0.55 * swing * c * 1.6) * (1 - 0.7 * wade) + 0.25 * crouch + 0.75 * wade, bend = 0.18 + 0.3 * Math.min(s, 1) + 0.5 * crouch + 0.75 * wade;
    const elbow = [sh[0] + side * (0.025 + 0.14 * wade), sh[1] - 0.29 * Math.cos(a), sh[2] - 0.29 * Math.sin(a)];
    const wrist = [elbow[0] - side * 0.015, elbow[1] - 0.25 * Math.cos(a + bend), elbow[2] - 0.25 * Math.sin(a + bend)];
    const tip = [wrist[0] - side * 0.01, wrist[1] - 0.17 * Math.cos(a + bend + 0.15), wrist[2] - 0.17 * Math.sin(a + bend + 0.15)];
    const sleeve = [sh[0] + (elbow[0] - sh[0]) * 0.5, sh[1] + (elbow[1] - sh[1]) * 0.5, sh[2] + (elbow[2] - sh[2]) * 0.5];
    t.tube(sh, sleeve, [0.052, 0.056], [0.047, 0.05], SHIRT);
    t.tube(sleeve, elbow, [0.042, 0.045], [0.036, 0.038], SKIN);
    t.tube(elbow, wrist, [0.036, 0.04], [0.026, 0.03], SKIN);
    t.tube(wrist, tip, [0.036, 0.018], [0.03, 0.012], SKIN);
    t.cap(wrist, tip, [0.03, 0.012], SKIN);
    t.tube([sh[0] - side * 0.01, sh[1] - 0.012, sh[2]], [side * 0.075, sy + 0.03, sh[2] - 0.01], [0.045, 0.056], [0.03, 0.045], SHIRT);      // the slope from the shoulder to the neck
    t.cap(sleeve, sh, [0.052, 0.056], SHIRT, 0.3);                    // the round of the shoulder
    joints.wrists.push(wrist);
  }
  // The trunk: seat, hips, waist, chest, shoulders, up to the base of the neck.
  const on = k => [0, hip[1] + (shoulder[1] - hip[1]) * k, hip[2] + (shoulder[2] - hip[2]) * k];
  const seat = [0, hip[1] - 0.09, hip[2] + 0.01];
  t.tube(seat, on(0.04), [0.15, 0.1], [0.172, 0.118], SHORTS);
  t.tube(on(0.04), on(0.2), [0.172, 0.118], [0.16, 0.112], SHORTS);
  t.tube(on(0.2), on(0.42), [0.162, 0.114], [0.148, 0.106], SHIRT);
  t.tube(on(0.42), on(0.74), [0.148, 0.106], [0.172, 0.12], SHIRT);
  t.tube(on(0.74), on(0.9), [0.172, 0.12], [0.168, 0.112], SHIRT);
  // (The shoulders slope up to the neck; the collar closes the trunk, so looking down you see your shirt, not into it.)
  const collar = [0, sy + 0.07, shoulder[2] - 0.012 - 0.03 * crouch], neck = [0, sy + 0.1, collar[2]];
  t.tube(on(0.9), collar, [0.168, 0.112], [0.07, 0.066], SHIRT);
  t.cap(on(0.9), collar, [0.07, 0.066], SHIRT, 0.25);
  t.cap(on(0.04), seat, [0.15, 0.1], SHORTS, 0.35);

  // The head (for the shadow): neck, jaw, the widest part at the temples, crown.
  const z = neck[2] - 0.01 - 0.04 * crouch, top = eye + 0.11;
  h.n = 0;
  h.tube(neck, [0, eye - 0.13, z], [0.056, 0.058], [0.05, 0.056], SKIN);
  h.tube([0, eye - 0.13, z], [0, eye - 0.06, z - 0.005], [0.058, 0.075], [0.074, 0.092], SKIN);
  h.tube([0, eye - 0.06, z - 0.005], [0, eye + 0.03, z], [0.074, 0.092], [0.078, 0.098], SKIN, HAIR);
  h.tube([0, eye + 0.03, z], [0, top - 0.035, z + 0.004], [0.078, 0.098], [0.062, 0.08], HAIR);
  h.cap([0, eye + 0.03, z], [0, top - 0.035, z + 0.004], [0.062, 0.08], HAIR, 0.55);
  return { ...joints, hip, shoulder };
}

const UPPER_ARM = 0.29, FOREARM = 0.25, HAND = 0.17;
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const ease = (a, b, v) => { const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return k * k * (3 - 2 * k); };

/**
 * Fills `t` and `h` with the body swimming breaststroke: lying in the water behind the eye, arms reaching
 * forward, sweeping out and back and tucking in under the chest; legs drawing up and kicking as the arms
 * recover. Here the eye is the origin (forward is -z): place the meshes at the eye.
 * @param {object} p
 * @param {number} p.stroke  phase of the stroke, radians (2 pi per stroke)
 * @param {number} [p.under]  0 at the surface (the body slopes down behind the head), 1 dived (it lies along the way you look)
 */
export function poseSwim(t, h, { stroke, under = 0 }) {
  const SKIN = SKIN0, SHIRT = SHIRT0, SHORTS = SHORTS0;
  t.n = 0; h.n = 0;
  const u = stroke / (2 * Math.PI) - Math.floor(stroke / (2 * Math.PI));
  // (At the surface only the head is out of the water: the shoulders ride a hand's breadth under it, and the
  // arms work below the surface, seen through it. Dived, the body lies in line with the head.)
  const chest = [0, -0.3 + 0.14 * under, 0.1], sink = 0.34 - 0.3 * under, hip = [0, chest[1] - TORSO * sink, chest[2] + TORSO * Math.sqrt(1 - sink * sink)];
  const joints = { hips: [], knees: [], ankles: [], shoulders: [], elbows: [], wrists: [], hip, chest };
  // How far through each part of the stroke: the pull (hands out and back), the tuck (hands in under the chest,
  // knees drawn up), the reach (hands shoot forward as the legs kick).
  const pull = ease(0.38, 0.68, u), tuck = ease(0.68, 0.84, u), shoot = ease(0.84, 1.0, u), drawn = ease(0.6, 0.84, u) * (1 - ease(0.86, 0.98, u));
  for (const side of [-1, 1]) {
    // Arms.
    const sh = [side * SHOULDER, chest[1] + 0.02, chest[2]];
    const ahead = [sh[0] - side * 0.11, sh[1] - 0.05, sh[2] - 0.5], out = [sh[0] + side * 0.27, sh[1] - 0.08, sh[2] - 0.24], inn = [sh[0] - side * 0.07, sh[1] - 0.19, sh[2] - 0.13];
    const target = lerp3(lerp3(lerp3(ahead, out, pull), inn, tuck), ahead, shoot);
    const elbow = reach(sh, target, UPPER_ARM, FOREARM, [side * 0.8, -0.6, 0.1]);
    const dir = [target[0] - elbow[0], target[1] - elbow[1], target[2] - elbow[2]], dl = Math.hypot(...dir) || 1;
    const tip = [target[0] + dir[0] / dl * HAND, target[1] + dir[1] / dl * HAND, target[2] + dir[2] / dl * HAND];
    const sleeve = lerp3(sh, elbow, 0.3);                               // (short sleeves, pushed up by the water)
    t.tube(sh, sleeve, [0.052, 0.056], [0.047, 0.05], SHIRT);
    t.tube(sleeve, elbow, [0.042, 0.045], [0.036, 0.038], SKIN);
    t.tube(elbow, target, [0.036, 0.04], [0.026, 0.03], SKIN);
    t.tube(target, tip, [0.04, 0.016], [0.034, 0.011], SKIN);            // the hand, flat like a paddle
    t.cap(target, tip, [0.034, 0.011], SKIN);
    t.tube([sh[0], sh[1], sh[2]], [side * 0.08, chest[1] + 0.05, chest[2] - 0.01], [0.05, 0.058], [0.05, 0.05], SHIRT);
    joints.shoulders.push(sh); joints.elbows.push(elbow); joints.wrists.push(target);
    // Legs: trailing straight, drawn up with the knees apart, kicked back.
    const hipJ = [side * HIP, hip[1], hip[2]], back = [hip[2] - chest[2], hip[1] - chest[1]], bl = Math.hypot(back[0], back[1]) || 1, bz = back[0] / bl, by = back[1] / bl;
    const straight = [hipJ[0] + side * 0.03, hipJ[1] + by * 0.84 + 0.03, hipJ[2] + bz * 0.84], up = [hipJ[0] + side * 0.3, hipJ[1] + by * 0.4 - 0.06, hipJ[2] + bz * 0.4];
    const ankle = lerp3(straight, up, drawn), knee = reach(hipJ, ankle, THIGH, SHIN, [side * 0.9, -0.5, -0.2]);
    const hem = lerp3(hipJ, knee, 0.55), calf = lerp3(knee, ankle, 0.35);
    t.tube(hipJ, hem, [0.088, 0.092], [0.074, 0.076], SHORTS);
    t.tube(hem, knee, [0.07, 0.072], [0.056, 0.058], SKIN);
    t.tube(knee, calf, [0.054, 0.056], [0.052, 0.058], SKIN);
    t.tube(calf, ankle, [0.052, 0.058], [0.034, 0.038], SKIN);
    // (The foot trails along the shin, toes pointed.)
    const shin = [ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2]], sl = Math.hypot(...shin) || 1;
    const toes = [ankle[0] + shin[0] / sl * 0.21 + side * 0.03 * drawn, ankle[1] + shin[1] / sl * 0.21, ankle[2] + shin[2] / sl * 0.21];
    t.tube(ankle, toes, [0.036, 0.04], [0.046, 0.013], SKIN);
    t.cap(ankle, toes, [0.046, 0.013], SKIN, 0.4);
    joints.hips.push(hipJ); joints.knees.push(knee); joints.ankles.push(ankle);
  }
  const on = k => lerp3(hip, chest, k), seat = lerp3(hip, chest, -0.18);
  t.tube(seat, on(0.04), [0.15, 0.1], [0.172, 0.118], SHORTS);
  t.tube(on(0.04), on(0.2), [0.172, 0.118], [0.16, 0.112], SHORTS);
  t.tube(on(0.2), on(0.42), [0.162, 0.114], [0.148, 0.106], SHIRT);
  t.tube(on(0.42), on(0.74), [0.148, 0.106], [0.172, 0.12], SHIRT);
  t.tube(on(0.74), on(1.0), [0.172, 0.12], [0.168, 0.11], SHIRT);
  const collar = [0, -0.09, 0.07];
  t.tube(on(1.0), collar, [0.168, 0.11], [0.07, 0.066], SHIRT);
  t.cap(on(1.0), collar, [0.07, 0.066], SHIRT, 0.25);
  t.cap(on(0.04), seat, [0.15, 0.1], SHORTS, 0.35);
  // The head, round the eye (only ever drawn into the shadow map).
  h.tube(collar, [0, -0.07, 0.03], [0.056, 0.058], [0.058, 0.075], SKIN);
  h.tube([0, -0.07, 0.03], [0, 0.03, 0.03], [0.074, 0.092], [0.078, 0.098], SKIN);
  h.tube([0, 0.03, 0.03], [0, 0.085, 0.035], [0.078, 0.098], [0.062, 0.08], SKIN);
  h.cap([0, 0.03, 0.03], [0, 0.085, 0.035], [0.062, 0.08], SKIN, 0.55);
  return joints;
}

/**
 * Someone strolling up and down a stretch of shore: where they are, which way they face and how they step at
 * time t (seconds). `stroll` = { dir: unit [east, south] along the shore, reach: metres each way, speed: m/s on
 * average }, from (x0, z0). They slow to a stop at each end, turn round over a second or so, and set off again.
 * Returns { x, z, yaw (radians, as the walker's), phase, stride } for poseBody.
 */
export function strollAt(stroll, x0, z0, t) {
  const leg = 2 * stroll.reach / stroll.speed, q = t / leg, n = Math.floor(q), v = q - n, back = ((n % 2) + 2) % 2 === 1;
  const eased = 0.5 - 0.5 * Math.cos(Math.PI * v), along = ((back ? 1 - eased : eased) * 2 - 1) * stroll.reach;
  // Turning: a quarter turn out of the last leg, a quarter turn into the next, always the same way round.
  const k = Math.min(1, Math.min(v, 1 - v) * leg / 1.2), turned = 1 - k * k * (3 - 2 * k);
  const ahead = Math.atan2(stroll.dir[0], -stroll.dir[1]) + (back ? Math.PI : 0);
  return {
    x: x0 + stroll.dir[0] * along, z: z0 + stroll.dir[1] * along, yaw: ahead - turned * (v < 0.5 ? -1 : 1) * Math.PI / 2,
    // (The paces follow the ground actually covered, and shorten as they slow.)
    phase: (n + eased) * 2 * stroll.reach / 0.72 * Math.PI, stride: 0.12 + 0.8 * Math.sin(Math.PI * v) * Math.min(1.3, stroll.speed * 1.5708 / 1.4),
  };
}

