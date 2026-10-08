// Sound, all of it made here from noise and a few oscillators (no audio files): small waves on the sand in time
// with the swash you see, the roar of the reef where it is near, wind, your steps on dry sand, wet sand and in
// water, the swish of wading, rain, the muffled world under water, and now and then a laughing gull.
//
// `Ambience` builds the sound graph on any BaseAudioContext, so the same code runs live and in an
// OfflineAudioContext (tools/sound.mjs renders scenes with it and measures their levels: a machine can check
// that the sound is there and not clipping, not that it sounds right).
//
// update() takes the scene as numbers; nothing here knows about three or the DOM.

import { runup, swashPhase } from '../data/shoreCPU.js';

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function noiseBuffer(ctx, seconds, colour) {
  const n = Math.floor(ctx.sampleRate * seconds), buffer = ctx.createBuffer(1, n, ctx.sampleRate), d = buffer.getChannelData(0);
  let seed = colour === 'pink' ? 22222 : colour === 'brown' ? 33333 : 11111;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    if (colour === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22; }
    else if (colour === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w;
  }
  // (Fade the ends into each other so the loop has no click.)
  const k = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < k; i++) { const a = i / k; d[i] = d[i] * a + d[n - k + i] * (1 - a); }
  return buffer;
}

export class Ambience {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0.9;
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000; this.muffle.Q.value = 0.5;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 8; limiter.ratio.value = 8; limiter.attack.value = 0.004; limiter.release.value = 0.2;
    this.out.connect(this.muffle).connect(limiter).connect(ctx.destination);
    this.tap = limiter;                                       // where a meter can listen
    this.buffers = { white: noiseBuffer(ctx, 5.3, 'white'), pink: noiseBuffer(ctx, 7.1, 'pink'), brown: noiseBuffer(ctx, 6.1, 'brown') };
    const loop = (colour, type, freq, q, into = this.out) => {
      const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
      src.buffer = this.buffers[colour]; src.loop = true; src.loopStart = 0.05;
      filter.type = type; filter.frequency.value = freq; filter.Q.value = q; gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(pan).connect(into);
      src.start(0, Math.abs(freq * 0.37) % 3);
      return { filter, gain, pan };
    };
    // Three stretches of shore, each with the body of its wave and the fizz of its foam.
    this.surf = [0, 1, 2].map(i => ({ body: loop('pink', 'bandpass', 620 + 90 * i, 0.5), fizz: loop('white', 'highpass', 3200 + 400 * i, 0.4) }));
    this.reef = loop('brown', 'lowpass', 260, 0.4);
    this.wind = loop('pink', 'bandpass', 480, 0.7);
    this.windHigh = loop('white', 'bandpass', 2600, 1.2);
    this.wade = loop('white', 'bandpass', 1500, 0.7);
    this.rain = loop('white', 'highpass', 2400, 0.3);
    this.deep = loop('brown', 'lowpass', 110, 0.5);
    this.time = 0; this.nextGull = 18; this.seed = 7;
  }

  rnd() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  set(param, value, lag = 0.09) { param.setTargetAtTime(value, this.ctx.currentTime, lag); }

  /**
   * Once a frame (or every few milliseconds of an offline render).
   * @param {number} dt seconds
   * @param {object} s
   * @param {number} s.time  the wave clock (uTime)
   * @param {{x: number, z: number, dist: number, bearing: number, hs: number}[]} s.shores  up to three points of
   *   the waterline near the listener: where, how far, the bearing from the listener relative to where they
   *   look (radians, right positive), and the height of the waves arriving
   * @param {number} s.reef  0..1 how loud the reef's surf is here   @param {number} s.wind m/s   @param {number} s.rain 0..1
   * @param {boolean} s.under eye under water   @param {number} s.depth water round the legs, m   @param {number} s.speed m/s
   * @param {boolean} s.day
   */
  update(dt, s) {
    this.time += dt;
    const under = s.under ? 1 : 0;
    this.set(this.muffle.frequency, under ? 520 : 18000, 0.06);
    this.set(this.deep.gain.gain, under ? 0.5 : 0, 0.15);
    this.surf.forEach((v, i) => {
      const p = s.shores[i];
      if (!p) { this.set(v.body.gain.gain, 0); this.set(v.fizz.gain.gain, 0); return; }
      // A wave arrives (phase 0), thumps and rushes up the sand, then fizzes as it drains.
      const ph = swashPhase(p.x, p.z, s.time), size = Math.pow(clamp01(runup(p.hs) / 0.19), 0.8), near = 1 / (1 + (p.dist / 9) ** 2);
      const rush = ph < 0.28 ? Math.pow(ph / 0.28, 0.6) : Math.exp(-(ph - 0.28) / 0.22), fizz = smooth(0.1, 0.32, ph) * Math.exp(-Math.max(ph - 0.32, 0) / 0.3);
      this.set(v.body.gain.gain, (0.05 + 0.5 * rush) * size * near * (1 - 0.5 * under));
      this.set(v.body.filter.frequency, 380 + 900 * rush + 80 * i);
      this.set(v.fizz.gain.gain, 0.16 * fizz * size * near * (1 - under));
      this.set(v.body.pan.pan, Math.max(-0.85, Math.min(0.85, Math.sin(p.bearing) * 0.9))); this.set(v.fizz.pan.pan, Math.max(-0.85, Math.min(0.85, Math.sin(p.bearing) * 0.9)));
    });
    this.set(this.reef.gain.gain, 0.5 * s.reef, 0.4);
    // Wind in the ears: it comes and goes.
    const gust = 0.75 + 0.25 * Math.sin(this.time * 0.37) + 0.2 * Math.sin(this.time * 0.93 + 1.3), w = Math.pow(clamp01(s.wind / 14), 1.6) * (1 - under);
    this.set(this.wind.gain.gain, 0.3 * w * gust, 0.3); this.set(this.wind.filter.frequency, 380 + 30 * s.wind + 120 * gust, 0.3);
    this.set(this.windHigh.gain.gain, 0.04 * w * w * gust, 0.3);
    this.set(this.wade.gain.gain, 0.2 * clamp01(s.speed / 1.2) * clamp01(s.depth * 2.5) * (1 - under), 0.12);
    this.set(this.rain.gain.gain, 0.3 * s.rain * (1 - 0.8 * under), 0.5);
    // A laughing gull, somewhere along the beach, every half minute or so by day.
    if (s.day && !under && s.shores.length && this.time > this.nextGull) { this.gull(); this.nextGull = this.time + 22 + 40 * this.rnd(); }
  }

  burst(colour, type, freq, q, gain, attack, decay, pan = 0, delay = 0) {
    const { ctx } = this, t = ctx.currentTime + delay, src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    src.buffer = this.buffers[colour];
    filter.type = type; filter.frequency.value = freq; filter.Q.value = q; p.pan.value = pan * (this.side ?? 1);      // (side: -1 while your left hand is what sounds)
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(1e-4, t + attack + decay);
    src.connect(filter).connect(g).connect(p).connect(this.out);
    src.start(t, this.rnd() * 4, attack + decay + 0.05);
  }

  /** A footfall: `depth` of water there (m), `wet` 0..1 how wet the sand is, `side` 0 left / 1 right, `surface` 'sand' or 'wood'. */
  step({ depth = 0, wet = 0, side = 0, surface = 'sand' }) {
    const pan = side ? 0.12 : -0.12;
    if (surface === 'wood') {
      // A board on a pier: a hollow knock and the click of the foot on it.
      this.burst('brown', 'lowpass', 210 + 60 * this.rnd(), 1.4, 0.7, 0.004, 0.1, pan);
      this.burst('pink', 'bandpass', 950, 1.0, 0.07, 0.003, 0.04, pan, 0.006);
      return;
    }
    if (depth > 0.03) {
      // In water: a splash, longer the deeper, and the plunk of the foot going in.
      const d = clamp01(depth * 2.2);
      this.burst('white', 'highpass', 1100 - 400 * d, 0.5, 0.1 + 0.12 * d, 0.012, 0.18 + 0.22 * d, pan);
      this.burst('pink', 'lowpass', 330, 0.9, 0.2 * d, 0.01, 0.12, pan, 0.02);
    } else if (wet > 0.5) {
      this.burst('pink', 'lowpass', 620, 0.8, 0.22, 0.006, 0.07, pan);              // a firm pat
      this.burst('white', 'bandpass', 2400, 1.5, 0.03, 0.004, 0.05, pan, 0.03);     // and a little suck as the foot lifts
    } else {
      this.burst('white', 'bandpass', 1150 + 300 * this.rnd(), 0.7, 0.16, 0.008, 0.1, pan);     // dry sand gives and squeaks faintly
      this.burst('pink', 'bandpass', 520, 0.6, 0.13, 0.01, 0.13, pan, 0.035);
    }
  }

  /**
   * Your hand on the sand or in the water. `kind`: 'dry', 'wet' or 'water'; `how`: 'down' as it lands, 'drag' as
   * it is drawn along (called a few times a second while it moves), 'take' as the fingers close on a handful,
   * 'pour' as that runs out between them (called many times a second; `speed` is then how fast, 0..1), 'up' as it
   * leaves or is empty; `speed` in m/s. `side`: 1 your right hand (heard a little to the right), -1 your left.
   */
  touch(kind, how, speed = 0, side = 1) { this.side = side; try { this.touching(kind, how, speed); } finally { this.side = 1; } }
  touching(kind, how, speed) {
    const k = clamp01(speed / 0.6);
    if (how === 'take') {
      if (kind === 'water') this.burst('pink', 'bandpass', 700, 0.8, 0.07, 0.03, 0.14, 0.1);                 // water closing over the hand
      else if (kind === 'wet') { this.burst('pink', 'lowpass', 700, 0.9, 0.1, 0.03, 0.12, 0.1); this.burst('white', 'bandpass', 2600, 1.4, 0.03, 0.02, 0.1, 0.1, 0.05); }       // a wet squeeze
      else this.burst('white', 'bandpass', 3000, 0.5, 0.09, 0.05, 0.22, 0.1);                               // dry sand crunching as the fingers close through it
      return;
    }
    if (how === 'drop') {
      // One drop landing, `speed` seconds from now: its own small note, no two alike.
      this.burst('white', 'bandpass', 1900 + 3100 * this.rnd(), 7, 0.03 + 0.02 * this.rnd(), 0.002, 0.04, 0.1 + 0.3 * (this.rnd() - 0.5), Math.max(0, speed));
      return;
    }
    if (how === 'pour') {
      // What runs out between the fingers: the steady whisper of dry grains landing; the patter of clots of
      // wet sand; the trickle of water, each drop its own small note.
      const q = clamp01(speed);
      if (kind === 'dry') this.burst('white', 'highpass', 5200 + 1500 * this.rnd(), 0.4, 0.014 + 0.03 * q, 0.03, 0.14, 0.1 + 0.2 * (this.rnd() - 0.5));
      else if (kind === 'wet') { if (this.rnd() < 0.5) this.burst('pink', 'lowpass', 900 + 500 * this.rnd(), 0.9, 0.05 * q + 0.02, 0.004, 0.05, 0.1, 0.3 * this.rnd()); }
      else { this.burst('white', 'bandpass', 2200 + 2600 * this.rnd(), 7, 0.02 + 0.035 * q, 0.002, 0.035, 0.1 + 0.3 * (this.rnd() - 0.5), 0.3 + 0.06 * this.rnd()); this.burst('white', 'bandpass', 1300, 0.7, 0.012 * q, 0.03, 0.1, 0.1); }
      return;
    }
    if (kind === 'water') {
      if (how === 'down') { this.burst('pink', 'lowpass', 420, 1.1, 0.16, 0.008, 0.11, 0.1); this.burst('white', 'highpass', 1500, 0.5, 0.05, 0.01, 0.16, 0.1, 0.02); }      // a soft plop
      else if (how === 'drag') this.burst('white', 'bandpass', 900 + 500 * k, 0.6, 0.035 + 0.06 * k, 0.03, 0.16, 0.1);                                                      // water parting round the fingers
      else { for (let i = 0; i < 5; i++) this.burst('white', 'bandpass', 2600 + 1800 * this.rnd(), 6, 0.035, 0.002, 0.03, 0.1, 0.08 + 0.09 * i + 0.05 * this.rnd()); }       // drops falling back
    } else if (kind === 'wet') {
      if (how === 'down') this.burst('pink', 'lowpass', 520, 0.8, 0.12, 0.005, 0.06, 0.1);                                                                                  // a pat
      else if (how === 'drag') this.burst('pink', 'bandpass', 1300 + 500 * k, 0.9, 0.03 + 0.05 * k, 0.02, 0.1, 0.1);                                                        // a firm scrape
      else this.burst('white', 'bandpass', 2300, 1.6, 0.02, 0.004, 0.05, 0.1);                                                                                              // a little suck as it lifts
    } else {
      if (how === 'down') this.burst('white', 'bandpass', 2000, 0.6, 0.06, 0.008, 0.07, 0.1);
      else if (how === 'drag') this.burst('white', 'highpass', 2600 + 1400 * k, 0.5, 0.03 + 0.07 * k, 0.025, 0.12, 0.1);                                                    // the hiss of dry grains
      else this.burst('white', 'highpass', 4200, 0.5, 0.025, 0.02, 0.3, 0.1, 0.05);                                                                                         // grains trickling off the hand
    }
  }

  /**
   * Your body on the sand: 'down' as you sit (your weight coming on to it, and the sand giving under you), 'up'
   * as you push yourself off it, 'scoot' as you shuffle round on your seat. `wet` 0..1: on the wet sand by the water.
   */
  seat(how, wet = 0) {
    if (how === 'down') {
      this.burst('brown', 'lowpass', 150, 0.8, 0.5, 0.02, 0.16);                                                   // the soft thump of it
      if (wet > 0.5) this.burst('pink', 'lowpass', 600, 0.8, 0.1, 0.01, 0.09, 0, 0.02);
      else this.burst('white', 'bandpass', 1400 + 300 * this.rnd(), 0.6, 0.09, 0.04, 0.3, 0, 0.04);              // dry sand shifting under you
    } else if (how === 'scoot') {
      this.burst(wet > 0.5 ? 'pink' : 'white', 'bandpass', wet > 0.5 ? 900 : 1700, 0.6, 0.06, 0.05, 0.28);
    } else this.burst('white', 'highpass', 3600, 0.5, 0.03, 0.03, 0.4, 0, 0.1);                                    // sand falling from you as you get up
  }

  /** The laugh of a laughing gull: a run of short notes falling in pitch, slowing at the end. */
  gull() {
    const { ctx } = this, pan = this.rnd() * 1.6 - 0.8, far = 0.25 + 0.75 * this.rnd(), notes = 5 + Math.floor(this.rnd() * 5);
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner(), len = 0.1 + 0.012 * i;
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1250 - 20 * i, t); osc.frequency.exponentialRampToValueAtTime(820 - 15 * i, t + len);
      filter.type = 'bandpass'; filter.frequency.value = 2100; filter.Q.value = 2.2; p.pan.value = pan;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03 * far, t + 0.012); g.gain.exponentialRampToValueAtTime(1e-4, t + len);
      osc.connect(filter).connect(g).connect(p).connect(this.out);
      osc.start(t); osc.stop(t + len + 0.02);
      t += 0.15 + 0.02 * i;
    }
  }
}

/** Owns the live AudioContext: made on the first start (which must come from a click), suspended when not wanted. */
export class Sound {
  constructor() {
    this.muted = false; this.wanted = false; this.ambience = null; this.error = null;
    try { this.muted = localStorage.getItem('lr-sound') === 'off'; } catch { /* private mode: not remembered */ }
  }
  get on() { return this.wanted && !this.muted && !!this.ambience; }
  /** Call from a click or key press: browsers only let sound start then. */
  start() {
    this.wanted = true;
    if (this.muted) return;
    try {
      if (!this.ambience) { const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext; this.ctx = new Ctx(); this.ambience = new Ambience(this.ctx); }
      this.ctx.resume?.();
    } catch (e) { this.error = String(e); this.ambience = null; }
  }
  stop() { this.wanted = false; this.ctx?.suspend?.(); }
  setMuted(muted) {
    this.muted = muted;
    try { localStorage.setItem('lr-sound', muted ? 'off' : 'on'); } catch { /* not remembered */ }
    if (muted) this.ctx?.suspend?.(); else if (this.wanted) this.start();
  }
  // (A fault in the sound must never stop the picture: it is noted, once, and that moment of sound is skipped.)
  update(dt, scene) { if (this.on && this.ctx.state === 'running') try { this.ambience.update(dt, scene); } catch (e) { this.error ??= String(e?.message || e); } }
  step(info) { if (this.on && this.ctx.state === 'running') try { this.ambience.step(info); } catch (e) { this.error ??= String(e?.message || e); } }
  seat(how, wet) { if (this.on && this.ctx.state === 'running') try { this.ambience.seat(how, wet); } catch (e) { this.error ??= String(e?.message || e); } }
  touch(kind, how, speed, side = 1) { if (this.on && this.ctx.state === 'running') try { this.ambience.touch(kind, how, speed, side); } catch (e) { this.error ??= String(e?.message || e); } }
}

/**
 * Renders `seconds` of a scene offline and measures it: for tests. `scene(t)` returns what update() takes;
 * `steps` is a list of [time, info] footfalls. Returns { rms, peak } of the left channel and whether any
 * sample was not a number.
 */
export async function measure(seconds, scene, steps = []) {
  const rate = 44100, ctx = new OfflineAudioContext(2, Math.floor(rate * seconds), rate), a = new Ambience(ctx), dt = 0.02;
  // (Offline, parameters are set ahead of time: walk the scene through in 20 ms slices.)
  const original = a.set.bind(a);
  let at = 0;
  a.set = (param, value, lag = 0.09) => param.setTargetAtTime(value, at, lag);
  for (at = 0; at < seconds; at += dt) a.update(dt, scene(at));
  a.set = original;
  for (const [t, info] of steps) {
    Object.defineProperty(ctx, 'currentTime', { configurable: true, get: () => t });      // (bursts are scheduled from "now")
    a.step(info);
    delete ctx.currentTime;
  }
  const d = (await ctx.startRendering()).getChannelData(0);
  let sum = 0, peak = 0, bad = false;
  for (let i = Math.floor(rate * 0.5); i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) bad = true; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
  return { rms: Math.sqrt(sum / (d.length - rate * 0.5)), peak, bad };
}

export { runup, swashPhase };
