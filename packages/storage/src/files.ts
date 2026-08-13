import { Directory, File, Paths } from 'expo-file-system';
import type { ConsoleSpec } from '@emulators/core-interface';

/** `Paths.document/roms/` — created on first use. Every imported ROM lives here. */
export function romsDirectory(): Directory {
  const dir = new Directory(Paths.document, 'roms');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Keeps names ASCII so `Paths.join` never percent-encodes and Kotlin's
 * `Uri.parse(uri).path` is exact. Do not drop this.
 */
export function sanitizeFileName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9._-]+/g, '_');
  if (sanitized.length <= 120) return sanitized;
  // Cap length but keep the extension, which drives console detection.
  const ext = extensionOf(sanitized);
  const stem = stripExtension(sanitized);
  return ext ? `${stem.slice(0, 120 - ext.length - 1)}.${ext}` : stem.slice(0, 120);
}

/** Lower-cased extension without the dot; '' if none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Matches an extension against `ConsoleSpec.romExtensions`, or null. */
export function consoleForExtension(
  consoles: ConsoleSpec[],
  extension: string
): ConsoleSpec | null {
  return consoles.find((c) => c.romExtensions.includes(extension)) ?? null;
}

/** All accepted extensions as ".gba, .gbc, .gb" — for error text and the empty state. */
export function acceptedExtensions(consoles: ConsoleSpec[]): string {
  return consoles
    .flatMap((c) => c.romExtensions)
    .map((e) => `.${e}`)
    .join(', ');
}

/** `Game.gba` → `Game_2.gba` if taken (different ROM, same filename). */
export function uniqueFileName(dir: Directory, name: string): string {
  if (!new File(dir, name).exists) return name;
  const ext = extensionOf(name);
  const stem = stripExtension(name);
  for (let n = 2; ; n++) {
    const candidate = ext ? `${stem}_${n}.${ext}` : `${stem}_${n}`;
    if (!new File(dir, candidate).exists) return candidate;
  }
}

/**
 * The single place an absolute ROM path exists; the DB stores only
 * `file_name`, so the URI survives backup restore / profile changes.
 */
export function romFileUri(fileName: string): string {
  return new File(romsDirectory(), fileName).uri;
}

export function deleteRomFile(fileName: string): void {
  const file = new File(romsDirectory(), fileName);
  if (file.exists) file.delete();
}

/**
 * `Paths.document/state-thumbs/` — created on first use. Savestate previews
 * live here rather than in the core's private layout, so the shared UI can
 * render them without knowing how any core names its files.
 */
export function stateThumbsDirectory(): Directory {
  const dir = new Directory(Paths.document, 'state-thumbs');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * `<romId>-<slot>-<savedAt>.png`. The timestamp is part of the name on
 * purpose: React Native caches images by URI, so a slot written again under
 * its old name would keep showing the previous frame.
 */
function stateThumbName(romId: number, slot: number, savedAt: number): string {
  return `${romId}-${slot}-${savedAt}.png`;
}

export function stateThumbUri(romId: number, slot: number, savedAt: number): string {
  return new File(stateThumbsDirectory(), stateThumbName(romId, slot, savedAt)).uri;
}

export function deleteStateThumb(romId: number, slot: number, savedAt: number): void {
  const file = new File(stateThumbsDirectory(), stateThumbName(romId, slot, savedAt));
  if (file.exists) file.delete();
}

/** Every thumbnail belonging to a ROM, whatever slot or timestamp. */
export function deleteStateThumbsForRom(romId: number): void {
  // Trailing dash included, or ROM 1 would sweep up ROM 12's thumbnails.
  const prefix = `${romId}-`;
  for (const entry of stateThumbsDirectory().list()) {
    if (entry instanceof File && entry.name.startsWith(prefix)) entry.delete();
  }
}

/**
 * `Paths.document/covers/` — created on first use. Box art downloaded from
 * the thumbnail CDN, and DS banner icons decoded from the ROM itself.
 */
export function coversDirectory(): Directory {
  const dir = new Directory(Paths.document, 'covers');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * `<romId>-<stamp>.png`. The stamp exists for the same reason as the one in
 * `stateThumbName`: React Native caches images by URI, so a cover replaced
 * under its old name would keep rendering the previous art.
 */
export function coverFileName(romId: number, stamp: number): string {
  return `${romId}-${stamp}.png`;
}

/** Takes the stored `roms.cover_file`, not a ROM id — the DB owns the name. */
export function coverUri(fileName: string): string {
  return new File(coversDirectory(), fileName).uri;
}

export function deleteCover(fileName: string): void {
  const file = new File(coversDirectory(), fileName);
  if (file.exists) file.delete();
}

/** Every cover belonging to a ROM, whatever stamp. Also catches `.part` files. */
export function deleteCoversForRom(romId: number): void {
  // Trailing dash included, or ROM 1 would sweep up ROM 12's covers.
  const prefix = `${romId}-`;
  for (const entry of coversDirectory().list()) {
    if (entry instanceof File && entry.name.startsWith(prefix)) entry.delete();
  }
}

/**
 * Covers download to `<name>.part` and are renamed into place, so a process
 * killed mid-download leaves one behind. Called once at the top of a sweep.
 */
export function sweepPartialCovers(): void {
  for (const entry of coversDirectory().list()) {
    if (entry instanceof File && entry.name.endsWith('.part')) entry.delete();
  }
}
