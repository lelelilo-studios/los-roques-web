// Boot: is this a computer; the opening screen while the simulation loads; trying it on this computer; the way
// in. Exposes the test API (window.__LR). The simulation itself (app.js, and three.js with it) is only fetched
// once this is known to be a computer.
import { params } from './config.js';
import { TIER_ORDER, isMobile, judge, median, probeGraphics, readEnv, staticChecks } from './ui/device.js';
import { createIntro } from './ui/intro.js';

const LR = (window.__LR = { errors: [] });
// (The test harness, and pictures of the simulation itself, want no opening screen: intro=0.)
const plain = params.freeze || !params.ui || params.intro === '0';
const intro = createIntro({ plain });
const env = readEnv(params.as);
const store = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* no storage */ } } };

/**
 * How fast this computer draws the simulation, which is running behind the opening screen by now, with the picture
 * kept whole. After a first second and a bit in which it is still settling, up to five spells of seven tenths of
 * a second: each gives the middle one of its intervals between frames, and the best spell is the answer (a page
 * that has just loaded still has things to finish, and another program may take the graphics card for a moment:
 * what the computer can do is what it does when left alone). It ends as soon as one spell runs at fifty frames a
 * second. { fps, scale: 1 }. `tell(0..1)`: how far through. (Looked away from, a page is not drawn: a spell that
 * was interrupted is begun again.)
 */
function measure(api, tell) {
  const WARM = 1200, SPELL = 700, SPELLS = 5, MOST = 15000;
  return new Promise(resolve => {
    const began = performance.now(), gaps = [];
    let from = 0, last = 0, lastGap = 0, done = 0, best = Infinity;
    const end = () => resolve({ fps: 1000 / (Number.isFinite(best) ? best : lastGap || MOST), scale: 1 });
    const step = now => {
      const late = now - began > MOST;
      if (!last) from = now + WARM;                                                   // (the first frame: settle first)
      else if (now - last > 1500 && !late) { from = Math.max(from, now + 300); gaps.length = 0; }      // (back from being hidden)
      else { lastGap = now - last; if (now >= from) gaps.push(lastGap); }
      last = now;
      tell(Math.min(1, (now - began) / (WARM + SPELLS * SPELL)));
      if (now - from >= SPELL && gaps.length >= 4) { best = Math.min(best, median(gaps)); gaps.length = 0; from = now; done++; }
      // (A browser drawing without a graphics card takes seconds a frame: it is not waited on for ever.)
      if (done >= SPELLS || 1000 / best >= 50 || late) end(); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// (While the opening screen is up the simulation behind it hears no keys; Enter steps in when the way in is showing.)
addEventListener('keydown', e => {
  if (plain || !intro.open) return;
  e.stopImmediatePropagation();
  if ((e.key === 'Enter' || e.key === ' ') && intro.step && !e.repeat && document.activeElement?.id !== 'i-sound' && !e.target.closest?.('a')) { e.preventDefault(); intro.step(); }
}, true);
addEventListener('keyup', e => { if (!plain && intro.open) e.stopImmediatePropagation(); }, true);

// (Nor can the Tab key wander into its controls, which are there behind the night.)
const ui = document.getElementById('ui');
if (!plain) ui.inert = true;

LR.ready = (async () => {
  // A phone or a tablet: it is told what this needs, and nothing more is fetched.
  if (!plain && isMobile(env)) { LR.blocked = true; intro.blocked(); return false; }
  const gfx = probeGraphics(params.as);
  if (!plain) {
    intro.device(staticChecks(env, gfx));
    if (!gfx.webgl2) { intro.fail('This browser cannot draw it', ['The simulation is drawn with WebGL 2, which this browser does not have, or has switched off. A current Chrome, Edge, Firefox or Safari on a computer with a graphics card has it.']); return false; }
  }
  try {
    const { start } = await import('./app.js');
    // (The seam: the maps are its first seven tenths; you, and the first frames, the next; trying it, the last.)
    const api = await start(document.getElementById('view'), (fraction, label) => intro.progress(label === 'your body' ? 0.78 : 0.7 * fraction, label));
    api.errors.push(...LR.errors);
    Object.assign(LR, api);
    if (plain) { intro.close(); return true; }

    intro.progress(0.86, 'measure');
    intro.row({ id: 'fps', label: 'Frame rate', value: 'trying it…', state: 'busy' });
    const steps = Number(store.get('lr-steps') || 0), tier = api.device.tier;
    const pretend = { slow: { fps: 13.4, scale: 0.5, tier: 'low', forced: true }, weak: { fps: 52, scale: 1, tier: 'medium', forced: true } }[params.as];
    // (Tried with the picture whole: app.js trial.)
    api.trial(true);
    const about = { tier, software: api.device.software, forced: !!params.tier || steps >= TIER_ORDER.length - 1 };
    let m = pretend || await measure(api, t => intro.progress(0.86 + 0.1 * t));
    // (Found too slow for this quality, it is not believed at once: it is left a moment, and tried once more.)
    if (!pretend && judge({ ...about, ...m }).stepTo) {
      intro.progress(0.96, 'again');
      await new Promise(r => setTimeout(r, 1500));
      const second = await measure(api, t => intro.progress(0.96 + 0.04 * t));
      if (second.fps > m.fps) m = second;
    }
    api.trial(false);
    const result = { ...about, ...m };
    Object.assign(result, judge(result));
    LR.tried = result;
    // Too much for this computer at this quality: the page starts again a tier simpler (config.js pickTier reads
    // the note), and is tried again there. At the simplest, it is told how it did.
    if (result.stepTo) {
      intro.progress(1, 'simpler');
      store.set('lr-tier', result.stepTo); store.set('lr-steps', String(steps + 1));
      setTimeout(() => location.reload(), 900);
      return new Promise(() => {});
    }
    intro.onSound = on => api.setSound(on);
    if (intro.soundChosen) api.setSound(intro.sound);
    intro.ready(result).then(() => { ui.inert = false; api.enter(); });
    return true;
  } catch (e) {
    console.error(e);
    LR.errors.push(String(e?.message || e));
    if (plain) intro.close();
    else intro.fail('It could not start', [String(e?.message || e), 'Loading the page again often cures it. If it does not, the browser may have switched its graphics off: closing other tabs, or starting the browser again, brings them back.']);
    return false;
  }
})();
