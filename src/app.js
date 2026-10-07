// The application: loads the data, owns the frame loop and the environment state (time, month, weather),
// wires up the controls, and exposes the test API (window.__LR).
import { TIERS, params, pickTier } from './config.js';
import { registerChunks } from './core/chunks.js';
import { createRenderer } from './core/renderer.js';
import { FrameGraph } from './core/framegraph.js';
import { DynamicResolution } from './core/perf.js';
import { shared } from './core/uniforms.js';
import { loadData } from './data/loader.js';
import { Ground } from './data/geoCPU.js';
import { CameraRig, attachOrbitInput } from './camera/rig.js';
import { OVERVIEW, shotFor } from './camera/bookmarks.js';
import { Terrain } from './world/terrain.js';
import { Water } from './world/water.js';
import { Sky } from './world/sky.js';
import { Waves } from './world/waves.js';
import * as THREE from 'three';
import { Clouds } from './world/clouds.js';
import { Landmarks } from './world/landmarks.js';
import { Boats } from './world/boats.js';
import { localDate, sunDirection, sunPosition, sunTimes } from './world/sun.js';
import { conditions } from './world/weather.js';
import { buildPanel } from './ui/panel.js';
import { Labels } from './ui/labels.js';

const DAY_SECONDS = 75;      // how long a played day (04:00-21:00) lasts

export async function start(canvas, onProgress = () => {}) {
  const errors = [];
  addEventListener('error', e => errors.push(String(e.message || e.error)));
  addEventListener('unhandledrejection', e => errors.push(String(e.reason?.message || e.reason)));

  registerChunks();
  const tierName = pickTier(), tier = TIERS[tierName];
  const R = createRenderer(canvas);
  const { renderer } = R;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = s => (gl.getShaderInfoLog(s) || '').trim();
    errors.push(`shader: ${gl.getProgramInfoLog(program)} | vs: ${log(vs)} | fs: ${log(fs)}`);
    console.error('shader error', gl.getProgramInfoLog(program), log(vs), log(fs));
  };

  const data = await loadData(tier.maps, renderer.capabilities.getMaxAnisotropy(), onProgress);
  const { textures: tx, rect, manifest } = data;
  shared.uMapRect.value.set(rect.x, rect.z, 1 / rect.w, 1 / rect.h);
  shared.uMapTexels.value.set(tx.height.image.width, tx.height.image.height, tx.shore.image.width, tx.shore.image.height);
  shared.uMpp.value = rect.w / tx.height.image.width;
  shared.tHeight.value = tx.height; shared.tShore.value = tx.shore; shared.tAlbedo.value = tx.albedo;
  shared.tBenthic.value = tx.benthic; shared.tLand.value = tx.land; shared.tWaveMap.value = tx.waveMap; shared.tWaterType.value = tx.waterType;
  // The water's optical coefficients are the ones the maps were derived with.
  const o = manifest.optics || {};
  if (o.ocean?.a) { shared.uAbsOcean.value.fromArray(o.ocean.a); shared.uBbOcean.value.fromArray(o.ocean.bb); }
  if (o.lagoon?.a) { shared.uAbsLagoon.value.fromArray(o.lagoon.a); shared.uBbLagoon.value.fromArray(o.lagoon.bb); }

  const ground = new Ground(data.cpu.height, data.cpu.shore, rect);
  const rig = new CameraRig();
  rig.ground = ground;
  const terrain = new Terrain(tier), water = new Water(tier);
  water.material.uniforms.tRefr.value = R.targets.refr.texture;
  const graph = new FrameGraph(R);
  const sky = new Sky(renderer, { syncReadback: params.freeze });
  const waves = new Waves(renderer);
  const clouds = new Clouds(renderer, tier.clouds, rect);
  if (params.freeze) while (clouds.enabled && !clouds.bakeSome(64)) { /* tests want the clouds from the first frame */ }
  const clock = { time: 0, last: performance.now() };
  let satellite = null;

  // ---- environment: local time (UTC-4), month, weather
  const env = { hours: 10.5, month: 0, weather: 'trade', windOverride: null, playing: false, sunOverride: null, exposure: 1 };
  const status = { wind: 7, windFrom: 78, sunElevation: 0, sunrise: 6, sunset: 18, sea: 27, airMax: 30, compare: -1 };
  const convergence = manifest.grid.convergenceDeg || 0;
  const dayOf = month => `2026-${String(month + 1).padStart(2, '0')}-15`;
  function applyEnv() {
    const date = localDate(dayOf(env.month), env.hours);
    const sun = env.sunOverride || sunPosition(date), times = sunTimes(date), c = conditions(env.weather, env.month);
    shared.uSunDir.value.fromArray(sunDirection(sun.azimuth, sun.elevation, env.sunOverride ? 0 : convergence));
    const wind = env.windOverride ?? c.wind;
    if (wind !== waves.wind.speed || c.windFrom !== waves.wind.from) waves.setWind(wind, c.windFrom);
    shared.uMieScale.value = c.haze;
    env.cloud = env.cloudOverride ?? c.cloud;
    Object.assign(status, { wind, windFrom: c.windFrom, sunElevation: sun.elevation, sunrise: times.sunrise, sunset: times.sunset, sea: c.sea, airMax: c.airMax });
  }

  // ---- places, labels, controls
  const features = data.features || {};
  const places = (features.places || []).filter(p => p.pos);
  if (!places.some(p => p.id === 'overview')) places.unshift(OVERVIEW);

  // ---- the opaque scene: terrain, buildings and lighthouses, boats
  const landmarks = new Landmarks(features, ground);
  const boats = new Boats(places, ground, waves, data.cpu.waveMap, rect, landmarks.material);
  const opaque = new THREE.Scene();
  opaque.matrixWorldAutoUpdate = false;
  opaque.add(terrain.mesh, landmarks.group, boats.group);
  const ui = document.getElementById('ui');
  let syncPanel = null, labels = null;
  const app = {
    env, places, attribution: manifest.attribution || [],
    setEnv(patch) { Object.assign(env, patch); applyEnv(); syncPanel?.(status); saveHash(); },
    flyToPlace(p) { rig.flyTo(shotFor(p), 4.5); },
    async setCompare(x) {
      if (x >= 0 && !satellite) { satellite = await data.loadSatellite(); shared.tSatellite.value = satellite; }
      shared.uCompareX.value = status.compare = x;
      syncPanel?.(status);
    },
    setLabels(on) { if (labels) labels.enabled = on; },
  };

  // ---- the view in the URL (so a link reopens the same scene)
  let hashTimer = 0;
  function saveHash() {
    if (params.freeze) return;
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const c = rig.get(), h = new URLSearchParams();
      h.set('c', [c.x.toFixed(0), c.z.toFixed(0), c.dist.toFixed(0), c.yaw.toFixed(1), c.pitch.toFixed(1)].join(','));
      h.set('t', env.hours.toFixed(2)); h.set('m', String(env.month)); h.set('w', env.weather);
      history.replaceState(null, '', `#${h}`);
    }, 400);
  }
  function loadHash() {
    const h = new URLSearchParams(location.hash.slice(1)), c = (h.get('c') || '').split(',').map(Number);
    if (c.length === 5 && c.every(Number.isFinite)) rig.set({ x: c[0], z: c[1], dist: c[2], yaw: c[3], pitch: c[4] });
    if (h.has('t') && Number.isFinite(Number(h.get('t')))) env.hours = Number(h.get('t'));
    if (h.has('m') && Number(h.get('m')) >= 0 && Number(h.get('m')) < 12) env.month = Math.floor(Number(h.get('m')));
    if (h.has('w')) env.weather = h.get('w');
    return c.length === 5;
  }

  const dynamic = new DynamicResolution(1, 0.5);
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, tier.dprCap);
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    // Keep the pixel count inside the tier's budget, times whatever the frame rate allows (unless a fixed scale was asked for).
    const scale = params.scale ?? Math.min(1, Math.sqrt(tier.maxPixels / (w * h * dpr * dpr))) * dynamic.scale;
    R.resize(w, h, dpr, scale);
  }
  addEventListener('resize', resize);
  resize();

  function frame(dt = 0) {
    if (env.playing && dt > 0) {
      env.hours += dt * 17 / DAY_SECONDS;
      if (env.hours > 21) env.hours = 4;
      applyEnv(); syncPanel?.(status);
    }
    if (rig.step(dt)) saveHash();
    shared.uTime.value = clock.time;
    rig.update(R.size.width / R.size.height, R.reversed);
    sky.update();
    const view = rig.view();
    waves.update(clock.time, view.cam);
    clouds.bakeSome(4);
    clouds.update(dt, waves.wind, env.cloud);
    terrain.update(view, rect);
    water.update(view);
    // Night: the eye (the exposure) opens up as the sun goes down, and lamps come on.
    const night = Math.min(1, Math.max(0, (-1 - status.sunElevation) / 8));
    shared.uExposure.value = env.exposure * (1 + 44 * night * night);
    landmarks.update(rig.eye, night);
    graph.starTurn = env.hours / 24 * 2 * Math.PI;
    boats.update(rig.eye, clock.time, shared.uSeaLevel.value);
    graph.render(opaque, water.mesh, rig.camera, clouds);
    labels?.update(rig.eye, shared.uViewProj.value, R.size.cssWidth, R.size.cssHeight);
  }

  // ---- start-up view
  rig.set(shotFor(places.find(p => p.id === 'overview')));
  const fromLink = loadHash();
  applyEnv();
  if (params.ui) {
    syncPanel = buildPanel(ui, app);
    syncPanel(status);
    const layer = document.createElement('div');
    layer.className = 'label-layer';
    ui.prepend(layer);                                   // under the panel
    labels = new Labels(layer, features.labels || [], ground);
  }
  attachOrbitInput(rig, canvas, rect, saveHash);

  if (!params.freeze) {
    // Opening: glide down from the overview to the first place, unless the link asked for a view or motion is unwelcome.
    const first = places.find(p => p.id === 'madrisqui-cayo-pirata') || places.find(p => p.id !== 'overview');
    if (first && !fromLink && !matchMedia('(prefers-reduced-motion: reduce)').matches) rig.flyTo(shotFor(first), 9);
    let lastFrame = performance.now();
    const loop = now => {
      const dt = Math.min(0.1, (now - clock.last) / 1000);
      clock.last = now; clock.time += dt;
      if (params.scale == null && clouds.ready !== false && dynamic.frame((now - lastFrame) / 1000) !== null) resize();
      lastFrame = now;
      if (!document.hidden) frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  const api = {
    errors,
    /**
     * For tests and screenshots. { cam: {x, z, dist, yaw, pitch, fov}, time (wave clock, s), hours (local), month (0-11),
     * weather, wind (m/s), sun: {azimuth, elevation}|null, seaLevel, exposure, compare (0..1 or -1), show: {water, terrain} }
     */
    async setState(s = {}) {
      if (s.cam) { rig.cancelFlight(); rig.set(s.cam); }
      if (s.time !== undefined) clock.time = s.time;
      if (s.seaLevel !== undefined) shared.uSeaLevel.value = s.seaLevel;
      if (s.show) { if (s.show.water !== undefined) water.mesh.visible = s.show.water; if (s.show.terrain !== undefined) terrain.mesh.visible = s.show.terrain; }
      if (s.exposure !== undefined) env.exposure = s.exposure;
      if (s.debug !== undefined) shared.uDebug.value.set(s.debug, 0, 0, 0);
      for (const k of ['hours', 'month', 'weather']) if (s[k] !== undefined) env[k] = s[k];
      if (s.wind !== undefined) env.windOverride = s.wind;
      if (s.cloud !== undefined) env.cloudOverride = s.cloud;
      if (s.sun !== undefined) env.sunOverride = s.sun;
      applyEnv();
      if (s.compare !== undefined) await app.setCompare(s.compare);
      syncPanel?.(status);
    },
    getState: () => ({ cam: rig.get(), time: clock.time, env: { ...env }, status: { ...status } }),
    flyTo: id => { const p = places.find(q => q.id === id); if (p) app.flyToPlace(p); return !!p; },
    /** Jumps straight to a place's camera shot (no flight). */
    goTo: id => { const p = places.find(q => q.id === id); if (p) { rig.cancelFlight(); rig.set(shotFor(p)); } return !!p; },
    renderOnce(dt = 0) { frame(dt); },
    /** Renders a frame and returns it as a PNG data URL. */
    capture() { frame(0); return canvas.toDataURL('image/png'); },
    /** Average milliseconds per frame over n frames, each finished on the GPU before the next starts. */
    bench(n = 60) {
      // Reading a pixel back is what really waits for the GPU (gl.finish returns early in Chromium).
      const gl = renderer.getContext(), px = new Uint8Array(4);
      const sync = () => { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      frame(0); sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { clock.time += 1 / 60; frame(0); sync(); }
      return (performance.now() - t0) / n;
    },
    info() {
      const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        tier: tierName, data: manifest.version, reversedDepth: R.reversed,
        gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        size: { ...R.size }, dynamicScale: dynamic.scale, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        terrain: terrain.clipmap.stats, water: water.clipmap.stats, programs: renderer.info.programs?.length,
        places: places.map(p => p.id), labels: (features.labels || []).length, boats: boats.count, landmarks: landmarks.group.children.length,
      };
    },
  };
  frame(0);
  return api;
}
