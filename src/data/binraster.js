// Codec for the `.bin` rasters in web/data (same format as pipeline/binraster.py).
//
// A raster is W x H x C unsigned ints (u8 or u16), row 0 = north. Each channel is stored as its "grad" residual
//   r[y][x] = v[y][x] - v[y][x-1] - v[y-1][x] + v[y-1][x-1]   (mod 2^bits, missing neighbours = 0)
// split into byte planes: for each channel, all low bytes then (u16 only) all high bytes, row-major, no header.
// Smooth fields leave residuals near zero, which the web server's gzip then squeezes; decoding is exact.
// No imports: this module is loaded by the worker, by the page and by the Node tools.

const BYTES = { u8: 1, u16: 2 };

/** Decodes a `.bin` file. Returns the values planar (channel, row, column) as Uint8Array or Uint16Array. */
export function decodeBin(bytes, { width, height, channels = 1, dtype = 'u8', filter = 'grad' }) {
  const B = BYTES[dtype];
  if (!B) throw new Error(`binraster: unknown dtype ${dtype}`);
  const n = width * height;
  if (bytes.length !== n * channels * B) throw new Error(`binraster: expected ${n * channels * B} bytes, got ${bytes.length}`);
  const out = B === 1 ? new Uint8Array(n * channels) : new Uint16Array(n * channels);
  for (let c = 0; c < channels; c++) {
    const o = c * n, src = c * n * B;
    if (B === 1) out.set(bytes.subarray(src, src + n), o);
    else for (let i = 0; i < n; i++) out[o + i] = bytes[src + i] | (bytes[src + n + i] << 8);
    if (filter === 'none') continue;
    if (filter !== 'grad') throw new Error(`binraster: unknown filter ${filter}`);
    // Undo the mixed second difference: running sum along each row, then down each column (typed arrays wrap).
    for (let y = 0; y < height; y++) {
      const row = o + y * width;
      for (let x = 1; x < width; x++) out[row + x] += out[row + x - 1];
      if (y > 0) for (let x = 0; x < width; x++) out[row + x] += out[row - width + x];
    }
  }
  return out;
}

/** Encodes planar values (as `decodeBin` returns them) into the file bytes. */
export function encodeBin(values, { width, height, channels = 1, dtype = 'u8', filter = 'grad' }) {
  const B = BYTES[dtype], n = width * height, mask = B === 1 ? 0xff : 0xffff;
  const bytes = new Uint8Array(n * channels * B);
  for (let c = 0; c < channels; c++) {
    const o = c * n, dst = c * n * B;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = o + y * width + x;
        let r = values[i];
        if (filter === 'grad') {
          const l = x > 0 ? values[i - 1] : 0, u = y > 0 ? values[i - width] : 0, ul = x > 0 && y > 0 ? values[i - width - 1] : 0;
          r = (r - l - u + ul) & mask;
        }
        bytes[dst + y * width + x] = r & 0xff;
        if (B === 2) bytes[dst + n + y * width + x] = r >> 8;
      }
    }
  }
  return bytes;
}

/** Planar single-channel values -> Float32Array of physical values (raw * scale + offset). */
export function toPhysical(values, scale = 1, offset = 0) {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] * scale + offset;
  return out;
}

/** Planar u8 channels -> interleaved RGBA bytes for a texture (missing channels: 0, alpha 255). */
export function interleaveRGBA(values, width, height, channels) {
  const n = width * height, out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = values[i];
    out[i * 4 + 1] = channels > 1 ? values[n + i] : 0;
    out[i * 4 + 2] = channels > 2 ? values[2 * n + i] : 0;
    out[i * 4 + 3] = channels > 3 ? values[3 * n + i] : 255;
  }
  return out;
}
