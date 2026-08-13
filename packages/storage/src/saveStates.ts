import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * One written savestate slot. The state itself lives in the core's own
 * storage, keyed by ROM SHA-1 — this row is what the library knows about it:
 * that the slot is occupied, and when it was written.
 */
export interface SaveStateRow {
  rom_id: number;
  /** 0 is the automatic slot (AUTO_SAVESTATE_SLOT); the rest are the user's. */
  slot: number;
  saved_at: number;
}

export function listSaveStates(db: SQLiteDatabase, romId: number): Promise<SaveStateRow[]> {
  return db.getAllAsync<SaveStateRow>(
    'SELECT * FROM save_states WHERE rom_id = ? ORDER BY slot',
    romId
  );
}

export function getSaveState(
  db: SQLiteDatabase,
  romId: number,
  slot: number
): Promise<SaveStateRow | null> {
  return db.getFirstAsync<SaveStateRow>(
    'SELECT * FROM save_states WHERE rom_id = ? AND slot = ?',
    romId,
    slot
  );
}

/** Records a slot as written. Overwriting a slot just moves its timestamp. */
export async function upsertSaveState(
  db: SQLiteDatabase,
  romId: number,
  slot: number,
  savedAt: number
): Promise<void> {
  await db.runAsync(
    `INSERT INTO save_states (rom_id, slot, saved_at) VALUES (?, ?, ?)
     ON CONFLICT(rom_id, slot) DO UPDATE SET saved_at = excluded.saved_at`,
    romId,
    slot,
    savedAt
  );
}

export async function deleteSaveState(
  db: SQLiteDatabase,
  romId: number,
  slot: number
): Promise<void> {
  await db.runAsync('DELETE FROM save_states WHERE rom_id = ? AND slot = ?', romId, slot);
}

export async function deleteSaveStatesForRom(db: SQLiteDatabase, romId: number): Promise<void> {
  await db.runAsync('DELETE FROM save_states WHERE rom_id = ?', romId);
}
