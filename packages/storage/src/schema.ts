import type { SQLiteDatabase } from 'expo-sqlite';
import type { ConsoleId } from '@emulators/core-interface';

export const DATABASE_NAME = 'emulators.db';

export interface RomRow {
  id: number;
  /** Sanitized basename on disk, UNIQUE. The file:// URI loadRom needs is derived at runtime via romFileUri(). */
  file_name: string;
  /** Picked filename without extension; what the library displays. */
  display_name: string;
  /** Real ROM-header title only; null until first load, and kept null when the core fell back to the filename stem. */
  header_title: string | null;
  /** Provisional (from extension) until the core reports it. */
  console_id: ConsoleId;
  extension: string;
  size: number;
  /** Dedup key. */
  content_md5: string;
  /**
   * SHA-1 the core reported, which names its save files. Null until the ROM
   * has been played once since the v2 upgrade — treat it as "unknown", not
   * "no saves".
   */
  sha1: string | null;
  added_at: number;
  last_played_at: number | null;
  play_count: number;
  favorite: 0 | 1;
  /** Filename in `covers/`, or null when this ROM has no cover art. */
  cover_file: string | null;
  /** What kind of art `cover_file` holds — the tile renders the two differently. */
  cover_source: CoverSource | null;
  cover_state: CoverState;
  /** When the last cover lookup ran; null until one has. */
  cover_checked_at: number | null;
  /**
   * Drives the retry backoff exponent — deliberately NOT a give-up counter.
   * Nothing here can tell "offline" from "the CDN is down", so a cap would
   * turn one flight in airplane mode into a permanently coverless library.
   * The backoff ceiling bounds the cost instead.
   */
  cover_attempts: number;
  /**
   * The cover's real width/height, so its tile can be exactly that shape.
   * Null for a ROM with no cover, and for icons — those are centred in a box
   * sized from the console default, not stretched to fill it.
   */
  cover_ratio: number | null;
}

/** Box art from the thumbnail CDN, or an icon decoded from the ROM itself. */
export type CoverSource = 'boxart' | 'icon';

/**
 * How far a ROM has got through cover lookup. The distinction between
 * `missing` and `failed` is what keeps the background sweep off the network:
 * `missing` means every source was tried and none had art (a 404 is a real
 * answer), `failed` means something transient went wrong and is worth
 * retrying sooner.
 */
export type CoverState = 'pending' | 'ok' | 'missing' | 'failed';

/**
 * Runs pending migrations. Passed to SQLiteProvider's onInit.
 *
 * Migration rule: add a new `if (version < N)` block per change, NEVER edit
 * an existing one — installed databases have already run it.
 *
 * That rule is also how a regenerated cover index reaches existing libraries:
 * `cover_state = 'missing'` is near-permanent by design, so after rebuilding
 * `apps/*\/assets/covers/*.ts` add a block whose whole body is
 * `UPDATE roms SET cover_state = 'pending', cover_attempts = 0
 *  WHERE cover_state = 'missing'`. Deliberate and reviewed, with no new schema.
 */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  if (version < 1) {
    await db.execAsync(`
      CREATE TABLE roms (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name      TEXT    NOT NULL UNIQUE,
        display_name   TEXT    NOT NULL,
        header_title   TEXT,
        console_id     TEXT    NOT NULL,
        extension      TEXT    NOT NULL,
        size           INTEGER NOT NULL DEFAULT 0,
        content_md5    TEXT    NOT NULL UNIQUE,
        added_at       INTEGER NOT NULL,
        last_played_at INTEGER,
        play_count     INTEGER NOT NULL DEFAULT 0,
        favorite       INTEGER NOT NULL DEFAULT 0
      );
    `);
    version = 1;
  }
  if (version < 2) {
    // The core names save files by ROM SHA-1, so the library has to know it to
    // clean up after a deleted ROM. Backfilled by applyRomInfo on next play.
    // save_states mirrors what the core has on disk: one row per written slot,
    // which is also what the slot picker lists (a bare file gives no timestamp
    // without opening it). Slot 0 is the automatic one.
    await db.execAsync(`
      ALTER TABLE roms ADD COLUMN sha1 TEXT;
      CREATE TABLE save_states (
        rom_id   INTEGER NOT NULL,
        slot     INTEGER NOT NULL,
        saved_at INTEGER NOT NULL,
        PRIMARY KEY (rom_id, slot)
      );
    `);
    version = 2;
  }
  if (version < 3) {
    // Cover art. `cover_file` names a file in `covers/`, never an absolute
    // path — same reasoning as `file_name`. Existing rows default to
    // 'pending', which is what makes the background sweep pick up a library
    // that predates this column.
    await db.execAsync(`
      ALTER TABLE roms ADD COLUMN cover_file       TEXT;
      ALTER TABLE roms ADD COLUMN cover_source     TEXT;
      ALTER TABLE roms ADD COLUMN cover_state      TEXT    NOT NULL DEFAULT 'pending';
      ALTER TABLE roms ADD COLUMN cover_checked_at INTEGER;
      ALTER TABLE roms ADD COLUMN cover_attempts   INTEGER NOT NULL DEFAULT 0;
    `);
    version = 3;
  }
  if (version < 4) {
    // Box scans have no common shape — measured across 40 covers per console,
    // DS/3DS cluster tightly around 1.11/1.13 but the Game Boy family runs
    // 0.64 to 1.65 because the scans come from square carts, wide long-boxes
    // and tall boxes alike. Storing each cover's real width/height lets its
    // tile take exactly that shape instead of letterboxing inside a guess.
    await db.execAsync(`ALTER TABLE roms ADD COLUMN cover_ratio REAL;`);
    version = 4;
  }

  // No index on roms, deliberately: the list query sorts by
  // COALESCE(last_played_at, added_at), which an index on the raw columns
  // can't serve, and the table is a few hundred rows at most.

  await db.execAsync(`PRAGMA user_version = ${version}`); // PRAGMA can't be parameterised; local int only
}
