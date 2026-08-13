import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * App settings, one row per key. Values are strings; callers own the encoding
 * (booleans are '1'/'0'). A missing key means "never set" — the caller applies
 * its default, so defaults can change in code without a migration.
 */
export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}
