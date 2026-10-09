// The opening screen (index.html #intro, css/intro.css): Los Roques' horizon sewn across lelelilo's night. The
// seam is the loading bar: a needle sews it, stitch by stitch, as the simulation loads; behind it the sun, which
// here is a pillow, comes up, and puts its sunglasses on when all is ready. Beside it, what is known of this
// computer and what the simulation asks of one. It ends when you step in: the night opens from the sun outward,
// a ring of stitches round the opening. main.js says what to show; nothing here knows the simulation.
import { MINIMUM, RECOMMENDED, frameWords } from './device.js';

/** What is being loaded, in the opening screen's words (the names are the loader's: data/loader.js, app.js). */
const STAGES = {
  start: 'Threading the needle', height: 'Measuring the sea floor', shore: 'Tracing every shoreline', benthic: 'Laying out reef and seagrass',
  land: 'Planting the mangroves', waveMap: 'Winding up the waves', albedo: 'Mixing the colours of the lagoon', waterType: 'Clearing the water',
  'your body': 'Stitching you together', measure: 'Trying it on your computer', again: 'Trying it once more', simpler: 'Too much for this computer: trying simpler graphics',
};
/** What to do once you are in, one line at a time while you wait. */
const TIPS = [
  '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk · the mouse to look',
  '<kbd>C</kbd> to crouch, then hold the mouse button to take a handful of sand',
  'Let go, and it runs out between your fingers by itself',
  'Hold the button again and move the mouse to tip your hand',
  '<kbd>X</kbd> to sit down by the water',
  '<kbd>Shift</kbd> to run · <kbd>Space</kbd> to stand on your toes',
  'The wheel parts and closes your fingers',
  '<kbd>Tab</kbd> lifts you into the air, to choose another island',
];
const VERDICTS = {
  good: () => 'This computer meets the recommended requirements.',
  fair: r => `This computer is below the recommended requirements. It will run, with ${r.tier === 'high' || r.tier === 'ultra' ? 'a smaller picture' : r.tier === 'low' ? 'the simplest graphics' : 'simpler graphics'}.`,
  poor: r => (r.software
    ? 'This browser is drawing without the graphics card, so the simulation will be very slow. Turn on hardware acceleration in the browser’s settings, then load this page again.'
    : `This computer does not meet the minimum requirements: it drew about ${r.fps >= 10 ? Math.round(r.fps) : r.fps.toFixed(1)} frames a second with ${r.tier === 'low' ? 'the simplest graphics' : 'the graphics it was given'}. It will be slow and jerky here. Closing other tabs and programs may help; a computer with a graphics card will.`),
};

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

/**
 * Takes charge of the opening screen. `plain`: for the test harness and pictures of the simulation itself, which
 * want no opening: it is only taken away when the simulation is ready.
 * @returns {{ progress, row, device, ready, fail, blocked, close, open: boolean, sound: boolean }}
 */
export function createIntro({ plain = false } = {}) {
  const root = $('intro'), wave = $('i-wave'), reveal = $('i-reveal'), thread = $('i-thread'), needle = $('i-needle'), sun = $('i-sun');
  const label = $('i-label'), pct = $('i-pct'), tip = $('i-tip'), checks = $('i-checks'), soundButton = $('i-sound');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { open: true, sound: true, touched: false };
  try { state.sound = localStorage.getItem('lr-sound') !== 'off'; } catch { /* not remembered */ }

  // ---- the night sky (the same stars each time: a fixed seed)
  if (!plain) {
    let seed = 20261008;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const stars = root.querySelector('.i-stars');
    for (let i = 0; i < 90; i++) {
      const big = r() < 0.12, s = el('i');
      s.style.cssText = `left:${(r() * 100).toFixed(2)}%;top:${(r() * r() * 78).toFixed(2)}%;--s:${(big ? 2.4 + r() * 1.2 : 0.9 + r() * 1.1).toFixed(1)}px;--o:${(0.35 + r() * 0.6).toFixed(2)};--t:${(2.6 + r() * 4).toFixed(1)}s;--d:${(-r() * 6).toFixed(1)}s`;
      if (big && r() < 0.5) s.className = 'warm';
      stars.append(s);
    }
    $('i-asks').append(...RECOMMENDED.map(([, text]) => el('li', {}, el('span', { textContent: text }))));
    $('i-least').textContent = MINIMUM;
    fetch('build.json').then(q => (q.ok ? q.json() : null)).then(b => { if (b?.build) $('i-build').textContent = `build ${b.build}`; }).catch(() => {});
  }

  // ---- the seam, the needle and the sun: `shown` follows `want`, so the needle glides and never jumps
  const length = wave.getTotalLength();
  reveal.style.strokeDasharray = `${length} ${length}`;
  let want = 0, shown = 0, soft = 0, told = performance.now(), last = performance.now(), frame = 0, painted = -1;
  const ease = t => t * t * (3 - 2 * t);
  function paint(now) {
    const d = shown * length, p = wave.getPointAtLength(d), q = wave.getPointAtLength(Math.min(length, d + 2)), along = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
    reveal.style.strokeDashoffset = String(length * (1 - shown));
    // (It sews: down through the cloth and up again once a stitch, and never quite still in between.)
    const dip = Math.sin((d % 30) / 30 * 2 * Math.PI), idle = still ? 0 : Math.sin(now / 420);
    needle.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${(along + 15 * dip + 2.5 * idle).toFixed(2)}) translate(6 ${(-3 * dip).toFixed(2)})`);
    // (The thread it has drawn through and not yet pulled tight.)
    const loose = Math.min(54, d);
    thread.style.strokeDasharray = `${loose} ${length}`; thread.style.strokeDashoffset = String(-(d - loose));
    sun.setAttribute('transform', `translate(500 ${(312 - 152 * ease(shown)).toFixed(2)})`);
    root.style.setProperty('--p', shown.toFixed(3));
    const percent = Math.round(shown * 100);
    // (And on the tab, for whoever has gone to look at something else meanwhile.)
    if (percent !== painted) { painted = percent; pct.textContent = String(percent); if (!root.classList.contains('ready') && !root.classList.contains('blocked')) document.title = `${percent} % · Los Roques`; }
  }
  function tick(now) {
    frame = 0;
    if (!state.open) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // (Between two things loaded it creeps on a little, towards a twentieth further: it is working, not stuck.)
    soft = Math.min(1, want + 0.05 * (1 - Math.exp(-(now - told) / 5000)));
    const goal = want >= 1 ? 1 : Math.min(soft, 0.995);
    shown = still ? goal : Math.min(goal, shown + Math.max((goal - shown) * (1 - Math.exp(-dt / 0.3)), Math.min(goal - shown, 0.02 * dt)));
    paint(now);
    frame = requestAnimationFrame(tick);
  }
  if (!plain) { paint(performance.now()); frame = requestAnimationFrame(tick); }

  // ---- what is being done, and what to do later
  let shownStage = 'start', tipAt = -1, tipTimer = 0;
  function say(name) {
    if (name === shownStage || !STAGES[name]) return;
    shownStage = name;
    label.classList.add('swap');
    setTimeout(() => { label.textContent = STAGES[name]; label.classList.remove('swap'); }, still ? 0 : 220);
  }
  function nextTip() {
    tipAt = (tipAt + 1) % TIPS.length;
    tip.classList.add('swap');
    setTimeout(() => { tip.innerHTML = TIPS[tipAt]; tip.classList.remove('swap'); }, still ? 0 : 420);
  }
  if (!plain) { tip.innerHTML = TIPS[tipAt = 0]; tipTimer = setInterval(nextTip, 5200); }

  // ---- the sound: on or off before you go in, remembered as the simulation remembers it
  const showSound = () => soundButton.setAttribute('aria-pressed', String(state.sound));
  showSound();
  soundButton.addEventListener('click', () => {
    state.sound = !state.sound; state.touched = true; showSound();
    try { localStorage.setItem('lr-sound', state.sound ? 'on' : 'off'); } catch { /* not remembered */ }
    api.onSound?.(state.sound);
  });

  /** One line of "your computer": added, or changed if there is one of that id. */
  function row({ id, label: name, value, state: how }) {
    let li = checks.querySelector(`[data-id="${id}"]`);
    if (!li) { li = el('li', {}, el('span'), el('b')); li.dataset.id = id; checks.append(li); }
    li.className = how; li.children[0].textContent = name; li.children[1].textContent = value;
  }

  /** The night opens from the sun: a hole that grows until the screen is clear, a ring of stitches round it. */
  function open() {
    return new Promise(done => {
      document.title = 'Los Roques';
      const finish = () => { state.open = false; root.hidden = true; root.style.maskImage = root.style.webkitMaskImage = ''; rim.style.opacity = '0'; cancelAnimationFrame(frame); clearInterval(tipTimer); done(); };
      const rim = $('i-rim');
      root.classList.add('leaving');
      if (still) { root.classList.add('fading'); setTimeout(finish, 720); return; }
      const box = sun.querySelector('.pillow').getBoundingClientRect(), cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      const far = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 30, t0 = performance.now(), T = 1250;
      const grow = now => {
        const t = Math.min(1, (now - t0) / T), k = t * t * t * (t * (6 * t - 15) + 10), radius = box.width * 0.2 + (far - box.width * 0.2) * k * k;
        const mask = `radial-gradient(circle at ${cx}px ${cy}px, transparent ${radius.toFixed(1)}px, #000 ${(radius + 1.5).toFixed(1)}px)`;
        root.style.maskImage = mask; root.style.webkitMaskImage = mask;
        rim.style.left = `${(cx - radius).toFixed(1)}px`; rim.style.top = `${(cy - radius).toFixed(1)}px`; rim.style.width = rim.style.height = `${(2 * radius).toFixed(1)}px`;
        rim.style.opacity = String(Math.min(1, t * 8) * (1 - Math.max(0, (t - 0.7) / 0.3)));
        rim.style.rotate = `${(t * 40).toFixed(1)}deg`;
        if (t < 1) requestAnimationFrame(grow); else finish();
      };
      requestAnimationFrame(grow);
    });
  }

  /** A note in the middle of the screen in place of the loading: a heading, paragraphs, and what else is given. */
  function note(kind, heading, paragraphs, ...more) {
    root.classList.add(kind);
    const box = $('i-note');
    box.replaceChildren(el('h2', { textContent: heading }), ...paragraphs.map(t => el('p', { textContent: t })), ...more);
    box.hidden = false; $('i-go').hidden = true;
    clearInterval(tipTimer);
  }

  const api = {
    get open() { return state.open; },
    /** Whether you want the sound, and whether you said so here. */
    get sound() { return state.sound; }, get soundChosen() { return state.touched; },
    /** Set by main.js: told when the sound is switched here while the simulation is already running behind. */
    onSound: null,
    /** How far along (0..1) and what was just done (a name of STAGES). */
    progress(fraction, name) { if (fraction > want) { want = Math.min(1, fraction); told = performance.now(); } if (name) say(name); },
    row,
    /** What is known of this computer before it is tried (device.js staticChecks). */
    device(rows) { for (const r of rows) row(r); row({ id: 'fps', label: 'Frame rate', value: 'tried once it has loaded', state: 'none' }); },
    /**
     * Loaded and tried: shows how the computer did (`result`: { verdict, fps, scale, tier, software }) and the way
     * in. The promise is kept when you step in (the button, or Enter), as the night begins to open; `opened` on
     * it when the screen is clear.
     */
    ready(result) {
      want = 1;
      row({ id: 'fps', label: 'Frame rate', value: frameWords(result.fps, result.tier, result.scale), state: result.verdict === 'good' ? 'ok' : result.verdict === 'fair' ? 'warn' : 'bad' });
      const verdict = $('i-verdict'), enter = $('i-enter');
      verdict.className = `i-verdict ${result.verdict}`; verdict.textContent = VERDICTS[result.verdict](result);
      if (result.verdict === 'poor') $('i-enter-text').textContent = 'Enter anyway';
      root.classList.add('ready'); document.title = 'Los Roques · ready';
      root.querySelector('.i-status').hidden = true; $('i-go').hidden = false;
      clearInterval(tipTimer);
      enter.focus({ preventScroll: true });
      let opened;
      const stepped = new Promise(go => {
        const step = () => { if (!go) return; const g = go; go = null; opened = open(); g(); };
        enter.addEventListener('click', step);
        api.step = step;
      });
      stepped.opened = () => opened;
      return stepped;
    },
    /** Step in, if the way in is showing (main.js: the Enter key). */
    step: null,
    /** It could not start: says why, and what can be done. */
    fail(heading, paragraphs) { want = Math.max(want, shown); document.title = 'Los Roques'; note('failed', heading, paragraphs, el('div', { className: 'i-link' }, el('code', { textContent: 'Load the page again' }), el('button', { type: 'button', textContent: 'Reload', onclick: () => location.reload() }))); },
    /** A phone or a tablet: the simulation is not loaded; says what it needs, and gives the address to take to a computer. */
    blocked() {
      root.classList.add('blocked'); document.title = 'Los Roques';
      want = 0.46; shown = 0.46; paint(performance.now());           // (the sun half up, asleep)
      const address = location.origin + location.pathname, code = el('code', { textContent: address.replace(/^https?:\/\//, '') });
      const copy = el('button', { type: 'button', textContent: navigator.share ? 'Send it to yourself' : 'Copy the address' });
      copy.onclick = async () => {
        try { if (navigator.share) await navigator.share({ title: 'Los Roques', text: 'Los Roques: open on a computer', url: address }); else { await navigator.clipboard.writeText(address); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy the address'; }, 2200); } }
        catch { /* cancelled, or not allowed: the address is there to read */ }
      };
      note('blocked', 'This one needs a computer',
        ['Los Roques is a whole archipelago in 3D, made for a keyboard, a mouse and a graphics card. A phone or a tablet cannot run it. Open it on a computer:'],
        el('div', { className: 'i-link' }, code, copy), el('p', { textContent: '' }), el('ul', {}, ...RECOMMENDED.map(([, text]) => el('li', {}, el('span', { textContent: text })))));
    },
    /** Takes the screen away without ceremony (the test harness). */
    close() { state.open = false; root.hidden = true; cancelAnimationFrame(frame); clearInterval(tipTimer); },
  };
  return api;
}
