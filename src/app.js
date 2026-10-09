// The application: loads the data, owns the frame loop and the environment state (time, month, weather),
// wires up the controls, and exposes the test API (window.__LR).
import { TIERS, isSoftware, params, pickTier } from './config.js';
import { registerChunks } from './core/chunks.js';
import { createRenderer } from './core/renderer.js';
import { FrameGraph, FullscreenPass } from './core/framegraph.js';
import { DynamicResolution } from './core/perf.js';
import { CHUNK_UNIFORMS, shared, uniformsFor } from './core/uniforms.js';
import { loadData } from './data/loader.js';
import { Ground } from './data/geoCPU.js';
import { CameraRig, attachOrbitInput } from './camera/rig.js';
import { OVERVIEW, shotFor, walkSpotFor } from './camera/bookmarks.js';
import { Walker, attachWalkInput, buildingBlocker } from './camera/walk.js';
import { BOOM } from './camera/boom.js';
import { proportions, setProportions } from './world/bodyshape.js';
import { Gait } from './world/gait.js';
import { Spray } from './world/spray.js';
import { Falling } from './world/falling.js';
import { Hand } from './world/hand.js';
import { Figure, loadFigure } from './world/figure.js';
import { FigureRig } from './world/figurepose.js';
import { clearance, handsApart, mixPose, slerpFrame, ATTITUDES } from './world/handpose.js';
import { SandPatch } from './sim/patch.js';
import { Ripples } from './sim/ripples.js';
import { SkinState } from './sim/skin.js';
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
import { noiseTile, ragged, shoreCrest, swashPhase } from './data/shoreCPU.js';
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
const NO_INPUT = { fwd: 0, right: 0, run: false, down: false, up: false, hand: false, hand2: false, sit: false };

export async function start(canvas, onProgress = () => {}) {
  const errors = [];
  // (A fault that repeats every frame must not fill the memory with its own report.)
  const note = text => { if (errors.length < 40) errors.push(text); };
  addEventListener('error', e => note(String(e.message || e.error)));
  addEventListener('unhandledrejection', e => note(String(e.reason?.message || e.reason)));

  // (When you stepped in from the opening screen; with no opening screen, at the start.)
  let entered = params.freeze || !params.ui || params.intro === '0' ? performance.now() : 0, trialOn = false;
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
  let figure = null, figureRig = null, patch = null, pressing = null, ripples = null, crossing = null, skin = null;
  // How far your feet have sunk as the wash drew the sand from under them (metres), and how the water runs past you (m/s).
  let sunk = 0;
  const told = { crouch: false, sit: false };
  // Sitting: how far your legs are drawn up (0..1), how wide your feet (0..1), and your toes (radians, curling).
  const seated = { draw: 0, splay: 0, wiggle: 0, lean: 0.22 };
  const flow = [0, 0];
  const figureReady = tierName === 'low' || params.tubes ? Promise.resolve(false) : loadFigure(manifest.compressed === 'gzip').then(data => {
    const u = body.mesh.material.uniforms;
    figure = new Figure(data, tier.fp.shadowTaps || 4, { uBodyWet: u.uBodyWet, uBodySand: u.uBodySand, uHandWet: u.uHandWet, uHandSand: u.uHandSand, uHandWetL: u.uHandWetL, uHandSandL: u.uHandSandL }); figureRig = new FigureRig(data.info);
    // (The round rods that stand for the skin of her fingers, measured from the mesh: to tell how far apart they are.)
    figureRig.fitHands(data.arrays);
    const p = figureRig.proportions, was = walker.stand;
    // (The solver is given her hands with her proportions: a hand's pose is then every joint of it. And each
    // of your hands is given its own, to hold itself by.)
    setProportions({ ...p, hands: figureRig.models }); hand.model = figureRig.models[1]; handL.model = figureRig.models[0];
    // (Squatting on her heels, leaning forward a little, her eyes are at a little over half her height: lower, and
    // the knees have to fold further than knees do, 160 degrees and more.)
    Object.assign(walker, { stand: p.stand, crouch: 0.54 * p.stand, sit: 0.095 + 0.985 * p.torso + p.eyeToShoulder, legs: (p.thigh + p.shin) / 0.87 });
    gait.prop = { hip: p.hip, ankle: p.ankle, leg: p.thigh + p.shin };
    if (walker.body >= was - 0.01) { walker.eyeY += p.stand - walker.body; walker.body = p.stand; }
    opaque.add(figure.mesh, figure.cloth, figure.hair, figure.face.eyes, figure.face.hairs);
    // The sand round you as real sand: your body presses into it (sim/patch.js).
    if (tier.fp.patch && !params.stamps) { patch = new SandPatch(renderer, tier.fp.patch); pressing = patch.toolMaterial(figure.mesh.material.uniforms.tBones);
      ripples = new Ripples(renderer, patch, 512); crossing = ripples.crossMaterial(figure.mesh.material.uniforms.tBones);
      // What is on your skin, where it is (sim/skin.js): the figure's shader reads it.
      skin = new SkinState(renderer, patch, figure.mesh.material.uniforms.tBones); figure.mesh.material.uniforms.tSkinState = skin.uniform; }
    return true;
  }).catch(e => { note(`the body model did not load: ${e?.message || e}`); return false; });
  const spray = new Spray();
  // What falls from your hands, grain by grain, laid over the finished picture (world/falling.js).
  const falling = tier.fp.grains ? new Falling(tier.fp.grains, tier.fp.grainShare) : null, overlay = new THREE.Scene();
  overlay.matrixWorldAutoUpdate = false;
  if (falling) overlay.add(falling.mesh);
  let pools = false;
  // Whether the sand at (x, z), ground height g, is wet from the waves: under the height the swash reaches there.
  // (As lr_shore's lrBeach has it, without the ragged edge: on a beach face the waves climb to their run-up; over
  // flat sand a sheet runs on a few metres and dies, so the middle of a wide bar is dry though it is low.)
  const wetSandAt = (x, z, g) => {
    const a = Math.max(g - shared.uSeaLevel.value, 0), ease = (lo, hi, v) => { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
    let R = runup(seaAt(x, z).hs);
    const flat = Math.max(-ground.shoreAt(x, z) - a / 0.08, 0), run = (R / 0.11 + 0.3) * (1 + 3 * (1 - ease(0.03, 0.2, a / Math.max(R, 1e-4))));
    // (Over a flat the sheet's reach is ragged, tongues and bays a few steps wide: the same ones as the picture
    // has, lrBeach. Without them here the darker patches on top of the bar were wet sand to the eye and dry sand
    // to everything else: deep prints, the sound of dry sand, a dry handful.)
    const px = ((x % 1024) + 1024) % 1024, pz = ((z % 1024) + 1024) % 1024;
    R *= 1 - ease(1.2 * run, 3 * run, flat + ease(0, 1, flat) * 3.8 * ragged(x, z));
    return a < (R * (1 + 0.05 * noiseTile(px * (445 / 1024), pz * (445 / 1024), 445)) + 0.02) * ease(0, 0.01, R);
  };
  // Your right hand, taking up sand and water and letting them run out between the fingers (world/hand.js).
  const handParts = { spray, falling, sound: { touch: (kind, how, speed) => sound.touch(kind, how, speed) }, shadowTaps: tier.fp.shadowTaps, patch: () => patch,
    ring: (x, z, when, strength) => (ripples ? ripples.drop(x, z, when, strength, 0.022) : shared.uRing.value[rings++ % 6].set(wrap64(x), wrap64(z), when, strength)) };
  // (Your right hand: the mouse button. Your left: the other button, or F. Each takes, holds and pours its own.)
  const hand = new Hand(handParts), handL = new Hand({ ...handParts, side: -1, sound: { touch: (kind, how, speed) => sound.touch(kind, how, speed, -1) } });
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
  opaque.add(terrain.mesh, landmarks.group, boats.group, birds.group, body.mesh, body.headMesh, lifeGroup, spray.points, hand.mesh, hand.streams, hand.lying, handL.mesh, handL.streams, handL.lying);
  overlay.add(hand.pool, handL.pool); pools = true;
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
  let prints = 0, carved = -9, hidePatch = false;
  // (Where each of those prints is in the world, and whether the patch of real sand has lost it: see the frame.)
  const marks = [];
  const wrap64 = v => ((v % 64) + 64) % 64;
  let rings = 0;
  /** Whether your feet are wet (from the water you stood in a little while ago). */
  const feetWet = () => Math.max(soak.amount * (soak.high > 0.02 ? 1 : 0), soak.nowAmount) > 0.2;
  function stamp(step) {
    // (Wet feet pick up sand at every step on the dry beach; the sea washes it off again.)
    if (step.depth < 0.02 && !onDeck(step.x, step.z) && feetWet()) soak.sand = Math.min(1, soak.sand + 0.3);
    // (On a pier: the knock of boards, and no prints in the sand below.)
    if (onDeck(step.x, step.z) && step.depth < 0.03) { sound.step({ side: step.side, surface: 'wood' }); return; }
    // (Wet sand as everything else has it: the same patches as the picture shows.)
    const wetSand = wetSandAt(step.x, step.z, ground.heightAt(step.x, step.z));
    sound.step({ depth: step.depth, side: step.side, wet: wetSand ? 1 : 0 });
    // Where that foot came down: under the foot itself as it was posed a moment ago (the middle of the sole is
    // 6 cm ahead of the ankle), or, when nothing is being drawn (a test walking on fast), a hip's width to the
    // side and ahead of you by the reach of the pace.
    // (A footfall from the gait is the middle of that sole, where it is.)
    const fresh = frames - posedAt <= 1 ? body.joints?.ankles : null, cy = Math.cos(step.yaw), sy = Math.sin(step.yaw);
    const px = step.x, pz = step.z, pace = Math.min(step.stride ?? 1, 1.6);
    if (step.depth > 0.03) {
      // Wading: each pace sends a ring out over the water, and throws up drops where the foot goes in.
      if (ripples) ripples.drop(px, pz, clock.time, Math.min(1.6, 0.7 + step.depth * 3), 0.07);
      else shared.uRing.value[rings++ % 6].set(wrap64(step.x), wrap64(step.z), clock.time, Math.min(1, 0.4 + step.depth * 2));
      if (fresh) spray.burst(wrap64(px), ground.heightAt(px, pz) + step.depth, wrap64(pz), clock.time, [-sy, cy], Math.round((6 + 10 * pace) * Math.min(1, step.depth / 0.1)), true, 0.6 + 0.4 * pace);
      return;
    }
    // On dry sand the other foot, pushing off a tenth of a second from now, flicks grains back from under its toes.
    const pushing = fresh ? gait.feet[1 - step.side] : null;
    if (pushing && !wetSand && pace > 0.5) {
      const wx = pushing.x + Math.sin(pushing.yaw) * 0.13, wz = pushing.z - Math.cos(pushing.yaw) * 0.13;
      spray.burst(wrap64(wx), ground.heightAt(wx, wz), wrap64(wz), clock.time + 0.1 / Math.max(pace, 0.5), [-sy, cy], Math.round(3 + 8 * pace), false, 0.45 + 0.55 * pace);
    }
    shared.uFoot.value[prints % 24].set(wrap64(px), wrap64(pz), Math.atan2(sy, cy) + (feetWet() ? 64 : 0), clock.time);
    marks[prints % 24] = { x: px, z: pz, yaw: Math.atan2(sy, cy), wet: wetSand, away: false, side: step.side ? 1 : -1 };
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
  // (What the camera behind her keeps clear of: the sand, a deck, and the sea as it is drawn, waves and all.)
  rig.floorAt = (x, z) => ({ ground: footing.heightAt(x, z), sea: surfaceAt(x, z) });
  /** How much of her head is drawn: none from inside it (her own eyes), all of it from a forearm's length off; between, it thins out. */
  const headSeen = () => (rig.outside ? 1 : Math.min(1, Math.max(0, (rig.away - BOOM.headNear[0]) / (BOOM.headNear[1] - BOOM.headNear[0]))));
  /** (What her eyes' small movements and the gaps between her blinks are drawn from: the same each time for a test that seeds it.) */
  let faceSeed = 12345;
  const faceRandom = () => (faceSeed = (Math.imul(faceSeed, 1664525) + 1013904223) >>> 0) / 4294967296;
  /** And of her hair, which comes in with it. */
  const hairSeen = () => (rig.outside ? 1 : Math.min(1, Math.max(0, (rig.away - BOOM.headNear[0]) / (BOOM.headNear[1] + 0.05 - BOOM.headNear[0]))));
  /** How wet her hair is, 0..1: soaked the moment her head goes under, dry again in about three minutes (sooner in a wind). */
  let hairWet = 0;
  const wetHair = dt => { hairWet = walker.under ? 1 : Math.max(0, hairWet - dt / (200 / (1 + 0.08 * waves.wind.speed))); return hairWet; };
  // Your feet (world/gait.js): each planted where it was put, or on its way to the next place. And you, as last
  // posed: where the body's own frame stands in the world (x, z, the height of the ground it stands on), which
  // way it faces, how far the hips are down for the legs to reach (`dip`), where the ground under your weight
  // is in that frame (`home`). `on`: on your feet or seated, as against swimming.
  walker.gaited = true;
  const gait = new Gait((p => ({ hip: p.hip, ankle: p.ankle, leg: p.thigh + p.shin }))(proportions()));
  const you = { on: false, was: '', x: 0, y: 0, z: 0, cy: 1, sy: 0, heading: 0, dip: 0, home: [0, 0, 0.08], folded: false, eyeUp: 1.5, reachable: null };
  const toWorld = q => [you.x + q[0] * you.cy - q[2] * you.sy, you.y + q[1], you.z + q[0] * you.sy + q[2] * you.cy];
  /**
   * The height of the sea's surface where any of you is in it this very moment (far below when none of you is):
   * under your weight, at each ankle and at each wrist. (Not the walker's own idea of it, which follows the
   * sea a quarter of a second late and only where you stand: a wave running in over your feet, or the wash
   * over your heels when you sit above it, was water your feet were not yet "in", and it was painted over them.)
   */
  function waterOver() {
    let high = -1e9;
    const at = (x, z) => { const s = surfaceAt(x, z); if (s - footing.heightAt(x, z) > 0.003) high = Math.max(high, s); };
    at(walker.x, walker.z);
    for (const p of [...(body.joints?.ankles || []), ...(body.joints?.wrists || [])]) { const w = toWorld(p); at(w[0], w[2]); }
    return high;
  }
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
      hand.reset(); handL.reset(); patch?.reset(); ripples?.reset(); skin?.reset(); sunk = 0; Object.assign(seated, { draw: 0, splay: 0, wiggle: 0 });
      if (!on) {
        sound.stop();
        if (rig.mode === 'walk') { rig.setMode('orbit'); walkInput?.release(); }
        rig.behind.set(false, true);
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
        // (A link, or a test, may put you down already seeing yourself from behind.)
        if (spot.third !== undefined) rig.behind.set(!!spot.third, true);
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
    /** Seeing yourself from behind (true), or through your own eyes; `now`: without the glide between them. */
    setThird(on, now = false) { if (rig.mode !== 'walk') return; rig.behind.set(on, now); status.third = !!on; saveHash(); },
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
    // (A fifth number, 3: seeing yourself from behind.)
    if (rig.mode === 'walk') h.set('p', [walker.x.toFixed(1), walker.z.toFixed(1), (walker.yaw * 180 / Math.PI).toFixed(0), (walker.look * 180 / Math.PI).toFixed(0), ...(rig.behind.want ? [3] : [])].join(','));
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
    // p = a first-person spot: x, z, heading, look (degrees); and 3 if you were seeing yourself from behind.
    const w = (h.get('p') || '').split(',').map(Number);
    if (w.length >= 3 && w.every(Number.isFinite)) { walkLink = { x: w[0], z: w[1], yaw: w[2], pitch: w[3] ?? -4, third: w[4] === 3 }; return true; }
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

  // Between swimming and standing your body goes over from the one pose to the other in half a second: your legs
  // come down under you and your arms in from the stroke as the sea sets you on your feet, and the other way as
  // it lifts you off them. (Your eye already did; your body was one pose in one frame and the other in the next.)
  // The two are posed in different frames (standing: from your feet, facing as your body faces; swimming: from
  // your eye, facing as you look), so both are put in one form and the swimmer is brought into the frame of the
  // one who stands.
  const going = { a: new THREE.Matrix4(), b: new THREE.Matrix4(), e: new THREE.Euler(), v: new THREE.Vector3() };
  const frameOf = (m, f) => { going.e.set(f.pitch || 0, -f.yaw, 0, 'YXZ'); return m.makeRotationFromEuler(going.e).setPosition(f.x, f.y, f.z); };
  const LIMBS = ['hips', 'knees', 'ankles', 'shoulders', 'elbows', 'wrists'], unitOf = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  /** The joints the rig needs, in one form for either pose. */
  function inForm(j) {
    const out = { hip: j.hip.slice(), shoulder: (j.shoulder || j.chest).slice(), eye: (j.eye || [0, 0, 0]).slice(), pelvis: j.pelvis || 0, headTurn: j.headTurn || 0, headNod: j.headNod || 0, feet: j.feet?.length ? j.feet.map(f => ({ ...f })) : null, drawn: j.drawn };
    for (const name of LIMBS) out[name] = j[name].map(q => q.slice());
    out.hands = j.wrists.map((w, i) => {
      const h = j.hands?.[i];
      if (h) return { ...h, f: h.f.slice(), N: h.N.slice() };
      // (As the rig holds a swimmer's hand: along the forearm, palm down.)
      const f = unitOf([w[0] - j.elbows[i][0], w[1] - j.elbows[i][1], w[2] - j.elbows[i][2]]), k = -f[1];
      return { f, N: unitOf([-f[0] * k, -1 - f[1] * k, -f[2] * k]), curl: 0.1, spread: 0 };
    });
    return out;
  }
  /** A pose in the frame `from` (x, y, z, yaw, pitch), as it is in the frame `to`. */
  function moved(j, from, to) {
    const m = going.a.copy(frameOf(going.b, to)).invert().multiply(frameOf(going.b, from)), v = going.v;
    const at = q => { v.set(q[0], q[1], q[2]).applyMatrix4(m); return [v.x, v.y, v.z]; }, way = q => { v.set(q[0], q[1], q[2]).transformDirection(m); return [v.x, v.y, v.z]; };
    const out = { ...j, hip: at(j.hip), shoulder: at(j.shoulder), eye: at(j.eye), headTurn: j.headTurn + Math.atan2(Math.sin(from.yaw - to.yaw), Math.cos(from.yaw - to.yaw)) };
    for (const name of LIMBS) out[name] = j[name].map(at);
    out.hands = j.hands.map(h => ({ ...h, f: way(h.f), N: way(h.N) }));
    return out;
  }
  function mixForms(a, b, k) {
    const mix = (q, r) => [q[0] + (r[0] - q[0]) * k, q[1] + (r[1] - q[1]) * k, q[2] + (r[2] - q[2]) * k], num = (q, r) => q + (r - q) * k, near = k < 0.5 ? a : b;
    const out = { hip: mix(a.hip, b.hip), shoulder: mix(a.shoulder, b.shoulder), eye: mix(a.eye, b.eye), pelvis: num(a.pelvis, b.pelvis), headTurn: num(a.headTurn, b.headTurn), headNod: num(a.headNod, b.headNod), feet: near.feet, drawn: near.drawn };
    for (const name of LIMBS) out[name] = a[name].map((q, i) => mix(q, b[name][i]));
    // (A hand goes from the one way of holding it to the other by one turn, and its joints each by their own way:
    // a swimmer's hand has no pose of its own, only how far it is curled, and takes the pose that stands for.)
    const jointsOf = (h, i) => h.fingers || (figureRig ? figureRig.models[i].fromCurl(h.curl ?? 0.1, h.spread || 0) : null);
    out.hands = a.hands.map((h, i) => { const g = b.hands[i], [f, N] = slerpFrame(h.f, h.N, g.f, g.N, k), hf = jointsOf(h, i), gf = jointsOf(g, i); return { ...(k < 0.5 ? h : g), f, N, curl: num(h.curl ?? 0.1, g.curl ?? 0.1), spread: num(h.spread || 0, g.spread || 0), ...(hf && gf ? { fingers: mixPose(hf, gf, k) } : {}) }; });
    return out;
  }
  /**
   * What of you to draw this frame: `joints` as posed, `kind` 'stand' or 'swim', in `frame` (x, y, z relative to
   * the camera, yaw, pitch). Returns { joints, frame, raw }: `raw` when it is the pose as posed, in its own frame;
   * else a pose part of the way over from the last one, in the frame it is to be placed in.
   */
  function goingOver(dt, joints, kind, frame) {
    const own = [rig.own.x - rig.eye.x, rig.own.y, rig.own.z - rig.eye.z], live = inForm(joints), b = you.blend ??= { kind: null, k: 1, from: null, last: null };
    // (Put down somewhere: you are there as you are, at once.)
    if (you.cut || !b.kind) { b.kind = kind; b.k = 1; b.from = null; you.cut = false; }
    if (b.kind !== kind) { b.from = b.last; b.kind = kind; b.k = b.from ? 0 : 1; }
    if (dt > 0 && b.k < 1) b.k = Math.min(1, b.k + dt / 0.5);
    let out = { joints, frame, raw: true };
    if (b.k < 1 && b.from) {
      // (The pose you were in comes along with your eye, as it was.)
      const k = b.k * b.k * (3 - 2 * b.k), was = { ...b.from.frame, x: own[0] + b.from.rel[0], y: own[1] + b.from.rel[1], z: own[2] + b.from.rel[2] };
      out = kind === 'stand' ? { joints: mixForms(moved(b.from.j, was, frame), live, k), frame, raw: false } : { joints: mixForms(b.from.j, moved(live, frame, was), k), frame: was, raw: false };
    } else b.from = null;
    b.last = { j: out.raw ? live : out.joints, frame: { ...out.frame }, rel: [out.frame.x - own[0], out.frame.y - own[1], out.frame.z - own[2]] };
    return out;
  }

  /**
   * You move on by dt: the walker (where you are going), your feet (the gait), and your body posed over them.
   * It is done before the camera is set, because your eye is the posed body's eye.
   */
  function advance(dt, input) {
    walker.step(dt, hand.low || handL.low ? { ...input, atWork: Math.max(hand.low, handL.low) } : input);          // (its own footfalls are not used: the gait says when a foot comes down)
    walker.head = null;
    if (walker.placed) you.cut = true;
    // Where your eye is afloat (the walker's own place), and how far you are on your feet: 0 swimming .. 1
    // standing, half a second from the one to the other. Standing, your eye is the posed body's, a hand's
    // breadth from the walker's place: as the sea lifts you off your feet or sets you down, your eye goes over
    // from the one to the other (it jumped 15 cm in a frame, each time).
    const floatAt = [walker.x + Math.cos(walker.yaw) * walker.sway, walker.eyeY + walker.bob, walker.z + Math.sin(walker.yaw) * walker.sway];
    const swimming = walker.afloat || walker.diving;
    // (Put down somewhere at once: you are standing there, or swimming there, from the first moment.)
    if (walker.placed) { you.grounded = swimming ? 0 : 1; you.headOff = null; }
    if (dt > 0) you.grounded = Math.min(1, Math.max(0, (you.grounded ?? (swimming ? 0 : 1)) + (swimming ? -dt : dt) / 0.5));
    const stood = (k => k * k * (3 - 2 * k))(you.grounded ?? (swimming ? 0 : 1));
    if (swimming) {
      you.on = false;
      if (stood > 0 && you.headOff && !walker.placed) walker.head = { x: floatAt[0] + you.headOff[0] * stood, y: floatAt[1] + you.headOff[1] * stood, z: floatAt[2] + you.headOff[2] * stood };
      else you.headOff = null;
      walker.placed = false;
      return;
    }
    const heading = walker.heading, cy = Math.cos(heading), sy = Math.sin(heading), feetY = walker.eyeY - walker.body, deck = onDeck(walker.x, walker.z);
    const turn = Math.atan2(Math.sin(walker.yaw - heading), Math.cos(walker.yaw - heading)), state = walker.sitting ? 'sit' : 'stand';
    // (Put down somewhere, come out of the water, sat down or got up: your feet are under you.)
    if (!you.on || walker.placed || (you.was === 'sit' && state === 'stand')) { gait.reset(walker.x, walker.z, heading); you.dip = you.dipV = you.deep = you.deepS = you.peak = you.shallow = 0; }
    you.was = state; walker.placed = false;
    // Your hand (world/hand.js): what it is to do this frame. It can go down to the ground when you are crouched
    // or seated, on sand or in water no deeper than your knee. (Its frame is the body's, as last posed.)
    const ox = walker.x - (you.home[0] * cy - you.home[2] * sy), oz = walker.z - (you.home[0] * sy + you.home[2] * cy);
    const settling = Math.max(0, walker.body - (walker.bodyWant ?? walker.body)) + (walker.sitting ? Math.abs(seated.lean - (seated.leanTo ?? seated.lean)) * 0.45 : 0);
    const reachable = { want: !!input.hand, open: input.open, openBy: input.openBy || 0, steerBy: input.steerBy || null, eyeAt: you.on ? you.eyeAt : null, headTurn: turn, going: Math.hypot(walker.vx, walker.vz), settling, sitting: walker.sitting, seated: walker.seated * walker.seated * (3 - 2 * walker.seated), low: walker.crouched, canReach: (walker.crouched > 0.8 || walker.sitting) && walker.depth < 0.5 && !deck, time: clock.time, look: walker.look, body: walker.body, feet: feetY,
      x: ox, z: oz, yaw: heading, cy, sy, surf: walker.surf, groundAt: (x, z) => footing.heightAt(x, z), wetAt: wetSandAt };
    // (Both hands holding something, held up: they come together.)
    if (dt > 0) you.together = (you.together || 0) + ((hand.lift > 0.3 && handL.lift > 0.3 && hand.amount > 0.004 && handL.amount > 0.004 ? 1 : 0) - (you.together || 0)) * (1 - Math.exp(-dt * 4));
    reachable.together = you.together || 0;
    const reach = hand.plan(dt, reachable), reachL = handL.plan(dt, { ...reachable, want: !!input.hand2 });
    // (A hand that holds something, its button held: the mouse is that hand's until you let go. camera/walk.js.)
    walkInput?.steering?.(hand.steering || handL.steering);
    // (Your weight presses a planted foot a centimetre or two into dry sand, less into wet.)
    const firm = walker.depth > 0.005 || wetSandAt(walker.x, walker.z, footing.heightAt(walker.x, walker.z)), sink = deck ? 0 : (firm ? 0.008 : patch ? 0.018 : 0.011) + sunk;
    const g = gait.update(dt, { x: walker.x, z: walker.z, heading, vx: walker.vx, vz: walker.vz, wish: walker.sitting ? null : walker.wish, crouch: walker.crouched, legs: walker.legs, base: feetY, groundAt: (x, z) => footing.heightAt(x, z), sink, hold: walker.sitting, time: clock.time,
      // (Your hip joints as last posed, carried on by how far you have come since.)
      hips: you.on && body.joints?.hips && !walker.sitting && walker.seated < 0.02 ? body.joints.hips.map(q => { const w = toWorld(q); return [w[0] + walker.vx * dt, w[1], w[2] + walker.vz * dt]; }) : null });
    // Your toes, standing: Space curls them up and digs them into the sand, as it does when you sit; and left to
    // themselves, standing a while, the toes of one foot and then the other lift and settle again every few
    // seconds, as bare feet do on sand. (They press what they touch: the patch of real sand takes their marks.)
    {
      const quiet = !walker.sitting && walker.seated < 0.02 && gait.still > 2.5 && walker.crouched < 0.3;
      const idle = i => { const u = ((clock.time + i * 4.3) / 9.2) % 1; return u < 0.1 ? 0.3 * Math.sin(Math.PI * u / 0.1) : u < 0.22 ? -0.14 * Math.sin(Math.PI * (u - 0.1) / 0.12) : 0; };
      you.toes ??= [0, 0];
      g.feet.forEach((f, i) => {
        const want = walker.sitting || !f.down || walker.crouched > 0.3 ? 0 : input.up && gait.still > 0.3 ? 0.4 * Math.sin(clock.time * 9 + i * 1.3) - 0.12 : quiet ? idle(i) : 0;
        if (dt > 0) you.toes[i] += (want - you.toes[i]) * (1 - Math.exp(-dt * 12));
        f.toes = you.toes[i];
      });
    }
    // (A test may put the eye lower than anyone can squat, to look at the sand: the body is then posed in its
    // deepest squat, for the shadow, and left out of the picture: it would be folded through the camera.)
    const eyeUp = Math.max(walker.body, walker.crouch - 0.13), folded = eyeUp > walker.body + 0.02, breath = Math.sin(clock.time * 1.45);
    // What sitting sounds like: the thump of your seat coming on to the sand, a shuffle as you scoot round, sand
    // falling from you as you get up.
    if (dt > 0) {
      const wet = wetSandAt(walker.x, walker.z, footing.heightAt(walker.x, walker.z)) ? 1 : 0, was = you.seatWas ?? 0, scooting = (walker.scootLeft || 0) > 0;
      if (was < 0.6 && walker.seated >= 0.6 && walker.sitting) sound.seat('down', wet);
      if (was > 0.85 && walker.seated <= 0.85 && !walker.sitting) sound.seat('up', wet);
      if (scooting && !you.scooting) sound.seat('scoot', wet);
      you.seatWas = walker.seated; you.scooting = scooting;
    }
    // Seated, the keys that walk you move your legs: S draws them up and W stretches them out, A / D bring your
    // feet together and apart, Space curls your toes.
    // (You sit leaning back a little on your hand; reaching for the sand beside you, you lean forward over it.)
    // (Eased both ways, like any movement of the trunk.)
    if (dt > 0) { const down = Math.max(reach ? reach.amount * (1 - (reach.lift || 0)) : 0, reachL ? reachL.amount * (1 - (reachL.lift || 0)) : 0), to = walker.sitting ? 0.22 - 0.34 * down : 0.22; seated.leanTo = to; seated.leanV = (seated.leanV || 0) + (36 * (to - seated.lean) - 12 * (seated.leanV || 0)) * dt; seated.lean += seated.leanV * dt; }
    if (walker.sitting && dt > 0) {
      seated.draw = Math.min(1, Math.max(0, seated.draw + input.fwd * -dt * 0.9)); seated.splay = Math.min(1, Math.max(0, seated.splay + input.right * dt * 0.9));
      seated.wiggle += ((input.up ? 0.45 * Math.sin(clock.time * 9) - 0.15 : 0) - seated.wiggle) * (1 - Math.exp(-dt * 12));
    }
    // Sitting down and getting up are movements, a second long: from a squat over your feet back on to your
    // seat, a hand going to the sand behind you and your legs out in front; and the same undone. (`seated`: how
    // far along; the two poses are mixed, joint by joint.)
    const k = walker.seated, eased = k * k * (3 - 2 * k), sit = { sit: true, eye: walker.sit, recline: seated.lean, hop: walker.scoot || 0, draw: seated.draw, splay: seated.splay, wiggle: seated.wiggle, breath, sink: deck ? 0 : 0.008 + sunk, touch: reach, touchL: reachL, turn, look: walker.look };
    // (Setting off, the hips come forward over the feet during the first pace, not in the first three frames; and
    // only as far as you are going forward: sideways or backward they stay over your feet.)
    if (dt > 0) { you.carryV = (you.carryV || 0) + (30 * ((g.amount || 0) * (g.along ?? 1) - (you.carry || 0)) - 11 * (you.carryV || 0)) * dt; you.carry = (you.carry || 0) + you.carryV * dt; }
    if (k >= 1) body.pose(sit);
    else body.pose({ gait: g, bank: walker.bank || 0, dip: you.dip, carry: you.carry || 0, turn, stride: walker.stride, eye: eyeUp, look: walker.look, wade: Math.min(1, Math.max(0, (walker.depth - 0.9) / 0.4)), breath, touch: reach, touchL: reachL, ...(k > 0 ? { seat: { ...sit, k: eased } } : {}) });
    const j = body.joints;
    // The hips ride down to each footfall and up over the standing leg, smoothly: as far down as the legs have
    // needed lately (`deep`), in time with the feet. (Left to the legs alone they came down all at once as the
    // heel reached out: five centimetres in four frames, a stamp at every pace.)
    if (dt > 0) {
      // (`deep`: the most they needed in the pace before this one. It was kept as a multiple of the pace squared
      // and remembered for twenty seconds: the first short pace from standing set it to its limit, and the
      // hips then rode ten centimetres down at every footfall, on knees bent to forty degrees.)
      const need = j.dipWant ?? 0; you.peak = Math.max(you.peak || 0, need);
      if (g.landed.length) { you.deep = you.peak; you.peak = need; you.since = 0; } else you.since = (you.since || 0) + dt;
      if (you.since > 1) you.deep = need;
      you.deep = Math.max(you.deep || 0, need);
      // (Taken up gradually: sideways, one pace asks for more than the next, and the wave's height jumped at each footfall.)
      you.deepS = (you.deepS || 0) + (you.deep - (you.deepS || 0)) * (1 - Math.exp(-dt * 7));
      // (`shallow`: the least they have needed lately, as you pass over the standing leg.)
      you.shallow = need < (you.shallow || 0) ? need : (you.shallow || 0) + (need - (you.shallow || 0)) * Math.min(1, dt / 0.6);
      const want = j.dipWant === undefined ? 0 : Math.max(need, you.shallow + (Math.max(you.deepS, you.shallow) - you.shallow) * (g.beat || 0));
      // (Followed as a sprung weight follows, not at once: quicker down, when a leg needs it, than up.)
      // (Up again briskly when you are walking forward at a steady pace, as the leg straightens under you; more gently otherwise.)
      { const w = want > you.dip ? 30 : 24 + 14 * (g.along ?? 1) * (you.carry || 0); you.dipV = (you.dipV || 0) + (w * w * (want - you.dip) - 2 * w * (you.dipV || 0)) * dt; you.dip = Math.max(0, you.dip + you.dipV * dt); }
    }
    // Where that leaves the body's frame in the world, and your eye. (Your weight is where the walker is.)
    Object.assign(you, { on: true, home: j.home, x: walker.x - (j.home[0] * cy - j.home[2] * sy), y: feetY, z: walker.z - (j.home[0] * sy + j.home[2] * cy), cy, sy, heading, folded, eyeUp, reachable });
    // (Asked for less movement: your eye keeps its height and its line; the body under it still walks.)
    // Your eye is her eye: where her head, on her neck, carries it (figurepose.js). Her skeleton is posed here,
    // before the camera is put anywhere, and the camera goes to it. (The camera used to be put where the solver
    // reckoned an eye would be, and her head put on the camera afterwards.)
    const eyeIs = figure && figureRig ? (figureRig.pose(j, eyeUp), you.rigFor = j, figureRig.eyeNow) : j.eye;
    // (For her hands, next frame: where her eye would be were she not leaning to anything. A hand held before
    // her eyes and the lean that hand asks of her would otherwise chase one another.)
    you.eyeAt = figure && figureRig ? figureRig.eyeFree : null;
    const calm = 1 - walker.bobAmount, ex = eyeIs[0] + calm * (g.shift || 0) * (walker.sitting ? 0 : 1), ey = eyeIs[1] + calm * 0.92 * (you.dip - (g.ride || 0) + 0.05 * (g.run || 0)), ez = eyeIs[2];
    if (!folded) {
      const head = [you.x + ex * cy - ez * sy, feetY + ey, you.z + ex * sy + ez * cy];
      you.headOff = [head[0] - floatAt[0], head[1] - floatAt[1], head[2] - floatAt[2]];
      walker.head = { x: floatAt[0] + you.headOff[0] * stood, y: floatAt[1] + you.headOff[1] * stood, z: floatAt[2] + you.headOff[2] * stood };
    }
    walker.roll = walker.sitting ? 0 : 0.22 * g.shift * walker.bobAmount;
    posedAt = frames;
    // Each foot that came down: its sound, its splash or its grains, where it is.
    for (const e of g.landed) { walker.thud = Math.min(1.4, 0.4 + e.stride); stamp({ ...e, depth: Math.max(walker.surf - footing.heightAt(e.x, e.z), 0) }); }
  }

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
      advance(dt, lastInput);
      sound.update(dt, soundScene(dt));
      if (moved !== walker.x + walker.z + walker.yaw) saveHash();
    }
    // Rain wets the ground in a quarter of a minute; the sun and the wind take a few minutes to dry it.
    if (dt > 0) { const rain = shared.uRain.value, wet = shared.uWet.value; shared.uWet.value = rain > wet ? wet + (rain - wet) * (1 - Math.exp(-dt / 6)) : Math.max(rain, wet - dt / 200); }
    rig.dt = dt; rig.under = walker.under;
    rig.update(R.size.width / R.size.height, R.reversed);
    // (The picture is under water when the camera is: behind her, that is the camera's own height against the sea
    // there. What you hear is still where her ears are: sound.update, above.)
    shared.uUnderEye.value = rig.mode !== 'walk' ? 0 : rig.out > 0.5 ? (rig.eye.y < surfaceAt(rig.eye.x, rig.eye.z) ? 1 : 0) : walker.under ? 1 : 0;
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
    if (figure) { figure.mesh.visible = figure.cloth.visible = walking; if (!walking) figure.face.place(figure.mesh.matrix, 0); }
    if (standing && you.on) {
      // You were posed before the camera was set (advance): now everything of you is put where it stands,
      // relative to the camera. (Looked at from outside, the camera is not at your eye.)
      const { cy, sy } = you, offX = you.x - rig.eye.x, offZ = you.z - rig.eye.z;
      body.place(offX, you.y, offZ, you.heading);
      if (figure) {
        // What of her rests on the sand or hangs just over it (for the soft dark under it: terrain.js).
        const list = shared.uContact.value;
        const put = (i, q, r) => list[i].set(offX + q[0] * cy - q[2] * sy, you.y + q[1], offZ + q[0] * sy + q[2] * cy, r);
        body.joints.ankles.forEach((a, i) => { const o = body.joints.feet[i]?.out || 0, fx = Math.sin(o), fz = -Math.cos(o); put(i * 2, [a[0] - fx * 0.02, a[1] - 0.025, a[2] - fz * 0.02], 0.05); put(i * 2 + 1, [a[0] + fx * 0.11, Math.max(a[1] - 0.05, 0.02), a[2] + fz * 0.11], 0.045); });
        body.joints.wrists.forEach((w, i) => { const t = body.joints.fingertips[i] || w; put(4 + i, [(w[0] + t[0]) / 2, (w[1] + t[1]) / 2, (w[2] + t[2]) / 2], 0.05); });
        body.joints.knees.forEach((k, i) => put(6 + i, k, 0.06));
        // (Just set down by the sea: part of the way over from swimming still.)
        const over = goingOver(dt, body.joints, 'stand', { x: offX, y: you.y, z: offZ, yaw: you.heading, pitch: 0 });
        // (Folded into the deepest squat she is left out of her own eyes' picture; from behind she is there to be seen.)
        figure.mesh.visible = !you.folded || rig.out > 0.02; figure.setPose(over.joints === you.rigFor && posedAt === frames ? figureRig.matrices : figureRig.pose(over.joints, you.eyeUp), figureRig.eyeNow[1]); figure.place(offX, you.y, offZ, you.heading);
        figure.mesh.material.uniforms.uShowHead.value = headSeen(); figure.mesh.material.uniforms.uWaterY.value = you.waterY = waterOver(); figure.mesh.material.uniforms.uShowUnder.value = rig.eye.y > walker.surf ? 1 : 0; figure.hairModel.show(figure.mesh.visible ? hairSeen() : 0, wetHair(dt));
        // Her eyes: her head has nodded six tenths of the way to where you look, and her eyes take the rest. With the
        // camera held round in front of her for a moment (Alt), she glances at it.
        { const j = body.joints, at = rig.behind.held && rig.out > 0.9 ? (you.glance = (you.glance || 0) + dt) : (you.glance = 0);
          let gy = 0, gp = walker.look - (j.headNod || 0);
          if (at > 0.7) { const dx = rig.eye.x - rig.own.x, dy = rig.eye.y - rig.own.y, dz = rig.eye.z - rig.own.z, to = Math.atan2(dx, -dz), off = Math.atan2(Math.sin(to - walker.yaw), Math.cos(to - walker.yaw)), up = Math.atan2(dy, Math.hypot(dx, dz)) - (j.headNod || 0); if (Math.abs(off) < 0.6 && up > -0.5 && up < 0.42) { gy = off; gp = up; } }
          you.gaze = (you.gaze || [0, 0]).map((v, c) => v + ((c ? gp : gy) - v) * (1 - Math.exp(-dt * 12)));
          figure.look(dt, you.gaze[0], you.gaze[1], walker.turnRate || 0, faceRandom); figure.face.place(figure.mesh.matrix, figure.mesh.visible ? headSeen() : 0); }
        // (Her real hand, as the rig has posed it: where its palm is, which way it faces, where the fingers leave it.)
        // (And her fingers as rods, where they are: what she holds lies on them, and falls between them.)
        if (body.joints.touching && !you.folded) body.joints.touching.palm = { ...figureRig.hand(1), caps: figureRig.handCaps(1), skin: () => figureRig.handSkin(1) };
        if (body.joints.touchingL && !you.folded) body.joints.touchingL.palm = { ...figureRig.hand(0), caps: figureRig.handCaps(0), skin: () => figureRig.handSkin(0) };
      }
      // What comes of it. (Points of the body are turned to your heading and stood on your feet.)
      // (The breeze where your hand is: a fifth of what blows at mast height, less down near the sand in your own lee.)
      // (And it comes in gusts: a few seconds of more, a few of less, never the same for long.)
      const gust = 0.85 + 0.4 * Math.sin(clock.time * 0.71) * Math.sin(clock.time * 0.23 + 1) + 0.15 * Math.sin(clock.time * 2.3 + 2);
      const breeze = shared.uWind.value, lee = 0.2 * breeze.z * (1 - 0.45 * walker.crouched) * gust;
      you.air = [breeze.x * lee, breeze.y * lee];
      if (figure) {
        // The tail of her hair (hair.js): moved on in the world, where she now is, in the breeze up there,
        // which is stronger than at the hand and flutters.
        const high = 0.45 * breeze.z * gust * (1 + 0.25 * Math.sin(clock.time * 7.3) * Math.sin(clock.time * 3.1));
        figure.swing(dt, [rig.eye.x, rig.eye.z], [breeze.x * high, 0, breeze.y * high]);
      }
      // Water runs off a hand that has been in the sea: drops from the fingertips, three a second at first and
      // fewer every second, for a quarter of a minute: a dozen or so from each hand. Each leaves a dark spot on dry sand
      // (it dries), or a ring where it falls back into the sea.
      if (dt > 0) {
        you.drip ??= [{ t: 99, owed: 0 }, { t: 99, owed: 0 }];
        for (const [i, h] of [[0, handL], [1, hand]]) {
          const at = body.joints.fingertips?.[i], d = you.drip[i];
          if (!at) continue;
          const tip = toWorld(at), g = footing.heightAt(tip[0], tip[2]), surf = surfaceAt(tip[0], tip[2]), sea = surf - g > 0.01;
          if ((sea && tip[1] < surf) || (h.kind === 'water' && (h.down || h.amount > 0.02))) { d.t = 0; continue; }
          d.t += dt;
          if (d.t > 15) continue;
          d.owed += dt * 3.2 * Math.exp(-d.t / 4.5);
          for (; d.owed >= 1; d.owed--) {
            const r = spray.random, floor = Math.max(g, sea ? surf : g), fall = Math.sqrt(Math.max(tip[1] - floor, 0.01) / 4.9), x = tip[0] + (r() - 0.5) * 0.03, z = tip[2] + (r() - 0.5) * 0.03;
            spray.put(wrap64(x), tip[1], wrap64(z), floor, clock.time, [walker.vx * 0.5, -0.05, walker.vz * 0.5], 0.0022 + 0.0016 * r(), true);
            if (sea) ripples?.drop(x + walker.vx * 0.5 * fall, z + walker.vz * 0.5 * fall, clock.time + fall, 0.14, 0.014);
            else patch?.pour(x + walker.vx * 0.5 * fall, z + walker.vz * 0.5 * fall, 0.011, 0, 1.3, fall, clock.time);
          }
        }
      }
      const doing = { wind: [breeze.x * lee, breeze.y * lee], joints: body.joints, eye: rig.eye, material: body.mesh.material, world: toWorld, turn: v => [v[0] * cy - v[2] * sy, v[1], v[0] * sy + v[2] * cy] };
      handL.act(dt, { ...you.reachable, want: !!lastInput.hand2, ...doing });
      hand.act(dt, { ...you.reachable, wind: [breeze.x * lee, breeze.y * lee], joints: body.joints, eye: rig.eye, material: body.mesh.material, world: toWorld, turn: v => [v[0] * cy - v[2] * sy, v[1], v[0] * sy + v[2] * cy] });
    }
    else if (walking) {
      if (hand.ik > 0 || hand.amount > 0 || handL.ik > 0 || handL.amount > 0) { hand.reset(); handL.reset(); }          // (swimming: the hands have other work)
      for (const c of shared.uContact.value) c.w = 0;
      const under = walker.diving ? 1 : 0;
      // (Placed from your own eye: which is where the camera is, unless you are being looked at from outside.)
      const sx = rig.own.x - rig.eye.x, sz = rig.own.z - rig.eye.z;
      body.pose({ swim: true, stroke: walker.stroke, under }); body.place(sx, walker.eyeY + walker.bob, sz, walker.yaw, under * walker.look);
      if (figure) {
        // (Just lifted off your feet: part of the way over from standing still, in the frame you stood in.)
        const over = goingOver(dt, body.joints, 'swim', { x: sx, y: walker.eyeY + walker.bob, z: sz, yaw: walker.yaw, pitch: under * walker.look });
        figure.setPose(figureRig.pose(over.joints, 0), over.raw ? 0 : over.joints.eye[1]); figure.place(over.frame.x, over.frame.y, over.frame.z, over.frame.yaw, over.frame.pitch || 0);
        figure.mesh.material.uniforms.uShowHead.value = headSeen(); figure.hairModel.show(hairSeen(), wetHair(dt));
        figure.swing(dt, [rig.eye.x, rig.eye.z], [0, 0, 0], walker.under ? 1 : 0);
        figure.look(dt, 0, 0, 0, faceRandom); figure.face.place(figure.mesh.matrix, headSeen());
        // (Afloat, what of you is under the surface is seen through it, as your legs are when you wade: your arms
        // working under the water in front of you. It was painted over by the sea: a head floating by itself.)
        figure.mesh.material.uniforms.uWaterY.value = walker.surf; figure.mesh.material.uniforms.uShowUnder.value = rig.eye.y > walker.surf ? 1 : 0;
      }
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
      const inWater = standing && walker.depth > 0.012 ? 1 : 0, speed = Math.hypot(walker.vx, walker.vz);
      (body.joints?.ankles || []).forEach((a, i) => { const w = toWorld(a); shared.uLeg.value[i].set(wrap64(w[0]), wrap64(w[2]), inWater, speed); });
    } else {
      for (const c of shared.uContact.value) c.w = 0;
      shared.uLeg.value[0].z = shared.uLeg.value[1].z = 0;
    }
    // The keys for what you are doing, said the first time you do it (the opening hint has faded by then).
    if (params.ui && !params.freeze && walking && standing) {
      if (walker.sitting && !told.sit) { told.sit = true; notice('Seated: S draws your legs up, W stretches them out · A D move your feet · Space curls your toes · the mouse button works your right hand · X gets you up', null, 10); }
      else if (!walker.sitting && walker.crouched > 0.9 && !told.crouch) { told.crouch = true; notice('Hold the mouse button: your hand goes down to the sand or the water. Move your look and your fingers rake through it; hold still and they close on a handful. Let go and it runs out between your fingers · the other button (or F) is your left hand · the wheel (or Q / E) closes and parts them', null, 14); }
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
        // Prints you left and walked away from. The patch holds only the four metres round you, and forgot each
        // as it left that square; a stamped print stands for it out there. Coming back, it is pressed into the
        // patch again as it comes within reach: that foot's print: heel, outer edge, ball and toes (the stamp is
        // not drawn inside the patch: without this your own trail vanished as you walked back along it).
        for (const m of marks) {
          if (!m) continue;
          const far = Math.max(Math.abs(m.x - walker.x), Math.abs(m.z - walker.z));
          if (far > 1.9) m.away = true;
          else if (far < 1.7 && m.away && clock.time - carved > 0.12 && dt > 0) {
            m.away = false; carved = clock.time;
            if (surfaceAt(m.x, m.z) - footing.heightAt(m.x, m.z) > 0.005) continue;       // (the sea is over it: gone)
            const fx = Math.sin(m.yaw), fz = -Math.cos(m.yaw), deep = m.wet ? 0.005 : 0.013;
            patch.drop(m.x, m.z, 0.13, -deep / 0.1, 0.1, 0, [fx, fz, m.side]);
          }
        }
        patch.update(dt, { x: walker.x, z: walker.z, cam: rig.eye, base: footing.heightAt(walker.x, walker.z), time: clock.time, feetWet: feetWet() ? 0.8 : 0,
          meshes: standing && figure.mesh.visible ? [{ mesh: figure.mesh, material: pressing }] : [],
          sample: (x, z) => { const g = footing.heightAt(x, z); return [g, wetSandAt(x, z, g) ? 1 : 0, surfaceAt(x, z) - g]; } });
        // (What breaks the surface into bubbles is a leg lifted out of it and put back in, or a shin driven
        // through it at a walk: up to the hip. Deeper, your legs stay under and your body only parts the water as
        // it goes, slowly: ripples and a wake, no foam. It foamed at any speed: wading chest-deep you trailed a
        // white sheet a metre long.)
        const ease = (a, b, v) => { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
        const stir = Math.max(1 - ease(0.55, 0.95, walker.depth), ease(0.9, 1.6, Math.hypot(walker.vx, walker.vz)));
        ripples?.update(dt, { x: walker.x, z: walker.z, time: clock.time, flow, stir, meshes: standing && figure.mesh.visible ? [{ mesh: figure.mesh, material: crossing }] : [] });
        if (skin && figure.mesh.visible) skin.update(dt, figure.mesh, !standing ? walker.surf : (you.waterY ?? -1e9), rig.eye);
      } else { shared.uPatch.value.w = 0; shared.uRipple.value.w = 0; }
      // (For tests: drawn as if there were no patch, to see that untouched sand looks the same with it as without.)
      if (hidePatch) { shared.uPatch.value.w = 0; shared.uRipple.value.w = 0; }
    }
    if (shadows.enabled && (walking || rig.dist < 1500)) {
      const centre = walking ? { x: Math.sin(walker.yaw) * 12, y: footing.heightAt(walker.x, walker.z), z: -Math.cos(walker.yaw) * 12 }
        : { x: rig.target.x - rig.eye.x, y: Math.max(ground.heightAt(rig.target.x, rig.target.z), shared.uSeaLevel.value), z: rig.target.z - rig.eye.z };
      // (Your own body goes into a small map of its own: a square across the light that just holds you, standing or swimming.)
      const own = walking ? { meshes: figure ? [figure.mesh, figure.hair] : [body.mesh, body.headMesh], centre: standing ? { x: walker.x - rig.eye.x, y: walker.eyeY - walker.body + 0.9, z: walker.z - rig.eye.z } : { x: rig.own.x - rig.eye.x, y: body.mesh.position.y - 0.3, z: rig.own.z - rig.eye.z }, half: standing ? 1.3 : 2 } : null;
      shadows.render(opaque, centre, walking ? 26 : Math.min(600, Math.max(24, 0.6 * rig.dist)), [terrain.mesh, birds.group, lifeGroup, spray.points, hand.mesh, hand.streams, hand.lying, handL.mesh, handL.streams, handL.lying, ...(walking ? [body.mesh, ...(figure ? [figure.mesh, figure.cloth, figure.hair, figure.face.eyes, figure.face.hairs] : [])] : [])], [], casters, own);
    } else shared.uShadowP.value.z = 0;
    falling?.update(clock.time, dt, you.air || [0, 0]);
    graph.render(opaque, water.mesh, rig.camera, clouds, falling || pools ? overlay : null);
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
    walkInput = attachWalkInput(walker, canvas, { active: () => rig.mode === 'walk', onLeave: () => app.setWalk(false), buttons: [...hud.querySelectorAll('[data-walk]')],
      // (V: out of your eyes to behind you, and back. Alt held: the mouse swings that camera round you.)
      onThird: () => app.setThird(!rig.behind.want),
      onSwing: (a, b) => { if (typeof a === 'boolean') rig.behind.held = a && rig.behind.want > 0; else if (rig.behind.held) rig.behind.swingBy(a, -b); } });
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
    let lastFrame = performance.now(), failures = 0, slowFor = 0, slowTold = false;
    const loop = now => {
      requestAnimationFrame(loop);                         // (first: nothing that goes wrong below may end the animation)
      const dt = Math.min(0.1, (now - clock.last) / 1000);
      clock.last = now; clock.time += dt;
      if (document.hidden || lost || paceHold) { lastFrame = now; paceHold = false; if (document.hidden || lost) return; }
      if (params.scale == null && !trialOn && clouds.ready !== false && dynamic.frame((now - lastFrame) / 1000) !== null) resize();
      lastFrame = now;
      // Slow for a quarter of a minute with the picture already at its smallest (under 25 frames a second, where
      // movement stops looking like movement): this computer is below what the simulation asks, and is told so,
      // once. (It was tried before you stepped in; this is for what has happened since: another program taking
      // the graphics card, a laptop gone onto its battery.)
      if (params.ui && !params.freeze && !slowTold && entered) {
        slowFor = dynamic.pace > 0.04 && dynamic.scale <= dynamic.min + 1e-3 && now - entered > 8000 ? slowFor + dt : 0;
        if (slowFor > 15) {
          slowTold = true;
          notice(`This computer is not keeping up: about ${Math.round(1 / dynamic.pace)} frames a second, with the picture at its smallest. It is below the recommended requirements for this simulation. Closing other tabs and programs may help.`, ['OK', () => notice('')]);
        }
      }
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

  // For tests: where hand i (0 left, 1 right) is in the world, the middle of its palm; and where what it pours lands.
  const handAt = i => {
    if (!you.on || !body.joints?.wrists?.[i]) return [rig.own.x, rig.own.y - 0.4, rig.own.z];
    if (figureRig && !you.folded) return toWorld(figureRig.hand(i).centre);
    const w = body.joints.wrists[i], t = body.joints.fingertips[i] || w;
    return toWorld([(w[0] + t[0]) / 2, (w[1] + t[1]) / 2, (w[2] + t[2]) / 2]);
  };
  const landAt = i => { const p = handAt(i), g = footing.heightAt(p[0], p[2]); return [p[0], Math.max(g, surfaceAt(p[0], p[2])), p[2]]; };
  let cut = null;
  const api = {
    errors,
    /** What this is being drawn with, and at which quality tier (for the opening screen: main.js). */
    device: { gpu: gpuName, software, tier: tierName },
    /** How the frames are coming: the size the picture is drawn at (1 whole .. the smallest), and the last mean interval between frames (s). */
    pace: () => ({ scale: dynamic.scale, min: dynamic.min, interval: dynamic.pace }),
    /**
     * Being tried (main.js, behind the opening screen): the picture is drawn whole and stays whole, however the
     * frames come, so that how they come says what this computer can do with it. (Left to itself the picture is
     * made smaller whenever frames come late, and the first frames of all, while the shaders are still being
     * made, always do: a fast computer was found slow.) `false`: over; the picture follows the frames again.
     */
    trial(on) { trialOn = !!on; Object.assign(dynamic, { scale: dynamic.max, sum: 0, count: 0, calm: 0, long: 0, crawling: 0 }); resize(); },
    setSound: on => app.setSound(on),
    /**
     * You step in from the opening screen: the sound starts (that step was the click a browser waits for), the
     * line of keys at the foot of the page is shown from its beginning (it had faded behind the opening), and
     * the mouse is yours to look round with if the browser gives it.
     */
    enter() {
      if (rig.mode === 'walk' && !sound.muted) sound.start();
      const hint = hud?.querySelector('.walk-hint');
      if (hint) { hint.style.animation = 'none'; void hint.offsetWidth; hint.style.animation = ''; }
      canvas.focus({ preventScroll: true });
      if (rig.mode === 'walk') canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      entered = performance.now();
    },
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
    eyeXZ: () => (you.on ? [you.x, you.z] : [rig.own.x, rig.own.z]),
    /** For tests: your feet as the gait has them (world), the joints as last posed (the body's frame), and where that frame stands. */
    gait: () => ({ feet: gait.feet.map(f => ({ x: f.x, z: f.z, yaw: f.yaw, down: f.down, pitch: f.pitch, ankle: f.ankle.slice() })), heading: walker.heading, yaw: walker.yaw, at: [walker.x, walker.z], you: { x: you.x, y: you.y, z: you.z, heading: you.heading, dip: you.dip }, eye: [rig.own.x, rig.own.y, rig.own.z] }),
    /**
     * For tests: her skeleton as posed (FigureRig.probe: what is stretched, the neck's length), with how far the
     * first-person camera is from where her head carries her eye (metres), or null without her.
     */
    /** Seeing yourself from behind (tests): on or off, at once unless `glide`. */
    third: (on = true, glide = false) => { rig.behind.set(on, !glide); status.third = !!on; },
    /** The camera behind her swung round her by so many degrees, and held there (`hold` false: let go, it comes back behind). */
    swing: (yaw = 0, pitch = 0, hold = true) => { rig.behind.held = hold; if (hold) { rig.behind.swing = [0, 0]; rig.behind.swingBy(yaw * Math.PI / 180, pitch * Math.PI / 180); } },
    /** Where the camera is and what is under it: { at, own (her eye), out (0 her eyes .. 1 behind her), away, ground, sea (heights there), under (the picture is the underwater one), diving } */
    camera: () => { const f = rig.floorAt(rig.eye.x, rig.eye.z); return { at: [rig.eye.x, rig.eye.y, rig.eye.z], own: [rig.own.x, rig.own.y, rig.own.z], out: rig.out, away: rig.away, ground: f.ground, sea: f.sea, under: shared.uUnderEye.value > 0.5, diving: !!walker.under, length: rig.behind.len, lift: rig.behind.lift, block: rig.behind.block, fov: rig.camera.fov }; },
    /** How many times she has blinked (tests). */
    blinks: () => (figure ? figure.face.blinks : null),
    bones: () => { if (!figureRig) return null; const p = figureRig.probe(), e = you.on ? toWorld(p.eye) : null; return { ...p, eyeGap: e ? Math.hypot(e[0] - rig.own.x, e[1] - rig.own.y, e[2] - rig.own.z) : null }; },
    /** For tests: a point of her body's frame as a place in the world (on foot). */
    toWorld: q => (you.on ? toWorld(q) : null),
    joints: () => (you.on ? JSON.parse(JSON.stringify(body.joints)) : null),
    /** For tests: your joints as last drawn (standing, swimming or between the two), in the world: { ankles, knees, wrists, elbows, hip, eye, over: 0..1 }. */
    drawn() {
      const b = you.blend;
      if (!b?.last) return null;
      const m = frameOf(going.a, b.last.frame), v = going.v, at = q => { v.set(q[0], q[1], q[2]).applyMatrix4(m); return [v.x + rig.eye.x, v.y, v.z + rig.eye.z]; }, j = b.last.j;
      return { ankles: j.ankles.map(at), knees: j.knees.map(at), wrists: j.wrists.map(at), elbows: j.elbows.map(at), hip: at(j.hip), eye: at(j.eye), over: b.k, kind: b.kind };
    },
    /**
     * For tests: look at yourself from outside. `angle` degrees round you from behind (0) to in front (180), `dist`
     * metres off, `height` of the camera above your feet, `aim` the height it looks at. No arguments: back to your own eyes.
     * `fixed`: keep the camera where it is in the world as you turn (else it goes round with you).
     */
    /**
     * `about`: what to go round and look at in place of yourself: 'hand' (your right), 'handL', 'land' / 'landL'
     * (where what that hand pours comes down), 'mid' / 'midL' (half way between the two) or a point [x, y, z] of the
     * world; `height` and `aim` are then above it. With `fixed` the point is taken once (the camera does not ride
     * the hand's every movement). `fov`: the lens, in degrees.
     */
    outside(angle = null, dist = 2.6, height = 1.1, aim = 0.8, fixed = false, about = null, fov = null) {
      const left = typeof about === 'string' && about.endsWith('L') ? 0 : 1, kind = typeof about === 'string' ? about.replace(/L$/, '') : null;
      const point = !about ? null : Array.isArray(about) ? () => about : kind === 'hand' ? () => handAt(left) : kind === 'land' ? () => landAt(left) : () => { const a = handAt(left), b = landAt(left); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; };
      rig.outside = angle === null ? null : { angle, dist, height, aim, ...(fixed ? { heading: walker.yaw } : {}), ...(point ? { about: fixed ? point() : point } : {}), ...(fov ? { fov } : {}) };
    },
    /** For tests: where a point of the world is in the picture: [x, y] in pixels of the canvas, and how deep (under 1: before the camera). */
    project(p) { const v = new THREE.Vector3(p[0] - rig.eye.x, p[1], p[2] - rig.eye.z).project(rig.camera); return [(v.x + 1) / 2 * canvas.width, (1 - v.y) / 2 * canvas.height, v.z]; },
    /** For tests: the way to the sun (east, up, south), and where the camera is. */
    sunDir: () => shared.uSunDir.value.toArray(), cameraAt: () => [rig.eye.x, rig.eye.y, rig.eye.z],
    /** For tests: what a hand holds and its account of what it took and let go (world/hand.js `ledger`, cubic metres): `side` 1 your right, -1 your left. */
    // (For tools: a named attitude of the hand set to other angles, to try it: handpose.js ATTITUDES.)
    attitude: (name, spec) => { if (spec) { ATTITUDES[name] = spec; figureRig.models.forEach(m => m.learn()); } return ATTITUDES[name]; },
    // (What lies in a hand, cell by cell, for tools: sim/palm.js.)
    palm: (side = 1) => { const h = side > 0 ? hand : handL, q = h.sim; return q ? { floor: Array.from(q.floor), s: Array.from(q.s), leak: Array.from(q.leak), gap: Array.from(q.gap), drops: h.drops || 0, hang: (h.hang || []).slice(), last: h.lastDrop || null, lift: h.lift, fresh: !!h.fresh, up: h.upNow || null, lost: q.lost ? Array.from(q.lost) : null, trace: () => { q.lost = new Float32Array(q.s.length); }, edgeBy: h.edgeBy || null, open: h.open, tipped: h.tipped, worked: h.worked || 0, began: h.began || 0, flow: h.running_ || 0 } : null; },
    handful: (side = 1) => { const h = side > 0 ? hand : handL; return { kind: h.kind, amount: h.amount, open: h.open, rates: h.rates.slice(), ...h.ledger, gaps: h.ledger.gaps.slice() }; },
    /** For tests: chance begins again from `n`: the same doing then gives the same grains and drops. */
    seed(n = 1) { spray.seed(n); hand.seed(n + 1); handL.seed(n + 2); falling?.seed(n + 3); faceSeed = (n + 77) >>> 0; },
    /** For tests: a place to hold a handful (from the eye: x to the hand's own side, y up, z back; metres) and how far the fingers point inward (radians), to try; null: as it is. */
    holdAt(tune = null) { Hand.tune = tune; },
    /** For tests: how many grains are in the air now, and how many were written over while still falling. */
    grains: () => (falling ? falling.inAir(clock.time) : null),
    /**
     * For tests: your hands as they are posed now, measured as hands are (world/handpose.js): [left, right], each
     * { what it is doing: ik, lift, grip, amount, kind, down, open, tipped, rates, ledger (world/hand.js);
     * where it is in the world: wrist, elbow, shoulder, centre, knuckles, f, N, A; sup, flex, dev, twists (radians);
     * fingers: [{ mcp, abd, pip, dip, tip }], thumb, caps (the rods of its fingers), gaps (the room between them) }.
     */
    handProbe() {
      if (!you.on || !body.joints?.wrists?.length) return null;
      const turned = v => [v[0] * you.cy - v[2] * you.sy, v[1], v[0] * you.sy + v[2] * you.cy], rod = r => ({ a: toWorld(r.a), b: toWorld(r.b), r: r.r, w: r.w, t: r.t });
      const hands = [handL, hand].map((h, i) => {
        const doing = { side: h.side, ik: h.ik, lift: h.lift, grip: h.grip, amount: h.amount, kind: h.kind, down: h.down, open: h.open, tipped: h.tipped, rates: h.rates.slice(), ledger: { ...h.ledger, gaps: h.ledger.gaps.slice() },
          pourAt: h.pour?.gaps ? h.pour.gaps.map(q => q.slice()) : null, floor: h.pour ? h.pour.floor : null };
        if (!figureRig || you.folded) return { ...doing, wrist: toWorld(body.joints.wrists[i]), elbow: toWorld(body.joints.elbows[i]), shoulder: toWorld(body.joints.shoulders[i]), centre: handAt(i) };
        const p = figureRig.handProbe(i);
        return { ...doing, wrist: toWorld(p.wrist), elbow: toWorld(p.elbow), shoulder: toWorld(p.shoulder), centre: toWorld(p.centre), knuckles: toWorld(p.knuckles), f: turned(p.f), N: turned(p.N), A: turned(p.A),
          sup: p.sup, flex: p.flex, dev: p.dev, turned: p.turned, bent: p.bent, twists: p.twists, gaps: p.gaps, fingers: p.fingers.map(f => ({ ...f, tip: toWorld(f.tip) })), thumb: { ...p.thumb, tip: toWorld(p.thumb.tip) },
          caps: p.caps ? { fingers: p.caps.fingers.map(f => f.map(rod)), thumb: p.caps.thumb.map(rod), palm: p.caps.palm.map(rod) } : null, clear: p.caps ? clearance(p.caps) : null };
      });
      return { time: clock.time, eye: [rig.own.x, rig.own.y, rig.own.z], yaw: walker.yaw, heading: walker.heading, look: walker.look, feet: you.y, crouched: walker.crouched, seated: walker.seated,
        knees: body.joints.knees.map(toWorld), ankles: body.joints.ankles.map(toWorld), hips: (body.joints.hips || []).map(toWorld), hands,
        apart: hands[0].caps && hands[1].caps ? handsApart(hands[0].caps, hands[1].caps) : null };
    },
    /** For tests: the ripples at a place: [height (m), speed, crossing]; how far your feet have sunk in the wash. */
    rippleAt: (x, z) => (ripples ? ripples.read(x, z) : null), sunk: () => sunk,
    /** For tests: whether the sand at a place is sand the sea keeps wet, as everything but the picture has it. */
    wetSand: (x, z) => wetSandAt(x, z, ground.heightAt(x, z)),
    /** For tests: lrRagged at world points [[x, z], ...] as the graphics card works it out, beside the CPU's own. */
    raggedBoth(points) {
      const n = Math.min(points.length, 64), target = new THREE.WebGLRenderTarget(n, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      const pass = new FullscreenPass(`
#include <lr_common>
#include <lr_geo>
#include <lr_shore>
uniform vec2 uPts[64];
layout(location = 0) out vec4 outColor;
void main() { outColor = vec4(lrRagged(uPts[int(gl_FragCoord.x)]), 0.0, 0.0, 1.0); }`, uniformsFor([...CHUNK_UNIFORMS.common, ...CHUNK_UNIFORMS.geo, ...CHUNK_UNIFORMS.shore], { uPts: { value: Array.from({ length: 64 }, (_, i) => new THREE.Vector2(...(points[i] || [0, 0]).map(v => ((v % 1024) + 1024) % 1024))) } }));
      const previous = renderer.getRenderTarget(), out = new Float32Array(n * 4);
      pass.render(renderer, target); renderer.readRenderTargetPixels(target, 0, 0, n, 1, out); renderer.setRenderTarget(previous);
      target.dispose(); pass.material.dispose();
      return points.slice(0, n).map((q, i) => [out[i * 4], ragged(q[0], q[1])]);
    },
    /** For tests: as if both hands had just come out of the sea (they drip). */
    wetHands() { you.drip = [{ t: 0.01, owed: 0 }, { t: 0.01, owed: 0 }]; },
    /** For tests: how far the tail of her hair has swung from where it hangs: { x: to her right, z: back } (m). */
    figureTail: () => (figure?.tail ? { x: figure.tail.x, z: figure.tail.z } : null),
    /** For tests: [how wet, how sandy] the skin is at a texture coordinate of the body. */
    skinAt: (u, v) => (skin ? skin.read(u, v) : null),
    /** For tests: draw (or not) what the patch of real sand and the ripple field say; they go on being worked out. */
    patchShown(on) { hidePatch = !on; },
    /** For tests: the sand round you at a place: [height gained or lost (m), dampness, in transit (m), pressed]. */
    patchAt: (x, z) => (patch ? patch.read(x, z) : null),
    /** For tests: whether you have the real body, and its size. */
    figure: () => (figure ? { vertices: figure.info.vertices, eyeHeight: figure.info.eyeHeight, stand: walker.stand, crouch: walker.crouch } : null),
    /** For tests: what your hand is doing (see world/hand.js). */
    handL: () => ({ ik: handL.ik, lift: handL.lift, amount: handL.amount, kind: handL.kind, down: handL.down, wet: handL.wet, sand: handL.sand }),
    hand: () => ({ tip: hand.tip, wrist: body.joints.touching ? toWorld(body.joints.touching.wrist) : null, rest: hand.rest, rake: hand.rake, speed: hand.speed, took: hand.took, ik: hand.ik, lift: hand.lift, grip: hand.grip, amount: hand.amount, open: hand.open, rates: hand.rates.slice(), kind: hand.kind, down: hand.down, marks: shared.uTouchCount.value, wet: hand.wet, sand: hand.sand, heap: hand.mesh.visible,
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
      // (A hand takes three quarters of a second to reach the sand, and about as long again to take a handful.)
      if (s.touch) { api.run(0.7, { down: true }); api.run(0.9, { down: true, hand: true }); api.run(s.touch.seconds ?? 1.2, { down: true, hand: true }, s.touch.turn ?? 0, s.touch.nod ?? 0); if (s.touch.then) api.run(s.touch.then.seconds ?? 1, { down: true, hand: true }, s.touch.then.turn ?? 0, s.touch.then.nod ?? 0);
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
    getState: () => ({ cam: rig.get(), mode: rig.mode, sitting: walker.sitting, seated: walker.seated, crouched: walker.crouched, walk: { x: walker.x, z: walker.z, yaw: walker.yaw * 180 / Math.PI, look: walker.look * 180 / Math.PI, eye: walker.eyeY - shared.uSeaLevel.value, depth: walker.depth, diving: walker.diving, afloat: walker.afloat }, time: clock.time, env: { ...env }, status: { ...status } }),
    /**
     * Runs the whole simulation (walking, sound scene, drawing) for `seconds` of its own time, as fast as the
     * machine goes: the long-run test (tools/soak.mjs). `turn` (degrees a second) swings your heading as you go,
     * `nod` raises your look.
     */
    run(seconds, input = {}, turn = 0, nod = 0, { step = 1 / 60, each = null } = {}) {
      // (`step`: the length of a frame, to see that a faster or a slower display changes nothing; `each(i)`: called
      // after every frame, to measure as it goes.)
      const gl = renderer.getContext(), px = new Uint8Array(4), held = walkInput;
      walkInput = { read: () => ({ ...NO_INPUT, ...input }) }; paceHold = true;
      try {
        for (let i = 0, n = Math.round(seconds / step); i < n; i++) {
          clock.time += step; walker.yaw += turn * Math.PI / 180 * step; walker.look = Math.min(1.5, Math.max(-1.5, walker.look + nod * Math.PI / 180 * step));
          frame(step); each?.(i);
          // (Reading a pixel back makes the GPU catch up, so that the queue of work does not grow without limit.)
          if (i % 20 === 19) { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        }
      } finally { walkInput = held; }
      return frames;
    },
    /** Advances first person by `seconds` with a fixed input ({ fwd, right, run, down, up }), in 1/60 s steps: for tests. */
    walkFor(seconds, input = {}) { for (let t = 0; t < seconds; t += 1 / 60) { clock.time += 1 / 60; advance(1 / 60, { ...NO_INPUT, ...input }); } },
    flyTo: id => { const p = places.find(q => q.id === id); if (p) app.flyToPlace(p); return !!p; },
    /** Jumps straight to a place's camera shot (no flight). */
    goTo: id => { const p = places.find(q => q.id === id); if (p) { app.setWalk(false); rig.cancelFlight(); rig.set(shotFor(p)); } return !!p; },
    renderOnce(dt = 0) { frame(dt); },
    /**
     * Renders a frame and returns it as a PNG data URL: all of it, or the part `crop` = [x, y, width, height] in
     * pixels, drawn `size` = [width, height] pixels large (as it is, if not given).
     */
    capture(crop = null, size = null) {
      frame(0);
      if (!crop) return canvas.toDataURL('image/png');
      const [x, y, w, h] = crop, [ow, oh] = size || [w, h]; cut ??= document.createElement('canvas');
      cut.width = ow; cut.height = oh; cut.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, ow, oh);
      return cut.toDataURL('image/png');
    },
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
