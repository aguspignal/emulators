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
  added_at: number;
  last_played_at: number | null;
  play_count: number;
  favorite: 0 | 1;
}

/**
 * Runs pending migrations. Passed to SQLiteProvider's onInit.
 *
 * Migration rule: add a new `if (version < N)` block per change, NEVER edit
 * an existing one — installed databases have already run it.
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
  // v2 (deferred): ALTER TABLE roms ADD COLUMN sha1 TEXT; + save_states, once RomInfo exposes the SHA-1.

  // No index on roms, deliberately: the list query sorts by
  // COALESCE(last_played_at, added_at), which an index on the raw columns
  // can't serve, and the table is a few hundred rows at most.

  await db.execAsync(`PRAGMA user_version = ${version}`); // PRAGMA can't be parameterised; local int only
}
