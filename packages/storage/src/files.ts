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
