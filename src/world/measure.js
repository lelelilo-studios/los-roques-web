// A body's movement as anatomy, defined once: the same code measures a recorded person (pipeline/motion) and
// her (tools/motioncheck.mjs, tests), so that the two can be set side by side. Plain numbers, no three.
//
// What it is given, for one moment, is a handful of places and turns in the world (metres; +y up; a body at
// rest faces north, -z, with +x to its right):
//   pelvis { at, R }, chest { at, R }, head { at, top, R }      R: the part's turn from its own rest (nine numbers, row by row)
//   hips, knees, ankles, balls, toes, shoulders, elbows, wrists, knuckles     each [left, right]
// What it gives back are angles in radians and lengths in metres, named as a gait laboratory names them.
//
// Signs. A turn about the upright: to the right positive. A tilt: forward (nose down) positive. A list or a
// side bend: the right side lower positive. A limb: forward positive (hip and shoulder flexion), away from the
// body's middle positive (abduction); a knee or an elbow: bent positive, from straight.
//
// Skeletons differ in where they put a joint by a centimetre or two, and in what they call straight; so nobody
// is held to another's absolute angles. Each measure is taken as what it does about its own middle over a
// stride (or from where it was at the start of a movement), and the middles are kept apart (`cycles`).

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]), unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const col = (R, c) => [R[c], R[3 + c], R[6 + c]], back = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];      // R^T v
const mulT = (a, b) => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => a[i] * b[j] + a[3 + i] * b[3 + j] + a[6 + i] * b[6 + j]));      // a^T b
export const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

/** A turn as three angles: about the upright (to the right positive), forward tilt, and list (right side lower positive). */
export function attitude(R) {
  const f = [-R[2], -R[5], -R[8]], r = col(R, 0);
  return { turn: Math.atan2(f[0], -f[2]), tilt: Math.asin(clamp(-f[1], -1, 1)), list: Math.atan2(-r[1], Math.hypot(r[0], r[2])) };
}
const angle = (a, b, c) => Math.acos(clamp(dot(unit(sub(a, b)), unit(sub(c, b))), -1, 1));
/** How far the middle joint of a limb stands round the line from its root to its end, from the way `ahead` points: outward positive. */
function swivel(root, mid, end, ahead, side) {
  const a = unit(sub(end, root)), k = sub(mid, root), kp = sub(k, a.map(v => v * dot(k, a))), fp = sub(ahead, a.map(v => v * dot(ahead, a)));
  if (len(kp) < 1e-5 || len(fp) < 1e-5) return 0;
  return -side * Math.atan2(dot(a, cross(unit(fp), unit(kp))), dot(unit(fp), unit(kp)));
}

/** The channels every doing is measured by, in the order they are kept. */
export const CHANNELS = ['pelvisTurn', 'pelvisTilt', 'pelvisList', 'chestTurn', 'chestTilt', 'chestList', 'chestYaw', 'chestRoll', 'headTurn', 'headTilt', 'headList', 'headYaw', 'headNod', 'headRoll',
  'hipL', 'hipR', 'hipOutL', 'hipOutR', 'kneeL', 'kneeR', 'kneeWayL', 'kneeWayR', 'ankleL', 'ankleR', 'footL', 'footR',
  'armL', 'armR', 'armOutL', 'armOutR', 'elbowL', 'elbowR', 'elbowWayL', 'elbowWayR'];
/** Which are angles (radians; the rest are metres), which belong to which part of the body, and which are a left and a right of one thing. */
export const PART = { pelvis: ['pelvisTurn', 'pelvisTilt', 'pelvisList'], chest: ['chestTurn', 'chestTilt', 'chestList'], head: ['headTurn', 'headTilt', 'headList'],
  legL: ['hipL', 'hipOutL', 'kneeL', 'ankleL'], legR: ['hipR', 'hipOutR', 'kneeR', 'ankleR'], armL: ['armL', 'armOutL', 'elbowL'], armR: ['armR', 'armOutR', 'elbowR'] };
export const PAIRS = [['hipL', 'hipR'], ['hipOutL', 'hipOutR'], ['kneeL', 'kneeR'], ['kneeWayL', 'kneeWayR'], ['ankleL', 'ankleR'], ['footL', 'footR'], ['armL', 'armR'], ['armOutL', 'armOutR'], ['elbowL', 'elbowR'], ['elbowWayL', 'elbowWayR']];

/**
 * One moment, measured. `m`: the places and turns listed above. Returns the channels (the pelvis's turn is in
 * the world here: `cycles` and `course` take the way the body is going out of it), and the places kept for the
 * measures that need more than one moment: `at` (pelvis), `ankles`, `balls`, `eye` if given.
 */
export function measure(m) {
  const P = m.pelvis.R, C = m.chest.R, H = m.head.R, p = attitude(P), c = attitude(mulT(P, C)), h = attitude(mulT(C, H)), hw = attitude(H), cw = attitude(C);
  // (The chest against the pelvis, and the head against the chest: `Turn`, `Tilt`, `List`. And each as it is in the
  // world: the chest's `Yaw` and `Roll`, the head's `Yaw`, `Nod` and `Roll`.)
  const out = { pelvisTurn: p.turn, pelvisTilt: p.tilt, pelvisList: p.list, chestTurn: c.turn, chestTilt: c.tilt, chestList: c.list, chestYaw: cw.turn, chestRoll: cw.list, headTurn: h.turn, headTilt: h.tilt, headList: h.list, headYaw: hw.turn, headNod: hw.tilt, headRoll: hw.list };
  const ahead = [-P[2], -P[5], -P[8]], behind = [C[2], C[5], C[8]];
  for (const [i, s] of ['L', 'R'].entries()) {
    const side = i ? 1 : -1, t = back(P, sub(m.knees[i], m.hips[i]));
    out['hip' + s] = Math.atan2(-t[2], -t[1]); out['hipOut' + s] = Math.atan2(side * t[0], -t[1]);
    out['knee' + s] = Math.PI - angle(m.hips[i], m.knees[i], m.ankles[i]);
    out['kneeWay' + s] = swivel(m.hips[i], m.knees[i], m.ankles[i], ahead, side);
    out['ankle' + s] = Math.PI / 2 - angle(m.knees[i], m.ankles[i], m.balls[i]);
    const foot = sub(m.balls[i], m.ankles[i]); out['foot' + s] = Math.atan2(foot[1], Math.hypot(foot[0], foot[2]));
    const u = back(C, sub(m.elbows[i], m.shoulders[i]));
    out['arm' + s] = Math.atan2(-u[2], -u[1]); out['armOut' + s] = Math.atan2(side * u[0], -u[1]);
    out['elbow' + s] = Math.PI - angle(m.shoulders[i], m.elbows[i], m.wrists[i]);
    out['elbowWay' + s] = swivel(m.shoulders[i], m.elbows[i], m.wrists[i], behind, side);
  }
  out.at = m.pelvis.at.slice(); out.ankles = m.ankles.map(q => q.slice()); out.balls = m.balls.map(q => q.slice()); out.wrists = m.wrists.map(q => q.slice()); out.headAt = (m.head.top || m.head.at).slice();
  if (m.eye) out.eye = m.eye.slice();
  return out;
}

/** A run of numbers with what is quicker than `hz` taken out, with no delay (a second-order Butterworth run forward and then backward). */
export function lowpass(v, fps, hz) {
  const n = v.length;
  if (n < 6 || hz >= fps / 2) return v.slice();
  const k = Math.tan(Math.PI * hz / fps) / Math.pow(Math.SQRT2 - 1, 0.25), q = Math.SQRT1_2, norm = 1 / (1 + k / q + k * k);      // (the cut-off moved up, so that two passes cut at `hz`)
  const b0 = k * k * norm, b1 = 2 * b0, b2 = b0, a1 = 2 * (k * k - 1) * norm, a2 = (1 - k / q + k * k) * norm;
  const pass = x => { const y = new Array(x.length); let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0]; for (let i = 0; i < x.length; i++) { const o = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = o; y[i] = o; } return y; };
  // (Each end is carried on by its own mirror image, so that the filter has something to settle on.)
  const pad = Math.min(n - 1, Math.round(fps / hz)), ext = [];
  for (let i = pad; i > 0; i--) ext.push(2 * v[0] - v[i]);
  for (const x of v) ext.push(x);
  for (let i = 1; i <= pad; i++) ext.push(2 * v[n - 1] - v[n - 1 - i]);
  return pass(pass(ext).reverse()).reverse().slice(pad, pad + n);
}
/** An angle followed from moment to moment, so that it does not leap a whole turn. */
export function unwrap(v) { const out = [v[0]]; for (let i = 1; i < v.length; i++) out.push(out[i - 1] + wrapPi(v[i] - out[i - 1])); return out; }

/**
 * The way a body is going, moment by moment: `heading` (radians, clockwise from north) from where its pelvis
 * travels when it travels, and from which way its pelvis faces when it does not; `speed` (m/s); and each foot's
 * place against the pelvis in that frame: `fore` (ahead positive) and `aside` (to the right positive), [left, right].
 */
export function course(frames, fps) {
  const n = frames.length, x = lowpass(frames.map(f => f.at[0]), fps, 0.7), z = lowpass(frames.map(f => f.at[2]), fps, 0.7), face = lowpass(unwrap(frames.map(f => f.pelvisTurn)), fps, 0.5);
  const heading = [], speed = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), vx = (x[b] - x[a]) * fps / (b - a || 1), vz = (z[b] - z[a]) * fps / (b - a || 1), v = Math.hypot(vx, vz);
    speed.push(v);
    // (Going forward, the way it travels; slower than a shuffle, or going backward or sideways, the way it faces.)
    const along = Math.atan2(vx, -vz), k = clamp((v - 0.25) / 0.25, 0, 1) * (Math.cos(wrapPi(along - face[i])) > 0.6 ? 1 : 0);
    heading.push(face[i] + wrapPi(along - face[i]) * k);
  }
  const h = lowpass(heading, fps, 0.7), fore = [[], []], aside = [[], []], foreBall = [[], []];
  for (let i = 0; i < n; i++) {
    const s = Math.sin(h[i]), c = Math.cos(h[i]), f = frames[i];
    for (let k = 0; k < 2; k++) {
      const d = sub(f.ankles[k], f.at), e = sub(f.balls[k], f.at);
      fore[k].push(d[0] * s - d[2] * c); aside[k].push(d[0] * c + d[2] * s); foreBall[k].push(e[0] * s - e[2] * c);
    }
  }
  return { heading: h, speed, fore, aside, foreBall, x, z };
}

/**
 * When each foot comes down and leaves the ground, from where it is against the pelvis (Zeni, Richards and
 * Higginson 2008: a heel comes down when the foot is furthest ahead of the pelvis, the toes leave when it is
 * furthest behind): good to a frame or two walking and running, on the level, in any direction of travel.
 * Returns [{ foot: 0 | 1, down: frame, off: frame }] in the order they come down; `off` is the leaving that follows.
 */
export function footfalls(frames, fps, co = course(frames, fps)) {
  const out = [];
  for (let k = 0; k < 2; k++) {
    const f = lowpass(co.fore[k], fps, 6), b = lowpass(co.foreBall[k], fps, 6), n = f.length, reach = Math.max(...f) - Math.min(...f);
    if (reach < 0.08) continue;
    const downs = [], offs = [];
    for (let i = 2; i < n - 2; i++) {
      if (f[i] >= f[i - 1] && f[i] > f[i + 1] && f[i] - Math.min(...f.slice(Math.max(0, i - Math.round(fps * 0.5)), i)) > 0.35 * reach) downs.push(i);
      if (b[i] <= b[i - 1] && b[i] < b[i + 1] && Math.max(...b.slice(Math.max(0, i - Math.round(fps * 0.5)), i)) - b[i] > 0.35 * reach) offs.push(i);
    }
    for (const d of downs) { const off = offs.find(o => o > d); if (off !== undefined && (off - d) / fps < 1.6) out.push({ foot: k, down: d, off }); }
  }
  return out.sort((a, b) => a.down - b.down);
}

const sample = (v, at) => { const i = Math.floor(at), k = at - i; return i + 1 < v.length ? v[i] + (v[i + 1] - v[i]) * k : v[v.length - 1]; };
/** The measures that are turns about the upright in the world: over a stride each is taken against the way she is going. */
const WORLD_TURNS = ['pelvisTurn', 'chestYaw', 'headYaw'];
/** How many points a stride is kept as. */
export const POINTS = 64;

/**
 * Strides, each from one coming-down of the left foot to its next, every channel set out over POINTS moments
 * of it. Returns [{ from, to, time (s), speed (m/s), length (m), width (m), stance: [left, right] (share of
 * the stride each foot is down), rightDown (share of the stride at which the right foot comes down),
 * mean: { channel: its middle over the stride }, curve: { channel: POINTS numbers about that middle } }].
 * The pelvis's turn is taken against the way the body is going (a stride's own drift taken out); `pelvisRise`,
 * `pelvisSway` and `pelvisSurge` are added: the pelvis's place against a point going steadily along its path (m);
 * and `eyeRise`, `eyeSway` if the frames have an eye (else the head's).
 */
export function cycles(frames, fps, { channels = CHANNELS, cut = 6 } = {}) {
  const co = course(frames, fps), falls = footfalls(frames, fps, co), left = falls.filter(f => f.foot === 0), right = falls.filter(f => f.foot === 1), out = [];
  const smooth = {}; for (const c of channels) smooth[c] = lowpass(c.endsWith('Turn') || c.endsWith('Yaw') ? unwrap(frames.map(f => f[c])) : frames.map(f => f[c]), fps, cut);
  const eye = frames[0].eye ? 'eye' : 'headAt', ys = lowpass(frames.map(f => f.at[1]), fps, cut), ey = lowpass(frames.map(f => f[eye][1]), fps, cut);
  const ax = frames.map(f => f.at[0]), az = frames.map(f => f.at[2]), ex = lowpass(frames.map(f => f[eye][0]), fps, cut), ez = lowpass(frames.map(f => f[eye][2]), fps, cut);
  for (let s = 0; s + 1 < left.length; s++) {
    const a = left[s].down, b = left[s + 1].down, time = (b - a) / fps;
    if (time < 0.4 || time > 2.2) continue;
    const r = right.find(f => f.down > a && f.down < b);
    if (!r) continue;
    const at = k => a + (b - a) * k / POINTS, line = (v0, v1, k) => v0 + (v1 - v0) * k / POINTS;
    const h0 = co.heading[a], sn = Math.sin(h0), cs = Math.cos(h0), dx = frames[b].at[0] - frames[a].at[0], dz = frames[b].at[2] - frames[a].at[2], length = Math.hypot(dx, dz);
    const stride = { from: a, to: b, time, speed: length / time, length, stance: [(left[s].off - a) / (b - a), (r.off - r.down) / (b - a)], rightDown: (r.down - a) / (b - a), mean: {}, curve: {} };
    // (How far apart the feet pass, across the way she goes: each ankle's place as it bears her, half way through its stance.)
    { const mid = f => Math.round((f.down + f.off) / 2); stride.width = co.aside[1][Math.min(frames.length - 1, mid(r))] - co.aside[0][mid(left[s])]; }
    for (const c of channels) {
      let v = Array.from({ length: POINTS }, (_, k) => sample(smooth[c], at(k)));
      // (A turn about the upright is taken against the stride's own drift: she may be going round a bend.)
      if (WORLD_TURNS.includes(c)) { const end = sample(smooth[c], b); v = v.map((q, k) => q - line(v[0], end, k)); }
      const mean = v.reduce((p, q) => p + q, 0) / POINTS;
      stride.mean[c] = WORLD_TURNS.includes(c) ? 0 : mean; stride.curve[c] = v.map(q => q - mean);
    }
    const place = (get, name) => { const v = Array.from({ length: POINTS }, (_, k) => get(at(k))), end = get(b), w = v.map((q, k) => q - line(v[0], end, k)), mean = w.reduce((p, q) => p + q, 0) / POINTS; stride.mean[name] = 0; stride.curve[name] = w.map(q => q - mean); };
    const px = i => sample(ax, i), pz = i => sample(az, i);
    place(i => sample(ys, i), 'pelvisRise'); place(i => (px(i) - frames[a].at[0]) * cs + (pz(i) - frames[a].at[2]) * sn, 'pelvisSway'); place(i => (px(i) - frames[a].at[0]) * sn - (pz(i) - frames[a].at[2]) * cs, 'pelvisSurge');
    place(i => sample(ey, i), 'eyeRise'); place(i => (sample(ex, i) - frames[a].at[0]) * cs + (sample(ez, i) - frames[a].at[2]) * sn, 'eyeSway');
    out.push(stride);
  }
  return out;
}

/** A stride's curve read at a share `u` (0..1) of the stride, going round. */
export function curveAt(curve, u) { const q = ((u % 1) + 1) % 1 * curve.length, i = Math.floor(q), k = q - i; return curve[i % curve.length] + (curve[(i + 1) % curve.length] - curve[i % curve.length]) * k; }

/**
 * The mean of several strides' curves and their spread, point by point: { mean: POINTS numbers, sd: POINTS numbers,
 * range: [least, most] of the strides' own peak-to-peak }.
 */
export function band(curves) {
  const n = curves.length, mean = new Array(POINTS).fill(0), sd = new Array(POINTS).fill(0);
  for (const c of curves) for (let k = 0; k < POINTS; k++) mean[k] += c[k] / n;
  for (const c of curves) for (let k = 0; k < POINTS; k++) sd[k] += (c[k] - mean[k]) ** 2 / Math.max(1, n - 1);
  const ranges = curves.map(c => Math.max(...c) - Math.min(...c)).sort((a, b) => a - b);
  return { mean, sd: sd.map(Math.sqrt), range: [ranges[0], ranges[ranges.length - 1]], middle: ranges[Math.floor(ranges.length / 2)] };
}

/**
 * A curve over a stride as a few waves: [a0, a1, b1, a2, b2, ...] with value(u) = a0 + sum ak cos(2 pi k u) + bk sin(2 pi k u).
 * `waves` of them: four hold a trunk's movement, six an arm's.
 */
export function toWaves(curve, waves = 4) {
  const n = curve.length, out = [curve.reduce((p, q) => p + q, 0) / n];
  for (let k = 1; k <= waves; k++) { let a = 0, b = 0; for (let i = 0; i < n; i++) { a += curve[i] * Math.cos(2 * Math.PI * k * i / n); b += curve[i] * Math.sin(2 * Math.PI * k * i / n); } out.push(2 * a / n, 2 * b / n); }
  return out;
}
export function waveAt(w, u) { let v = w[0]; for (let k = 1; 2 * k < w.length; k++) v += w[2 * k - 1] * Math.cos(2 * Math.PI * k * u) + w[2 * k] * Math.sin(2 * Math.PI * k * u); return v; }
