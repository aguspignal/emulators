import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { ConsoleId } from '@emulators/core-interface';
import type { RomRow } from './schema';
import { lookupByMd5, lookupByNormalizedTitle, normalizeTitle, type CoverIndex } from './coverIndex';
import {
  coverFileName,
  coversDirectory,
  deleteCover,
  romFileUri,
  sweepPartialCovers,
} from './files';
import {
  listRomsMissingCoverRatio,
  listRomsNeedingCover,
  setRomCover,
  setRomCoverEmpty,
  setRomCoverRatio,
} from './roms';
import { extractNdsIcon } from './ndsBanner';
import { encodeRgbaPng, pngDimensions } from './png';

/**
 * Fallback tile shape per console, used for a ROM with no cover and for
 * icons (which are centred, not stretched). These are measured medians over
 * 40 sampled covers each: DS and 3DS cluster tightly, while the Game Boy
 * family runs from 0.64 to 1.65 and has no meaningful median — hence square,
 * and hence storing the real ratio for every cover we actually fetch.
 */
export const COVER_ASPECT: Record<ConsoleId, number> = {
  gb: 1,
  gbc: 1,
  gba: 1,
  nds: 1.111,
  '3ds': 1.13,
};

/** Reads just the IHDR off a written cover; null when it isn't a PNG. */
function measureCover(fileName: string): number | null {
  let handle: ReturnType<File['open']> | null = null;
  try {
    handle = new File(coversDirectory(), fileName).open();
    const size = pngDimensions(handle.readBytes(24));
    return size ? size.width / size.height : null;
  } catch {
    return null;
  } finally {
    try {
      handle?.close();
    } catch {
      // Nothing useful to do here.
    }
  }
}

/** The CDN's per-system folder names, which are also the DAT basenames. */
export const LIBRETRO_SYSTEM: Record<ConsoleId, string> = {
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  gba: 'Nintendo - Game Boy Advance',
  nds: 'Nintendo - Nintendo DS',
  '3ds': 'Nintendo - Nintendo 3DS',
};

const THUMBNAIL_HOST = 'https://thumbnails.libretro.com';

/** libretro's documented rule for turning a game name into a filename. */
export function sanitizeCoverName(name: string): string {
  return name.replace(/[&*\/:`<>?\\|"]/g, '_');
}

export function boxartUrl(consoleId: ConsoleId, canonicalName: string): string {
  // encodeURIComponent leaves !'()* literal, which is valid in a path and is
  // what other libretro clients emit. The system folder needs encoding too —
  // every one of them contains spaces.
  return (
    `${THUMBNAIL_HOST}/${encodeURIComponent(LIBRETRO_SYSTEM[consoleId])}` +
    `/Named_Boxarts/${encodeURIComponent(sanitizeCoverName(canonicalName))}.png`
  );
}

export interface ResolvedCover {
  /** The console of the index that matched — NOT necessarily `row.console_id`. */
  consoleId: ConsoleId;
  canonicalName: string;
}

/**
 * Finds the canonical name a ROM's art is filed under, entirely offline.
 *
 * Every index the app bundles is searched, not just the one for the row's
 * `console_id`: that column comes from the file extension at import and only
 * becomes authoritative after the core has read the header once, so a Game
 * Boy Color dump named `.gb` sits at `console_id: 'gb'` and would otherwise
 * be looked up — and requested — under the wrong system. Content MD5 is
 * globally unique, so searching everything is safe and self-correcting; the
 * matching index is what decides the system folder.
 *
 * Returning null means "no source knows this ROM", which is a durable answer
 * reached without a single network call.
 */
export function resolveCoverName(
  row: Pick<RomRow, 'console_id' | 'content_md5' | 'display_name' | 'header_title'>,
  indexes: CoverIndex[]
): ResolvedCover | null {
  if (indexes.length === 0) return null;
  // The row's own console first: usually right, and it keeps the common case
  // to a single map lookup.
  const ordered = [
    ...indexes.filter((i) => i.console === row.console_id),
    ...indexes.filter((i) => i.console !== row.console_id),
  ];

  for (const index of ordered) {
    const name = lookupByMd5(index, row.content_md5);
    if (name) return { consoleId: index.console, canonicalName: name };
  }

  // Fallbacks for ROMs absent from the tables — trimmed DS dumps (trimming
  // changes the hash), hacks, translations, homebrew. Deliberately exact
  // equality on a normalized title rather than fuzzy matching, and only
  // against names already known to exist, so a miss costs nothing and a hit
  // is a real CDN filename.
  for (const title of [row.display_name, row.header_title]) {
    if (!title) continue;
    const normalized = normalizeTitle(title);
    if (!normalized) continue;
    for (const index of ordered) {
      const name = lookupByNormalizedTitle(index, normalized);
      if (name) return { consoleId: index.console, canonicalName: name };
    }
  }

  return null;
}

/** Box scans run 200KB–3MB; anything larger is not a cover we want on disk. */
const MAX_COVER_BYTES = 3 * 1024 * 1024;
/** DownloadOptions has no timeout, so a half-open socket needs its own. */
const DOWNLOAD_TIMEOUT_MS = 20_000;
/** One sweep pass; successive focuses drain the rest of a big library. */
const SWEEP_LIMIT = 24;
/** Downloads share one radio — 2 pipelines without thrashing. */
const CONCURRENCY = 2;
/** Consecutive failures that end a run, so one offline session costs 3 requests. */
const CIRCUIT_BREAKER = 3;

export type CoverOutcome = 'updated' | 'missing' | 'failed' | 'aborted';

/** Why our own controller fired, which the thrown AbortError can't tell us. */
type AbortReason = 'timeout' | 'oversize' | null;

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /abort/i.test(error.message))
  );
}

/**
 * A 404 means libretro genuinely has no art for this name — a durable answer,
 * not a transient one. Matching on the message is fragile, but tolerable
 * precisely because we only ever request names that exist in the index.
 */
function isNotFound(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

/**
 * `SQLiteProvider` can close the database under a running sweep — a Fast
 * Refresh in development, or `AppRoot`'s ErrorState retry remounting the
 * provider in production. The sweep holds the old handle and every query
 * after that rejects with "Access to closed resource".
 *
 * There is nothing to report and nothing to retry: the next focus opens a
 * fresh run against the new handle. So this ends the run quietly rather than
 * logging a failure per ROM, and must never be recorded as a `failed` row —
 * that would inflate the backoff for ROMs that were never actually tried.
 */
function isClosedDatabase(error: unknown): boolean {
  return error instanceof Error && /closed resource/i.test(error.message);
}

/**
 * Downloads to `<name>.part` and renames into place, so a failure part-way
 * through can never leave a truncated file that looks like a real cover.
 * Android streams straight into the destination, which is exactly how that
 * would otherwise happen.
 */
async function downloadCover(
  url: string,
  romId: number,
  external: AbortSignal | undefined
): Promise<string> {
  const name = coverFileName(romId, Date.now());
  const part = new File(coversDirectory(), `${name}.part`);

  const controller = new AbortController();
  let reason: AbortReason = null;
  const onExternalAbort = () => controller.abort();
  external?.addEventListener('abort', onExternalAbort);
  const timer = setTimeout(() => {
    reason = 'timeout';
    controller.abort();
  }, DOWNLOAD_TIMEOUT_MS);

  try {
    await File.downloadFileAsync(url, part, {
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        // totalBytes is -1 when the server sends no Content-Length, so the
        // written count is the backstop for a chunked response.
        if (totalBytes > MAX_COVER_BYTES || bytesWritten > MAX_COVER_BYTES) {
          reason = 'oversize';
          controller.abort();
        }
      },
    });
    if (!part.exists || part.size === 0) {
      throw new Error('cover download produced an empty file');
    }
    part.rename(name);
    return name;
  } catch (error) {
    try {
      if (part.exists) part.delete();
    } catch {
      // A failed cleanup must not mask the original error.
    }
    if (reason === 'oversize') throw new OversizeCoverError();
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

/** Distinguishes "too big to keep" (durable) from "we gave up" (transient). */
class OversizeCoverError extends Error {
  constructor() {
    super('cover exceeds the size cap');
    this.name = 'OversizeCoverError';
  }
}

/** Icons are 32x32; 4x means Android scales the file down, which stays sharp. */
const ICON_SCALE = 4;

/**
 * The DS fallback: a cartridge carries its own icon, so a ROM the CDN has
 * never heard of still gets something. Only DS — a 3DS icon lives in the
 * encrypted part of a retail dump, and GB/GBA carts have no artwork at all.
 */
function writeNdsIcon(row: RomRow): string | null {
  if (row.console_id !== 'nds') return null;
  const icon = extractNdsIcon(romFileUri(row.file_name));
  if (!icon) return null;
  const name = coverFileName(row.id, Date.now());
  try {
    const file = new File(coversDirectory(), name);
    // `write` doesn't document creating the file, so don't depend on it.
    file.create({ intermediates: true, overwrite: true });
    file.write(encodeRgbaPng(icon.rgba, icon.width, icon.height, ICON_SCALE));
    return name;
  } catch (error) {
    console.warn('could not write a DS icon:', error);
    return null;
  }
}

/**
 * Resolves and fetches one ROM's cover, recording the outcome. Never throws:
 * every failure is a row state, because a cover is decoration and the caller
 * is a background sweep.
 */
export async function ensureCover(
  db: SQLiteDatabase,
  row: RomRow,
  indexes: CoverIndex[],
  signal?: AbortSignal
): Promise<CoverOutcome> {
  const commit = async (name: string, source: 'boxart' | 'icon') => {
    const previous = row.cover_file;
    // Only box art gets a measured shape. An icon is centred in a box sized
    // from the console default, so its own 1:1 would just make DS tiles
    // disagree with the box art beside them.
    await setRomCover(db, row.id, name, source, source === 'boxart' ? measureCover(name) : null);
    // Only after the row points at the new file, and never when the names
    // match — same ordering as savestate thumbnails in EmulatorScreen.
    if (previous && previous !== name) deleteCover(previous);
  };

  /** Every path where the CDN has nothing lands here before giving up. */
  const fallback = async (): Promise<CoverOutcome> => {
    const icon = writeNdsIcon(row);
    if (!icon) {
      await setRomCoverEmpty(db, row.id, 'missing');
      return 'missing';
    }
    await commit(icon, 'icon');
    return 'updated';
  };

  const resolved = resolveCoverName(row, indexes);
  // No source knows this ROM. Durable, and reached without any network.
  if (!resolved) return fallback();

  let name: string;
  try {
    name = await downloadCover(
      boxartUrl(resolved.consoleId, resolved.canonicalName),
      row.id,
      signal
    );
  } catch (error) {
    if (isNotFound(error) || error instanceof OversizeCoverError) return fallback();
    // An external abort is the screen going away mid-download. Record
    // nothing: burning an attempt would inflate the backoff for a row that
    // was never actually given a chance.
    if (signal?.aborted && isAbort(error)) return 'aborted';
    await setRomCoverEmpty(db, row.id, 'failed');
    return 'failed';
  }

  // The signal can fire between the download finishing and this write.
  if (signal?.aborted) {
    deleteCover(name);
    return 'aborted';
  }

  await commit(name, 'boxart');
  return 'updated';
}

/**
 * One pass over the ROMs due for a cover. Returns how many rows changed, so
 * the caller can refresh the list once rather than per ROM.
 */
/**
 * Measures covers downloaded before `cover_ratio` existed, straight from the
 * files on disk — no network. A cover whose file has gone gets the console
 * default written instead, so this converges rather than retrying forever;
 * the tile's own `onError` is what notices a missing file and re-queues it.
 */
async function backfillCoverRatios(db: SQLiteDatabase): Promise<number> {
  const rows = await listRomsMissingCoverRatio(db, 200);
  let measured = 0;
  for (const row of rows) {
    const ratio = (row.cover_file && measureCover(row.cover_file)) || COVER_ASPECT[row.console_id];
    if (!ratio) continue;
    await setRomCoverRatio(db, row.id, ratio);
    measured++;
  }
  return measured;
}

export async function sweepCovers(
  db: SQLiteDatabase,
  indexes: CoverIndex[],
  signal?: AbortSignal
): Promise<number> {
  if (indexes.length === 0) return 0;
  try {
    sweepPartialCovers();
  } catch (error) {
    console.warn('could not clear partial covers:', error);
  }

  let changed = 0;
  let stopped = false;

  try {
    changed += await backfillCoverRatios(db);

    const rows = await listRomsNeedingCover(db, SWEEP_LIMIT);
    if (rows.length === 0) return changed;

    let cursor = 0;
    let consecutiveFailures = 0;

    const worker = async () => {
      while (cursor < rows.length) {
        if (signal?.aborted || stopped) return;
        // Nothing here can tell "offline" from "the CDN is down", so bound
        // the damage per run instead of giving up on rows permanently.
        if (consecutiveFailures >= CIRCUIT_BREAKER) return;
        const row = rows[cursor++]!;
        let outcome: CoverOutcome;
        try {
          outcome = await ensureCover(db, row, indexes, signal);
        } catch (error) {
          if (isClosedDatabase(error)) {
            stopped = true;
            return;
          }
          // A row that throws outright still shouldn't take the run down.
          console.warn('cover lookup failed:', error);
          consecutiveFailures++;
          continue;
        }
        if (outcome === 'aborted') return;
        consecutiveFailures = outcome === 'failed' ? consecutiveFailures + 1 : 0;
        if (outcome === 'updated') changed++;
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (error) {
    if (!isClosedDatabase(error)) throw error;
  }
  return changed;
}
