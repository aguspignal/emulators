import type { SQLiteDatabase } from 'expo-sqlite';
import type { RomInfo } from '@emulators/core-interface';
import type { CoverSource, RomRow } from './schema';
import { stripExtension } from './files';

/** Fields the import flow provides; the rest have DB defaults. */
export interface NewRom {
  file_name: string;
  display_name: string;
  console_id: string;
  extension: string;
  size: number;
  content_md5: string;
}

export function listRoms(db: SQLiteDatabase): Promise<RomRow[]> {
  return db.getAllAsync<RomRow>(
    `SELECT * FROM roms
     ORDER BY favorite DESC, COALESCE(last_played_at, added_at) DESC, id DESC`
  );
}

export function getRom(db: SQLiteDatabase, id: number): Promise<RomRow | null> {
  return db.getFirstAsync<RomRow>('SELECT * FROM roms WHERE id = ?', id);
}

/** The dedup lookup: same content, any filename, any folder. */
export function findRomByMd5(db: SQLiteDatabase, md5: string): Promise<RomRow | null> {
  return db.getFirstAsync<RomRow>('SELECT * FROM roms WHERE content_md5 = ?', md5);
}

export async function insertRom(db: SQLiteDatabase, rom: NewRom): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO roms (file_name, display_name, console_id, extension, size, content_md5, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    rom.file_name,
    rom.display_name,
    rom.console_id,
    rom.extension,
    rom.size,
    rom.content_md5,
    Date.now()
  );
  return result.lastInsertRowId;
}

/**
 * Reconciles the import-time guess with what the core read from the ROM
 * header (authoritative console, real size, header title) and records the
 * play. Call after a successful `loadRom`.
 */
export async function applyRomInfo(
  db: SQLiteDatabase,
  id: number,
  info: RomInfo
): Promise<void> {
  const row = await getRom(db, id);
  if (!row) return;

  // Fallback guard: when the ROM header has no title, the native side
  // substitutes the on-disk filename stem (RomFiles.kt fallbackTitle) — by
  // then the sanitized/_2-suffixed name. RomInfo.title can't distinguish the
  // two, so only store it when it differs from that stem.
  const headerTitle = info.title !== stripExtension(row.file_name) ? info.title : null;

  await db.runAsync(
    `UPDATE roms
     SET header_title = ?, console_id = ?, size = ?,
         -- Cores that couldn't hash the ROM report ''; keep whatever we already
         -- know rather than forgetting where this ROM's saves live.
         sha1 = COALESCE(NULLIF(?, ''), sha1),
         last_played_at = ?, play_count = play_count + 1
     WHERE id = ?`,
    headerTitle,
    info.console,
    info.size,
    info.sha1,
    Date.now(),
    id
  );
}

export async function setFavorite(
  db: SQLiteDatabase,
  id: number,
  favorite: boolean
): Promise<void> {
  await db.runAsync('UPDATE roms SET favorite = ? WHERE id = ?', favorite ? 1 : 0, id);
}

/** First retry after a transient failure; doubles per attempt from here. */
const FAILED_BACKOFF_MS = 30 * 1000;
/** Ceiling on that backoff — a permanently broken row costs ~4 requests/day. */
const FAILED_BACKOFF_CEILING_MS = 6 * 60 * 60 * 1000;
/**
 * A definitive miss is retried this rarely, as insurance: the CDN does gain
 * art over time. Regenerating the bundled index resets these wholesale
 * instead, via a migration block — see the rule in schema.ts.
 */
const MISSING_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A cover lookup that produced art. `ratio` is the image's real width/height
 * where we could measure it, and null to fall back to the console default.
 */
export async function setRomCover(
  db: SQLiteDatabase,
  id: number,
  coverFile: string,
  source: CoverSource,
  ratio: number | null
): Promise<void> {
  await db.runAsync(
    `UPDATE roms
     SET cover_file = ?, cover_source = ?, cover_ratio = ?, cover_state = 'ok',
         cover_checked_at = ?, cover_attempts = 0
     WHERE id = ?`,
    coverFile,
    source,
    ratio,
    Date.now(),
    id
  );
}

/**
 * A lookup that produced nothing. `'missing'` means every source was asked
 * and none had art — a durable answer, so attempts reset. `'failed'` means
 * something transient went wrong, and increments the backoff exponent.
 */
export async function setRomCoverEmpty(
  db: SQLiteDatabase,
  id: number,
  state: 'missing' | 'failed'
): Promise<void> {
  await db.runAsync(
    `UPDATE roms
     SET cover_state = ?, cover_checked_at = ?,
         cover_attempts = CASE WHEN ? = 'failed' THEN cover_attempts + 1 ELSE 0 END
     WHERE id = ?`,
    state,
    Date.now(),
    state,
    id
  );
}

/**
 * Puts a ROM back in the queue. Used when the UI finds `cover_file` naming a
 * file that is no longer on disk (backup restore, a half-finished rename).
 */
export async function resetRomCover(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    `UPDATE roms
     SET cover_file = NULL, cover_source = NULL, cover_ratio = NULL,
         cover_state = 'pending', cover_checked_at = NULL, cover_attempts = 0
     WHERE id = ?`,
    id
  );
}

/**
 * Covers fetched before `cover_ratio` existed. They are measured from the
 * files already on disk rather than re-downloaded — see `backfillCoverRatios`.
 */
export function listRomsMissingCoverRatio(db: SQLiteDatabase, limit: number): Promise<RomRow[]> {
  return db.getAllAsync<RomRow>(
    `SELECT * FROM roms
     WHERE cover_file IS NOT NULL AND cover_ratio IS NULL AND cover_source = 'boxart'
     LIMIT ?`,
    limit
  );
}

export async function setRomCoverRatio(
  db: SQLiteDatabase,
  id: number,
  ratio: number
): Promise<void> {
  await db.runAsync('UPDATE roms SET cover_ratio = ? WHERE id = ?', ratio, id);
}

/** Clears the backoff on every failed row, so pull-to-refresh retries now. */
export async function retryFailedCovers(db: SQLiteDatabase): Promise<void> {
  await db.runAsync("UPDATE roms SET cover_checked_at = 0 WHERE cover_state = 'failed'");
}

/**
 * ROMs the background sweep should look up. Ordered by the same key as
 * `listRoms`, so the sweep fills the top of the visible grid first — the
 * tiles the user is actually looking at. `limit` bounds one pass; the next
 * focus picks up where this left off.
 */
export function listRomsNeedingCover(
  db: SQLiteDatabase,
  limit: number,
  now: number = Date.now()
): Promise<RomRow[]> {
  return db.getAllAsync<RomRow>(
    // The failed clause is the backoff, in SQL so a row that isn't due yet
    // never leaves SQLite: 30s doubling per attempt, capped at 6h. The inner
    // MIN on the exponent keeps the shift from overflowing after ~40 misses.
    `SELECT * FROM roms
     WHERE cover_state = 'pending'
        OR (cover_state = 'failed' AND COALESCE(cover_checked_at, 0)
              + MIN(?, ? * (1 << MIN(cover_attempts, 20))) <= ?)
        OR (cover_state = 'missing' AND COALESCE(cover_checked_at, 0) < ?)
     ORDER BY favorite DESC, COALESCE(last_played_at, added_at) DESC, id DESC
     LIMIT ?`,
    FAILED_BACKOFF_CEILING_MS,
    FAILED_BACKOFF_MS,
    now,
    now - MISSING_RETRY_MS,
    limit
  );
}

export async function deleteRomRow(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM roms WHERE id = ?', id);
}
