import { File } from 'expo-file-system';

/**
 * Reads the icon out of a Nintendo DS cartridge banner.
 *
 * Offsets are per GBATEK. The banner's location is a u32 in the ROM header;
 * everything the icon needs sits in the first 0x240 bytes of the banner:
 *
 *   header + 0x068   u32 LE   banner offset
 *   banner + 0x000   u16      version
 *   banner + 0x020   0x200    32x32 icon, 4bpp, 4x4 grid of 8x8 tiles
 *   banner + 0x220   0x020    16-colour BGR555 palette, index 0 transparent
 *   banner + 0x240   0x100    titles, one per language
 *
 * A random-access handle rather than `file.bytes()` is not an optimisation
 * here: a DS ROM runs to 512MB, and this needs about 600 bytes of it.
 */

const HEADER_BANNER_OFFSET = 0x068;
const ICON_BITMAP = 0x020;
const ICON_PALETTE = 0x220;
const BANNER_PREFIX = 0x240;
export const NDS_ICON_SIZE = 32;

export interface DecodedIcon {
  /** 8-bit RGBA, `NDS_ICON_SIZE` square. */
  rgba: Uint8Array;
  width: number;
  height: number;
}

/** BGR555 -> 8-bit channels. The low bits repeat the high ones so 31 -> 255. */
function expand5(value: number): number {
  return (value << 3) | (value >>> 2);
}

/**
 * The tile arithmetic, split out from the IO so it can be exercised against
 * a synthetic banner. Deliberately not re-exported from the package index —
 * callers want `extractNdsIcon`.
 */
export function decodeNdsIcon(icon: Uint8Array, palette: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(NDS_ICON_SIZE * NDS_ICON_SIZE * 4);

  const colours: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const raw = palette[i * 2]! | (palette[i * 2 + 1]! << 8);
    colours.push([
      expand5(raw & 0x1f),
      expand5((raw >>> 5) & 0x1f),
      expand5((raw >>> 10) & 0x1f),
    ]);
  }

  const put = (x: number, y: number, index: number) => {
    const at = (y * NDS_ICON_SIZE + x) * 4;
    const [r, g, b] = colours[index]!;
    rgba[at] = r!;
    rgba[at + 1] = g!;
    rgba[at + 2] = b!;
    // Index 0 is transparent, not black — filling it black would box every
    // icon in a hard rectangle.
    rgba[at + 3] = index === 0 ? 0 : 255;
  };

  // Four rows of four 8x8 tiles; within a tile, eight rows of four bytes,
  // each byte holding two pixels with the LOW nibble on the left.
  for (let tileY = 0; tileY < 4; tileY++) {
    for (let tileX = 0; tileX < 4; tileX++) {
      const tile = (tileY * 4 + tileX) * 32;
      for (let row = 0; row < 8; row++) {
        for (let pair = 0; pair < 4; pair++) {
          const byte = icon[tile + row * 4 + pair]!;
          put(tileX * 8 + pair * 2, tileY * 8 + row, byte & 0x0f);
          put(tileX * 8 + pair * 2 + 1, tileY * 8 + row, byte >>> 4);
        }
      }
    }
  }
  return rgba;
}

/**
 * Returns null for anything that isn't a readable DS banner — homebrew with
 * no banner, a truncated dump, a ROM that moved. A missing icon is a cover
 * we don't have, never an error worth propagating.
 */
export function extractNdsIcon(fileUri: string): DecodedIcon | null {
  let handle: ReturnType<File['open']> | null = null;
  try {
    const file = new File(fileUri);
    if (!file.exists) return null;
    handle = file.open();

    const size = handle.size ?? 0;
    if (size < HEADER_BANNER_OFFSET + 4) return null;

    handle.offset = HEADER_BANNER_OFFSET;
    const pointer = handle.readBytes(4);
    const bannerOffset =
      ((pointer[0]! | (pointer[1]! << 8) | (pointer[2]! << 16) | (pointer[3]! << 24)) >>> 0);
    if (bannerOffset === 0 || bannerOffset + BANNER_PREFIX > size) return null;

    handle.offset = bannerOffset;
    const banner = handle.readBytes(BANNER_PREFIX);
    if (banner.length < BANNER_PREFIX) return null;

    return {
      rgba: decodeNdsIcon(
        banner.subarray(ICON_BITMAP, ICON_PALETTE),
        banner.subarray(ICON_PALETTE, BANNER_PREFIX)
      ),
      width: NDS_ICON_SIZE,
      height: NDS_ICON_SIZE,
    };
  } catch {
    return null;
  } finally {
    try {
      handle?.close();
    } catch {
      // Nothing useful to do; the read already succeeded or didn't.
    }
  }
}
