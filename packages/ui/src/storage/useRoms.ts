import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { listRoms, type RomRow } from '@emulators/storage';

/**
 * The Home screen's view of the library. Re-queries on focus so returning
 * from the Emulator screen reflects the play just recorded.
 *
 * `reload` never rejects — failures are logged and land in `error` — so
 * callers may fire-and-forget it.
 *
 * Lives in @emulators/ui (not @emulators/storage) so the storage package
 * stays React-free.
 */
export function useRoms(): {
  roms: RomRow[];
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
} {
  const db = useSQLiteContext();
  const [roms, setRoms] = useState<RomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    try {
      setRoms(await listRoms(db));
      setError(null);
    } catch (e) {
      console.error('Failed to load ROM library:', e);
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRoms(db).then(
        (rows) => {
          if (!cancelled) {
            setRoms(rows);
            setError(null);
            setLoading(false);
          }
        },
        (e: unknown) => {
          if (!cancelled) {
            console.error('Failed to load ROM library:', e);
            setError(e);
            setLoading(false);
          }
        }
      );
      return () => {
        cancelled = true;
      };
    }, [db])
  );

  return { roms, loading, error, reload };
}
