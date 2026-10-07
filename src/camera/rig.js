// The camera rig. It keeps the true camera position in world metres (JS doubles) and gives three a camera that
// sits at x = z = 0: the world is drawn relative to it ("floating origin"), so nothing jitters far from the centre.
//
// Orbit state: a target on the sea surface, a distance, a heading (yaw, 0 = looking north, clockwise) and an
// elevation (pitch, the angle of the eye above the target's horizon).
// Walk mode: the eye is where the Walker (camera/walk.js) says, looking along its yaw and look angles.
import * as THREE from 'three';
import { EARTH_RADIUS } from '../config.js';
import { shared } from '../core/uniforms.js';

const DEG = Math.PI / 180;
const wrap = (v, m) => ((v % m) + m) % m;
const _m = new THREE.Matrix4(), _look = new THREE.Vector3();

export class CameraRig {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200000);
    this.camera.matrixAutoUpdate = true;
    this.target = { x: 0, y: 0, z: 0 };
    this.dist = 30000; this.yaw = 0; this.pitch = 55 * DEG;
    this.limits = { minDist: 1, maxDist: 60000, minPitch: 0.01 * DEG, maxPitch: 89.9 * DEG };
    this.frustum = new THREE.Frustum();
    this.eye = { x: 0, y: 1, z: 0 };
    this.ground = null;       // data/geoCPU.js Ground, for keeping the eye above the terrain
    this.flight = null;
    this.seaLevel = 0;
    this.fov = 50;            // orbit field of view (vertical, degrees)
    this.mode = 'orbit';      // or 'walk'
    this.walker = null;       // camera/walk.js Walker, set by the app
    this.focus = { x: 0, z: 0 };
  }

  /** Into first person (the walker has already been placed) or back to the orbit view around where we stood. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.cancelFlight();
    if (mode === 'walk') this.saved = { dist: this.dist, pitch: this.pitch };
    else {
      const w = this.walker;
      this.target.x = w.x + Math.sin(w.yaw) * 20; this.target.z = w.z - Math.cos(w.yaw) * 20;
      this.yaw = w.yaw; this.dist = Math.max(60, Math.min(this.saved?.dist ?? 60, 400)); this.pitch = Math.max(this.saved?.pitch ?? 0, 14 * DEG);
    }
    this.mode = mode;
  }

  /** Starts a smooth flight to an orbit state ({x, z, dist, yaw, pitch} in metres/degrees); `then` runs on arrival. */
  flyTo(to, seconds = 4, then = null) {
    const from = this.get(), sep = Math.hypot(to.x - from.x, to.z - from.z);
    const dyaw = ((((to.yaw ?? from.yaw) - from.yaw) % 360) + 540) % 360 - 180;
    // Far apart: rise in the middle of the trip so both ends are in view, like a map zoom-and-pan.
    const peak = Math.max(from.dist, to.dist ?? from.dist, 0.7 * sep);
    this.flight = { from, to: { ...from, ...to, yaw: from.yaw + dyaw }, t: 0, seconds: Math.max(0.01, seconds), peak, then };
  }
  cancelFlight() { this.flight = null; }

  /** Advances a flight by dt seconds. Returns true while one is under way. */
  step(dt) {
    const f = this.flight;
    if (!f) return false;
    f.t = Math.min(1, f.t + dt / f.seconds);
    const e = f.t * f.t * f.t * (f.t * (6 * f.t - 15) + 10), lerp = (a, b) => a + (b - a) * e;
    const hop = Math.sin(Math.PI * f.t) ** 2 * Math.log(f.peak / Math.max(f.from.dist, f.to.dist));
    this.target.x = lerp(f.from.x, f.to.x); this.target.z = lerp(f.from.z, f.to.z);
    this.dist = Math.exp(lerp(Math.log(f.from.dist), Math.log(f.to.dist)) + hop);
    this.yaw = lerp(f.from.yaw, f.to.yaw) * DEG; this.pitch = lerp(f.from.pitch, f.to.pitch) * DEG;
    if (f.t >= 1) { this.flight = null; f.then?.(); }
    return true;
  }

  set(s) {
    if (s.x !== undefined) this.target.x = s.x;
    if (s.z !== undefined) this.target.z = s.z;
    if (s.y !== undefined) this.target.y = s.y;
    if (s.dist !== undefined) this.dist = s.dist;
    if (s.yaw !== undefined) this.yaw = s.yaw * DEG;
    if (s.pitch !== undefined) this.pitch = s.pitch * DEG;
    if (s.fov !== undefined) this.fov = s.fov;
  }
  get() { return { x: this.target.x, y: this.target.y, z: this.target.z, dist: this.dist, yaw: this.yaw / DEG, pitch: this.pitch / DEG, fov: this.fov }; }

  /** Applies the state to the three camera and the shared uniforms. `reversed`: the renderer uses reversed depth. */
  update(aspect, reversed) {
    const L = this.limits, cam = this.camera;
    this.dist = Math.min(L.maxDist, Math.max(L.minDist, this.dist));
    this.pitch = Math.min(L.maxPitch, Math.max(L.minPitch, this.pitch));
    const walking = this.mode === 'walk', yaw = walking ? this.walker.yaw : this.yaw;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    const eye = this.eye;
    let dirX, dirY, dirZ;
    if (walking) {
      // First person: the walker owns the eye. The ground detail is centred a few metres ahead of the feet.
      // (A heel coming down drops the eye half a centimetre and nods it a third of a degree, for an instant.)
      const w = this.walker, jolt = (w.thud || 0) * (w.bobAmount ?? 1), look = w.look - 0.006 * jolt, cl = Math.cos(look);
      eye.x = w.x + cy * w.sway; eye.z = w.z + sy * w.sway; eye.y = w.eyeY + w.bob - 0.005 * jolt;
      this.target.x = w.x; this.target.z = w.z; this.target.y = eye.y;
      dirX = sy * cl; dirY = Math.sin(look); dirZ = -cy * cl;
      this.focus.x = w.x + sy * 6; this.focus.z = w.z - cy * 6;
      // 65 degrees across the short side of the screen.
      cam.fov = aspect >= 1 ? 65 : 2 * Math.atan(Math.tan(32.5 * DEG) / aspect) / DEG;
    } else {
      cam.fov = this.fov;
      this.focus.x = this.target.x; this.focus.z = this.target.z;
      // The orbit centre sits on the ground (or the sea surface), so hills are orbited around their own height.
      if (this.ground) this.target.y = Math.max(this.ground.heightAt(this.target.x, this.target.z), this.seaLevel);
      eye.x = this.target.x - sy * cp * this.dist;
      eye.z = this.target.z + cy * cp * this.dist;
      eye.y = this.target.y + sp * this.dist;
      // Never under the ground, never inside the sea surface.
      eye.y = Math.max(eye.y, (this.ground ? Math.max(this.ground.heightAt(eye.x, eye.z), this.seaLevel) : this.seaLevel) + 0.6);
      const dx = this.target.x - eye.x, dy = this.target.y - eye.y, dz = this.target.z - eye.z, dl = Math.hypot(dx, dy, dz) || 1;
      dirX = dx / dl; dirY = dy / dl; dirZ = dz / dl;
    }

    // Reversed float depth has precision to spare. The ordinary 24-bit path needs the near plane pushed out with height.
    // (In first person the sea surface can be centimetres from the eye.)
    cam.near = walking ? (reversed ? 0.05 : 0.1) : reversed ? 0.1 : Math.min(50, Math.max(0.3, 0.05 * eye.y));
    cam.far = reversed ? 200000 : 150000;
    cam.aspect = aspect;
    cam.position.set(0, eye.y, 0);
    // An up vector square to the view direction: well defined even looking straight down.
    const h = Math.hypot(dirX, dirZ), roll = walking ? this.walker.roll || 0 : 0, cr = Math.cos(roll), sr = Math.sin(roll);
    cam.up.set(-sy * dirY * cr + cy * sr, h * cr, cy * dirY * cr + sy * sr);
    _look.set(dirX, eye.y + dirY, dirZ);
    cam.lookAt(_look);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_m, cam.coordinateSystem, cam.reversedDepth);
    shared.uViewProj.value.copy(_m);

    const u = shared, e = cam.matrixWorld.elements, t = Math.tan(cam.fov * DEG / 2);
    u.uCamXZ.value.set(eye.x, eye.z);
    u.uCamMod.value.set(wrap(eye.x, 64), wrap(eye.z, 64), wrap(eye.x, 1024), wrap(eye.z, 1024));
    // (The camera's texel in the height map, whole part and fraction apart, for exact close-up ground lookups.)
    const tx = (eye.x - u.uMapRect.value.x) / u.uMpp.value, tz = (eye.z - u.uMapRect.value.y) / u.uMpp.value;
    const finer = u.uMapTexels.value.z / u.uMapTexels.value.x, sx = tx * finer, sz = tz * finer;
    u.uCamTexel.value.set(Math.floor(tx), Math.floor(tz), tx - Math.floor(tx), tz - Math.floor(tz));
    u.uCamTexelShore.value.set(Math.floor(sx), Math.floor(sz), sx - Math.floor(sx), sz - Math.floor(sz));
    // The sea's mesh rides just above the beach face; an ordinary depth buffer needs more room far away.
    u.uLift.value.set(2e-4, reversed ? 0 : 4 / (cam.near * 2 ** 24));
    u.uCamY.value = eye.y;
    u.uFocusRel.value.set(this.focus.x - eye.x, this.focus.z - eye.z);
    u.uNearFar.value.set(cam.near, cam.far);
    u.uCamRight.value.set(e[0], e[1], e[2]).multiplyScalar(t * aspect);
    u.uCamUp.value.set(e[4], e[5], e[6]).multiplyScalar(t);
    u.uCamFwd.value.set(-e[8], -e[9], -e[10]);
  }

  /** What the clipmaps need: camera and focus in world metres, the eye-to-focus range, the frustum. */
  view() {
    const range = this.mode === 'walk' ? 4 : Math.hypot(this.eye.x - this.target.x, this.eye.y - this.target.y, this.eye.z - this.target.z);
    const reach = 2 * Math.sqrt(2 * EARTH_RADIUS * Math.max(this.eye.y, 1)) + 70000;   // generous: how far geometry can matter
    return { cam: this.eye, focus: this.focus, range, frustum: this.frustum, drop: Math.min(reach, 70000) ** 2 / (2 * EARTH_RADIUS) };
  }
}

/**
 * Mouse, touch and keyboard for the orbit view: drag pans, right-drag (or shift-drag, or two fingers) turns and
 * tilts, wheel or pinch zooms, double-click flies to the point, arrow keys / WASD pan, Q/E turn, +/- zoom.
 * @param {{x: number, z: number, w: number, h: number}} rect  the mapped area: the target stays near it
 */
export function attachOrbitInput(rig, el, rect, onChange) {
  const pointers = new Map(), MIN_PITCH = 1.5 * DEG, MAX_DIST = 60000, MIN_DIST = 3;
  let pinch = 0;
  const clamp = () => {
    rig.pitch = Math.min(89.9 * DEG, Math.max(MIN_PITCH, rig.pitch));
    rig.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, rig.dist));
    rig.target.x = Math.min(rect.x + rect.w + 4000, Math.max(rect.x - 4000, rig.target.x));
    rig.target.z = Math.min(rect.z + rect.h + 4000, Math.max(rect.z - 4000, rig.target.z));
  };
  const changed = () => { rig.cancelFlight(); clamp(); onChange(); };
  const pan = (right, fwd) => {
    const s = Math.sin(rig.yaw), c = Math.cos(rig.yaw);
    rig.target.x += right * c + fwd * s;
    rig.target.z += right * s - fwd * c;
  };
  // Metres on the ground per CSS pixel at the orbit centre.
  const scale = () => rig.dist * 2 * Math.tan(rig.camera.fov * DEG / 2) / el.clientHeight;
  // Where a screen point's view ray meets the sea-level plane (null if it points at the sky).
  const pick = (cx, cy) => {
    const r = el.getBoundingClientRect(), nx = (cx - r.left) / r.width * 2 - 1, ny = 1 - (cy - r.top) / r.height * 2;
    const e = rig.camera.matrixWorld.elements, t = Math.tan(rig.camera.fov * DEG / 2), a = r.width / r.height;
    const d = [-e[8] + nx * t * a * e[0] + ny * t * e[4], -e[9] + nx * t * a * e[1] + ny * t * e[5], -e[10] + nx * t * a * e[2] + ny * t * e[6]];
    if (d[1] > -1e-4) return null;
    const k = -rig.eye.y / d[1];
    return { x: rig.eye.x + d[0] * k, z: rig.eye.z + d[2] * k };
  };

  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => { el.focus({ preventScroll: true }); el.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey }); pinch = 0; });
  const up = e => { pointers.delete(e.pointerId); pinch = 0; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p || rig.mode !== 'orbit') return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) rig.dist *= pinch / d;
      pinch = d;
      rig.yaw -= dx * 0.002; rig.pitch += dy * 0.002;
    } else if (p.button === 2 || p.shift) {
      rig.yaw -= dx * 0.005; rig.pitch += dy * 0.005;
    } else {
      pan(-dx * scale(), dy * scale() / Math.max(Math.sin(rig.pitch), 0.25));
    }
    changed();
  });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (rig.mode !== 'orbit') return;
    rig.dist *= Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0015);
    changed();
  }, { passive: false });
  el.addEventListener('dblclick', e => {
    const p = pick(e.clientX, e.clientY);
    if (p && rig.mode === 'orbit') { rig.flyTo({ x: p.x, z: p.z, dist: Math.max(MIN_DIST * 10, rig.dist * 0.45) }, 1.6); onChange(); }
  });
  el.addEventListener('keydown', e => {
    if (rig.mode !== 'orbit') return;
    const step = 60 * scale(), k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') pan(-step, 0);
    else if (k === 'arrowright' || k === 'd') pan(step, 0);
    else if (k === 'arrowup' || k === 'w') pan(0, step);
    else if (k === 'arrowdown' || k === 's') pan(0, -step);
    else if (k === 'q') rig.yaw -= 0.08;
    else if (k === 'e') rig.yaw += 0.08;
    else if (k === 'r') rig.pitch += 0.05;
    else if (k === 'f') rig.pitch -= 0.05;
    else if (k === '+' || k === '=') rig.dist *= 0.85;
    else if (k === '-') rig.dist /= 0.85;
    else return;
    e.preventDefault();
    changed();
  });
}
