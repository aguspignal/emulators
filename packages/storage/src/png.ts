/**
 * A minimal PNG encoder, here because the DS banner decoder produces raw
 * pixels and React Native can only render an image file.
 *
 * It writes *uncompressed* PNGs — a zlib stream of stored deflate blocks,
 * which is entirely legal and costs nothing worth having for a 16-colour
 * 32x32 icon. Pulling in a compression library, or an Expo native module
 * that can encode, would be wildly out of proportion; BMP would be smaller
 * code but React Native's Android image pipeline supports it inconsistently,
 * and the failure mode there is a silently blank tile.
 *
 * Every accumulator below is coerced with `>>> 0` before it is written.
 * JavaScript's bitwise operators are 32-bit *signed*, and a negative CRC
 * written through a shift produces a file that most desktop viewers accept
 * and Android's decoder silently rejects.
 */

/**
 * Width and height out of a PNG's IHDR, or null if the bytes aren't a PNG.
 * Needs only the first 24 bytes, so callers can read a header rather than a
 * whole file. Returns null rather than throwing — an unmeasurable cover just
 * falls back to its console's default shape.
 */
export function pngDimensions(header: Uint8Array): { width: number; height: number } | null {
  if (header.length < 24) return null;
  // Signature, then an 8-byte chunk header, then IHDR's width and height.
  if (header[0] !== 0x89 || header[1] !== 0x50 || header[2] !== 0x4e || header[3] !== 0x47) {
    return null;
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0) >>> 0;
}

/** `[length][type][data][crc]`, with the CRC over type+data but not length. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Stored deflate blocks cap at 65535 bytes, so this loop really does run. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff;
  const blocks = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let p = 0;
  out[p++] = 0x78; // CMF: deflate, 32K window
  out[p++] = 0x01; // FLG: no preset dictionary, fastest
  for (let offset = 0; offset < raw.length; offset += MAX_BLOCK) {
    const length = Math.min(MAX_BLOCK, raw.length - offset);
    out[p++] = offset + length >= raw.length ? 1 : 0; // BFINAL, BTYPE=00
    out[p++] = length & 0xff;
    out[p++] = (length >>> 8) & 0xff;
    out[p++] = ~length & 0xff;
    out[p++] = (~length >>> 8) & 0xff;
    out.set(raw.subarray(offset, offset + length), p);
    p += length;
  }
  const sum = adler32(raw);
  out[p++] = (sum >>> 24) & 0xff;
  out[p++] = (sum >>> 16) & 0xff;
  out[p++] = (sum >>> 8) & 0xff;
  out[p++] = sum & 0xff;
  return out.subarray(0, p);
}

/** Nearest-neighbour integer upscale. See the note in encodeRgbaPng. */
function upscale(rgba: Uint8Array, width: number, height: number, scale: number): Uint8Array {
  const out = new Uint8Array(width * scale * height * scale * 4);
  const outWidth = width * scale;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const dst = ((y * scale + dy) * outWidth + x * scale + dx) * 4;
          out[dst] = rgba[src]!;
          out[dst + 1] = rgba[src + 1]!;
          out[dst + 2] = rgba[src + 2]!;
          out[dst + 3] = rgba[src + 3]!;
        }
      }
    }
  }
  return out;
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Encodes 8-bit RGBA pixels as a PNG.
 *
 * `scale` replicates pixels before encoding. It exists because Android
 * smooths images on upscale with no nearest-neighbour option, so a 32x32
 * icon drawn into a 64dp box on a 3x screen turns to mush; emitting it at 4x
 * means the platform is scaling *down* instead, which stays crisp.
 */
export function encodeRgbaPng(
  rgba: Uint8Array,
  width: number,
  height: number,
  scale = 1
): Uint8Array {
  const pixels = scale > 1 ? upscale(rgba, width, height, scale) : rgba;
  const outWidth = width * scale;
  const outHeight = height * scale;

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, outWidth);
  ihdrView.setUint32(4, outHeight);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none".
  const stride = outWidth * 4;
  const raw = new Uint8Array(outHeight * (stride + 1));
  for (let y = 0; y < outHeight; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    png.set(part, p);
    p += part.length;
  }
  return png;
}
