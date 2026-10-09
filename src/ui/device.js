// Whether this device can run the simulation: that it is a computer and not a phone; what the simulation asks of
// a computer; and how this one does when it is tried. Plain functions of what they are given (tests/device.test.mjs
// runs them in node); the opening screen (intro.js) shows what they say, and main.js acts on it.

/**
 * What the simulation was made for, in the words shown on the opening screen. (The graphics cards: measured on
 * one machine only, a GeForce RTX 4080 Super, where the heaviest view in first person takes 8.5 ms a frame at
 * full graphics and 1920 x 1080 (tools/bench.mjs), 5.3 ms at the simpler tier, and 3.4 ms at the simplest with
 * the picture whole. The cards named are those about half as fast as that one by their makers' and reviewers'
 * figures, which would draw full graphics at about sixty frames a second; and, for the least, those about an
 * eighth as fast, which would draw the simplest at about that. Estimates, not measurements of those cards: what
 * a computer is told on the opening screen is what it did when tried, judge() below.)
 */
export const RECOMMENDED = [
  ['device', 'A computer, with a keyboard and a mouse'],
  ['gpu', 'A graphics card: GeForce RTX 3070 or RTX 4060 Ti, Radeon RX 6750 XT, Apple M2 Max, or better'],
  ['memory', '16 GB of memory'],
  ['browser', 'Chrome or Edge, up to date (Firefox and Safari work too)'],
  ['screen', 'A screen of 1920 × 1080'],
];
export const MINIMUM = 'It runs on less, with simpler graphics: a GeForce GTX 1650, an Apple M1 or recent built-in graphics (Intel Iris Xe), and 8 GB of memory.';

/** The quality tiers (config.js TIERS) from the simplest up, and what each is called on the page. */
export const TIER_ORDER = ['low', 'medium', 'high', 'ultra'];
export const TIER_WORDS = { low: 'the simplest graphics', medium: 'simpler graphics', high: 'full graphics', ultra: 'the finest graphics' };

/**
 * Whether this is a phone or a tablet. `e`: { ua, touchPoints, coarse: the main pointer is a finger, anyFine:
 * there is a mouse or trackpad at all, hover: the main pointer can hover }. A computer with a touch screen is a
 * computer: it has a trackpad or a mouse as well.
 */
export function isMobile(e) {
  const ua = e.ua || '';
  // Phones and tablets say so.
  if (/Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Opera Mini|\bMobile\b|\bTablet\b|Silk\//i.test(ua)) return true;
  // An iPad asking for the desktop site calls itself a Mac; no Mac has a touch screen.
  if (/Macintosh/.test(ua) && (e.touchPoints || 0) > 1) return true;
  // And whatever else has a finger for its only pointer (no mouse, no trackpad, nothing that hovers): a tablet
  // asking for the desktop site.
  return !!(e.coarse && !e.anyFine && !e.hover && (e.touchPoints || 0) > 0);
}

/** What this browser says of itself and the device (in a browser only). `as`: a device to pretend to be, for pictures and tests. */
export function readEnv(as = null) {
  const mq = q => { try { return matchMedia(q).matches; } catch { return false; } };
  const env = {
    ua: navigator.userAgent || '', touchPoints: navigator.maxTouchPoints || 0, coarse: mq('(pointer: coarse)'), anyFine: mq('(any-pointer: fine)'), hover: mq('(hover: hover)'),
    memory: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency ?? null, width: innerWidth, height: innerHeight,
  };
  if (as === 'mobile') Object.assign(env, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', touchPoints: 5, coarse: true, anyFine: false, hover: false });
  return env;
}

/**
 * What this browser can draw with: { webgl2, floatTargets (it can draw into the half-float pictures the scene is
 * made in), renderer (the graphics driver's name) }. A context made to ask, and given back at once.
 */
export function probeGraphics(as = null) {
  if (as === 'nogpu') return { webgl2: false, floatTargets: false, renderer: '' };
  try {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
    if (!gl) return { webgl2: false, floatTargets: false, renderer: '' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info'), renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    const floatTargets = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, floatTargets, renderer };
  } catch { return { webgl2: false, floatTargets: false, renderer: '' }; }
}

/** A browser drawing on the processor, with no graphics card behind it (as config.js isSoftware). */
const software = renderer => /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer || '');

/** The graphics card's own name out of what the driver calls itself ("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x2503) Direct3D11 ...)"). */
export function gpuLabel(renderer) {
  const s = String(renderer || '').replace(/\((R|TM)\)/gi, '').replace(/\s+/g, ' ');
  if (software(s)) return 'none (drawn by the processor)';
  const m = s.match(/(NVIDIA )?(GeForce|Quadro|RTX|GTX|TITAN)[^(),/]*|(AMD |ATI )?Radeon[^(),/]*|Intel [^(),/]*(Iris|UHD|HD Graphics|Arc)[^(),/]*|Arc A?\d[^(),/]*|Apple M\d[^(),/]*|Apple GPU|Mali-[^(),/ ]*|Adreno[^(),/]*/i);
  const name = (m ? m[0] : s).replace(/\b(Direct3D|OpenGL|Vulkan|Metal|D3D)\b.*$/i, '').replace(/, or similar$/i, '').trim();
  return name.length > 44 ? `${name.slice(0, 43)}…` : name || 'not named by the browser';
}

/** Which browser this is, from what it calls itself: { name, version }. */
export function browserName(ua = '') {
  const pick = (re, name) => { const m = ua.match(re); return m ? { name, version: Number(m[1]) } : null; };
  return pick(/Edg\/(\d+)/, 'Edge') || pick(/OPR\/(\d+)/, 'Opera') || pick(/Firefox\/(\d+)/, 'Firefox') || pick(/Chrome\/(\d+)/, 'Chrome') || pick(/Version\/(\d+)[\d.]* Safari/, 'Safari') || { name: 'This browser', version: null };
}

/**
 * What can be said of this computer before the simulation is tried: rows { id, label, value, state } for the
 * opening screen; state 'ok', 'warn' (below what is recommended), 'bad' (it cannot run) or 'none' (not known).
 * `env` from readEnv, `gfx` from probeGraphics.
 */
export function staticChecks(env, gfx) {
  const rows = [], b = browserName(env.ua), chromium = b.name === 'Chrome' || b.name === 'Edge' || b.name === 'Opera';
  if (!gfx.webgl2) rows.push({ id: 'gpu', label: 'Graphics', value: 'this browser cannot draw in 3D (no WebGL 2)', state: 'bad' });
  else if (software(gfx.renderer)) rows.push({ id: 'gpu', label: 'Graphics', value: 'no graphics card in use: hardware acceleration is off', state: 'bad' });
  else if (!gfx.floatTargets) rows.push({ id: 'gpu', label: 'Graphics', value: `${gpuLabel(gfx.renderer)}: too old for this`, state: 'bad' });
  else rows.push({ id: 'gpu', label: 'Graphics', value: gpuLabel(gfx.renderer), state: 'ok' });
  rows.push({ id: 'browser', label: 'Browser', value: `${b.name}${b.version ? ` ${b.version}` : ''}${chromium ? '' : ' (made and tried in Chrome)'}`, state: 'ok' });
  // (A browser tells no more than 8 GB, or in newer ones 32, and Firefox and Safari tell nothing.)
  if (env.memory == null) rows.push({ id: 'memory', label: 'Memory', value: 'not told by this browser', state: 'none' });
  else rows.push({ id: 'memory', label: 'Memory', value: env.memory >= 8 ? `${env.memory} GB or more` : `${env.memory} GB (8 or more is asked)`, state: env.memory >= 8 ? 'ok' : 'warn' });
  const small = env.width < 1024 || env.height < 600;
  rows.push({ id: 'window', label: 'Window', value: `${env.width} × ${env.height}${small ? ' (small: make it larger)' : ''}`, state: small ? 'warn' : 'ok' });
  return rows;
}

/** The middle value of a list of numbers (0 for none). */
export function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * How the computer did when the simulation was tried on it. `fps`: frames a second it drew (the middle one of
 * those measured); `scale`: how small the picture had to be made to keep that up (1 whole .. 0.5); `tier`: the
 * quality it was tried at; `software`: no graphics card in use; `forced`: the tier was asked for, or has been
 * lowered as far as it will be.
 *
 * Returns { verdict, power, stepTo }. `power`: the frames a second it would manage with the picture whole (what
 * a frame costs goes with its pixels). `stepTo`: the simpler tier to try instead, when this one is too much for
 * it (it cannot hold forty frames with the picture whole). `verdict`: 'good', it meets what is recommended (full
 * graphics, smoothly); 'fair', it runs, with simpler graphics or a smaller picture than it was made for; 'poor',
 * under 24 frames a second even so: below the least it needs.
 */
export function judge({ fps, scale = 1, tier = 'high', software: soft = false, forced = false }) {
  const power = fps * scale * scale, lower = TIER_ORDER[TIER_ORDER.indexOf(tier) - 1] || null;
  const stepTo = !forced && !soft && lower && power < 38 ? lower : null;
  const verdict = soft || fps < 24 ? 'poor' : (tier === 'high' || tier === 'ultra') && power >= 45 ? 'good' : 'fair';
  return { verdict, power, stepTo };
}

/** The line that says how it did: frames a second, and at what quality. */
export function frameWords(fps, tier, scale = 1) {
  const n = fps >= 10 ? Math.round(fps) : Math.round(fps * 10) / 10;
  return `${n} frames a second, ${TIER_WORDS[tier] || tier}${scale < 0.85 ? ', a smaller picture' : ''}`;
}
