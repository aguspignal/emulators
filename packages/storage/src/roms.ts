import type { SQLiteDatabase } from 'expo-sqlite';
import type { RomInfo } from '@emulators/core-interface';
import type { RomRow } from './schema';
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
     SET header_title = ?, console_id = ?, size = ?, last_played_at = ?, play_count = play_count + 1
     WHERE id = ?`,
    headerTitle,
    info.console,
    info.size,
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

export async function deleteRomRow(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM roms WHERE id = ?', id);
}
