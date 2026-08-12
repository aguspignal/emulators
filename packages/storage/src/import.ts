import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { ConsoleSpec } from '@emulators/core-interface';
import {
  acceptedExtensions,
  consoleForExtension,
  extensionOf,
  romsDirectory,
  sanitizeFileName,
  stripExtension,
  uniqueFileName,
} from './files';
import { findRomByMd5, insertRom } from './roms';

/** A user-facing import failure; the message is safe to show in an alert. */
export class RomImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RomImportError';
  }
}

export type RomImportResult =
  | { status: 'cancelled' }
  | { status: 'duplicate'; id: number; displayName: string }
  | { status: 'imported'; id: number };

/**
 * Pick a ROM from device storage, de-duplicate by content MD5, and copy it
 * into `Paths.document/roms/` — once, at import time. The copy is what gives
 * the native core a durable real `file://` path (a `content://` URI expires
 * with the process and can't be `fopen()`ed).
 */
export async function pickAndImportRom(
  db: SQLiteDatabase,
  consoles: ConsoleSpec[]
): Promise<RomImportResult> {
  // .gba/.nds/.3ds have no registered MIME type -> must accept everything
  // and filter by extension ourselves.
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: false,
    multiple: false,
  });
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets?.[0];
  if (!asset) return { status: 'cancelled' };

  const extension = extensionOf(asset.name);
  const spec = consoleForExtension(consoles, extension);
  if (!spec) {
    throw new RomImportError(
      `"${asset.name}" isn't a supported ROM. Expected: ${acceptedExtensions(consoles)}`
    );
  }

  const source = new File(asset.uri);

  // Dedup BEFORE copying: hashing streams the source, it never writes.
  // Catches the same ROM re-picked from another folder or under another name.
  const md5 = source.md5; // string | null — the native getter swallows read errors
  if (!md5) throw new RomImportError(`Couldn't read "${asset.name}".`);
  const existing = await findRomByMd5(db, md5);
  if (existing) {
    return { status: 'duplicate', id: existing.id, displayName: existing.display_name };
  }

  const size = asset.size ?? source.size ?? 0;
  if (size > Paths.availableDiskSpace) {
    throw new RomImportError(`Not enough free space to import "${asset.name}".`);
  }

  const dir = romsDirectory();
  const fileName = uniqueFileName(dir, sanitizeFileName(asset.name));
  const destination = new File(dir, fileName);
  await source.copy(destination); // content:// -> file:// stream copy

  let id: number;
  try {
    id = await insertRom(db, {
      file_name: fileName,
      display_name: stripExtension(asset.name),
      console_id: spec.id,
      extension,
      size,
      content_md5: md5,
    });
  } catch (e) {
    // content_md5 UNIQUE is the backstop if the check above raced the
    // insert — don't strand an orphan copy the library can't see.
    try {
      destination.delete();
    } catch {
      // A failed cleanup must not mask the original error.
    }
    throw e;
  }
  return { status: 'imported', id };
}
