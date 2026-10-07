// Loads the manifest and turns the map files into textures (plus raw copies of height and shore for CPU lookups).
import * as THREE from 'three';
import { DATA_ROOT, MANIFEST } from '../config.js';

const url = file => new URL(DATA_ROOT + file, document.baseURI).href;

/** A small pool of decode workers. */
class Decoder {
  constructor(count = 2) {
    this.jobs = new Map(); this.next = 0; this.id = 0;
    this.workers = Array.from({ length: count }, () => {
      const w = new Worker(new URL('./binraster.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = ({ data }) => { const job = this.jobs.get(data.id); this.jobs.delete(data.id); data.error ? job.reject(new Error(data.error)) : job.resolve(data); };
      w.onerror = e => { for (const job of this.jobs.values()) job.reject(new Error(`decode worker failed: ${e.message}`)); this.jobs.clear(); };
      return w;
    });
  }
  decode(entry, as, gzip) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.jobs.set(id, { resolve, reject });
      this.workers[this.next++ % this.workers.length].postMessage({ id, url: url(entry.file + (gzip ? '.gz' : '')), entry, as, gzip });
    });
  }
  dispose() { for (const w of this.workers) w.terminate(); }
}

function dataTexture(data, entry, format, type, { mipmaps = false, internalFormat = null } = {}) {
  const t = new THREE.DataTexture(data, entry.width, entry.height, format, type);
  if (internalFormat) t.internalFormat = internalFormat;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mipmaps;
  t.flipY = false;                       // row 0 (north) is v = 0 everywhere
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

async function imageTexture(entry, anisotropy) {
  const res = await fetch(url(entry.file));
  if (!res.ok) throw new Error(`${res.status} for ${entry.file}`);
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const t = new THREE.Texture(bitmap);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.flipY = false;                       // (three never flips an ImageBitmap; its first row is v = 0 as well)
  t.colorSpace = THREE.SRGBColorSpace;   // files hold sRGB-encoded reflectance: the GPU hands the shader linear values
  t.needsUpdate = true;
  return t;
}

/**
 * Loads everything the first frame needs.
 * @param {'hi'|'lo'} set  which texture set to prefer (falls back to `hi` per map)
 * @param {(fraction: number, label: string) => void} onProgress
 */
export async function loadData(set, anisotropy, onProgress = () => {}) {
  const res = await fetch(url(MANIFEST));
  if (!res.ok) throw new Error(`manifest: ${res.status}`);
  const manifest = await res.json();
  const pick = name => manifest.maps[name][set] || manifest.maps[name].hi;
  const gzip = manifest.compressed === 'gzip';
  const names = ['height', 'shore', 'benthic', 'land', 'waveMap', 'albedo'].concat(manifest.maps.waterType ? ['waterType'] : []);
  const total = names.reduce((s, n) => s + pick(n).bytes, 0);
  let done = 0;
  const tick = name => { done += pick(name).bytes; onProgress(done / total, name); };

  const decoder = new Decoder(Math.min(3, navigator.hardwareConcurrency || 2));
  const half = async name => { const e = pick(name), d = await decoder.decode(e, 'half', gzip); tick(name); return { entry: e, ...d }; };
  const rgba = async name => { const e = pick(name), d = await decoder.decode(e, 'rgba', gzip); tick(name); return { entry: e, ...d }; };
  try {
    const [height, shore, benthic, land, waveMap, waterType, albedo, features] = await Promise.all([
      half('height'), half('shore'), rgba('benthic'), rgba('land'), rgba('waveMap'), manifest.maps.waterType ? rgba('waterType') : null,
      imageTexture(pick('albedo'), anisotropy).then(t => { tick('albedo'); return t; }),
      fetch(url(manifest.features || 'features.json')).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const g = manifest.grid, size = [g.width * g.mpp, g.height * g.mpp];
    const cpu = e => ({ raw: e.raw, width: e.entry.width, height: e.entry.height, scale: e.entry.scale ?? 1, offset: e.entry.offset ?? 0 });
    return {
      manifest, features,
      /** World rectangle covered by the maps: origin = NW corner (x east, z south), metres. */
      rect: { x: -size[0] / 2, z: -size[1] / 2, w: size[0], h: size[1] },
      textures: {
        height: dataTexture(height.half, height.entry, THREE.RedFormat, THREE.HalfFloatType, { mipmaps: true, internalFormat: 'R16F' }),
        shore: dataTexture(shore.half, shore.entry, THREE.RedFormat, THREE.HalfFloatType, { internalFormat: 'R16F' }),
        benthic: dataTexture(benthic.rgba, benthic.entry, THREE.RGBAFormat, THREE.UnsignedByteType, { mipmaps: true }),
        land: dataTexture(land.rgba, land.entry, THREE.RGBAFormat, THREE.UnsignedByteType, { mipmaps: true }),
        waveMap: dataTexture(waveMap.rgba, waveMap.entry, THREE.RGBAFormat, THREE.UnsignedByteType, { mipmaps: true }),
        // Where the water is lagoon water (1) rather than clear ocean water (0). Without the map: ocean everywhere.
        waterType: waterType ? dataTexture(waterType.rgba, waterType.entry, THREE.RGBAFormat, THREE.UnsignedByteType)
          : dataTexture(new Uint8Array([0, 0, 0, 255]), { width: 1, height: 1 }, THREE.RGBAFormat, THREE.UnsignedByteType),
        albedo,
      },
      cpu: {
        height: cpu(height), shore: cpu(shore), waveMap: { rgba: waveMap.rgba, width: waveMap.entry.width, height: waveMap.entry.height },
        // (The arrays the textures were made from: nothing extra is kept.)
        land: { rgba: land.rgba, width: land.entry.width, height: land.entry.height }, benthic: { rgba: benthic.rgba, width: benthic.entry.width, height: benthic.entry.height },
      },
      /** The satellite picture is only fetched when the compare view is first opened. */
      loadSatellite: () => imageTexture(manifest.maps.satellite.hi, anisotropy),
    };
  } finally {
    decoder.dispose();
  }
}
