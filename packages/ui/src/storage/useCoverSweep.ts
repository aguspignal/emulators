import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { sweepCovers } from '@emulators/storage';
import { useAppConfig } from '../config';

/**
 * Fills in missing cover art in the background. Lives here rather than in
 * `@emulators/storage` for the same reason `useRoms` does — that package
 * stays React-free.
 *
 * Candidates come from the database, never from a `roms` array a caller
 * passes in. That decoupling is what makes the sweep safe to pair with
 * `onChanged`: the list re-rendering cannot re-trigger it.
 */
export function useCoverSweep(onChanged: () => void): () => void {
  const db = useSQLiteContext();
  const { coverIndexes } = useAppConfig();
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const sweep = useCallback(() => {
    if (inFlight.current || !coverIndexes?.length) return;
    inFlight.current = true;
    const own = new AbortController();
    controller.current = own;
    sweepCovers(db, coverIndexes, own.signal)
      .then((changed) => {
        // Once per run, not per ROM: a 24-ROM batch calling reload each time
        // is 24 queries and 24 re-renders of a grid full of images.
        if (changed > 0 && !own.signal.aborted) onChanged();
      })
      .catch((error: unknown) => console.warn('cover sweep failed:', error))
      .finally(() => {
        inFlight.current = false;
      });
  }, [db, coverIndexes, onChanged]);

  useFocusEffect(
    useCallback(() => {
      sweep();
      // Aborting rather than setting a cancelled flag, because unlike a
      // query there is real in-flight work to stop — the emulator screen
      // should not be competing with a download for IO.
      return () => controller.current?.abort();
    }, [sweep])
  );

  return sweep;
}
