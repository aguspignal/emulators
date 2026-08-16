import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
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
import { findRomByMd5, getRom, insertRom } from './roms';
import type { RomRow } from './schema';

export type RomImportErrorCode = 'unsupported_file' | 'unreadable_file' | 'no_space';

/** A user-facing import failure; the message is safe to show in an alert. */
export class RomImportError extends Error {
  constructor(
    /** Stable failure kind; `@emulators/ui` maps it to localized copy. */
    readonly code: RomImportErrorCode,
    /** Values the localized message interpolates. */
    readonly params: { name: string; extensions?: string },
    /** English fallback — logs, and any consumer that doesn't translate. */
    message: string
  ) {
    super(message);
    this.name = 'RomImportError';
  }
}

export type RomImportResult =
  | { status: 'cancelled' }
  | { status: 'duplicate'; id: number; displayName: string }
  | { status: 'imported'; id: number };

/** What an already-open file resolved to. Both cases carry a bootable row. */
export type OpenedRomImport =
  | { status: 'duplicate'; rom: RomRow }
  | { status: 'imported'; rom: RomRow };

/**
 * Everything one file can end as. Deliberately data, not exceptions: the
 * folder path tallies dozens of these, and one bad file must not end a batch.
 * The single-file entry points turn them back into throws via `unwrapOutcome`.
 */
type RomFileOutcome =
  | { status: 'imported'; id: number }
  | { status: 'duplicate'; rom: RomRow }
  | { status: 'unsupported' } // an extension we don't emulate
  | { status: 'unreadable' } // md5 came back null
  | { status: 'no_space' }
  | { status: 'failed'; error: unknown }; // copy or SQLite failure

/**
 * De-duplicate one source file by content MD5 and copy it into
 * `Paths.document/roms/` — once, at import time. The copy is what gives the
 * native core a durable real `file://` path (a `content://` URI expires with
 * the process and can't be `fopen()`ed).
 *
 * `name` and `size` are passed in rather than read off `source`, because the
 * document picker reports both for assets whose provider answers neither.
 *
 * **Never throws.** Every failure is a returned status.
 */
async function importRomFile(
  db: SQLiteDatabase,
  consoles: ConsoleSpec[],
  source: File,
  name: string,
  size: number
): Promise<RomFileOutcome> {
  const extension = extensionOf(name);
  const spec = consoleForExtension(consoles, extension);
  if (!spec) return { status: 'unsupported' };

  try {
    // Dedup BEFORE copying: hashing streams the source, it never writes.
    // Catches the same ROM re-picked from another folder or under another name.
    const md5 = source.md5; // string | null — the native getter swallows read errors
    if (!md5) return { status: 'unreadable' };
    const existing = await findRomByMd5(db, md5);
    if (existing) return { status: 'duplicate', rom: existing };

    // Read fresh per file rather than once per batch: each earlier import is
    // already on disk, so the remaining space really has shrunk.
    if (size > Paths.availableDiskSpace) return { status: 'no_space' };

    const dir = romsDirectory();
    const fileName = uniqueFileName(dir, sanitizeFileName(name));
    const destination = new File(dir, fileName);
    await source.copy(destination); // content:// -> file:// stream copy

    try {
      const id = await insertRom(db, {
        file_name: fileName,
        display_name: stripExtension(name),
        console_id: spec.id,
        extension,
        size,
        content_md5: md5,
      });
      return { status: 'imported', id };
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
  } catch (error) {
    return { status: 'failed', error };
  }
}

/**
 * The single-file contract: the same `RomImportError` throws these entry
 * points have always raised, so `@emulators/ui`'s `showErrorAlert` and the
 * `import.*` catalog keys keep working.
 */
function unwrapOutcome(
  consoles: ConsoleSpec[],
  name: string,
  outcome: RomFileOutcome
): { status: 'imported'; id: number } | { status: 'duplicate'; rom: RomRow } {
  switch (outcome.status) {
    case 'imported':
    case 'duplicate':
      return outcome;
    case 'unsupported':
      throw new RomImportError(
        'unsupported_file',
        { name, extensions: acceptedExtensions(consoles) },
        `"${name}" isn't a supported ROM. Expected: ${acceptedExtensions(consoles)}`
      );
    case 'unreadable':
      throw new RomImportError('unreadable_file', { name }, `Couldn't read "${name}".`);
    case 'no_space':
      throw new RomImportError(
        'no_space',
        { name },
        `Not enough free space to import "${name}".`
      );
    case 'failed':
      throw outcome.error;
  }
}

/** Pick a ROM from device storage and import it. */
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

  const source = new File(asset.uri);
  const outcome = unwrapOutcome(
    consoles,
    asset.name,
    await importRomFile(db, consoles, source, asset.name, asset.size ?? source.size ?? 0)
  );
  return outcome.status === 'duplicate'
    ? { status: 'duplicate', id: outcome.rom.id, displayName: outcome.rom.display_name }
    : outcome;
}

/**
 * Import a ROM the system handed us — an `ACTION_VIEW` intent from a file
 * manager, whose URI reaches JS through React Native's `Linking`. Same
 * dedup-then-copy path as the picker; the only difference is that the name
 * and size come off the URI, since there is no picker asset to describe it.
 *
 * A duplicate is not an error here: the caller wants to boot the ROM, and it
 * already has a row. Both outcomes therefore return one.
 */
export async function importRomFromUri(
  db: SQLiteDatabase,
  consoles: ConsoleSpec[],
  uri: string
): Promise<OpenedRomImport> {
  const source = new File(uri);
  // `File#name` resolves a content:// URI through the provider's
  // DISPLAY_NAME, falling back to the URI's last path segment. A provider
  // that answers neither with an extension lands on `unsupported_file`,
  // which is the right answer to the broad MIME filter that got us here.
  const name = source.name;
  const outcome = unwrapOutcome(
    consoles,
    name,
    await importRomFile(db, consoles, source, name, source.size ?? 0)
  );
  if (outcome.status === 'duplicate') return outcome;

  const rom = await getRom(db, outcome.id);
  if (!rom) {
    throw new RomImportError('unreadable_file', { name }, `Imported "${name}" is missing.`);
  }
  return { status: 'imported', rom };
}

/** What the batch is doing right now, for a progress overlay. */
export interface FolderImportProgress {
  done: number;
  total: number;
  currentName: string;
}

/** A whole folder's tally. Per-file failures are counted here, never thrown. */
export type FolderImportResult =
  | { status: 'cancelled' }
  | {
      status: 'done';
      imported: number;
      duplicates: number;
      /** Files in the folder that aren't a ROM for any console this app runs. */
      skipped: number;
      /** Unreadable, out of space, or a copy/DB failure. */
      failed: number;
    };

/** The walk's result: what to import, and how much wasn't ours to begin with. */
interface RomScan {
  files: File[];
  skipped: number;
}

/**
 * Recursively collect the ROMs under a picked folder. Filtering happens here
 * rather than in the import loop so `total` is a real number the overlay can
 * count against.
 */
function collectRomFiles(dir: Directory, consoles: ConsoleSpec[], scan: RomScan): void {
  let entries: (Directory | File)[];
  try {
    entries = dir.list();
  } catch (error) {
    // One folder we can't read must not end the walk.
    console.warn(`could not list "${dir.uri}" while importing:`, error);
    return;
  }
  for (const entry of entries) {
    if (entry instanceof Directory) {
      collectRomFiles(entry, consoles, scan);
    } else if (consoleForExtension(consoles, extensionOf(entry.name))) {
      scan.files.push(entry);
    } else {
      scan.skipped++;
    }
  }
}

/**
 * Pick a folder and import every ROM under it, subfolders included. Same
 * dedup-then-copy path as the single-file import, run once per file — but
 * nothing a single file can do throws here; the tally is the result.
 */
export async function pickAndImportFolder(
  db: SQLiteDatabase,
  consoles: ConsoleSpec[],
  onProgress?: (progress: FolderImportProgress) => void
): Promise<FolderImportResult> {
  let root: Directory;
  try {
    // Android's folder picker: the returned URI is a granted content:// tree,
    // not a path. `list`, `md5` and `copy` all work on it.
    root = await Directory.pickDirectoryAsync();
  } catch (error) {
    if (isPickerCancelled(error)) return { status: 'cancelled' };
    throw error;
  }

  const scan: RomScan = { files: [], skipped: 0 };
  collectRomFiles(root, consoles, scan);

  const total = scan.files.length;
  let imported = 0;
  let duplicates = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    const file = scan.files[i];
    const name = file.name;
    onProgress?.({ done: i, total, currentName: name });
    // `File#md5` is a synchronous native call. Back to back over 90 files it
    // would hold the JS thread from the first hash to the last, so the
    // overlay would never repaint — yield a tick between files.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const outcome = await importRomFile(db, consoles, file, name, file.size ?? 0);
    switch (outcome.status) {
      case 'imported':
        imported++;
        break;
      case 'duplicate':
        duplicates++;
        break;
      case 'unsupported':
        scan.skipped++;
        break;
      case 'failed':
        console.error(`could not import "${name}":`, outcome.error);
        failed++;
        break;
      default: // 'unreadable' | 'no_space'
        failed++;
        break;
    }
  }
  onProgress?.({ done: total, total, currentName: '' });

  return { status: 'done', imported, duplicates, skipped: scan.skipped, failed };
}

/** Backing out of the folder picker rejects; that one code is not an error. */
function isPickerCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ERR_PICKER_CANCELLED'
  );
}
