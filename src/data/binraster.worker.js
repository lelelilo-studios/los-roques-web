// Fetches and decodes one `.bin` raster off the main thread.
// (Import maps do not apply inside workers: only relative imports here, and never three.)
import { decodeBin, interleaveRGBA } from './binraster.js';

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);

/** IEEE half-float bits of `v` (round to nearest, overflow clamps to infinity). */
export function halfBits(v) {
  f32[0] = v;
  const x = u32[0], sign = (x >>> 16) & 0x8000, man = x & 0x7fffff, exp = ((x >>> 23) & 0xff) - 112;
  if (exp <= 0) return exp < -10 ? sign : sign | (((man | 0x800000) >>> (1 - exp)) + 0x1000) >>> 13;
  if (exp >= 31) return sign | 0x7c00;
  return (sign | (exp << 10) | (man >>> 13)) + ((man >>> 12) & 1);
}

self.onmessage = async ({ data: { id, url, entry, as, gzip } }) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    // The published site ships the rasters gzipped as plain files (not relying on the server to compress them).
    const body = gzip ? new Response(res.body.pipeThrough(new DecompressionStream('gzip'))) : res;
    const values = decodeBin(new Uint8Array(await body.arrayBuffer()), entry);
    if (as === 'half') {
      // One channel of physical values, as half floats for an R16F texture; the raw values go back too (CPU lookups).
      const scale = entry.scale ?? 1, offset = entry.offset ?? 0, half = new Uint16Array(values.length);
      for (let i = 0; i < values.length; i++) half[i] = halfBits(values[i] * scale + offset);
      self.postMessage({ id, raw: values, half }, [values.buffer, half.buffer]);
    } else {
      const rgba = interleaveRGBA(values, entry.width, entry.height, entry.channels);
      self.postMessage({ id, rgba }, [rgba.buffer]);
    }
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
