// URL switches, quality tiers and world constants.

const q = new URLSearchParams(location.search);

/** Switches read from the query string (mostly for the test harness and debugging). */
export const params = {
  freeze: q.get('freeze') === '1',          // render only when asked (harness): a forgotten browser burns no GPU
  ui: q.get('ui') !== '0',
  scale: q.has('scale') ? Number(q.get('scale')) : null,   // fixed render scale, disables dynamic resolution
  tier: q.get('tier'),                      // low | medium | high | ultra
  revz: q.get('revz') !== '0',              // revz=0 forces the ordinary depth path (as on Firefox)
  data: q.get('data') || 'real',            // fixture = the small synthetic atoll
  dev: q.has('dev'),
  validate: q.get('validate') === '1',
};

export const DATA_ROOT = 'data/';
export const MANIFEST = params.data === 'fixture' ? 'fixture/manifest.json' : 'manifest.json';

export const EARTH_RADIUS = 6371000;
export const WATER_IOR = 1.34;

/** What each quality tier turns on. `maps` picks the texture set, `block` the clipmap block size in quads. */
export const TIERS = {
  low: { maps: 'lo', block: 16, maxPixels: 1.0e6, dprCap: 1.5, bicubicNormals: false, fps: 30, clouds: null, fp: { sand: 'plain', shadowMap: 0, shadowTaps: 4, life: 0 } },
  medium: { maps: 'hi', block: 32, maxPixels: 2.1e6, dprCap: 2, bicubicNormals: true, fps: 60, clouds: { shape: 64, steps: 28, lightSteps: 3, scale: 0.34, shadowEvery: 6 }, fp: { sand: 'plain', shadowMap: 1024, shadowTaps: 4, life: 1 } },
  high: { maps: 'hi', block: 32, maxPixels: 3.7e6, dprCap: 2, bicubicNormals: true, fps: 60, clouds: { shape: 128, steps: 48, lightSteps: 4, scale: 0.5, shadowEvery: 2 }, fp: { sand: 'full', shadowMap: 2048, shadowTaps: 8, life: 2 } },
  ultra: { maps: 'hi', block: 48, maxPixels: 8.3e6, dprCap: 2, bicubicNormals: true, fps: 60, clouds: { shape: 128, steps: 80, lightSteps: 5, scale: 0.5, shadowEvery: 1 }, fp: { sand: 'full', shadowMap: 2048, shadowTaps: 8, life: 2 } },
};

/** Picks a starting tier from what the device reports (the perf monitor may lower it later). */
export function pickTier() {
  if (params.tier && TIERS[params.tier]) return params.tier;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
  if (mobile || navigator.connection?.saveData) return 'low';
  if ((navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4) return 'medium';
  return 'high';
}
