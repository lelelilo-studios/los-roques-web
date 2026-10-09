// What you steer by, aboard your boat: a compass tape with your heading under its lubber line, your speed in
// knots, and the throttle lever beside them. In lelelilo's own night: midnight blue, gold thread, brass, cream
// (css/intro.css has the same colours). Drawn on a small canvas a dozen times a second.

const MIDNIGHT = '#070d18', NAVY = '#0f1c2e', GOLD = '#ffc94a', CREAM = '#fff4d6', BRASS = '#b8863b', DIM = '#a0afc3', CORAL = '#ff8a75';
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** The compass point a heading is nearest (degrees, clockwise from north): 'N', 'NE'... */
export const compassPoint = degrees => POINTS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
/** Metres a second to knots. */
export const knots = speed => speed * 1.943844;

export function buildHelm(root) {
  const W = 340, H = 86, canvas = document.createElement('canvas'), ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.className = 'helm'; canvas.width = W * ratio; canvas.height = H * ratio; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Heading and speed');
  root.append(canvas);
  const c = canvas.getContext('2d');
  let shown = false, last = -1;
  const round = (x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  /**
   * @param {{heading: number, speed: number, throttle: number, running: boolean, shallow?: boolean}} s  heading in
   *   radians clockwise from north, speed in m/s through the water (astern negative), throttle -1..1
   * @param {number} now  seconds (any clock): it is drawn again only every twelfth of one
   */
  const update = (s, now = performance.now() / 1000) => {
    if (!shown || now - last < 1 / 12) return;
    last = now;
    c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, W, H);
    // The cloth: midnight, with a seam of gold stitches round it.
    const cloth = c.createLinearGradient(0, 0, 0, H); cloth.addColorStop(0, NAVY); cloth.addColorStop(1, MIDNIGHT);
    round(1, 1, W - 2, H - 2, 14); c.fillStyle = cloth; c.globalAlpha = 0.88; c.fill(); c.globalAlpha = 1;
    round(5.5, 5.5, W - 11, H - 11, 10); c.strokeStyle = GOLD; c.lineWidth = 1.2; c.setLineDash([5, 4]); c.globalAlpha = 0.75; c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    // The tape: 100 degrees of it across, a tick every five, a longer one every fifteen, the points named.
    const deg = (((s.heading * 180 / Math.PI) % 360) + 360) % 360, x0 = 18, x1 = W - 64, mid = (x0 + x1) / 2, per = (x1 - x0) / 100;
    c.save(); c.beginPath(); c.rect(x0, 10, x1 - x0, 40); c.clip();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (let d = Math.floor((deg - 55) / 5) * 5; d <= deg + 55; d += 5) {
      const x = mid + (d - deg) * per, at = ((d % 360) + 360) % 360, edge = Math.min(1, Math.min(x - x0, x1 - x) / 26);
      c.globalAlpha = Math.max(0, edge);
      const long = at % 15 === 0, named = at % 45 === 0;
      c.strokeStyle = named ? GOLD : long ? CREAM : DIM; c.lineWidth = named ? 1.6 : 1;
      c.beginPath(); c.moveTo(x, 44); c.lineTo(x, named ? 33 : long ? 36 : 40); c.stroke();
      if (named) { c.fillStyle = at % 90 === 0 ? GOLD : CREAM; c.font = `${at % 90 === 0 ? 700 : 500} ${at % 90 === 0 ? 15 : 12}px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif`; c.fillText(POINTS[at / 45], x, 28); }
      else if (at % 30 === 0) { c.fillStyle = DIM; c.font = '500 10px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif'; c.fillText(String(at), x, 28); }
    }
    c.restore(); c.globalAlpha = 1;
    // The lubber line: a brass needle, point down on the tape.
    c.fillStyle = BRASS; c.beginPath(); c.moveTo(mid - 5, 9); c.lineTo(mid + 5, 9); c.lineTo(mid, 19); c.closePath(); c.fill();
    c.strokeStyle = BRASS; c.lineWidth = 1.4; c.beginPath(); c.moveTo(mid, 19); c.lineTo(mid, 46); c.stroke();
    // Under it: the heading in figures and the speed in knots.
    c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillStyle = CREAM; c.font = '700 20px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';
    const figures = `${String(Math.round(deg) % 360).padStart(3, '0')}°`; c.fillText(figures, x0 + 4, 72);
    c.fillStyle = DIM; c.font = '500 12px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif'; c.fillText(compassPoint(deg), x0 + 8 + c.measureText('000°').width * 1.7, 72);
    c.textAlign = 'right'; c.fillStyle = CREAM; c.font = '700 20px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';
    const kn = Math.abs(knots(s.speed)); c.fillText(kn < 9.95 ? kn.toFixed(1) : String(Math.round(kn)), x1 - 28, 72);
    c.fillStyle = DIM; c.font = '500 12px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif'; c.fillText(s.speed < -0.2 ? 'kn astern' : 'kn', x1 - 2, 72);
    // The lever: ahead up, astern down, neutral marked; its knob gold when the engine runs.
    const lx = W - 34, top = 16, bottom = H - 16, zero = top + (bottom - top) * 0.72, at = s.throttle >= 0 ? zero - (zero - top) * s.throttle : zero - (bottom - zero) * s.throttle;
    c.strokeStyle = DIM; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(lx, top); c.lineTo(lx, bottom); c.stroke();
    c.strokeStyle = CREAM; c.lineWidth = 1.2; c.beginPath(); c.moveTo(lx - 7, zero); c.lineTo(lx + 7, zero); c.stroke();
    c.strokeStyle = s.throttle < 0 ? CORAL : GOLD; c.lineWidth = 3; c.beginPath(); c.moveTo(lx, zero); c.lineTo(lx, at); c.stroke();
    c.fillStyle = s.running ? GOLD : DIM; c.beginPath(); c.arc(lx, at, 6, 0, 2 * Math.PI); c.fill(); c.strokeStyle = MIDNIGHT; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = DIM; c.font = '500 9px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif'; c.textAlign = 'left'; c.fillText('N', lx + 11, zero + 3);
    c.lineCap = 'butt';
  };
  return { el: canvas, update, show(on) { if (on === shown) return; shown = on; last = -1; canvas.classList.toggle('on', on); } };
}
