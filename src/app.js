// The application: loads the data, owns the frame loop and the environment state (time, month, weather),
// wires up the controls, and exposes the test API (window.__LR).
import { TIERS, isSoftware, params, pickTier } from './config.js';
import { registerChunks } from './core/chunks.js';
import { createRenderer } from './core/renderer.js';
import { FrameGraph } from './core/framegraph.js';
import { DynamicResolution } from './core/perf.js';
import { shared } from './core/uniforms.js';
import { loadData } from './data/loader.js';
import { Ground } from './data/geoCPU.js';
import { CameraRig, attachOrbitInput } from './camera/rig.js';
import { OVERVIEW, shotFor, walkSpotFor } from './camera/bookmarks.js';
import { Walker, attachWalkInput, buildingBlocker, paceLength } from './camera/walk.js';
import { eyeAhead, footfall, setProportions } from './world/bodyshape.js';
import { Spray } from './world/spray.js';
import { Hand } from './world/hand.js';
import { Figure, loadFigure } from './world/figure.js';
import { FigureRig } from './world/figurepose.js';
import { SandPatch } from './sim/patch.js';
import { Ripples } from './sim/ripples.js';
import { Terrain } from './world/terrain.js';
import { Water } from './world/water.js';
import { Sky } from './world/sky.js';
import { Waves } from './world/waves.js';
import { Detail } from './world/detail.js';
import { EnvMap } from './world/env.js';
import { Shadows } from './world/shadow.js';
import { buildSeaLife } from './world/sealife.js';
import { Turtle, buildStatue } from './world/creatures.js';
import { buildConchMounds, buildShoreLife } from './world/shorelife.js';
import { buildPlants } from './world/plants.js';
import { Sound, measure, runup } from './audio/ambience.js';
import { fullMoonDay, moonPosition } from './world/moon.js';
import { shoreCrest, swashPhase } from './data/shoreCPU.js';
import { createObjectMaterial } from './world/landmarks.js';
import { pierWalk } from './world/piers.js';
import { Body } from './world/body.js';
import * as THREE from 'three';
import { Clouds } from './world/clouds.js';
import { Landmarks } from './world/landmarks.js';
import { Boats } from './world/boats.js';
import { Birds } from './world/birds.js';
import { buildBeachSets } from './world/beach.js';
import { localDate, sunDirection, sunPosition, sunTimes } from './world/sun.js';
import { CLIMATE, conditions, tide } from './world/weather.js';
import { fetchLiveWeather } from './world/liveWeather.js';
import { buildPanel, buildWalkHud } from './ui/panel.js';
import { Labels } from './ui/labels.js';

const DAY_SECONDS = 75;      // how long a played day (04:00-21:00) lasts
const NO_INPUT = { fwd: 0, right: 0, run: false, down: false, up: false, hand: false, open: 0.3, sit: false };

export async function start(canvas, onProgress = () => {}) {
  const errors = [];
  // (A fault that repeats every frame must not fill the memory with its own report.)
  const note = text => { if (errors.length < 40) errors.push(text); };
  addEventListener('error', e => note(String(e.message || e.error)));
  addEventListener('unhandledrejection', e => note(String(e.reason?.message || e.reason)));

  registerChunks();
  const R = createRenderer(canvas);
  const { renderer } = R;
  // The graphics driver's name tells a browser that is drawing on the processor, with no graphics card behind
  // it (hardware acceleration off or failed). There every frame of the full scene takes seconds: it gets the
  // simplest tier at a quarter of the picture, and is told so.
  const gpuName = (() => { try { const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info'); return String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch { return ''; } })();
  const software = isSoftware(gpuName) && !params.tier;
  const tierName = pickTier(gpuName), tier = software ? { ...TIERS[tierName], maxPixels: 2.4e5, dprCap: 1 } : TIERS[tierName];

  // ---- when something goes wrong: say so on the page, and carry on or start again
  let noticeBox = null;
  /** Shows a line of text at the foot of the page, with an optional button ([label, action]), for `seconds` if given; no text hides it. */
  let noticeTimer = 0;
  function notice(text, button = null, seconds = 0) {
    if (!params.ui) return;
    clearTimeout(noticeTimer);
    if (!text) { noticeBox?.remove(); noticeBox = null; return; }
    if (seconds) noticeTimer = setTimeout(() => notice(''), seconds * 1000);
    noticeBox ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'notice' }));
    noticeBox.replaceChildren(Object.assign(document.createElement('span'), { textContent: text }));
    if (button) noticeBox.append(Object.assign(document.createElement('button'), { textContent: button[0], onclick: button[1] }));
  }
  /**
   * Starts the page again where you are (the address keeps your place, hour and weather). Twice in two minutes
   * at most: after that the trouble is not one that starting again cures, and the page says so instead.
   */
  function restart(why) {
    let recent = [];
    try { recent = JSON.parse(sessionStorage.getItem('lr-restarts') || '[]').filter(t => Date.now() - t < 120000); } catch { /* no storage */ }
    if (recent.length >= 2) { notice(`${why} Starting again did not cure it.`, ['Try once more', () => { try { sessionStorage.removeItem('lr-restarts'); } catch { /* no storage */ } location.reload(); }]); return; }
    try { sessionStorage.setItem('lr-restarts', JSON.stringify([...recent, Date.now()])); } catch { /* no storage */ }
    writeHash?.();
    location.reload();
  }
  let writeHash = null;
  // The browser can take the graphics away from a page (its graphics process restarted, the driver reset, too
  // many pages drawing at once). The picture then stays as it was, for good. What was drawn into textures at
  // the start (sand grain, cloud shapes) is gone with it, so the page starts again, where you were.
  let lost = false;
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); lost = true; note('graphics context lost');
    notice('The browser stopped the graphics of this page. Starting again…');
    setTimeout(() => { if (lost) restart('The browser stopped the graphics of this page.'); }, 3000);     // (if it does not hand them back by itself)
  });
  canvas.addEventListener('webglcontextrestored', () => restart('The browser stopped the graphics of this page.'));
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = s => (gl.getShaderInfoLog(s) || '').trim();
    note(`shader: ${gl.getProgramInfoLog(program)} | vs: ${log(vs)} | fs: ${log(fs)}`);
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
  ground.cover = { land: data.cpu.land, benthic: data.cpu.benthic };
  const rig = new CameraRig();
  rig.ground = ground;
  const terrain = new Terrain(tier), water = new Water(tier);
  water.material.uniforms.tRefr.value = R.targets.refr.texture;
  const graph = new FrameGraph(R);
  const sky = new Sky(renderer, { syncReadback: params.freeze });
  const waves = new Waves(renderer);
  const envMap = new EnvMap(renderer, tier.clouds);
  const detail = new Detail(renderer);
  shared.tDetail.value = detail.texture;
  detail.means.forEach((m, i) => shared.uDetailMean.value[i].copy(m));
  const clouds = new Clouds(renderer, tier.clouds, rect);
  if (params.freeze) while (clouds.enabled && !clouds.bakeSome(64)) { /* tests want the clouds from the first frame */ }
  const clock = { time: 0, last: performance.now() };
  let satellite = null;

  // ---- environment: local time (UTC-4), month, weather
  const env = { hours: 10.5, month: new Date().getUTCMonth(), weather: 'trade', windOverride: null, playing: false, sunOverride: null, exposure: 1, seaLevelOverride: null, live: null };
  const status = { wind: 7, windFrom: 78, sunElevation: 0, sunrise: 6, sunset: 18, sea: 27, airMax: 30, compare: -1 };
  const convergence = manifest.grid.convergenceDeg || 0;
  // Each month is shown on the day of its full moon (the sun hardly moves within a month; the moon decides
  // what a night looks like, and a night walk wants one).
  const fullMoons = Array.from({ length: 12 }, (_, month) => fullMoonDay(2026, month)), dayOf = month => fullMoons[month];
  let liveAsked = false;
  function applyEnv() {
    if (env.weather === 'live' && !liveAsked) {
      // First use of "Live" (from the panel or a link): ask the weather service once; until it answers, and if it
      // does not, the climate normals stand in.
      liveAsked = true;
      status.liveNote = 'Asking the weather service…';
      fetchLiveWeather().then(data => {
        env.live = data;
        status.liveNote = data ? '' : 'The weather service did not answer: showing typical conditions.';
        applyEnv(); syncPanel?.(status);
      });
    }
    const date = localDate(dayOf(env.month), env.hours);
    const moon = moonPosition(date);
    const sun = env.sunOverride || sunPosition(date), times = sunTimes(date), c = conditions(env.weather, env.month, moon.hourAngle, env.live);
    shared.uSunDir.value.fromArray(sunDirection(sun.azimuth, sun.elevation, env.sunOverride ? 0 : convergence));
    // After dark the moon takes the sun's place in the sky and in the lighting (shadows, glitter, the lit side of
    // clouds). Its light is the sun's, some four hundred thousand times weaker, which the eye's adaptation
    // (the night exposure) mostly takes up; what is left is a dim, blue-tinged day. The last twilight fades out
    // between 10 and 11.5 degrees of sun below the horizon, and the moonlight comes in by 13.
    const dusk = Math.min(1, Math.max(0, (-10 - sun.elevation) / 3)), toa = shared.uSunToa.value;
    toa.set(10, 10, 10);
    if (!env.sunOverride && dusk > 0) {
      const up = Math.min(1, Math.max(0, (moon.elevation + 1) / 5)), light = 0.022 * Math.pow(moon.illuminated, 1.6) * up * Math.max(0, 2 * dusk - 1);
      if (dusk >= 0.5 && light > 0) { shared.uSunDir.value.fromArray(sunDirection(moon.azimuth, moon.elevation, convergence)); toa.set(0.74 * light, 0.9 * light, 1.2 * light); }
      else toa.setScalar(Math.max(10 * (1 - 2 * dusk), 1e-5));
    }
    status.moon = { azimuth: moon.azimuth - convergence, elevation: moon.elevation, illuminated: moon.illuminated };
    const wind = env.windOverride ?? c.wind;
    if (wind !== waves.wind.speed || c.windFrom !== waves.wind.from) waves.setWind(wind, c.windFrom);
    shared.uMieScale.value = c.haze;
    shared.uRain.value = c.rain;
    if (params.freeze) shared.uWet.value = c.rain;         // (test pictures: as wet as it is raining)
    shared.uCloudLayer.value.y = 1750 + 1600 * c.rain;         // shower clouds tower
    env.cloud = env.cloudOverride ?? c.cloud;
    shared.uSeaLevel.value = env.seaLevelOverride ?? c.seaLevel;
    Object.assign(status, { live: c.live, air: c.air, waveHeight: c.waveHeight, seaLevel: shared.uSeaLevel.value, wind, windFrom: c.windFrom, sunElevation: sun.elevation, sunrise: times.sunrise, sunset: times.sunset, sea: c.sea, airMax: c.airMax });
  }

  // ---- places, labels, controls
  const features = data.features || {};
  // The sandbar of Cayo de Agua stands lower than any beach: at an autumn high water the sea covers it, the rest
  // of the time it is a strip of sand between two seas (see lrBermMin in lr_geo).
  const BAR_CREST = 0.1;
  if (features.tombolo?.crest?.length > 1) {
    const c = features.tombolo.crest, a = c[0], b = c[c.length - 1];
    ground.sandbar = { a, b, reach: 30, crest: BAR_CREST };
    shared.uSandbar.value.set(a[0], a[1], b[0], b[1]); shared.uSandbarP.value.set(30, BAR_CREST);
  }
  const places = (features.places || []).filter(p => p.pos);
  if (!places.some(p => p.id === 'overview')) places.unshift(OVERVIEW);

  // ---- the opaque scene: terrain, buildings and lighthouses, boats
  const landmarks = new Landmarks(features, ground, material => buildBeachSets(places, ground, material));
  const boats = new Boats(places, ground, waves, data.cpu.waveMap, rect, landmarks.material);
  const opaque = new THREE.Scene();
  opaque.matrixWorldAutoUpdate = false;
  const birds = new Birds(places, ground, landmarks.material);
  // Your own body: seen when you look down, and the caster of your shadow (the head only ever in the shadow).
  const body = new Body(createObjectMaterial(tier.fp.shadowTaps, true), true);
  // Your real body (world/figure.js: a woman of 1.63 m, built by pipeline/body). Until its files have come, and
  // on the simplest tier, you are the figure of tubes; once they have, the tubes only do the solving: the same
  // gait and reach, worked out with her proportions, are handed to her bones (figurepose.js).
  let figure = null, figureRig = null, patch = null, pressing = null, ripples = null, crossing = null;
  // How far your feet have sunk as the wash drew the sand from under them (metres), and how the water runs past you (m/s).
  let sunk = 0;
  const told = { crouch: false, sit: false };
  // Sitting: how far your legs are drawn up (0..1), how wide your feet (0..1), and your toes (radians, curling).
  const seated = { draw: 0, splay: 0, wiggle: 0 };
  const flow = [0, 0];
  const figureReady = tierName === 'low' || params.tubes ? Promise.resolve(false) : loadFigure(manifest.compressed === 'gzip').then(data => {
    const u = body.mesh.material.uniforms;
    figure = new Figure(data, tier.fp.shadowTaps || 4, { uBodyWet: u.uBodyWet, uBodySand: u.uBodySand, uHandWet: u.uHandWet, uHandSand: u.uHandSand }); figureRig = new FigureRig(data.info);
    const p = figureRig.proportions, was = walker.stand;
    setProportions(p);
    // (Squatting on her heels, leaning forward a little, her eyes are at about half her height.)
    Object.assign(walker, { stand: p.stand, crouch: 0.51 * p.stand, sit: 0.095 + 0.985 * p.torso + p.eyeToShoulder, legs: (p.thigh + p.shin) / 0.87 });
    if (walker.body >= was - 0.01) { walker.eyeY += p.stand - walker.body; walker.body = p.stand; }
    opaque.add(figure.mesh);
    // The sand round you as real sand: your body presses into it (sim/patch.js).
    if (tier.fp.patch && !params.stamps) { patch = new SandPatch(renderer, tier.fp.patch); pressing = patch.toolMaterial(figure.mesh.material.uniforms.tBones);
      ripples = new Ripples(renderer, patch, 512); crossing = ripples.crossMaterial(figure.mesh.material.uniforms.tBones); }
    return true;
  }).catch(e => { note(`the body model did not load: ${e?.message || e}`); return false; });
  const spray = new Spray();
  // Whether the sand at (x, z), ground height g, is wet from the waves: under the height the swash reaches there.
  // (As lr_shore's lrBeach has it, without the ragged edge: on a beach face the waves climb to their run-up; over
  // flat sand a sheet runs on a few metres and dies, so the middle of a wide bar is dry though it is low.)
  const wetSandAt = (x, z, g) => {
    const a = Math.max(g - shared.uSeaLevel.value, 0), ease = (lo, hi, v) => { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
    let R = runup(seaAt(x, z).hs);
    const flat = Math.max(-ground.shoreAt(x, z) - a / 0.08, 0), run = (R / 0.11 + 0.3) * (1 + 3 * (1 - ease(0.03, 0.2, a / Math.max(R, 1e-4))));
    R *= 1 - ease(1.2 * run, 3 * run, flat);
    return a < R * 1.02 + 0.02 * Math.min(1, R * 100);
  };
  // Your right hand, taking up sand and water and letting them run out between the fingers (world/hand.js).
  const hand = new Hand({ spray, sound: { touch: (kind, how, speed) => sound.touch(kind, how, speed) }, shadowTaps: tier.fp.shadowTaps, patch: () => patch,
    ring: (x, z, when, strength) => (ripples ? ripples.drop(x, z, when, strength, 0.022) : shared.uRing.value[rings++ % 6].set(wrap64(x), wrap64(z), when, strength)) });
  // How wet you are: `high` is as far up as the sea has stood round you lately (drying), `now` the water you stand in.
  const soak = { high: 0, amount: 0, now: 0, nowAmount: 0, sand: 0 };
  landmarks.material.defines.LR_SHADOW_TAPS = tier.fp.shadowTaps;
  const shadows = new Shadows(renderer, tier.fp.shadowMap, R.reversed);
  const statue = buildStatue(places, ground, landmarks.material), turtle = new Turtle(places, ground, landmarks.material);
  if (statue) landmarks.group.add(statue);
  // Small things near the eye (world/scatter.js): they cast no shadows of their own.
  const mounds = buildConchMounds(places, ground, landmarks.material);
  if (mounds) landmarks.group.add(mounds);
  const life = [...buildSeaLife(data.textures, tier.fp), ...buildShoreLife(data.textures, tier.fp), ...buildPlants(data.textures, tier.fp)], lifeGroup = new THREE.Group();
  shared.uTreesNear.value = tier.fp.life ? 1 : 0;
  lifeGroup.matrixAutoUpdate = false;
  for (const kind of life) lifeGroup.add(kind.mesh);
  opaque.add(terrain.mesh, landmarks.group, boats.group, birds.group, body.mesh, body.headMesh, lifeGroup, spray.points, hand.mesh, hand.streams, hand.lying);
  const casters = life.filter(k => k.caster).map(k => ({ mesh: k.mesh, caster: k.caster }));
  if (turtle.mesh) opaque.add(turtle.mesh);
  const ui = document.getElementById('ui');
  let syncPanel = null, labels = null, hud = null, walkInput = null;

  // ---- first person
  const surfaceAt = (x, z) => {
    const sea = shared.uSeaLevel.value;
    // (Near a shore the little waves coming in ride on top: without them their crests would wash over a swimmer's eyes.)
    return sea + waves.heightAt(x, z, clock.time, boats.weightsAt(x, z, sea - ground.heightAt(x, z)), 3) + shoreCrest(x, z, ground.shoreAt(x, z), seaAt(x, z).hs, clock.time);
  };
  // ---- sound (walking only)
  const sound = new Sound(), raw = [0, 0, 0, 0];
  /** Height of the waves arriving at a place, and how loud the reef's surf is there (from the wave map). */
  function seaAt(x, z) {
    const m = boats.mapAt(x, z, seaMap);
    waves.weightsAt(m[1], m[0], raw);
    const hs = 4 * Math.hypot(raw[0], raw[1], raw[2]), far = m[2] * m[2] * 250;
    return { hs, reef: m[3] * Math.exp(-far / 80) * Math.min(1, hs / 0.6) };
  }
  const seaMap = [0, 0, 0, 0];
  let shoreTimer = 0, shorePoints = [];
  function soundScene(dt) {
    shoreTimer -= dt;
    if (shoreTimer <= 0) {
      // Three points of the waterline: straight to the nearest sea and nine metres along the shore either way.
      shoreTimer = 0.25; shorePoints = [];
      const near = Math.abs(ground.shoreAt(walker.x, walker.z)) < 160 ? ground.findShore(walker.x, walker.z, 0) : null;
      if (near) {
        const a = near.yaw * Math.PI / 180, sea = [Math.sin(a), -Math.cos(a)];
        // (On a sandbar the sea is on both sides of you: the second point is then the far shore, behind you as
        // you face the near one.)
        const inland = -ground.shoreAt(walker.x, walker.z);
        const far = inland > 0 && inland < 30 ? ground.findShore(walker.x - sea[0] * (2 * inland + 8), walker.z - sea[1] * (2 * inland + 8), 0) : null;
        const across = far && Math.hypot(far.x - near.x, far.z - near.z) > 8 && Math.hypot(far.x - walker.x, far.z - walker.z) < 50 ? far : null;
        for (const along of across ? [0, 'across', 9] : [0, -9, 9]) {
          const q = along === 'across' ? across : along ? ground.findShore(near.x + sea[1] * -along, near.z + sea[0] * along, 0) : near;
          if (!q) continue;
          if (along === 'across') { const b = q.yaw * Math.PI / 180; shorePoints.push({ x: q.x, z: q.z, hs: seaAt(q.x + Math.sin(b) * 12, q.z - Math.cos(b) * 12).hs, dist: 0, bearing: 0 }); continue; }
          // (A puddle or a creek carries no waves: see lrOpenWater.)
          const open = ground.shoreAt(q.x + sea[0] * 8, q.z + sea[1] * 8) > 3 ? 1 : 0.1;
          shorePoints.push({ x: q.x, z: q.z, hs: seaAt(q.x + sea[0] * 12, q.z + sea[1] * 12).hs * open, dist: 0, bearing: 0 });
        }
      }
    }
    for (const q of shorePoints) { q.dist = Math.hypot(q.x - walker.x, q.z - walker.z); q.bearing = Math.atan2(q.x - walker.x, -(q.z - walker.z)) - walker.yaw; }
    return { time: clock.time, shores: shorePoints, reef: seaAt(walker.x, walker.z).reef, wind: waves.wind.speed, rain: shared.uRain.value, under: walker.under,
      depth: walker.depth, speed: Math.hypot(walker.vx, walker.vz), day: status.sunElevation > 2 };
  }

  // Your footprints: the last 24 paces on sand, left and right of the line walked.
  let prints = 0;
  const wrap64 = v => ((v % 64) + 64) % 64;
  let rings = 0;
  /** Whether your feet are wet (from the water you stood in a little while ago). */
  const feetWet = () => Math.max(soak.amount * (soak.high > 0.02 ? 1 : 0), soak.nowAmount) > 0.2;
  function stamp(step) {
    // (Wet feet pick up sand at every step on the dry beach; the sea washes it off again.)
    if (step.depth < 0.02 && !onDeck(step.x, step.z) && feetWet()) soak.sand = Math.min(1, soak.sand + 0.3);
    // (On a pier: the knock of boards, and no prints in the sand below.)
    if (onDeck(step.x, step.z) && step.depth < 0.03) { sound.step({ side: step.side, surface: 'wood' }); return; }
    const above = ground.heightAt(step.x, step.z) - shared.uSeaLevel.value;
    const wetSand = above < runup(seaAt(step.x, step.z).hs) + 0.02;
    sound.step({ depth: step.depth, side: step.side, wet: wetSand ? 1 : 0 });
    // Where that foot came down: under the foot itself as it was posed a moment ago (the middle of the sole is
    // 6 cm ahead of the ankle), or, when nothing is being drawn (a test walking on fast), a hip's width to the
    // side and ahead of you by the reach of the pace.
    const fresh = frames - posedAt <= 1 ? body.joints?.ankles : null, landed = fresh?.[step.side], cy = Math.cos(step.yaw), sy = Math.sin(step.yaw);
    const side = landed ? landed[0] + (step.side ? 0.007 : -0.007) : step.side ? 0.1 : -0.1, ahead = landed ? 0.06 - landed[2] + walker.ahead : footfall(step.stride ?? 1);
    const px = step.x + cy * side + sy * ahead, pz = step.z + sy * side - cy * ahead, pace = Math.min(step.stride ?? 1, 1.6);
    if (step.depth > 0.03) {
      // Wading: each pace sends a ring out over the water, and throws up drops where the foot goes in.
      if (ripples) ripples.drop(px, pz, clock.time, Math.min(1.6, 0.7 + step.depth * 3), 0.07);
      else shared.uRing.value[rings++ % 6].set(wrap64(step.x), wrap64(step.z), clock.time, Math.min(1, 0.4 + step.depth * 2));
      if (fresh) spray.burst(wrap64(px), ground.heightAt(px, pz) + step.depth, wrap64(pz), clock.time, [-sy, cy], Math.round((6 + 10 * pace) * Math.min(1, step.depth / 0.1)), true, 0.6 + 0.4 * pace);
      return;
    }
    // On dry sand the other foot, pushing off a tenth of a second from now, flicks grains back from under its toes.
    const pushing = fresh?.[1 - step.side];
    if (pushing && !wetSand) {
      const tx = pushing[0], tz = pushing[2] - 0.13, wx = step.x + cy * tx - sy * tz, wz = step.z + sy * tx + cy * tz;
      spray.burst(wrap64(wx), ground.heightAt(wx, wz), wrap64(wz), clock.time + 0.1 / Math.max(pace, 0.5), [-sy, cy], Math.round(3 + 8 * pace), false, 0.45 + 0.55 * pace);
    }
    shared.uFoot.value[prints % 24].set(wrap64(step.x + cy * side + sy * ahead), wrap64(step.z + sy * side - cy * ahead), Math.atan2(Math.sin(step.yaw), Math.cos(step.yaw)) + (step.side ? 0.12 : -0.12) + (feetWet() ? 64 : 0), clock.time);
    shared.uFootCount.value = Math.min(++prints, 24);
  }
  // Walls, and the umbrella poles on the beaches (a coarse grid of small circles).
  const walls = buildingBlocker(features.buildings), posts = new Map();
  for (const [x, z, radius] of landmarks.umbrellas.map(q => [q[0], q[1], 0.25])) {
    const key = `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
    if (!posts.has(key)) posts.set(key, []);
    posts.get(key).push([x, z, radius]);
  }
  const blocked = (x, z) => {
    if (walls(x, z)) return true;
    const i = Math.floor(x / 4), j = Math.floor(z / 4);
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) for (const q of posts.get(`${a},${b}`) || []) if (Math.hypot(x - q[0], z - q[1]) < q[2]) return true;
    return false;
  };
  // What you stand on: the ground, or a pier's deck once your feet are up at its level (coming up its gangway
  // from the beach; from the water you pass under it).
  const pierAt = pierWalk(features.piers, ground);
  const onDeck = (x, z) => { const deck = pierAt(x, z); return deck && (deck.ramp || walker.eyeY - walker.body > deck.height - 0.5) ? deck : null; };
  const footing = { heightAt(x, z) { const g = ground.heightAt(x, z), deck = onDeck(x, z); return deck ? Math.max(g, deck.height) : g; } };
  const walker = new Walker({ ground: footing, surfaceAt, blocked, rect: { x: rect.x - 3000, z: rect.z - 3000, w: rect.w + 6000, h: rect.h + 6000 } });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) walker.bobAmount = 0;
  rig.walker = walker;
  /**
   * Where the site opens: standing on the sandbar of Cayo de Agua, near its narrow end by the main cay,
   * looking down its length between the two seas to West Cay and its lighthouse.
   */
  function sandbarSpot() {
    const crest = features.tombolo?.crest || [];
    if (crest.length < 8) return null;
    const a = ground.ridge(...crest[Math.round(crest.length * 0.12)]), b = ground.ridge(...crest[Math.round(crest.length * 0.7)]);
    return { x: a.x, z: a.z, yaw: Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 6, pitch: -6 };
  }
  /**
   * Where you are put down at a place: its walking spot (camera/bookmarks.js), or, on the cays where the boatmen
   * set up umbrellas, a few steps up the beach from the nearest of them, looking out to sea past it: you arrive
   * among things whose size you know (an umbrella, loungers, the boats beyond).
   */
  function arrivalSpot(place) {
    if (place.id === 'cayo-de-agua-isthmus' && sandbarSpot()) return sandbarSpot();
    const spot = walkSpotFor(place);
    if (spot.near !== place.pos) return spot;               // (a spot chosen by hand)
    const u = landmarks.umbrellas.map(q => [Math.hypot(q[0] - place.pos[0], q[1] - place.pos[1]), q]).sort((a, b) => a[0] - b[0])[0];
    return u && u[0] < 500 ? { umbrella: [u[1][0], u[1][1]], back: 7.5, side: Math.PI - 0.5, face: 8, pitch: -3 } : spot;
  }
  const app = {
    env, places, attribution: manifest.attribution || [],
    setEnv(patch) {
      Object.assign(env, patch);
      if (patch.weather === 'live') {
        // Now, there: the local clock time and month at Los Roques (UTC-4), and the weather service's numbers.
        const now = new Date(Date.now() - 4 * 3600000);
        Object.assign(env, { hours: now.getUTCHours() + now.getUTCMinutes() / 60, month: now.getUTCMonth(), playing: false });
      }
      applyEnv(); syncPanel?.(status); saveHash();
    },
    flyToPlace(p) { app.setWalk(false); rig.flyTo(shotFor(p), 4.5); },
    /**
     * Into first person, or back to the air. With no pose you land where the camera is looking: on the nearest
     * place's walking spot when seen from far off, otherwise on that very point (standing, wading or afloat).
     * `pose`: { x, z, yaw (deg), pitch (deg), height, eye } or { near: [x, z], shore, face, ... }; `instant` skips the flight down.
     */
    setWalk(on, pose = null, instant = false) {
      // (Wherever you are put down, your hand is at your side and the sand there is as you found it.)
      hand.reset(); patch?.reset(); ripples?.reset(); sunk = 0; Object.assign(seated, { draw: 0, splay: 0, wiggle: 0 });
      if (!on) {
        sound.stop();
        if (rig.mode === 'walk') { rig.setMode('orbit'); walkInput?.release(); }
        status.walk = false; hud?.classList.remove('on'); if (labels) labels.enabled = status.labels !== false; syncPanel?.(status); saveHash();
        return;
      }
      let spot = pose;
      if (!spot) {
        const t = rig.target, place = rig.dist > 250 ? places.filter(q => q.id !== 'overview').map(q => [Math.hypot(q.pos[0] - t.x, q.pos[1] - t.z), q]).sort((a, b) => a[0] - b[0])[0] : null;
        spot = place && place[0] < 900 ? arrivalSpot(place[1]) : { x: t.x, z: t.z, yaw: rig.yaw * 180 / Math.PI };
      }
      // ({ place: id }: where "Walk here" puts you down at that place.)
      if (spot.place) { const q = places.find(v => v.id === spot.place); if (q) { const { place: _, face, ...rest } = spot, there = arrivalSpot(q); spot = { ...there, ...rest, ...(face !== undefined ? (there.yaw !== undefined ? { yaw: there.yaw + face } : { face }) : {}) }; } }
      if (spot.pier) {
        // "So many metres out along the pier whose landward end is nearest this point, facing out to sea."
        const q = pierAt.spot(spot.pier, spot.along ?? 8);
        if (q) { spot = { ...spot, x: q.x, z: q.z, yaw: q.yaw + (spot.face ?? 0) }; walker.eyeY = 50; }        // (feet above the deck: you are put down on it)
      } else if (spot.umbrella) {
        // "So many metres towards the water from the beach umbrella nearest this point, looking back at it."
        const u = landmarks.umbrellas.map(q => [Math.hypot(q[0] - spot.umbrella[0], q[1] - spot.umbrella[1]), q]).sort((a, b) => a[0] - b[0])[0]?.[1];
        if (u) {
          const d = spot.back ?? 5, a = u[2] + (spot.side ?? 0.5), x = u[0] + Math.cos(a) * d, z = u[1] + Math.sin(a) * d;
          spot = { ...spot, x, z, yaw: Math.atan2(u[0] - x, -(u[1] - z)) * 180 / Math.PI + (spot.face ?? 0) };
        }
      } else if (spot.near) {
        // "So many metres up the beach from the waterline nearest this point, facing so many degrees off the sea."
        const found = ground.findShore(spot.near[0], spot.near[1], spot.shore ?? -2) || { x: spot.near[0], z: spot.near[1], yaw: 0 };
        spot = { ...spot, x: found.x, z: found.z, yaw: found.yaw + (spot.face ?? 0) };
      }
      // Never start inside a house: step outwards in a spiral to the nearest clear ground.
      for (let i = 1; walker.blocked(spot.x, spot.z) && i < 400; i++) {
        const a = i * 2.4, r = 0.6 * Math.sqrt(i);
        const x = spot.x + Math.cos(a) * r, z = spot.z + Math.sin(a) * r;
        if (!walker.blocked(x, z)) spot = { ...spot, x, z };
      }
      if (!instant) sound.start();                         // (a click brought us here: the browser lets sound begin)
      // (For pictures: facing the moon, wherever it is.)
      if (spot.towards === 'moon' && status.moon) spot = { ...spot, yaw: status.moon.azimuth + (spot.face ?? 0) };
      const arrive = () => {
        walker.place({ x: spot.x, z: spot.z, yaw: (spot.yaw ?? 0) * Math.PI / 180, look: (spot.pitch ?? -4) * Math.PI / 180, height: Math.min(spot.height ?? walker.stand, walker.stand), eye: spot.eye ?? null });
        rig.setMode('walk');
        status.walk = true; hud?.classList.add('on'); if (labels) labels.enabled = false; syncPanel?.(status); saveHash();
      };
      if (instant || rig.mode === 'walk') return arrive();
      // Come down to where the eyes will be, looking the way the walker will look, then hand over.
      const yaw = (spot.yaw ?? 0) * Math.PI / 180;
      rig.flyTo({ x: spot.x + Math.sin(yaw) * 7, z: spot.z - Math.cos(yaw) * 7, dist: 7.2, yaw: spot.yaw ?? 0, pitch: 13 }, Math.min(5, 1.6 + rig.dist / 400), arrive);
    },
    async setCompare(x) {
      if (x >= 0 && !satellite) { satellite = await data.loadSatellite(); shared.tSatellite.value = satellite; }
      shared.uCompareX.value = status.compare = x;
      syncPanel?.(status);
    },
    /** Sound on or off (remembered). */
    setSound(on) { sound.setMuted(!on); if (on && rig.mode === 'walk') sound.start(); status.sound = !sound.muted; syncPanel?.(status); const b = hud?.querySelector('.walk-sound'); if (b) { b.setAttribute('aria-pressed', String(!sound.muted)); b.textContent = sound.muted ? 'Sound off' : 'Sound on'; } },
    setLabels(on) { status.labels = on; if (labels) labels.enabled = on && rig.mode !== 'walk'; },
  };

  // ---- the view in the URL (so a link reopens the same scene)
  let hashTimer = 0;
  function saveHash() {
    if (params.freeze) return;
    clearTimeout(hashTimer);
    hashTimer = setTimeout(writeHash, 400);
  }
  writeHash = () => {
    if (params.freeze) return;
    const c = rig.get(), h = new URLSearchParams();
    if (rig.mode === 'walk') h.set('p', [walker.x.toFixed(1), walker.z.toFixed(1), (walker.yaw * 180 / Math.PI).toFixed(0), (walker.look * 180 / Math.PI).toFixed(0)].join(','));
    else h.set('c', [c.x.toFixed(0), c.z.toFixed(0), c.dist.toFixed(0), c.yaw.toFixed(1), c.pitch.toFixed(1)].join(','));
    h.set('t', env.hours.toFixed(2)); h.set('m', String(env.month)); h.set('w', env.weather);
    history.replaceState(null, '', `#${h}`);
  };
  function loadHash() {
    const h = new URLSearchParams(location.hash.slice(1)), c = (h.get('c') || '').split(',').map(Number);
    if (c.length === 5 && c.every(Number.isFinite)) rig.set({ x: c[0], z: c[1], dist: c[2], yaw: c[3], pitch: c[4] });
    if (h.has('t') && Number.isFinite(Number(h.get('t')))) env.hours = Number(h.get('t'));
    if (h.has('m') && Number(h.get('m')) >= 0 && Number(h.get('m')) < 12) env.month = Math.floor(Number(h.get('m')));
    if (h.has('w')) env.weather = h.get('w');
    // p = a first-person spot: x, z, heading, look (degrees).
    const w = (h.get('p') || '').split(',').map(Number);
    if (w.length >= 3 && w.every(Number.isFinite)) { walkLink = { x: w[0], z: w[1], yaw: w[2], pitch: w[3] ?? -4 }; return true; }
    return c.length === 5;
  }
  let walkLink = null;

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

  let adapt = 1;                                            // how far the eye has opened up for a cloud's shade (1 in the sun)
  let inspected = null;                                     // (the body model put out to be looked at: tests only)
  let frames = 0, posedAt = -9, lastInput = NO_INPUT, paceHold = false;                         // (paceHold: the test's fast-forward has kept the page busy; its pauses say nothing of the device)
  function frame(dt = 0) {
    frames++;
    if (env.playing && dt > 0) {
      env.hours += dt * 17 / DAY_SECONDS;
      if (env.hours > 21) env.hours = 4;                 // a played day runs from before dawn to after dusk
      applyEnv(); syncPanel?.(status);
    }
    if (rig.step(dt)) saveHash();
    shared.uTime.value = clock.time;
    rig.seaLevel = shared.uSeaLevel.value;
    if (rig.mode === 'walk') {
      const moved = walker.x + walker.z + walker.yaw;
      lastInput = walkInput ? walkInput.read() : NO_INPUT;
      for (const step of walker.step(dt, lastInput)) stamp(step);
      walker.ahead = walker.afloat || walker.diving ? 0 : walker.sitting ? walker.ahead * Math.exp(-dt * 6) : eyeAhead({ look: walker.look, eye: Math.max(walker.body, walker.crouch - 0.13), stride: Math.max(walker.stride, walker.turned) });
      sound.update(dt, soundScene(dt));
      if (moved !== walker.x + walker.z + walker.yaw) saveHash();
    }
    shared.uUnderEye.value = rig.mode === 'walk' && walker.under ? 1 : 0;
    // Rain wets the ground in a quarter of a minute; the sun and the wind take a few minutes to dry it.
    if (dt > 0) { const rain = shared.uRain.value, wet = shared.uWet.value; shared.uWet.value = rain > wet ? wet + (rain - wet) * (1 - Math.exp(-dt / 6)) : Math.max(rain, wet - dt / 200); }
    rig.update(R.size.width / R.size.height, R.reversed);
    sky.overcast = Math.min(1, Math.max(0, (env.cloud - 0.45) / 0.4));
    sky.update();
    const view = rig.view();
    waves.update(clock.time, view.cam);
    clouds.bakeSome(4);
    clouds.update(dt, waves.wind, env.cloud);
    envMap.update(clouds.enabled && clouds.ready && env.cloud > 0.01, dt === 0);
    terrain.update(view, rect);
    water.update(view);
    // Night: the eye (the exposure) opens up as the sun goes down, and lamps come on.
    const night = Math.min(1, Math.max(0, (-1 - status.sunElevation) / 8));
    // On foot the eye also adapts to a cloud's shade. Under a cumulus a white beach gets about a third of the
    // light it has in the sun (a fifth of the sun through the cloud, plus the sky), and a fixed exposure shows it
    // as gloomy as dusk. The eye takes up most of the difference, over a second or two: the shade reads as shade,
    // still a white beach, and the sunlit distance as brighter still.
    let want = 1;
    if (rig.mode === 'walk' && status.sunElevation > 0) {
      const sunE = shared.uSunE.value, skyE = shared.uSkyE.value, mu = Math.max(shared.uSunDir.value.y, 0), luma = v => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
      const sun = luma(sunE) * mu, sky = luma(skyE), left = (sun * clouds.sunAt(rig.eye.x, rig.eye.z, dt === 0) + sky) / Math.max(sun + sky, 1e-6);
      want = Math.min(3, Math.pow(Math.max(left, 0.05), -0.75));
    }
    adapt = dt === 0 ? want : adapt + (want - adapt) * (1 - Math.exp(-dt / 1.5));
    if (!Number.isFinite(adapt)) adapt = 1;              // (a value that is not a number would stay one, and the picture black)
    shared.uExposure.value = env.exposure * (1 + 44 * night * night) * adapt;
    landmarks.update(rig.eye, night);
    graph.starTurn = env.hours / 24 * 2 * Math.PI;
    boats.update(rig.eye, clock.time, shared.uSeaLevel.value);
    birds.update(rig.eye, clock.time);
    for (const kind of life) kind.update(rig.eye);
    turtle.update(rig.eye, clock.time, shared.uSeaLevel.value);
    shared.uWaveHere.value.fromArray(boats.weightsAt(rig.eye.x, rig.eye.z, 3));
    // Shadows of things: round the walker (and of the walker), or round what the orbit camera looks at.
    const walking = rig.mode === 'walk', standing = walking && !walker.afloat && !walker.diving;
    // Your body: walking on the bottom, or swimming where the water carries you (tipped along your look when dived).
    body.mesh.visible = walking && !figure;
    if (figure) figure.mesh.visible = walking;
    if (standing) {
      // (The ground's rise under your feet, forward and to the right, so each foot is set down on it; and in
      // water to the chest, arms up and out.)
      const fx = Math.sin(walker.yaw), fz = -Math.cos(walker.yaw), g = (dx, dz) => footing.heightAt(walker.x + dx, walker.z + dz);
      const slope = [(g(fx * 0.3, fz * 0.3) - g(-fx * 0.3, -fz * 0.3)) / 0.6, (g(-fz * 0.2, fx * 0.2) - g(fz * 0.2, -fx * 0.2)) / 0.4];
      const wade = Math.min(1, Math.max(0, (walker.depth - 0.9) / 0.4));
      // Your hand (world/hand.js): what it is to do this frame. It can go down to the ground when you are crouched
      // on sand or in water no deeper than your knee.
      const cyw = Math.cos(walker.yaw), syw = Math.sin(walker.yaw), feet = walker.eyeY - walker.body, low = walker.crouched;
      const reachable = { want: !!lastInput.hand, open: lastInput.open ?? 0.3, sitting: walker.sitting, canReach: (low > 0.8 || walker.sitting) && walker.depth < 0.5 && !onDeck(walker.x, walker.z), time: clock.time, look: walker.look, body: walker.body, feet,
        x: walker.x + syw * walker.ahead, z: walker.z - cyw * walker.ahead, yaw: walker.yaw, cy: cyw, sy: syw, surf: walker.surf, groundAt: (x, z) => footing.heightAt(x, z),
        wetAt: wetSandAt };
      const reach = hand.plan(dt, reachable);
      // (The planted foot goes back under you at exactly the rate you travel, so it stays where it was put; your
      // weight presses it a centimetre into dry sand, less into wet; turning on the spot you shift your feet.)
      const speed = Math.hypot(walker.vx, walker.vz), firm = walker.depth > 0.005 || ground.shoreAt(walker.x, walker.z) > -1.5;
      // (A test may put the eye lower than anyone can squat, to look at the sand: the body is then posed in its
      // deepest squat, for the shadow, and left out of the picture: it would be folded through the camera.)
      const eyeUp = Math.max(walker.body, walker.crouch - 0.13), folded = eyeUp > walker.body + 0.02;
      if (walker.sitting) {
        // Seated, the keys that walk you move your legs: S draws them up and W stretches them out, A / D bring your
        // feet together and apart, Space curls your toes.
        if (dt > 0) {
          seated.draw = Math.min(1, Math.max(0, seated.draw + lastInput.fwd * -dt * 0.9)); seated.splay = Math.min(1, Math.max(0, seated.splay + lastInput.right * dt * 0.9));
          seated.wiggle += ((lastInput.up ? 0.45 * Math.sin(clock.time * 9) - 0.15 : 0) - seated.wiggle) * (1 - Math.exp(-dt * 12));
        }
        body.pose({ sit: true, eye: Math.max(walker.body, walker.sit - 0.08), draw: seated.draw, splay: seated.splay, wiggle: seated.wiggle, breath: Math.sin(clock.time * 1.45), sink: onDeck(walker.x, walker.z) ? 0 : 0.008 + sunk, touch: reach });
      } else       body.pose({ phase: walker.phase, stride: Math.max(walker.stride, walker.turned), eye: eyeUp, look: walker.look, slope, wade, breath: Math.sin(clock.time * 1.45),
        pace: speed > 0.3 ? paceLength(speed, walker.crouched, walker.legs) : null, sink: onDeck(walker.x, walker.z) ? 0 : (firm ? 0.005 : patch ? 0.018 : 0.011) + sunk, touch: reach });
      posedAt = frames; body.place(walker.eyeY - walker.body, walker.yaw, 0, walker.sway);
      if (figure) {
        // What of her rests on the sand or hangs just over it (for the soft dark under it: terrain.js).
        const cy = Math.cos(walker.yaw), sy = Math.sin(walker.yaw), base = walker.eyeY - walker.body, list = shared.uContact.value;
        const put = (i, q, r) => list[i].set(q[0] * cy - q[2] * sy - cy * walker.sway, base + q[1], q[0] * sy + q[2] * cy - sy * walker.sway, r);
        body.joints.ankles.forEach((a, i) => { put(i * 2, [a[0], a[1] - 0.025, a[2] + 0.02], 0.05); put(i * 2 + 1, [a[0], Math.max(a[1] - 0.05, 0.02), a[2] - 0.11], 0.045); });
        body.joints.wrists.forEach((w, i) => { const t = body.joints.fingertips[i] || w; put(4 + i, [(w[0] + t[0]) / 2, (w[1] + t[1]) / 2, (w[2] + t[2]) / 2], 0.05); });
        body.joints.knees.forEach((k, i) => put(6 + i, k, 0.06));
      }
      if (figure) { figure.mesh.visible = !folded; figure.setPose(figureRig.pose(body.joints, eyeUp), eyeUp); figure.place(-Math.cos(walker.yaw) * walker.sway, walker.eyeY - walker.body, -Math.sin(walker.yaw) * walker.sway, walker.yaw); }
      // (Her real hand, as the rig has posed it: where its palm is, which way it faces, where the fingers leave it.)
      if (figure && body.joints.touching && !folded) body.joints.touching.palm = figureRig.hand(1);
      // What comes of it. (Points of the body are turned to your heading and stood on your feet.)
      hand.act(dt, { ...reachable, joints: body.joints, eye: rig.eye, material: body.mesh.material,
        world: q => [reachable.x + q[0] * cyw - q[2] * syw, feet + q[1], reachable.z + q[0] * syw + q[2] * cyw], turn: v => [v[0] * cyw - v[2] * syw, v[1], v[0] * syw + v[2] * cyw] });
    }
    else if (walking) {
      if (hand.ik > 0 || hand.amount > 0) hand.reset();          // (swimming: the hand has other work)
      for (const c of shared.uContact.value) c.w = 0;
      const under = walker.diving ? 1 : 0;
      body.pose({ swim: true, stroke: walker.stroke, under }); body.place(walker.eyeY + walker.bob, walker.yaw, under * walker.look);
      if (figure) { figure.setPose(figureRig.pose(body.joints, 0), 0); figure.place(0, walker.eyeY + walker.bob, 0, walker.yaw, under * walker.look); }
    }
    if (walking) {
      // Wet to where the water stands round you (a hand's breadth more for the splash; all over when you swim).
      // What is above the water dries in about three minutes.
      const reach = !standing ? 3 : walker.depth > 0.02 ? walker.depth + 0.06 : 0, feet = standing ? walker.eyeY - walker.body : walker.eyeY - walker.stand;
      if (reach >= soak.high || soak.amount < 0.02) { soak.high = reach; soak.amount = reach > 0 ? 1 : 0; } else if (dt > 0) soak.amount = Math.max(0, soak.amount - dt / 180);
      if (reach > 0) { soak.now = reach; soak.nowAmount = 1; } else if (dt > 0) soak.nowAmount = Math.max(0, soak.nowAmount - dt / 180);
      body.mesh.material.uniforms.uBodyWet.value.set(feet + soak.high, soak.amount, feet + soak.now, soak.nowAmount);
      if (dt > 0) soak.sand = Math.max(0, soak.sand - dt * (walker.depth > 0.03 || !standing ? 2.5 : 1 / 300));       // washed off in the sea; otherwise it dries and drops off in minutes
      body.mesh.material.uniforms.uBodySand.value = standing ? soak.sand : 0;
      // Where your shins stand in the water (for the ripples round them): the body's ankles, turned to your heading.
      const inWater = standing && walker.depth > 0.012 ? 1 : 0, cy = Math.cos(walker.yaw), sy = Math.sin(walker.yaw), speed = Math.hypot(walker.vx, walker.vz);
      (body.joints?.ankles || []).forEach((a, i) => shared.uLeg.value[i].set(wrap64(rig.eye.x + a[0] * cy - a[2] * sy), wrap64(rig.eye.z + a[0] * sy + a[2] * cy), inWater, speed));
    } else {
      for (const c of shared.uContact.value) c.w = 0;
      shared.uLeg.value[0].z = shared.uLeg.value[1].z = 0;
    }
    // The keys for what you are doing, said the first time you do it (the opening hint has faded by then).
    if (params.ui && !params.freeze && walking && standing) {
      if (walker.sitting && !told.sit) { told.sit = true; notice('Seated: S draws your legs up, W stretches them out · A D move your feet · Space curls your toes · the mouse button works your right hand · X gets you up', null, 10); }
      else if (!walker.sitting && walker.crouched > 0.9 && !told.crouch) { told.crouch = true; notice('Hold the mouse button to take a handful of sand or water. Let go and it runs out between your fingers · the wheel (or Q / E) closes and parts them', null, 10); }
    }
    // How the water runs past you: up the beach with each wave, more slowly back down. Standing in it, the
    // backwash draws the sand from under your heels and you sink, a centimetre or two; a step frees you.
    {
      const sea = walking && standing && walker.depth > 0.008 && walker.depth < 0.35 ? ground.seaward(walker.x, walker.z) : null;
      if (sea) {
        const p = swashPhase(walker.x, walker.z, clock.time, Math.max(ground.shoreAt(walker.x, walker.z), 0)), run = p < 0.28 ? -1.3 * (1 - p / 0.28) : 0.7 * Math.sin(Math.PI * Math.min(1, (p - 0.28) / 0.6));
        flow[0] = sea.x * run; flow[1] = sea.z * run;
      } else flow[0] = flow[1] = 0;
      const still = Math.hypot(walker.vx, walker.vz) < 0.08, pull = Math.hypot(flow[0], flow[1]);
      // (Each wave that runs past takes a little more; standing on, you stay as deep as you are; moving frees you.)
      if (dt > 0) sunk = !still ? Math.max(0, sunk - dt * 0.08) : sea ? Math.min(0.026, sunk + dt * 0.012 * pull) : sunk;
    }
    // The sand round you moves on: pressed by your body where you stand on it, planed by the sea where that runs.
    if (patch) {
      if (walking && !onDeck(walker.x, walker.z)) {
        patch.update(dt, { x: walker.x, z: walker.z, cam: rig.eye, base: footing.heightAt(walker.x, walker.z), time: clock.time, feetWet: feetWet() ? 0.8 : 0,
          meshes: standing && figure.mesh.visible ? [{ mesh: figure.mesh, material: pressing }] : [],
          sample: (x, z) => { const g = footing.heightAt(x, z); return [g, wetSandAt(x, z, g) ? 1 : 0, surfaceAt(x, z) - g]; } });
        ripples?.update(dt, { x: walker.x, z: walker.z, time: clock.time, flow, meshes: standing && figure.mesh.visible ? [{ mesh: figure.mesh, material: crossing }] : [] });
      } else { shared.uPatch.value.w = 0; shared.uRipple.value.w = 0; }
    }
    if (shadows.enabled && (walking || rig.dist < 1500)) {
      const centre = walking ? { x: Math.sin(walker.yaw) * 12, y: footing.heightAt(walker.x, walker.z), z: -Math.cos(walker.yaw) * 12 }
        : { x: rig.target.x - rig.eye.x, y: Math.max(ground.heightAt(rig.target.x, rig.target.z), shared.uSeaLevel.value), z: rig.target.z - rig.eye.z };
      // (Your own body goes into a small map of its own: a square across the light that just holds you, standing or swimming.)
      const own = walking ? { meshes: figure ? [figure.mesh, figure.hair] : [body.mesh, body.headMesh], centre: standing ? { x: 0, y: walker.eyeY - walker.body + 0.9, z: 0 } : { x: 0, y: body.mesh.position.y - 0.3, z: 0 }, half: standing ? 1.3 : 2 } : null;
      shadows.render(opaque, centre, walking ? 26 : Math.min(600, Math.max(24, 0.6 * rig.dist)), [terrain.mesh, birds.group, lifeGroup, spray.points, hand.mesh, hand.streams, hand.lying, ...(walking ? [body.mesh, ...(figure ? [figure.mesh] : [])] : [])], [], casters, own);
    } else shared.uShadowP.value.z = 0;
    graph.render(opaque, water.mesh, rig.camera, clouds);
    labels?.update(rig.eye, shared.uViewProj.value, R.size.cssWidth, R.size.cssHeight);
  }

  // Your body should be there before you first look down: tests wait for it; a visitor waits a few seconds at
  // most, and if it is slower than that starts as the figure of tubes and changes when it comes.
  onProgress(1, 'your body');
  await Promise.race([figureReady, new Promise(r => setTimeout(r, params.freeze ? 120000 : 6000))]);

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
    hud = buildWalkHud(ui, () => app.setWalk(false), on => app.setSound(on), !sound.muted);
    // (Arriving by a link there was no click yet: the first one in first person starts the sound.)
    for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => { if (rig.mode === 'walk' && !sound.on) sound.start(); });
    walkInput = attachWalkInput(walker, canvas, { active: () => rig.mode === 'walk', onLeave: () => app.setWalk(false), buttons: [...hud.querySelectorAll('[data-walk]')] });
    // Ctrl with W (forward) closes the tab, and no page can stop that. People crouch with Ctrl by habit: say
    // which key does it, and for as long as Ctrl is down have the browser ask before the page goes.
    let ctrlAt = -1e9;
    addEventListener('keydown', e => {
      if (e.key !== 'Control' || rig.mode !== 'walk') return;
      if (performance.now() - ctrlAt > 4000) notice('Crouch or dive with C. Ctrl is left alone here: Ctrl+W would close the tab.', null, 6);
      ctrlAt = performance.now();
    });
    addEventListener('keyup', e => { if (e.key === 'Control') ctrlAt = -1e9; });
    addEventListener('blur', () => { ctrlAt = -1e9; });
    addEventListener('beforeunload', e => { if (rig.mode === 'walk' && performance.now() - ctrlAt < 1500) { e.preventDefault(); e.returnValue = ''; } });
  }
  attachOrbitInput(rig, canvas, rect, saveHash);
  if (walkLink) app.setWalk(true, walkLink, true);

  if (!params.freeze) {
    // Opening: glide down from the overview to the first place, unless the link asked for a view or motion is unwelcome.
    // Opening: you are standing on the sandbar of Cayo de Agua late in the morning, the tide coming in (unless
    // the link asked for a view of its own). "Back to the air" lifts you off; the places are in the panel.
    const bar = fromLink ? null : sandbarSpot();
    if (bar) {
      // (The hour, between nine and one, at which the rising tide first brings the sea to within three
      // centimetres of the bar's crest: where the bar is narrow the waves of the two seas wash across and meet,
      // where it is wide a strip stays dry. In the months when the sea never gets that high, high water: a dry
      // strip between them.)
      let hour = 13;
      for (let h = 9; h < 13; h += 0.1) {
        if (CLIMATE.seaLevel[env.month] + tide(moonPosition(localDate(dayOf(env.month), h)).hourAngle) > BAR_CREST - 0.03) { hour = h; break; }
      }
      env.hours = hour; applyEnv(); app.setWalk(true, bar, true);
    }
    if (software) notice('This browser is drawing without the graphics card (software rendering), so you get the simplest, slow form of the simulation. In Chrome or Chromium the page chrome://gpu says why.', ['OK', () => notice('')]);
    // A note of how each visit ends, kept in this browser. If the last one stopped without the page being closed
    // (the tab or the browser died under it), say so on the next start and offer what was noted, to pass on.
    {
      const KEY = 'lr-last-run', log = { build: null, started: new Date().toISOString(), ended: false };
      let last = null;
      try { last = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* no storage */ }
      fetch('build.json').then(r => (r.ok ? r.json() : null)).then(b => { log.build = b?.build ?? null; }).catch(() => {});
      const keep = () => {
        Object.assign(log, { seconds: Math.round(performance.now() / 1000), frames, doing: rig.mode !== 'walk' ? 'in the air' : walker.diving ? 'diving' : walker.afloat ? 'swimming' : walker.depth > 0.05 ? 'wading' : 'on foot',
          at: [Math.round(walker.x), Math.round(walker.z)], tier: tierName, scale: +dynamic.scale.toFixed(2), frameMs: Math.round(dynamic.pace * 1000), gpu: gpuName.slice(0, 120), software,
          sound: sound.ctx?.state || 'off', lost, hidden: document.hidden, errors: errors.slice(-3).map(t => String(t).slice(0, 200)) });
        try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* no storage */ }
      };
      setInterval(keep, 2000);
      addEventListener('pagehide', () => { log.ended = true; keep(); });
      if (last && !last.ended && !last.hidden && last.seconds > 8) {
        const text = JSON.stringify(last);
        notice(`Last time this page stopped without being closed (${last.seconds} s in, ${last.doing}).`, ['Copy the details', () => {
          const done = () => notice('Copied. Paste them to whoever looks after this page.', null, 8);
          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('Copy these details:', text)); else prompt('Copy these details:', text);
        }]);
      }
    }
    let lastFrame = performance.now(), failures = 0;
    const loop = now => {
      requestAnimationFrame(loop);                         // (first: nothing that goes wrong below may end the animation)
      const dt = Math.min(0.1, (now - clock.last) / 1000);
      clock.last = now; clock.time += dt;
      if (document.hidden || lost || paceHold) { lastFrame = now; paceHold = false; if (document.hidden || lost) return; }
      if (params.scale == null && clouds.ready !== false && dynamic.frame((now - lastFrame) / 1000) !== null) resize();
      lastFrame = now;
      // Still crawling with the picture at its smallest: this device cannot draw the tier it was given. Start
      // again in the simplest one (once: pickTier reads the note left here).
      if (dynamic.crawling >= 2 && tierName !== 'low' && !params.tier) {
        dynamic.crawling = 0;
        try { sessionStorage.setItem('lr-tier', 'low'); } catch { /* no storage */ }
        notice('Too slow at this quality on this device: starting again with simpler graphics…');
        restart('This device is too slow for the simulation.');
        return;
      }
      // A fault in one frame costs that frame. The same fault frame after frame is told on the page, with what
      // it was (to pass on), and the page keeps trying.
      try { frame(dt); if (failures >= 30) notice(''); failures = 0; }
      catch (e) {
        note(String(e?.stack || e?.message || e).split('\n').slice(0, 3).join(' '));
        if (++failures === 30) notice(`The picture has stopped: ${String(e?.message || e).slice(0, 160)}`, ['Reload', () => location.reload()]);
      }
    };
    requestAnimationFrame(loop);
  }

  const api = {
    errors,
    /** For tests: where the beach umbrellas stand, and the ground and shore distance the CPU sees at a point. */
    /** For tests: the height of the waves arriving at a place, and how loud the reef is there. */
    seaAt: (x, z) => ({ ...seaAt(x, z) }),
    /** For tests: your own body (world/body.js), and where its shins stand in the water ([x, z (wrapped to 64 m), in water, speed]). */
    body, legs: () => shared.uLeg.value.map(v => v.toArray()),
    /**
     * For tests: the body model (world/figure.js) stood at rest `dist` metres ahead of you, turned by `turn`
     * degrees (0 = its back to you), to be looked at from outside. `dist` null puts it away again.
     */
    async inspectFigure(dist = 2.5, turn = 180, raise = 0) {
      if (!inspected) {
        inspected = new Figure(await loadFigure(manifest.compressed === 'gzip'), tier.fp.shadowTaps || 4); opaque.add(inspected.mesh);
        inspected.mesh.visible = true; await renderer.compileAsync(opaque, rig.camera);          // (or the first pictures are taken before its shader is ready)
      }
      inspected.mesh.visible = dist !== null;
      if (dist === null) return null;
      const yaw = walker.yaw, wx = rig.eye.x + Math.sin(yaw) * dist, wz = rig.eye.z - Math.cos(yaw) * dist;
      inspected.place(Math.sin(yaw) * dist, footing.heightAt(wx, wz) + raise, -Math.cos(yaw) * dist, yaw + turn * Math.PI / 180);
      return { vertices: inspected.info.vertices, bones: inspected.bones.length, eyeHeight: inspected.info.eyeHeight };
    },
    /** For tests: where the body's own frame stands in the world (x, z): under the eye, less the head's sway. */
    eyeXZ: () => [rig.eye.x - Math.cos(walker.yaw) * walker.sway, rig.eye.z - Math.sin(walker.yaw) * walker.sway],
    /** For tests: the ripples at a place: [height (m), speed, crossing]; how far your feet have sunk in the wash. */
    rippleAt: (x, z) => (ripples ? ripples.read(x, z) : null), sunk: () => sunk,
    /** For tests: the sand round you at a place: [height gained or lost (m), dampness, in transit (m), pressed]. */
    patchAt: (x, z) => (patch ? patch.read(x, z) : null),
    /** For tests: whether you have the real body, and its size. */
    figure: () => (figure ? { vertices: figure.info.vertices, eyeHeight: figure.info.eyeHeight, stand: walker.stand, crouch: walker.crouch } : null),
    /** For tests: what your hand is doing (see world/hand.js). */
    hand: () => ({ ik: hand.ik, lift: hand.lift, grip: hand.grip, amount: hand.amount, open: hand.open, rates: hand.rates.slice(), kind: hand.kind, down: hand.down, marks: shared.uTouchCount.value, wet: hand.wet, sand: hand.sand, heap: hand.mesh.visible,
      stamps: shared.uTouchInfo.value.slice(0, shared.uTouchCount.value).map((v, i) => ({ kind: v.y, a: v.z, b: v.w, age: clock.time - v.x, x: shared.uTouchSeg.value[i].x, z: shared.uTouchSeg.value[i].y })) }),
    shadowsOff(off) { shadows.enabled = !off && tier.fp.shadowMap > 0; },
    /** For tests: the kinds of small things scattered near the eye (world/scatter.js), to switch one off and see what it drew. */
    life,
    umbrellas: landmarks.umbrellas,
    /** For tests: where the surf you hear is coming from ([{ x, z, hs, dist, bearing }]). */
    shoresHeard: () => soundScene(1).shores.map(q => ({ ...q })),
    /** For tests: where the statue stands and where the turtle is now. */
    statue: statue ? { ...statue.userData.world, depth: statue.userData.depth } : null,
    turtleAt: () => (turtle.mesh ? turtle.at(clock.time, shared.uSeaLevel.value) : null),
    /** Renders a few scenes of sound offline and measures them: [{ name, rms, peak, bad }]. */
    async soundCheck() {
      const shore = (hs, dist) => [{ x: 10, z: 20, hs, dist, bearing: 0.4 }, { x: 19, z: 20, hs, dist: dist + 4, bearing: -0.6 }];
      const base = { shores: [], reef: 0, wind: 0, rain: 0, under: false, depth: 0, speed: 0, day: false };
      const scenes = {
        'quiet inland, no wind': [() => ({ ...base })],
        'small waves at 4 m': [t => ({ ...base, time: t, shores: shore(0.1, 4), wind: 5 })],
        'lively waves at 2 m': [t => ({ ...base, time: t, shores: shore(0.3, 2), wind: 8 })],
        'strong wind, far from the sea': [() => ({ ...base, wind: 13 })],
        'reef and squall': [() => ({ ...base, reef: 1, rain: 1, wind: 11 })],
        'walking on dry sand': [() => ({ ...base }), [0.6, 1.1, 1.6, 2.1, 2.6].map((t, i) => [t, { depth: 0, wet: 0, side: i & 1 }])],
        'walking on wet sand': [() => ({ ...base }), [0.6, 1.1, 1.6, 2.1, 2.6].map((t, i) => [t, { depth: 0, wet: 1, side: i & 1 }])],
        'walking on a pier': [() => ({ ...base }), [0.6, 1.1, 1.6, 2.1, 2.6].map((t, i) => [t, { side: i & 1, surface: 'wood' }])],
        'wading knee deep': [() => ({ ...base, depth: 0.45, speed: 0.8 }), [0.6, 1.3, 2.0, 2.7].map((t, i) => [t, { depth: 0.45, wet: 1, side: i & 1 }])],
        'under water': [t => ({ ...base, time: t, shores: shore(0.3, 2), under: true })],
      };
      const out = [];
      for (const [name, [scene, steps]] of Object.entries(scenes)) out.push({ name, ...await measure(3.5, scene, steps || []) });
      return out;
    },
    sound,
    groundAt: (x, z) => ({ height: ground.heightAt(x, z), shore: ground.shoreAt(x, z), land: ground.coverAt('land', x, z, []), benthic: ground.coverAt('benthic', x, z, []) }),
    /**
     * For tests and screenshots. { cam: {x, z, dist, yaw, pitch, fov}, time (wave clock, s), hours (local), month (0-11),
     * weather, wind (m/s), sun: {azimuth, elevation}|null, seaLevel, exposure, compare (0..1 or -1), show: {water, terrain} }
     */
    async setState(s = {}) {
      if (s.cam) { app.setWalk(false); rig.cancelFlight(); rig.set(s.cam); }
      if (s.time !== undefined) clock.time = s.time;
      if (s.seaLevel !== undefined) env.seaLevelOverride = s.seaLevel;
      if (s.show) { if (s.show.water !== undefined) water.mesh.visible = s.show.water; if (s.show.terrain !== undefined) terrain.mesh.visible = s.show.terrain; }
      if (s.exposure !== undefined) env.exposure = s.exposure;
      if (s.debug !== undefined) shared.uDebug.value.set(s.debug, 0, 0, 0);
      for (const k of ['hours', 'month', 'weather']) if (s[k] !== undefined) env[k] = s[k];
      if (s.wind !== undefined) env.windOverride = s.wind;
      if (s.cloud !== undefined) env.cloudOverride = s.cloud;
      if (s.sun !== undefined) env.sunOverride = s.sun;
      applyEnv();
      // walk: a first-person pose (see app.setWalk), set at once; false leaves first person. After the
      // environment, because the pose depends on the sea level.
      if (s.walk !== undefined) { if (s.walk) app.setWalk(true, s.walk, true); else app.setWalk(false); }
      // stroll: { seconds, input, turn (degrees), pitch }: walk on from the pose, then turn and look (to see the prints left).
      if (s.stroke !== undefined) walker.stroke = s.stroke * 2 * Math.PI;      // (place in the swimming stroke, 0..1)
      // soaked: { to: metres above your feet, amount: 0..1 }: as if you had just waded that deep (for pictures).
      if (s.soaked !== undefined) Object.assign(soak, s.soaked ? { high: s.soaked.to, amount: s.soaked.amount ?? 1, sand: s.soaked.sand ?? 0 } : { high: 0, amount: 0, now: 0, nowAmount: 0, sand: 0 });
      // touch: { seconds, turn (degrees a second) }: crouch, put your hand down and draw it along for that long (for pictures).
      if (s.touch) { api.run(0.7, { down: true }); api.run(0.4, { down: true, hand: true }); api.run(s.touch.seconds ?? 1.2, { down: true, hand: true }, s.touch.turn ?? 0, s.touch.nod ?? 0); if (s.touch.then) api.run(s.touch.then.seconds ?? 1, { down: true, hand: true }, s.touch.then.turn ?? 0, s.touch.then.nod ?? 0);
        // (release: let go and watch it run out for that long, crouched still, or standing up with it.)
        if (s.touch.release) api.run(s.touch.release, { down: !s.touch.stand, ...(s.touch.open !== undefined ? { open: s.touch.open } : {}) }, 0, s.touch.look ?? 0); }
      if (s.stroll) {
        // (With every frame drawn: the sand you walk on is pressed by the body as it is posed in each.)
        api.run(s.stroll.seconds, s.stroll.input || { fwd: 1 });
        if (s.stroll.wait) clock.time += s.stroll.wait;       // (then stand a while: prints dry, waves come and go)
        walker.yaw += (s.stroll.turn || 0) * Math.PI / 180;
        if (s.stroll.pitch !== undefined) walker.look = s.stroll.pitch * Math.PI / 180;
      }
      if (s.compare !== undefined) await app.setCompare(s.compare);
      syncPanel?.(status);
    },
    getState: () => ({ cam: rig.get(), mode: rig.mode, sitting: walker.sitting, walk: { x: walker.x, z: walker.z, yaw: walker.yaw * 180 / Math.PI, look: walker.look * 180 / Math.PI, eye: walker.eyeY - shared.uSeaLevel.value, depth: walker.depth, diving: walker.diving, afloat: walker.afloat }, time: clock.time, env: { ...env }, status: { ...status } }),
    /**
     * Runs the whole simulation (walking, sound scene, drawing) for `seconds` of its own time, as fast as the
     * machine goes: the long-run test (tools/soak.mjs). `turn` (degrees a second) swings your heading as you go,
     * `nod` raises your look.
     */
    run(seconds, input = {}, turn = 0, nod = 0) {
      const gl = renderer.getContext(), px = new Uint8Array(4), held = walkInput;
      walkInput = { read: () => ({ ...NO_INPUT, ...input }) }; paceHold = true;
      try {
        for (let i = 0, n = Math.round(seconds * 60); i < n; i++) {
          clock.time += 1 / 60; walker.yaw += turn * Math.PI / 180 / 60; walker.look = Math.min(1.5, Math.max(-1.5, walker.look + nod * Math.PI / 180 / 60));
          frame(1 / 60);
          // (Reading a pixel back makes the GPU catch up, so that the queue of work does not grow without limit.)
          if (i % 20 === 19) { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        }
      } finally { walkInput = held; }
      return frames;
    },
    /** Advances first person by `seconds` with a fixed input ({ fwd, right, run, down, up }), in 1/60 s steps: for tests. */
    walkFor(seconds, input = {}) { for (let t = 0; t < seconds; t += 1 / 60) { clock.time += 1 / 60; for (const step of walker.step(1 / 60, { ...NO_INPUT, ...input })) stamp(step); } },
    flyTo: id => { const p = places.find(q => q.id === id); if (p) app.flyToPlace(p); return !!p; },
    /** Jumps straight to a place's camera shot (no flight). */
    goTo: id => { const p = places.find(q => q.id === id); if (p) { app.setWalk(false); rig.cancelFlight(); rig.set(shotFor(p)); } return !!p; },
    renderOnce(dt = 0) { frame(dt); },
    /** Renders a frame and returns it as a PNG data URL. */
    capture() { frame(0); return canvas.toDataURL('image/png'); },
    /** Average milliseconds per frame over n frames, each finished on the GPU before the next starts. */
    /** Mean milliseconds a frame over n frames. `live`: with time passing (the simulations near you run too: sand, ripples, what you hold). */
    bench(n = 60, live = false) {
      // Reading a pixel back is what really waits for the GPU (gl.finish returns early in Chromium).
      const gl = renderer.getContext(), px = new Uint8Array(4);
      const sync = () => { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      frame(0); sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { clock.time += 1 / 60; frame(live ? 1 / 60 : 0); sync(); }
      return (performance.now() - t0) / n;
    },
    info() {
      const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        tier: tierName, data: manifest.version, reversedDepth: R.reversed,
        gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        size: { ...R.size }, dynamicScale: dynamic.scale, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        frames, time: clock.time, memory: { ...renderer.info.memory }, contextLost: gl.isContextLost(), mode: rig.mode, sound: !!sound.on, soundState: sound.ctx?.state || 'none', soundError: sound.error || null, software, pace: dynamic.pace, nearestBird: birds.nearest,
        terrain: terrain.clipmap.stats, water: water.clipmap.stats, programs: renderer.info.programs?.length,
        places: places.map(p => p.id), labels: (features.labels || []).length, boats: boats.count, birds: birds.count, landmarks: landmarks.group.children.length,
      };
    },
  };
  frame(0);
  return api;
}
