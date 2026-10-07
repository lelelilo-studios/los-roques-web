// The shape of your body, as plain arrays (no three, so it can be measured in a test): a jointed figure of
// tapered tubes posed from the walker's gait. Legs reach by two bones for where each foot is in its pace, arms
// swing against them, knees fold as you crouch, and the trunk moves back from the eye as you bend your head
// to look down. In water deep enough to carry you the same figure swims breaststroke (poseSwim).
//
// Proportions are those of a person whose eyes are 1.65 m above the ground: 1.76 m tall, hips at 0.93 m,
// shoulders 0.48 m across at 1.43 m, an upper arm of 0.32 m and a forearm of 0.255 m, a hand 0.19 m long, a foot
// of 0.26 m. Local frame: +x right, +y up, forward is -z; the eye is
// at (0, eye height, 0) and the body's axis runs a hand's breadth behind it, as a neck does.
const SIDES = 16, BACK = 0.09;
const COS = Float64Array.from({ length: SIDES + 1 }, (_, k) => Math.cos(k / SIDES * 2 * Math.PI)), SIN = Float64Array.from({ length: SIDES + 1 }, (_, k) => Math.sin(k / SIDES * 2 * Math.PI));
const RING = new Float64Array((SIDES + 1) * 12);
const SKIN0 = [0.5, 0.36, 0.27], SHIRT0 = [0.56, 0.6, 0.6], SHORTS0 = [0.06, 0.14, 0.24], NAIL = [0.66, 0.5, 0.44];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const THIGH = 0.45, SHIN = 0.42, ANKLE = 0.06, TORSO = 0.5, HIP = 0.09, SHOULDER = 0.175;
/** Vertices the body below the neck and the head can take (see poseBody). */
export const BODY_VERTICES = 6 * SIDES * 36 + 3 * SIDES * 12, HEAD_VERTICES = 6 * SIDES * 5 + 3 * SIDES;
/** The same with `detail` (your own body: hands with fingers and thumbs, feet with toes). */
export const BODY_VERTICES_DETAIL = BODY_VERTICES + 108 * SIDES + 6800;
const LIMB = new Float64Array(11 * 12), SKIN_RINGS = new Float64Array(8 * (SIDES + 1) * 6);
const add = (p, a, ka, b = null, kb = 0, c = null, kc = 0) => [p[0] + a[0] * ka + (b ? b[0] * kb : 0) + (c ? c[0] * kc : 0), p[1] + a[1] * ka + (b ? b[1] * kb : 0) + (c ? c[1] * kc : 0), p[2] + a[2] * ka + (b ? b[2] * kb : 0) + (c ? c[2] * kc : 0)];
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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
  tube(a, b, ra, rb, ca, cb = ca, leanA = null, leanB = null) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-6, wx = dx / len, wy = dy / len, wz = dz / len;
    // u = the body's x made square to the axis, v = axis x u.
    let ux = 1 - wx * wx, uy = -wx * wy, uz = -wx * wz;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = wy * uz - wz * uy, vy = wz * ux - wx * uz, vz = wx * uy - wy * ux;
    // (Where the tube narrows, its skin faces partly along it: a shoulder sloping to the neck faces up.)
    const own = ((ra[0] + ra[1]) - (rb[0] + rb[1])) / (2 * len), ring = RING;
    // Both end rings once (position and normal of each point), then the quads between them: this runs for
    // every limb of everyone near you each frame, so nothing is allocated here.
    for (let k = 0, o = 0; k <= SIDES; k++) {
      const c = COS[k], sn = SIN[k];
      for (let e = 0; e < 2; e++, o += 6) {
        const p = e ? b : a, r = e ? rb : ra, cr = c * r[0], sr = sn * r[1], nc = c / r[0], ns = sn / r[1], nl = Math.hypot(nc, ns) || 1;
        const lean = (e ? leanB : leanA) ?? own;
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
  /**
   * Consecutive tubes through `pts`, with a radius pair per point and a colour per stretch. The slant of the
   * skin is shared at the joints, so the light does not jump from one stretch to the next (a trunk built of
   * separate tubes showed as bands).
   */
  chain(pts, radii, colours) { this.skin(pts, radii, colours, null, SIDES); }
  /**
   * One skin over a line of points: the ring at each point between two stretches is shared by both and lies
   * across the bend (square to the mean of their directions), so the stretches meet all the way round. (Rings
   * square to each stretch's own axis left a wedge open on the outside of every bend: dark slits across the
   * instep and at the finger joints.) `across` is where the first radius of each pair points (the body's x if
   * null); `n` sides (at most SIDES); `tip` > 0 rounds the far end off that far beyond the last point. `tint` =
   * { dir, colour }: skin facing `dir` takes that colour instead (the palm of a hand is paler than its back).
   */
  skin(pts, radii, colours, across = null, n = SIDES, tip = 0, tint = null) {
    const m = pts.length, dirs = [], ring = SKIN_RINGS, step = (n + 1) * 6;
    for (let i = 0; i < m - 1; i++) dirs.push(unit([pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]]));
    const taper = i => ((radii[i][0] + radii[i][1]) - (radii[i + 1][0] + radii[i + 1][1])) / (2 * (Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]) || 1e-6));
    for (let i = 0; i < m; i++) {
      const before = dirs[Math.max(i - 1, 0)], after = dirs[Math.min(i, m - 2)], w = unit([before[0] + after[0], before[1] + after[1], before[2] + after[2]]);
      // (Where the skin narrows it faces partly along itself: a shoulder sloping to the neck faces up.)
      const lean = ((i > 0 ? taper(i - 1) : taper(0)) + (i < m - 1 ? taper(i) : taper(m - 2))) / 2;
      const k = across ? across[0] * w[0] + across[1] * w[1] + across[2] * w[2] : w[0];
      const u = unit(across ? [across[0] - w[0] * k, across[1] - w[1] * k, across[2] - w[2] * k] : [1 - w[0] * w[0], -w[0] * w[1], -w[0] * w[2]]), v = cross(w, u), r = radii[i], p = pts[i];
      // (A ring across a bend is stretched along the bend: by one over the cosine of half the turn.)
      const wide = 1 / Math.max(0.5, before[0] * w[0] + before[1] * w[1] + before[2] * w[2]), bend = unit(cross(cross(before, after), w)), ub = u[0] * bend[0] + u[1] * bend[1] + u[2] * bend[2], vb = v[0] * bend[0] + v[1] * bend[1] + v[2] * bend[2];
      for (let j = 0, o = i * step; j <= n; j++, o += 6) {
        const t = j / n * 2 * Math.PI, c = Math.cos(t), sn = Math.sin(t), cr = c * r[0], sr = sn * r[1], along = (cr * ub + sr * vb) * (wide - 1), nc = c / r[0], ns = sn / r[1], nl = Math.hypot(nc, ns) || 1;
        const nx = (u[0] * nc + v[0] * ns) / nl + w[0] * lean, ny = (u[1] * nc + v[1] * ns) / nl + w[1] * lean, nz = (u[2] * nc + v[2] * ns) / nl + w[2] * lean, l = Math.hypot(nx, ny, nz) || 1;
        ring[o] = p[0] + u[0] * cr + v[0] * sr + bend[0] * along; ring[o + 1] = p[1] + u[1] * cr + v[1] * sr + bend[1] * along; ring[o + 2] = p[2] + u[2] * cr + v[2] * sr + bend[2] * along;
        ring[o + 3] = nx / l; ring[o + 4] = ny / l; ring[o + 5] = nz / l;
      }
    }
    const { pos, nor, col } = this;
    let q = this.n * 3;
    const put = (o, colour) => {
      pos[q] = ring[o]; pos[q + 1] = ring[o + 1]; pos[q + 2] = ring[o + 2]; nor[q] = ring[o + 3]; nor[q + 1] = ring[o + 4]; nor[q + 2] = ring[o + 5];
      if (tint) {
        const k = Math.min(1, Math.max(0, (ring[o + 3] * tint.dir[0] + ring[o + 4] * tint.dir[1] + ring[o + 5] * tint.dir[2] + 0.15) / 0.8));
        col[q] = colour[0] + (tint.colour[0] - colour[0]) * k; col[q + 1] = colour[1] + (tint.colour[1] - colour[1]) * k; col[q + 2] = colour[2] + (tint.colour[2] - colour[2]) * k;
      } else { col[q] = colour[0]; col[q + 1] = colour[1]; col[q + 2] = colour[2]; }
      q += 3;
    };
    for (let i = 0; i < m - 1; i++) {
      const colour = Array.isArray(colours[0]) ? colours[i] : colours;
      for (let j = 0; j < n; j++) { const a0 = i * step + j * 6, a1 = a0 + 6, b0 = a0 + step, b1 = b0 + 6; put(a0, colour); put(a1, colour); put(b1, colour); put(a0, colour); put(b1, colour); put(b0, colour); }
    }
    if (tip > 0) {
      const colour = Array.isArray(colours[0]) ? colours[m - 2] : colours, w = dirs[m - 2], end = pts[m - 1];
      for (let j = 0; j < n; j++) {
        put((m - 1) * step + j * 6, colour); put((m - 1) * step + j * 6 + 6, colour);
        pos[q] = end[0] + w[0] * tip; pos[q + 1] = end[1] + w[1] * tip; pos[q + 2] = end[2] + w[2] * tip; nor[q] = w[0]; nor[q + 1] = w[1]; nor[q + 2] = w[2];
        col[q] = colour[0]; col[q + 1] = colour[1]; col[q + 2] = colour[2]; q += 3;
      }
    }
    this.n = q / 3;
  }

  /**
   * A tube from a to b with a frame of its own, for the parts that do not lie the way the body does (the palm
   * of a hand, fingers, toes). `u` (any direction not along the tube) is where the first radius of each pair
   * points; the second is square to it and to the tube. `n` sides; `tip` > 0 rounds the far end off that far
   * beyond b.
   */
  limb(a, b, u, ra, rb, colour, n = 5, tip = 0) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-6, wx = dx / len, wy = dy / len, wz = dz / len;
    const k = u[0] * wx + u[1] * wy + u[2] * wz;
    let ux = u[0] - wx * k, uy = u[1] - wy * k, uz = u[2] - wz * k;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = wy * uz - wz * uy, vy = wz * ux - wx * uz, vz = wx * uy - wy * ux, lean = ((ra[0] + ra[1]) - (rb[0] + rb[1])) / (2 * len), ring = LIMB;
    for (let i = 0, o = 0; i <= n; i++) {
      const t = i / n * 2 * Math.PI, c = Math.cos(t), sn = Math.sin(t);
      for (let e = 0; e < 2; e++, o += 6) {
        const p = e ? b : a, r = e ? rb : ra, cr = c * r[0], sr = sn * r[1], nc = c / r[0], ns = sn / r[1], nl = Math.hypot(nc, ns) || 1;
        const nx = (ux * nc + vx * ns) / nl + wx * lean, ny = (uy * nc + vy * ns) / nl + wy * lean, nz = (uz * nc + vz * ns) / nl + wz * lean, l = Math.hypot(nx, ny, nz) || 1;
        ring[o] = p[0] + ux * cr + vx * sr; ring[o + 1] = p[1] + uy * cr + vy * sr; ring[o + 2] = p[2] + uz * cr + vz * sr;
        ring[o + 3] = nx / l; ring[o + 4] = ny / l; ring[o + 5] = nz / l;
      }
    }
    const { pos, nor, col } = this;
    let j = this.n * 3;
    const put = o => {
      pos[j] = ring[o]; pos[j + 1] = ring[o + 1]; pos[j + 2] = ring[o + 2]; nor[j] = ring[o + 3]; nor[j + 1] = ring[o + 4]; nor[j + 2] = ring[o + 5];
      col[j] = colour[0]; col[j + 1] = colour[1]; col[j + 2] = colour[2]; j += 3;
    };
    for (let i = 0; i < n; i++) {
      const a0 = i * 12, b0 = a0 + 6, a1 = a0 + 12, b1 = a0 + 18;
      put(a0); put(a1); put(b1); put(a0); put(b1); put(b0);
      if (tip > 0) {
        put(b0); put(b1);
        pos[j] = b[0] + wx * tip; pos[j + 1] = b[1] + wy * tip; pos[j + 2] = b[2] + wz * tip; nor[j] = wx; nor[j + 1] = wy; nor[j + 2] = wz;
        col[j] = colour[0]; col[j + 1] = colour[1]; col[j + 2] = colour[2]; j += 3;
      }
    }
    this.n = j / 3;
  }
  /** A nail: a small plate on the last joint of a finger or toe, from `a` to `b` along it, `w` wide, facing `out`. */
  nail(a, b, across, w, out) {
    const A = add(a, across, -w), B = add(a, across, w), C = add(b, across, w * 0.8), D = add(b, across, -w * 0.8);
    for (const q of [A, B, C, A, C, D]) this.vertex(q, out, NAIL);
  }
  /**
   * A hand from the wrist on: the palm, four fingers of their own lengths and a thumb. `f` = the way the forearm
   * points, `palm` = the way the palm faces, `side` -1 left / +1 right, `curl` 0 (held flat) .. 1 (a loose fist):
   * a hand hanging at rest is about half curled. `spread` 0 (fingers together) .. 1 (fanned apart, gaps between
   * them). Returns the tip of the middle finger; this.palm then holds the hand's frame: { wrist, knuckles, f (the way
   * it points), N (the way the palm faces), A (across it, towards the thumb) }. With `elbow`, the forearm is drawn
   * too, in one skin with the palm: round at the elbow, flattening to the wrist (which is wider across the hand
   * than it is thick), and on into the heel of the hand, with no joint showing however the hand is bent.
   */
  hand(wrist, f, palm, side, curl, colour, spread = 0, elbow = null) {
    const k = palm[0] * f[0] + palm[1] * f[1] + palm[2] * f[2], N = unit([palm[0] - f[0] * k, palm[1] - f[1] * k, palm[2] - f[2] * k]);
    const fxN = cross(f, N), A = [fxN[0] * side, fxN[1] * side, fxN[2] * side];        // across the palm, towards the thumb
    const K = add(wrist, f, 0.096);
    this.palm = { wrist: wrist.slice(), knuckles: K, f: f.slice(), N, A };
    // The palm is paler than the back of the hand, and so are the pads of the fingers.
    const pale = { dir: N, colour: [colour[0] * 1.22, colour[1] * 1.2, colour[2] * 1.24] }, back = [-N[0], -N[1], -N[2]];
    if (elbow) {
      const w = unit([wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]]), len = Math.hypot(wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]);
      this.skin([elbow, add(elbow, w, 0.55 * len), add(wrist, w, -0.03), wrist, add(wrist, f, 0.034), add(wrist, f, 0.068), K],
        [[0.037, 0.039], [0.031, 0.032], [0.0255, 0.0215], [0.0265, 0.0178], [0.0355, 0.0165], [0.0395, 0.013], [0.04, 0.0115]], colour, A, 10, 0, pale);
    } else {
      // (One skin from inside the wrist to the knuckles: closed at the wrist, however the hand is bent.)
      this.skin([add(wrist, f, -0.016), add(wrist, f, -0.004), wrist, add(wrist, f, 0.034), add(wrist, f, 0.068), K], [[0.006, 0.005], [0.022, 0.015], [0.0265, 0.0178], [0.0355, 0.0165], [0.0395, 0.013], [0.04, 0.0115]], colour, A, 8, 0, pale);
    }
    // The ball of the thumb: a cushion on the palm at the thumb's root, with the hollow that things lie in
    // beside it. (The heel of the hand, on the other side, is in the palm's own thickness there. A cushion of
    // its own showed as a patch.)
    const pad = (c, d, len, r) => this.skin([-1, -0.82, -0.45, 0, 0.45, 0.82, 1].map(k => add(c, d, k * len)), [0.12, 0.58, 0.9, 1, 0.9, 0.58, 0.12].map(k => [r[0] * k, r[1] * k]), colour, A, 8, 0, pale);
    pad(add(wrist, f, 0.036, A, 0.017, N, 0.005), unit(add([0, 0, 0], f, 0.85, A, 0.5)), 0.03, [0.0155, 0.0125]);
    let middle = K;
    for (let i = 0; i < 4; i++) {
      // Three bones to a finger, each bent a little more than the one before it (a relaxed hand curls most at
      // the tips); the fingers lie side by side, the little one set back along the knuckle line. A finger is
      // thickest at its joints and waisted between them, a little flattened, the pad of its tip rounded.
      const L = [0.076, 0.085, 0.079, 0.062][i], r = [0.0088, 0.0092, 0.0088, 0.0077][i], c1 = curl * (0.4 + 0.1 * i), c2 = c1 + curl * 0.7, c3 = c2 + curl * 0.55;
      // (Spread, each finger turns a few degrees away from the middle of the hand, and its root moves with it.)
      const fan = (1.5 - i) * 0.13 * spread, g = add([0, 0, 0], f, Math.cos(fan), A, Math.sin(fan));
      const B = add(K, A, 0.0285 - 0.019 * i + (1.5 - i) * 0.0025 * spread, f, -0.0016 * i * i);
      const M1 = add(B, g, Math.cos(c1) * 0.46 * L, N, Math.sin(c1) * 0.46 * L), M2 = add(M1, g, Math.cos(c2) * 0.29 * L, N, Math.sin(c2) * 0.29 * L), T = add(M2, g, Math.cos(c3) * 0.25 * L, N, Math.sin(c3) * 0.25 * L);
      const mid = (p, q2) => [(p[0] + q2[0]) / 2, (p[1] + q2[1]) / 2, (p[2] + q2[2]) / 2], flat = 0.9;
      this.skin([B, mid(B, M1), M1, mid(M1, M2), M2, mid(M2, T), T],
        [[r, r * flat], [r * 0.9, r * 0.84], [r * 0.97, r * 0.88], [r * 0.83, r * 0.77], [r * 0.9, r * 0.8], [r * 0.8, r * 0.74], [r * 0.7, r * 0.6]], colour, A, 8, r * 0.62, pale);
      this.skin([add(B, f, -0.011, back, 0.0065), add(B, back, 0.0085), add(B, f, 0.01, back, 0.006)], [[0.002, 0.002], [r * 0.95, r * 0.6], [0.002, 0.002]], colour, A, 6);      // the knuckle
      // (The nail lies on the back of the last joint.)
      const along = [T[0] - M2[0], T[1] - M2[1], T[2] - M2[2]];
      this.nail(add(M2, along, 0.2, back, r * 0.78), add(M2, along, 0.86, back, r * 0.64), A, r * 0.56, back);
      if (i === 1) middle = T;
    }
    // The thumb stands off the edge of the palm, turned towards the fingers: its root is in the ball of the thumb.
    const B = add(wrist, f, 0.03, A, 0.028, N, 0.006), d1 = unit(add([0, 0, 0], f, 0.62, A, 0.72, N, 0.12 + 0.35 * curl)), M = add(B, d1, 0.044);
    const d2 = unit(add([0, 0, 0], f, 0.82, A, 0.42, N, 0.2 + 0.45 * curl)), T = add(M, d2, 0.033);
    this.skin([add(B, d1, -0.014), B, add(B, d1, 0.024), M, add(M, d2, 0.018), T], [[0.009, 0.0095], [0.0125, 0.013], [0.0105, 0.0112], [0.011, 0.0115], [0.0095, 0.0098], [0.0082, 0.0085]], colour, N, 8, 0.0065, pale);
    return middle;
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
  /**
   * A foot: a rounded heel behind the ankle, widest at the ball, low at the toes. `fwd` is the unit direction the
   * toes point (x, z). With `side` (-1 left, +1 right) it has its five toes, the big one on the inside; without,
   * a rounded front. `pitch` (radians) tips it about the ankle, toes up positive.
   */
  foot(ankle, fwd, colour, side = 0, pitch = 0) {
    // (Points of the foot are given along it and above its sole, and turned about the ankle by `pitch`: toes up
    // as the heel comes down, heel up as you push off. The toes bend where they join the foot: with the heel
    // up they stay flat on the ground, ahead of the ball you are standing on.)
    const cp = Math.cos(pitch), sp = Math.sin(pitch), BALL = 0.126;
    const turned = (along, up) => { const h = up - ANKLE, a = along * cp - h * sp; return [ankle[0] + fwd[0] * a, ankle[1] + along * sp + h * cp, ankle[2] + fwd[1] * a]; };
    const ground = pitch < 0 ? add(turned(BALL, 0.025), [0, 1, 0], -0.025) : null;
    const P = (along, up) => (ground && along > BALL ? [ground[0] + fwd[0] * (along - BALL), ground[1] + up, ground[2] + fwd[1] * (along - BALL)] : turned(along, up));
    // One skin from the heel to the roots of the toes: highest under the ankle, the instep sloping down to the
    // ball, widest there.
    const heel = P(-0.052, 0.034), under = P(0.0, 0.041), arch = P(0.062, 0.036), ball = P(0.126, 0.025);
    const front = side ? P(0.156, 0.017) : P(0.19, 0.014), right = [-fwd[1], 0, fwd[0]];
    this.chain([heel, under, arch, ball, front], [[0.029, 0.034], [0.034, 0.041], [0.039, 0.035], [0.047, 0.023], side ? [0.045, 0.014] : [0.042, 0.012]], [colour, colour, colour, colour]);
    if (side) {
      // [how far towards the inside of the foot, where along it the toe begins, its length, its radius]
      const up = pitch < 0 ? [0, 1, 0] : [-fwd[0] * sp, cp, -fwd[1] * sp];
      for (const [across, along, len, r] of [[0.031, 0.152, 0.034, 0.0125], [0.011, 0.157, 0.029, 0.0095], [-0.005, 0.154, 0.026, 0.009], [-0.02, 0.148, 0.022, 0.0085], [-0.033, 0.14, 0.017, 0.008]]) {
        const base = add(P(along, r + 0.002), right, -side * across), tip = add(P(along + len, r * 0.8 + 0.002), right, -side * across), run = [tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]];
        this.limb(base, tip, right, [r, r * 0.9], [r * 0.9, r * 0.72], colour, 5, r * 0.6);
        this.nail(add(base, run, 0.45, up, r * 0.83), add(base, run, 1.0, up, r * 0.735), right, r * 0.62, up);
      }
    } else this.cap(ball, front, [0.042, 0.012], colour, 0.45);
    this.cap(under, heel, [0.029, 0.034], colour, 0.55);
    // The ankle: from the end of the shin down into the foot, the two bones standing out a little at the sides.
    this.tube(ankle, P(0.004, 0.05), [0.033, 0.037], [0.035, 0.044], colour);
    if (side) for (const out of [-1, 1]) this.limb([ankle[0] + right[0] * out * 0.031, ankle[1] + (out * side > 0 ? -0.004 : 0.006), ankle[2] + right[2] * out * 0.031 + 0.004], [ankle[0] + right[0] * out * 0.036, ankle[1] + (out * side > 0 ? -0.004 : 0.006), ankle[2] + right[2] * out * 0.036 + 0.004], [0, 1, 0], [0.014, 0.012], [0.008, 0.007], colour, 5, 0.004);
  }
}

/**
 * Where one foot is in its cycle, as walking really goes. u = its place in the cycle, radians: 0 as its heel
 * comes down, and a pace of the body is PI. It is on the ground for `stance` of the cycle (six tenths at a walk:
 * for a tenth at each end both feet are down), and for all that time it stays where it was put: the body
 * travels `pace` metres per PI, so in the body's frame the foot goes back at exactly that rate, in a straight
 * line. It comes down on the heel, toes raised; rolls flat; then the heel lifts and it pushes off from the ball
 * and the toes; then it is carried forward, lifted, to come down on the heel again.
 * `m` (0..1) scales the whole movement (0 = standing still, feet together).
 * Returns { ahead: metres the ankle is in front of the hips, up: its height, pitch: toes up, radians, planted: 0..1 }.
 */
export function footAt(u, pace, m, stance = 1.2 * Math.PI, lift = 0.09) {
  u = ((u % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const front = (0.486 - 0.36 * (1.2 - stance / Math.PI)) * pace * m, back = front - stance / Math.PI * pace * m;
  // The ankle when the foot is tipped up on its heel by t, or down on its ball by f. Heel and ball are round
  // (Tubes.foot): the heel's middle is 5.2 cm behind the ankle and 2.6 cm below it, 3.4 cm above the sole; the
  // ball's 12.6 cm ahead and 3.5 cm below, 2.5 cm above the sole. Each stays where it is as the foot tips on it.
  const heelUp = t => [-0.052 + 0.052 * Math.cos(t) - 0.026 * Math.sin(t), 0.034 + 0.052 * Math.sin(t) + 0.026 * Math.cos(t)];
  const ballDown = f => [0.126 - 0.126 * Math.cos(f) + 0.035 * Math.sin(f), 0.025 + 0.126 * Math.sin(f) + 0.035 * Math.cos(f)];
  const strike = 0.3 * m, push = 0.85 * m, ease = t => t * t * (3 - 2 * t);
  if (u < stance) {
    const flat = front - u / Math.PI * pace * m, roll = 0.2 * Math.PI, off = 0.6 * stance;
    if (u < roll) { const t = strike * (1 - u / roll) ** 2, [a, h] = heelUp(t); return { ahead: flat + a, up: h, pitch: t, planted: 1 }; }
    if (u > off) { const f = push * ease((u - off) / (stance - off)), [a, h] = ballDown(f); return { ahead: flat + a, up: h, pitch: -f, planted: 1 - 0.7 * f / Math.max(push, 1e-6) }; }
    return { ahead: flat, up: ANKLE, pitch: 0, planted: 1 };
  }
  const w = (u - stance) / (2 * Math.PI - stance), e = ease(w), from = ballDown(push), to = heelUp(strike);
  return {
    ahead: back + from[0] + (front + to[0] - back - from[0]) * e, up: from[1] + (to[1] - from[1]) * e + lift * m * Math.sin(Math.PI * w) * (1 - 0.3 * w),
    pitch: -push + (strike + push) * ease(Math.min(1, Math.max(0, (w - 0.15) / 0.8))), planted: 0,
  };
}

/**
 * How far ahead of your eye the middle of a foot comes down at pace `stride` (0 standing, 1 walking, about 2
 * running): where its print belongs. (The same numbers as poseBody uses, looking ahead and not crouched.)
 */
export function footfall(stride) {
  const s = Math.min(stride, 1.6), run = Math.min(1, Math.max(0, (1.4 * s - 1.6) / 1.2)), amount = Math.min(1, s / 0.55) ** 1.5;
  return footAt(0, 0.72 + 0.33 * run * run * (3 - 2 * run), amount, Math.PI * (1.2 - 0.5 * run)).ahead - (BACK + 0.035 - 0.03) + 0.06;
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
 * @param {{skin?: number[], shirt?: number[], shorts?: number[], hair?: number[]}} [p.colours]  (the defaults are yours)
 * @param {[number, number]} [p.slope]  rise of the ground per metre forward and to the right: each foot is set down on it
 * @param {number} [p.wade]  0..1: in water to the chest the arms are held up and out, hands at the surface
 * @param {boolean} [p.detail]  hands with fingers, thumbs and nails, feet with toes, hems on the clothes (your own body; needs BODY_VERTICES_DETAIL)
 * @param {number} [p.breath]  -1..1: where you are in a breath (the shoulders rise a few millimetres, the chest fills)
 * @param {number} [p.pace]  metres you travel per pace (PI of phase): the planted foot goes back at this rate, so it stays put on the ground
 * @param {number} [p.sink]  metres your weight presses a planted foot into the sand
 * @param {object | null} [p.touch]  your right hand at work: `amount` 0..1 of the way from where it rests;
 *   `at` = where the tip of the middle finger goes when it is down on the ground (this frame of reference), the
 *   hand laid flat; `lift` 0..1 of the way from there to being held up before you: then `wrist` (where), `dir`
 *   (the way the hand points), `palm` (the way the palm faces); `curl` of the fingers (0 flat .. 1) and `spread`
 */
export function poseBody(t, h, { phase, stride, eye, look = 0, colours = {}, slope = [0, 0], wade = 0, detail = false, breath = 0, pace = null, sink = 0, touch = null }) {
  const SKIN = colours.skin || SKIN0, SHIRT = colours.shirt || SHIRT0, SHORTS = colours.shorts || SHORTS0, HAIR = colours.hair || SKIN;
  // (You lean into a hill, and back coming down one.)
  const crouch = Math.min(1, Math.max(0, (1.65 - eye) / 0.9)), lean = 0.08 * Math.min(stride, 1.6) + 0.8 * crouch + 0.35 * Math.max(-0.5, Math.min(0.7, slope[0]));
  const sy = eye - 0.22 + 0.004 * breath, shoulder = [0, sy, BACK + 0.02 + 0.1 * Math.max(0, -Math.sin(look))], joints = { knees: [], ankles: [], hips: [], wrists: [], fingertips: [] };
  // Hips: under the shoulders standing, behind and below them as the trunk leans into a crouch.
  const hip = [0, Math.max(sy - TORSO * Math.cos(lean), 0.2), shoulder[2] + TORSO * Math.sin(lean) * 0.75];
  t.n = 0;
  // Where each foot is (footAt): planted and passing back under you in a straight line at the rate you travel,
  // so that it stays where you put it; then lifted and carried forward. Set down on the ground under it, which
  // on a slope is higher or lower than the ground under you. At a run a foot is down for a third of the cycle
  // only. (Crouched you shuffle: short paces, the feet kept ahead of the hips, the knees up in front.)
  const s = Math.min(stride, 1.6), run = Math.min(1, Math.max(0, (1.4 * s - 1.6) / 1.2)), amount = Math.min(1, s / 0.55) ** 1.5 * (1 - 0.3 * crouch);
  const travel = pace ?? (0.72 + 0.33 * run * run * (3 - 2 * run)) * (1 - 0.45 * crouch), stance = Math.PI * (1.2 - 0.5 * run);
  const balance = shoulder[2] + (hip[2] - shoulder[2]) * (0.45 - 0.2 * crouch), tilt = Math.atan(Math.max(-0.5, Math.min(0.5, slope[0])));
  const swing = 0.34 * s * (1 - 0.75 * crouch);              // (how far the arms swing)
  const steps = [-1, 1].map(side => footAt(phase + (side < 0 ? 0 : Math.PI), travel, amount, stance, (0.09 + 0.05 * run) * (1 - 0.6 * crouch)));
  const feet = [-1, 1].map((side, i) => {
    const f = steps[i], ankle = [side * (HIP + 0.01 + 0.05 * crouch), f.up - sink * f.planted, balance - 0.03 - f.ahead - 0.1 * crouch * amount];
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
    // (Loose shorts: the leg of them stands a finger's breadth off the thigh.)
    t.tube(hipJ, hem, [0.088, 0.092], [0.08, 0.083], SHORTS);
    if (detail) t.tube([hipJ[0] + (hem[0] - hipJ[0]) * 0.9, hipJ[1] + (hem[1] - hipJ[1]) * 0.9, hipJ[2] + (hem[2] - hipJ[2]) * 0.9], hem, [0.0818, 0.0848], [0.0812, 0.0842], shade(SHORTS, 0.72));   // the stitched hem
    t.tube(hem, knee, [0.068, 0.07], [0.055, 0.057], SKIN);
    const calf = [knee[0] + (ankle[0] - knee[0]) * 0.35, knee[1] + (ankle[1] - knee[1]) * 0.35, knee[2] + (ankle[2] - knee[2]) * 0.35 + 0.012];
    t.chain([knee, calf, ankle], [[0.055, 0.057], [0.052, 0.058], [0.034, 0.038]], [SKIN, SKIN]);
    // (The knee: both bones end rounded, so that a bent knee is a knee and not the open ends of two pipes.)
    if (detail) { t.cap(hem, knee, [0.055, 0.057], SKIN, 0.85); t.cap(calf, knee, [0.055, 0.057], SKIN, 0.85); }
    t.foot(ankle, [side * 0.12, -0.993], SKIN, detail ? side : 0, steps[side < 0 ? 0 : 1].pitch + tilt * steps[side < 0 ? 0 : 1].planted);
    joints.hips.push(hipJ); joints.knees.push(knee); joints.ankles.push(ankle);
    // The arm swings against its leg; the elbow bends more the faster you go.
    const sh = [side * SHOULDER, sy - 0.01, shoulder[2]], a = (0.7 * swing * c - 0.04 * Math.min(s, 1)) * (1 - 0.7 * wade) + 0.35 * crouch + 0.75 * wade, bend = 0.14 + 0.2 * Math.min(s, 1) * (0.5 + 0.5 * c) + 0.3 * Math.max(s - 1, 0) + 0.85 * crouch + 0.75 * wade;    // (crouched, the hands come forward over the knees)
    let elbow = [sh[0] + side * (0.025 + 0.14 * wade), sh[1] - 0.32 * Math.cos(a), sh[2] - 0.32 * Math.sin(a)];
    const wrist = [elbow[0] - side * 0.015, elbow[1] - 0.255 * Math.cos(a + bend), elbow[2] - 0.255 * Math.sin(a + bend)];
    // Reaching down to touch (the right hand): the shoulder goes forward and down with it, the hand is laid
    // flat, fingers pointing away from you, the wrist a hand's length behind the fingertip and just above it.
    const reaching = touch && side > 0 && touch.amount > 0 ? touch.amount * touch.amount * (3 - 2 * touch.amount) : 0;
    let point = null, facing = null;
    if (reaching) {
      const to = touch.at, away = unit([to[0] - sh[0], 0, to[2] - sh[2]]), curl = touch.curl ?? 0.2, lift = touch.wrist ? Math.min(1, Math.max(0, touch.lift ?? 0)) : 0, up = lift * lift * (3 - 2 * lift);
      sh[1] -= 0.1 * reaching * (1 - up); sh[2] -= 0.12 * reaching * (1 - up);
      // (Down on the ground: curled fingers reach less far and go down into what they touch, so the wrist comes
      // nearer and higher. Held up: the wrist where it is asked for.)
      const want = [to[0] - away[0] * (0.178 - 0.05 * curl), to[1] + 0.022 + 0.05 * curl, to[2] - away[2] * (0.178 - 0.05 * curl)];
      if (up > 0) for (let i = 0; i < 3; i++) want[i] += (touch.wrist[i] - want[i]) * up;
      for (let i = 0; i < 3; i++) wrist[i] += (want[i] - wrist[i]) * reaching;
      elbow = reach(sh, wrist, 0.32, 0.255, [0.75 - 0.15 * up, 0.25 - 0.95 * up, 0.6 - 0.25 * up]);
      point = up > 0 ? unit([away[0] + (touch.dir[0] - away[0]) * up, (touch.dir[1]) * up, away[2] + (touch.dir[2] - away[2]) * up]) : away;
      facing = up > 0 ? unit([touch.palm[0] * up, -1 + (touch.palm[1] + 1) * up, touch.palm[2] * up]) : [0, -1, 0];
    }
    const tip = [wrist[0] - side * 0.01, wrist[1] - 0.17 * Math.cos(a + bend + 0.15), wrist[2] - 0.17 * Math.sin(a + bend + 0.15)];
    const sleeve = [sh[0] + (elbow[0] - sh[0]) * 0.5, sh[1] + (elbow[1] - sh[1]) * 0.5, sh[2] + (elbow[2] - sh[2]) * 0.5];
    t.tube(sh, sleeve, [0.052, 0.056], [0.047, 0.05], SHIRT);
    if (detail) t.tube([sh[0] + (sleeve[0] - sh[0]) * 0.86, sh[1] + (sleeve[1] - sh[1]) * 0.86, sh[2] + (sleeve[2] - sh[2]) * 0.86], sleeve, [0.0485, 0.0518], [0.0478, 0.0508], shade(SHIRT, 0.8));
    t.tube(sleeve, elbow, [0.042, 0.045], [0.036, 0.038], SKIN);
    if (detail) { t.cap(sleeve, elbow, [0.036, 0.038], SKIN, 0.85); t.cap(wrist, elbow, [0.036, 0.04], SKIN, 0.85); }      // the elbow, likewise
    if (detail) {
      // A hand at rest: the palm towards the thigh and a little back, fingers half curled; opened out when wading.
      const fore = unit([wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]]), mix = (p, q) => unit([p[0] + (q[0] - p[0]) * reaching, p[1] + (q[1] - p[1]) * reaching, p[2] + (q[2] - p[2]) * reaching]);
      const rest = [-side, -0.6 * wade, 0.35 * (1 - wade)], loose = 0.55 - 0.3 * wade;
      const tip = t.hand(wrist, point ? mix(fore, point) : fore, point ? mix(rest, facing) : rest, side, point ? loose + ((touch.curl ?? 0.2) - loose) * reaching : loose, SKIN, point ? (touch.spread ?? 0) * reaching : 0, elbow);
      joints.fingertips.push(tip);
      if (point) joints.touching = { tip, wrist: wrist.slice(), amount: reaching, palm: t.palm };
    } else {
      t.tube(elbow, wrist, [0.036, 0.04], [0.026, 0.03], SKIN);
      t.tube(wrist, tip, [0.036, 0.018], [0.03, 0.012], SKIN);
      t.cap(wrist, tip, [0.03, 0.012], SKIN);
    }
    t.tube([sh[0] - side * 0.01, sh[1] - 0.012, sh[2]], [side * 0.075, sy + 0.03, sh[2] - 0.01], [0.045, 0.056], [0.03, 0.045], SHIRT);      // the slope from the shoulder to the neck
    t.cap(sleeve, sh, [0.052, 0.056], SHIRT, 0.3);                    // the round of the shoulder
    joints.wrists.push(wrist);
  }
  // The trunk: seat, hips, waist, chest, shoulders, up to the base of the neck.
  const on = k => [0, hip[1] + (shoulder[1] - hip[1]) * k, hip[2] + (shoulder[2] - hip[2]) * k];
  const seat = [0, hip[1] - 0.09, hip[2] + 0.01];
  // (The shoulders slope up to the neck; the collar closes the trunk, so looking down you see your shirt, not into it.)
  const collar = [0, sy + 0.07, shoulder[2] - 0.012 - 0.03 * crouch], neck = [0, sy + 0.1, collar[2]];
  // The shorts come up to the waist; the shirt hangs loose over them, a hand's breadth down past the waistband.
  t.chain([seat, on(0.04), on(0.2), on(0.27)], [[0.15, 0.1], [0.172, 0.118], [0.161, 0.113], [0.156, 0.11]], [SHORTS, SHORTS, SHORTS]);
  const chest = 1 + 0.012 * breath;
  t.chain([on(0.15), on(0.42), on(0.74), on(0.9), collar], [[0.172, 0.124], [0.15, 0.108], [0.172 * chest, 0.12 * chest], [0.168, 0.112], [0.07, 0.066]], [SHIRT, SHIRT, SHIRT, SHIRT]);
  if (detail) t.tube(on(0.15), on(0.185), [0.1735, 0.1255], [0.1712, 0.1232], shade(SHIRT, 0.8));          // the shirt's hem
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

const UPPER_ARM = 0.32, FOREARM = 0.255, HAND = 0.19;
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
export function poseSwim(t, h, { stroke, under = 0, detail = false }) {
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
    if (detail) {
      // The hand: flat, fingers together, palm down and a little outwards for the pull.
      t.hand(target, [dir[0] / dl, dir[1] / dl, dir[2] / dl], [side * 0.35 * pull, -1, 0], side, 0.08, SKIN, 0, elbow);
    } else {
      t.tube(elbow, target, [0.036, 0.04], [0.026, 0.03], SKIN);
      t.tube(target, tip, [0.04, 0.016], [0.034, 0.011], SKIN);            // the hand, flat like a paddle
      t.cap(target, tip, [0.034, 0.011], SKIN);
    }
    t.tube([sh[0], sh[1], sh[2]], [side * 0.08, chest[1] + 0.05, chest[2] - 0.01], [0.05, 0.058], [0.05, 0.05], SHIRT);
    joints.shoulders.push(sh); joints.elbows.push(elbow); joints.wrists.push(target);
    // Legs: trailing straight, drawn up with the knees apart, kicked back.
    const hipJ = [side * HIP, hip[1], hip[2]], back = [hip[2] - chest[2], hip[1] - chest[1]], bl = Math.hypot(back[0], back[1]) || 1, bz = back[0] / bl, by = back[1] / bl;
    const straight = [hipJ[0] + side * 0.03, hipJ[1] + by * 0.84 + 0.03, hipJ[2] + bz * 0.84], up = [hipJ[0] + side * 0.3, hipJ[1] + by * 0.4 - 0.06, hipJ[2] + bz * 0.4];
    const ankle = lerp3(straight, up, drawn), knee = reach(hipJ, ankle, THIGH, SHIN, [side * 0.9, -0.5, -0.2]);
    const hem = lerp3(hipJ, knee, 0.55), calf = lerp3(knee, ankle, 0.35);
    t.tube(hipJ, hem, [0.088, 0.092], [0.074, 0.076], SHORTS);
    t.tube(hem, knee, [0.07, 0.072], [0.055, 0.057], SKIN);
    t.chain([knee, calf, ankle], [[0.055, 0.057], [0.052, 0.058], [0.034, 0.038]], [SKIN, SKIN]);
    // (The foot trails along the shin, toes pointed.)
    const shin = [ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2]], sl = Math.hypot(...shin) || 1;
    const toes = [ankle[0] + shin[0] / sl * 0.21 + side * 0.03 * drawn, ankle[1] + shin[1] / sl * 0.21, ankle[2] + shin[2] / sl * 0.21];
    t.tube(ankle, toes, [0.036, 0.04], [0.046, 0.013], SKIN);
    t.cap(ankle, toes, [0.046, 0.013], SKIN, 0.4);
    joints.hips.push(hipJ); joints.knees.push(knee); joints.ankles.push(ankle);
  }
  const on = k => lerp3(hip, chest, k), seat = lerp3(hip, chest, -0.18);
  const collar = [0, -0.09, 0.07];
  t.chain([seat, on(0.04), on(0.2), on(0.42), on(0.74), on(1.0), collar],
    [[0.15, 0.1], [0.172, 0.118], [0.161, 0.113], [0.148, 0.106], [0.172, 0.12], [0.168, 0.11], [0.07, 0.066]], [SHORTS, SHORTS, SHIRT, SHIRT, SHIRT, SHIRT]);
  t.cap(on(1.0), collar, [0.07, 0.066], SHIRT, 0.25);
  t.cap(on(0.04), seat, [0.15, 0.1], SHORTS, 0.35);
  // The head, round the eye (only ever drawn into the shadow map).
  h.tube(collar, [0, -0.07, 0.03], [0.056, 0.058], [0.058, 0.075], SKIN);
  h.tube([0, -0.07, 0.03], [0, 0.03, 0.03], [0.074, 0.092], [0.078, 0.098], SKIN);
  h.tube([0, 0.03, 0.03], [0, 0.085, 0.035], [0.078, 0.098], [0.062, 0.08], SKIN);
  h.cap([0, 0.03, 0.03], [0, 0.085, 0.035], [0.062, 0.08], SKIN, 0.55);
  return joints;
}

