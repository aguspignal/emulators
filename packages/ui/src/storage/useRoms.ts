import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { listRoms, type RomRow } from '@emulators/storage';

/**
 * The Home screen's view of the library. Re-queries on focus so returning
 * from the Emulator screen reflects the play just recorded.
 *
 * Lives in @emulators/ui (not @emulators/storage) so the storage package
 * stays React-free.
 */
export function useRoms(): {
  roms: RomRow[];
  loading: boolean;
  reload: () => Promise<void>;
} {
  const db = useSQLiteContext();
  const [roms, setRoms] = useState<RomRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setRoms(await listRoms(db));
    setLoading(false);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRoms(db).then((rows) => {
        if (!cancelled) {
          setRoms(rows);
          setLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [db])
  );

  return { roms, loading, reload };
}
