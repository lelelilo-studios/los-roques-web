// First person: a body that walks on the ground, wades, floats when the water is deep enough and can dive.
//
// There are no separate "walking" and "swimming" states. The eye sits at
//     max(ground + body height, sea surface + 0.12 m)
// so in about a metre and a half of water the surface lifts you off your feet by itself, and wading simply gets
// slower as the water gets deeper. Diving is the one real switch: the eye then moves freely between the bed and
// the surface, along the direction you look.
//
// `Walker` is pure logic (no DOM, no three) so it can be tested in Node; `attachWalkInput` feeds it.

export const STAND = 1.65, CROUCH = 0.75, FLOAT = 0.12;

/** Walking speed in m/s with `depth` metres of water round the legs: 56 % at half a metre, 31 % at one metre. */
export function wadeSpeed(depth, run = false) {
  return (run ? 3.0 : 1.4) / (1 + 2.2 * Math.max(depth, 0) ** 1.5);
}

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Walker {
  /**
   * @param {object} o
   * @param {{heightAt: (x: number, z: number) => number}} o.ground
   * @param {(x: number, z: number) => number} o.surfaceAt  height of the sea surface there right now
   * @param {(x: number, z: number) => boolean} [o.blocked]  true where a wall stands
   * @param {{x: number, z: number, w: number, h: number}} [o.rect]  the walker stays inside this rectangle
   */
  constructor({ ground, surfaceAt, blocked = () => false, rect = null }) {
    Object.assign(this, { ground, surfaceAt, blocked, rect });
    this.x = 0; this.z = 0; this.yaw = 0; this.look = 0;       // radians; yaw clockwise from north, look above the horizon
    this.eyeY = STAND; this.body = STAND; this.surf = 0; this.vx = 0; this.vz = 0;
    this.diving = false; this.diveTimer = 0; this.phase = 0; this.bob = 0; this.bobAmount = 1;
    this.pinned = false;                                          // a test pose holds the eye where it was put
    this.depth = 0; this.afloat = false;
    this.stride = 0;                                              // pace against an easy walk: 0 standing, 1 walking, about 2 running
    this.stroke = 0;                                              // phase of the swimming stroke, radians
  }

  /**
   * Puts the walker somewhere at once (no springs). `eye`, if given, is the eye height in metres above the sea
   * surface at that spot at that moment (negative = under water) and stays fixed until the walker moves.
   */
  place({ x, z, yaw = this.yaw, look = this.look, height = STAND, eye = null }) {
    Object.assign(this, { x, z, yaw, look, vx: 0, vz: 0, phase: 0, bob: 0, diveTimer: 0, stride: 0 });
    const g = this.ground.heightAt(x, z);
    this.surf = this.surfaceAt(x, z);
    this.body = height;
    this.pinned = eye !== null;
    this.eyeY = eye !== null ? Math.max(this.surf + eye, g + 0.2) : Math.max(g + height, this.surf + FLOAT);
    this.diving = this.eyeY < this.surf;
    this.depth = Math.max(this.surf - g, 0);
    // (A test pose with the eye lower than you could stand is a swimmer.)
    this.afloat = this.pinned ? this.eyeY < g + height - 0.05 && !this.diving : this.surf + FLOAT > g + this.body;
  }

  /** True when the eye is under the sea surface. */
  get under() { return this.eyeY + this.bob < this.surf - 0.02; }

  /**
   * Advances by dt seconds. input: { fwd, right (-1..1), run, down, up (booleans) }.
   * Returns the footsteps taken: [{ x, z, yaw, side: 0|1, depth }] (for footprints and sound).
   */
  step(dt, input) {
    const steps = [];
    if (dt <= 0) return steps;
    const moving = Math.abs(input.fwd) + Math.abs(input.right) > 0.01 || input.up || input.down;
    if (this.pinned && !moving) return steps;
    this.pinned = false;

    const g = this.ground.heightAt(this.x, this.z);
    this.surf += (this.surfaceAt(this.x, this.z) - this.surf) * (1 - Math.exp(-dt / 0.25));
    const d = Math.max(this.surf - g, 0);
    this.depth = d;

    // Where the legs (or arms) want to take us.
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = input.fwd * sy + input.right * cy, wz = -input.fwd * cy + input.right * sy, vy = 0;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    let speed;
    if (this.diving) {
      speed = input.run ? 1.2 : 0.7;
      const cl = Math.cos(this.look);
      vy = input.fwd * Math.sin(this.look) * speed;
      wx = input.fwd * sy * cl + input.right * cy; wz = -input.fwd * cy * cl + input.right * sy;
    } else {
      // Wading slows with depth; from about waist deep, swimming is quicker than pushing through it.
      speed = Math.max(wadeSpeed(d, input.run), (input.run ? 1.5 : 0.8) * smooth(0.7, 1.1, d));
    }
    const onGround = !this.diving && !this.afloat;
    // (Crouched you shuffle along at less than half the pace.)
    const crouch = Math.min(1, Math.max(0, (STAND - this.body) / (STAND - CROUCH)));
    if (onGround) speed *= 1 - 0.55 * crouch;
    const k = 1 - Math.exp(-dt * (onGround ? 9 : 3.5));
    this.vx += (wx * speed - this.vx) * k; this.vz += (wz * speed - this.vz) * k;

    // Move, sliding along walls and refusing slopes steeper than 39 degrees.
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const ok = (x, z) => {
      if (this.blocked(x, z)) return false;
      if (this.rect && (x < this.rect.x || x > this.rect.x + this.rect.w || z < this.rect.z || z > this.rect.z + this.rect.h)) return false;
      // The slope is measured over a fixed pace ahead, not over this frame's step (a slow enough creep would
      // otherwise climb anything).
      const run = Math.hypot(x - this.x, z - this.z);
      if (!onGround || d >= 0.6 || run < 1e-6) return true;
      const px = this.x + (x - this.x) / run * 0.35, pz = this.z + (z - this.z) / run * 0.35;
      return this.ground.heightAt(px, pz) - g <= 0.81 * 0.35;
    };
    if (!ok(nx, nz)) {
      if (ok(nx, this.z)) { nz = this.z; this.vz = 0; } else if (ok(this.x, nz)) { nx = this.x; this.vx = 0; } else { nx = this.x; nz = this.z; this.vx = this.vz = 0; }
    }
    const travelled = Math.hypot(nx - this.x, nz - this.z);
    this.x = nx; this.z = nz;

    // The eye.
    const g2 = this.ground.heightAt(this.x, this.z);
    const want = input.down && !this.diving && d < 0.9 ? CROUCH : STAND;
    this.body += (want - this.body) * (1 - Math.exp(-dt * 10));
    this.afloat = this.surf + FLOAT > g2 + this.body;
    if (!this.diving) {
      const target = Math.max(g2 + this.body, this.surf + FLOAT);
      this.eyeY += (target - this.eyeY) * (1 - Math.exp(-dt * (this.afloat ? 9 : 10)));
      // Under we go: with the dive key in water deep enough, or by swimming forward while looking well down.
      this.diveTimer = this.afloat && this.look < -0.35 && input.fwd > 0.5 ? this.diveTimer + dt : 0;
      if ((input.down && d >= 0.9) || this.diveTimer > 0.3) this.diving = true;
    } else {
      this.eyeY += (vy + (input.up ? 0.8 : 0) - (input.down ? 0.6 : 0)) * dt;
      const lo = g2 + 0.35, hi = this.surf - FLOAT;
      if (hi < lo + 0.05 || (this.eyeY >= hi && (vy > 0.01 || input.up))) this.diving = false;      // back up through the surface
      this.eyeY = Math.min(Math.max(this.eyeY, lo), Math.max(lo, hi));
      this.diveTimer = 0;
    }

    // Steps: the head bobs once per pace of 0.72 m (shorter crouched), and each pace is reported.
    if (onGround && travelled > 0) {
      const before = Math.floor(this.phase / Math.PI);
      this.phase += travelled / (0.72 * (1 - 0.45 * crouch)) * Math.PI;
      const after = Math.floor(this.phase / Math.PI);
      if (after !== before) steps.push({ x: this.x, z: this.z, yaw: this.yaw, side: after & 1, depth: Math.max(this.surf - g2, 0), stride: this.stride });
    }
    const stride = onGround ? Math.min(1, Math.hypot(this.vx, this.vz) / 1.2) : 0;
    // Afloat: a stroke every second and a half when swimming along, a slow scull when lying still.
    if (!onGround) this.stroke += (0.22 + 0.45 * Math.min(1, Math.hypot(this.vx, this.vz) / 0.7)) * dt * 2 * Math.PI;
    this.stride += ((onGround ? Math.hypot(this.vx, this.vz) / 1.4 : 0) - this.stride) * (1 - Math.exp(-dt * 8));
    this.bob += (0.022 * this.bobAmount * stride * Math.abs(Math.sin(this.phase)) - this.bob) * (1 - Math.exp(-dt * 12));
    return steps;
  }
}

/** A quick "is there a wall here?" test from building footprints ([{ poly: [[x, z], ...] }]), with a body radius. */
export function buildingBlocker(buildings, radius = 0.3, cell = 24) {
  const grid = new Map(), polys = [];
  for (const b of buildings || []) {
    if (!b.poly || b.poly.length < 3) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const index = polys.push(b.poly) - 1;
    for (let i = Math.floor((x0 - radius) / cell); i <= Math.floor((x1 + radius) / cell); i++) {
      for (let j = Math.floor((z0 - radius) / cell); j <= Math.floor((z1 + radius) / cell); j++) {
        const key = `${i},${j}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(index);
      }
    }
  }
  const inside = (poly, x, z) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  return (x, z) => {
    const list = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
    if (!list) return false;
    for (const index of list) {
      const poly = polys[index];
      if (inside(poly, x, z) || inside(poly, x + radius, z) || inside(poly, x - radius, z) || inside(poly, x, z + radius) || inside(poly, x, z - radius)) return true;
    }
    return false;
  };
}

/**
 * Keyboard, mouse and touch for the walker. Returns { read(): input, dispose() }.
 *   desktop: W A S D / arrows walk, Shift runs, C crouches or dives, Space comes up, mouse looks (click to capture
 *            the pointer; without capture, drag to look), Tab or Esc leaves.
 *   touch:   left half of the screen is a stick, right half looks; `buttons` (elements with data-walk="up|down|run")
 *            do the rest.
 * @param {() => boolean} active  whether first person is on (the handlers stay installed)
 */
export function attachWalkInput(walker, el, { active, onLeave, buttons = [] }) {
  const held = new Set(), touch = { stick: null, look: null, vec: [0, 0] }, pressed = new Set();
  const typing = e => /INPUT|SELECT|TEXTAREA/.test(e.target?.tagName || '');
  const key = e => (e.code === 'Space' ? ' ' : e.key.length === 1 ? e.key.toLowerCase() : e.key);
  const turn = (dx, dy, rate) => { walker.yaw += dx * rate; walker.look = Math.min(1.5, Math.max(-1.5, walker.look - dy * rate)); };
  const lock = () => {
    if (!el.requestPointerLock || document.pointerLockElement === el) return;
    // Raw mouse movement where the browser offers it; some refuse the option, some refuse the lock: both are fine.
    try { Promise.resolve(el.requestPointerLock({ unadjustedMovement: true })).catch(() => { try { Promise.resolve(el.requestPointerLock()).catch(() => {}); } catch { /* drag to look */ } }); } catch { /* drag to look */ }
  };
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); return () => target.removeEventListener(type, fn, opts); };
  const off = [
    on(window, 'keydown', e => {
      if (!active() || typing(e)) return;
      const k = key(e);
      if (k === 'Tab' || (k === 'Escape' && document.pointerLockElement !== el)) { e.preventDefault(); onLeave(); return; }
      if (['w', 'a', 's', 'd', 'c', ' ', 'Shift', 'Control', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { held.add(k); e.preventDefault(); }
    }),
    on(window, 'keyup', e => held.delete(key(e))),
    on(window, 'blur', () => held.clear()),
    on(el, 'click', () => { if (active()) lock(); }),
    on(document, 'mousemove', e => { if (active() && document.pointerLockElement === el) turn(e.movementX, e.movementY, 0.0022); }),
    on(el, 'pointerdown', e => {
      if (!active()) return;
      if (e.pointerType === 'touch' && e.clientX < el.clientWidth * 0.45 && !touch.stick) touch.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      else if (!touch.look) touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
    }),
    on(el, 'pointermove', e => {
      if (!active()) return;
      if (touch.stick?.id === e.pointerId) {
        const dx = (e.clientX - touch.stick.x) / 56, dy = (e.clientY - touch.stick.y) / 56, l = Math.max(1, Math.hypot(dx, dy));
        touch.vec = [dx / l, -dy / l];
      } else if (touch.look?.id === e.pointerId && document.pointerLockElement !== el) {
        turn(e.clientX - touch.look.x, e.clientY - touch.look.y, touch.look.touch ? 0.005 : 0.004);
        touch.look.x = e.clientX; touch.look.y = e.clientY;
      }
    }),
    ...['pointerup', 'pointercancel'].map(type => on(el, type, e => {
      if (touch.stick?.id === e.pointerId) { touch.stick = null; touch.vec = [0, 0]; }
      if (touch.look?.id === e.pointerId) touch.look = null;
    })),
    ...buttons.flatMap(b => [
      on(b, 'pointerdown', e => { e.preventDefault(); pressed.add(b.dataset.walk); }),
      on(b, 'pointerup', () => pressed.delete(b.dataset.walk)), on(b, 'pointerleave', () => pressed.delete(b.dataset.walk)), on(b, 'pointercancel', () => pressed.delete(b.dataset.walk)),
    ]),
  ];
  return {
    /** The walker's input for this frame. */
    read() {
      const h = k => (held.has(k) ? 1 : 0);
      return {
        fwd: Math.max(-1, Math.min(1, h('w') + h('ArrowUp') - h('s') - h('ArrowDown') + touch.vec[1])),
        right: Math.max(-1, Math.min(1, h('d') + h('ArrowRight') - h('a') - h('ArrowLeft') + touch.vec[0])),
        run: held.has('Shift') || pressed.has('run') || Math.hypot(touch.vec[0], touch.vec[1]) > 0.97,
        down: held.has('c') || held.has('Control') || pressed.has('down'), up: held.has(' ') || pressed.has('up'),
      };
    },
    release() { held.clear(); pressed.clear(); touch.stick = touch.look = null; touch.vec = [0, 0]; if (document.pointerLockElement === el) document.exitPointerLock?.(); },
    dispose() { for (const f of off) f(); },
  };
}
