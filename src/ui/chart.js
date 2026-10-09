// The chart of the archipelago (M): the seabed as sim/route.js has read it, drawn in lelelilo's own night:
// midnight water growing paler where it shoals, the depth lines sewn in gold thread, the cays in sand, a brass
// rose; the names of the cays, your boat and which way it heads, the way you have come. In your boat, a click
// on a place asks to be taken there.
import { knots } from './helm.js';

const MIDNIGHT = [7, 13, 24], NAVY = [15, 28, 46], TEAL = [34, 104, 120], PALE = [86, 168, 172], SAND = [232, 220, 196], GOLD = '#ffc94a', CREAM = '#fff4d6', BRASS = '#b8863b', DIM = '#a0afc3';
const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", "Quicksand", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], ease = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The colour of the chart where the water is `d` metres deep (negative: land that high). */
export function chartColour(d) {
  if (d < -0.05) return mix(SAND, [206, 190, 160], ease(0.5, 6, -d));
  if (d < 0.35) return mix(SAND, PALE, ease(-0.05, 0.35, d));                 // (the wet edge, and flats that dry)
  if (d < 6) return mix(PALE, TEAL, Math.pow(ease(0.35, 6, d), 0.7));
  if (d < 22) return mix(TEAL, NAVY, ease(6, 22, d));
  return mix(NAVY, MIDNIGHT, ease(22, 55, d));
}

/**
 * @param {HTMLElement} root
 * @param {object} o
 * @param {import('../sim/route.js').Seaways} o.seaways
 * @param {{name: string, pos: number[], rank?: number, lat?: number, lon?: number}[]} o.names  the cays
 * @param {(target: {name: string, pos: number[]}) => void} o.onPick  a place was clicked
 * @param {() => void} o.onClose
 */
export function buildChart(root, { seaways, names, onPick, onClose }) {
  const el = document.createElement('div'); el.className = 'chart'; el.hidden = true;
  const canvas = document.createElement('canvas'); el.append(canvas);
  root.append(el);
  const c = canvas.getContext('2d'), rect = seaways.rect;
  let base = null, fit = null, state = null, hover = null, open = false, last = -1, message = '';
  const ratio = () => Math.min(2, window.devicePixelRatio || 1);
  // (The world to the page: the whole archipelago, fitted into the window with a margin, north up.)
  const layout = () => {
    const W = window.innerWidth, H = window.innerHeight, m = Math.max(16, Math.min(W, H) * 0.045), k = Math.min((W - 2 * m) / rect.w, (H - 2 * m - 30) / rect.h), w = rect.w * k, h = rect.h * k;
    fit = { W, H, k, x: (W - w) / 2, y: (H - h) / 2 + 6, w, h };
    canvas.width = Math.round(W * ratio()); canvas.height = Math.round(H * ratio()); canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    base = null;
  };
  const toPage = (x, z) => [fit.x + (x - rect.x) * fit.k, fit.y + (z - rect.z) * fit.k], toWorld = (px, py) => [rect.x + (px - fit.x) / fit.k, rect.z + (py - fit.y) / fit.k];
  // The seabed, once for this size of window: every pixel its depth's colour, and the depth lines sewn over it.
  const paint = () => {
    const r = ratio(), w = Math.round(fit.w * r), h = Math.round(fit.h * r), off = document.createElement('canvas'); off.width = w; off.height = h;
    const g = off.getContext('2d'), image = g.createImageData(w, h), d = image.data, depth = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) depth[y * w + x] = seaways.depthAt(rect.x + (x + 0.5) / w * rect.w, rect.z + (y + 0.5) / h * rect.h);
    const LINES = [2, 5, 10, 20];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x, v = depth[k], right = depth[k + (x + 1 < w ? 1 : 0)], below = depth[k + (y + 1 < h ? w : 0)];
      let col = chartColour(v);
      // (A little grain, as cloth has.)
      const grain = ((x * 7 + y * 13) % 5 - 2) * 0.6; col = [col[0] + grain, col[1] + grain, col[2] + grain];
      // The shore: a line of cream. The depth lines: gold stitches, three pixels on and three off along a slant.
      if ((v > 0) !== (right > 0) || (v > 0) !== (below > 0)) col = mix(col, [255, 244, 214], 0.75);
      else for (const line of LINES) if (((v > line) !== (right > line) || (v > line) !== (below > line)) && (((x + y) / (3 * r)) | 0) % 2 === 0) { col = mix(col, [255, 201, 74], line === 2 ? 0.35 : 0.5); break; }
      d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2]; d[k * 4 + 3] = 255;
    }
    g.putImageData(image, 0, 0);
    base = off;
  };
  // A line of latitude and longitude every five minutes, from where two far-apart cays are said to be.
  const graticule = (() => {
    const known = names.filter(n => Number.isFinite(n.lat) && Number.isFinite(n.lon));
    if (known.length < 2) return null;
    let a = known[0], b = known[1], far = 0;
    for (const p of known) for (const q of known) { const d = Math.abs(p.pos[0] - q.pos[0]) * Math.abs(p.pos[1] - q.pos[1]); if (d > far) { far = d; a = p; b = q; } }
    const xPer = (b.pos[0] - a.pos[0]) / (b.lon - a.lon), zPer = (b.pos[1] - a.pos[1]) / (b.lat - a.lat);
    return { x: lon => a.pos[0] + (lon - a.lon) * xPer, z: lat => a.pos[1] + (lat - a.lat) * zPer, lon: x => a.lon + (x - a.pos[0]) / xPer, lat: z => a.lat + (z - a.pos[1]) / zPer };
  })();
  const minutes = (v, pos, neg) => { const a = Math.abs(v), deg = Math.floor(a + 1e-9), min = Math.round((a - deg) * 60); return `${deg}°${String(min).padStart(2, '0')}′${v >= 0 ? pos : neg}`; };

  const draw = () => {
    if (!fit) layout();
    if (!base && seaways.ready) paint();
    const r = ratio(), { W, H } = fit;
    c.setTransform(r, 0, 0, r, 0, 0); c.clearRect(0, 0, W, H);
    // The cloth it is sewn on.
    const cloth = c.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.7); cloth.addColorStop(0, '#0f1c2e'); cloth.addColorStop(1, '#070d18');
    c.fillStyle = cloth; c.globalAlpha = 0.97; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
    if (base) c.drawImage(base, fit.x, fit.y, fit.w, fit.h);
    else { c.fillStyle = DIM; c.font = `500 14px ${FONT}`; c.textAlign = 'center'; c.fillText(`Sounding the archipelago: ${Math.round(seaways.build(0) * 100)} %`, W / 2, H / 2); }
    // Its seam: gold stitches round the sheet.
    c.strokeStyle = GOLD; c.lineWidth = 1.4; c.setLineDash([7, 5]); c.globalAlpha = 0.8; c.strokeRect(fit.x - 6, fit.y - 6, fit.w + 12, fit.h + 12); c.setLineDash([]); c.globalAlpha = 1;
    c.save(); c.beginPath(); c.rect(fit.x, fit.y, fit.w, fit.h); c.clip();
    if (graticule) {
      c.strokeStyle = 'rgba(160, 175, 195, 0.16)'; c.lineWidth = 1; c.fillStyle = 'rgba(160, 175, 195, 0.7)'; c.font = `500 10px ${FONT}`;
      const lon0 = graticule.lon(rect.x), lon1 = graticule.lon(rect.x + rect.w), lat0 = graticule.lat(rect.z + rect.h), lat1 = graticule.lat(rect.z), step = 5 / 60;
      for (let v = Math.ceil(Math.min(lon0, lon1) / step) * step; v < Math.max(lon0, lon1); v += step) { const [x] = toPage(graticule.x(v), 0); c.beginPath(); c.moveTo(x, fit.y); c.lineTo(x, fit.y + fit.h); c.stroke(); c.textAlign = 'left'; c.fillText(minutes(v, 'E', 'W'), x + 4, fit.y + fit.h - 6); }
      for (let v = Math.ceil(Math.min(lat0, lat1) / step) * step; v < Math.max(lat0, lat1); v += step) { const [, y] = toPage(0, graticule.z(v)); c.beginPath(); c.moveTo(fit.x, y); c.lineTo(fit.x + fit.w, y); c.stroke(); c.textAlign = 'left'; c.fillText(minutes(v, 'N', 'S'), fit.x + 5, y - 4); }
    }
    // The way you have come: cream dots. The way you are being taken: gold thread.
    const thread = (points, colour, dash, width) => { if (!points || points.length < 2) return; c.strokeStyle = colour; c.lineWidth = width; c.setLineDash(dash); c.lineJoin = 'round'; c.beginPath(); points.forEach((p, i) => { const [x, y] = toPage(p[0], p[1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); c.setLineDash([]); };
    if (state) { thread(state.track, 'rgba(255, 244, 214, 0.75)', [1.5, 5], 1.6); thread(state.route, GOLD, [8, 5], 2); }
    // The names of the cays: the larger ones first, none over another.
    const taken = [];
    c.textBaseline = 'middle';
    for (const n of [...names].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))) {
      const [x, y] = toPage(n.pos[0], n.pos[1]), big = (n.rank ?? 99) <= 6, lit = hover === n;
      c.font = `${big ? 700 : 500} ${big ? 13 : 10.5}px ${FONT}`;
      const w = c.measureText(n.name).width, box = [x + 7, y - 8, w + 4, 16];
      n.at = [x, y]; n.shown = lit || !taken.some(t => box[0] < t[0] + t[2] && t[0] < box[0] + box[2] && box[1] < t[1] + t[3] && t[1] < box[1] + box[3]);
      c.fillStyle = lit ? GOLD : 'rgba(255, 244, 214, 0.9)'; c.beginPath(); c.arc(x, y, lit ? 4 : 2, 0, 2 * Math.PI); c.fill();
      if (lit) { c.strokeStyle = BRASS; c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, 9, 0, 2 * Math.PI); c.stroke(); }
      if (!n.shown) continue;
      taken.push(box);
      c.textAlign = 'left'; c.lineWidth = 3; c.strokeStyle = 'rgba(7, 13, 24, 0.75)'; c.strokeText(n.name, x + 8, y); c.fillStyle = lit ? GOLD : big ? CREAM : 'rgba(255, 244, 214, 0.82)'; c.fillText(n.name, x + 8, y);
    }
    if (state) {
      // Where you are, if you are not in it: a cream dot. Your boat: a gold hull, its bow the way it heads.
      if (state.you) { const [x, y] = toPage(state.you[0], state.you[1]); c.fillStyle = CREAM; c.beginPath(); c.arc(x, y, 3, 0, 2 * Math.PI); c.fill(); }
      if (state.boat) {
        const [x, y] = toPage(state.boat.x, state.boat.z);
        c.save(); c.translate(x, y); c.rotate(state.boat.heading);
        c.fillStyle = GOLD; c.strokeStyle = '#070d18'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, -11); c.quadraticCurveTo(6, -3, 5, 8); c.lineTo(-5, 8); c.quadraticCurveTo(-6, -3, 0, -11); c.closePath(); c.fill(); c.stroke();
        c.restore();
        c.strokeStyle = 'rgba(255, 201, 74, 0.45)'; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, 16 + 3 * Math.sin(performance.now() / 500), 0, 2 * Math.PI); c.stroke();
      }
    }
    c.restore();
    // The title, the rose, the scale, and what a click does.
    c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillStyle = CREAM; c.font = `700 22px ${FONT}`; c.fillText('Los Roques', fit.x + 14, fit.y + 32);
    c.fillStyle = DIM; c.font = `500 11px ${FONT}`; c.fillText('Archipiélago · Venezuela · depths in metres: 2, 5, 10, 20', fit.x + 15, fit.y + 49);
    { const x = fit.x + 52, y = fit.y + fit.h - 62, R = 30;
      c.strokeStyle = BRASS; c.lineWidth = 1.4; c.beginPath(); c.arc(x, y, R, 0, 2 * Math.PI); c.stroke(); c.globalAlpha = 0.5; c.beginPath(); c.arc(x, y, R - 5, 0, 2 * Math.PI); c.stroke(); c.globalAlpha = 1;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, long = k % 2 === 0 ? R - 4 : R - 13; c.fillStyle = k === 0 ? GOLD : BRASS; c.beginPath(); c.moveTo(x + Math.sin(a) * long, y - Math.cos(a) * long); c.lineTo(x + Math.sin(a + 0.32) * 6, y - Math.cos(a + 0.32) * 6); c.lineTo(x, y); c.lineTo(x + Math.sin(a - 0.32) * 6, y - Math.cos(a - 0.32) * 6); c.closePath(); c.fill(); }
      c.fillStyle = GOLD; c.font = `700 12px ${FONT}`; c.textAlign = 'center'; c.fillText('N', x, y - R - 5); }
    { const metres = 5000, w = metres * fit.k, x = fit.x + fit.w - w - 18, y = fit.y + fit.h - 22;
      c.strokeStyle = CREAM; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y - 5); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y - 3); c.stroke();
      c.fillStyle = CREAM; c.font = `500 11px ${FONT}`; c.textAlign = 'center'; c.fillText('5 km · 2.7 nautical miles', x + w / 2, y - 9); }
    c.textAlign = 'center'; c.fillStyle = CREAM; c.font = `500 13px ${FONT}`;
    const line = message || (!state ? '' : state.passage ? `On the way to ${state.passage.name}: ${Math.max(0, state.passage.left / 1000).toFixed(1)} km to go · any key gives you the tiller back`
      : state.aboard ? (hover ? `${hover.name}: ${(Math.hypot(hover.pos[0] - state.boat.x, hover.pos[1] - state.boat.z) / 1000).toFixed(1)} km as the gull flies · click, and the boat takes you there` : 'Click a cay: the boat takes you there · M or Esc folds the chart')
        : 'Climb into your boat (B beside it) to be taken somewhere · M or Esc folds the chart');
    if (line) c.fillText(line, W / 2, fit.y + fit.h + 26);
    if (state && state.boat && state.aboard) { c.textAlign = 'right'; c.fillStyle = DIM; c.font = `500 11px ${FONT}`; c.fillText(`${knots(Math.abs(state.boat.speed)).toFixed(1)} kn`, fit.x + fit.w - 14, fit.y + 30); }
  };

  const pick = e => { if (!fit) return null; let best = null, far = 26; for (const n of names) { if (!n.at) continue; const d = Math.hypot(e.clientX - n.at[0], e.clientY - n.at[1]); if (d < far) { far = d; best = n; } } return best; };
  canvas.addEventListener('mousemove', e => { const h = pick(e); if (h !== hover) { hover = h; canvas.style.cursor = h && state?.aboard ? 'pointer' : 'default'; last = -1; } });
  canvas.addEventListener('click', e => { const h = pick(e); if (h && state?.aboard && !state.passage) onPick(h); });
  const key = e => { if (!open) return; const k = e.code === 'KeyM' ? 'm' : e.key; if (k === 'm' || k === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
  window.addEventListener('keydown', key, true);
  window.addEventListener('resize', () => { if (open) { layout(); last = -1; } });

  return {
    el,
    get isOpen() { return open; },
    /** Unfolds it (true) or folds it away. */
    show(on) { if (on === open) return; open = on; el.hidden = !on; message = ''; hover = null; if (on) { layout(); last = -1; } },
    /** A line said under it for a moment (there is no way there, say). */
    say(text) { message = text; last = -1; },
    /**
     * @param {{boat: {x: number, z: number, heading: number, speed: number} | null, you: number[] | null, aboard: boolean, track: number[][], route: number[][] | null, passage: {name: string, left: number} | null}} s
     * @param {number} now  seconds: it is drawn again eight times a second
     */
    update(s, now = performance.now() / 1000) { state = s; if (!open || now - last < 0.125) return; last = now; draw(); },
    /** For tests: where a cay's name is on the page ([x, y]), once drawn. */
    where: name => names.find(n => n.name === name)?.at || null,
  };
}
