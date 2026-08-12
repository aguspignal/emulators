import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { EmulatorSubscription } from '@emulators/core-interface';
import { applyRomInfo } from '@emulators/storage';
import { useAppConfig } from '../config';
import { showErrorAlert } from '../utils/errors';
import type { RootScreenProps } from '../navigation/types';

/**
 * Hosts the app's native emulator view. Will grow the on-screen gamepad
 * overlay, pause menu, and savestate controls.
 */
export function EmulatorScreen({ route, navigation }: RootScreenProps<'Emulator'>) {
  const { core, EmulatorView } = useAppConfig();
  const db = useSQLiteContext();
  const { romId, romUri } = route.params;

  useEffect(() => {
    let cancelled = false;
    let errorSub: EmulatorSubscription | undefined;
    core
      .loadRom(romUri)
      .then((info) => {
        if (cancelled) return;
        // Subscribe only after boot: the core both emits 'error' and rejects
        // on the same loadRom failure, so an earlier subscription would
        // double-alert. Post-boot, the event covers mid-game errors.
        errorSub = core.addListener('error', ({ message }) =>
          showErrorAlert(
            'Emulator problem',
            new Error(message),
            'The emulator hit a problem. The game may not work correctly.'
          )
        );
        core.start();
        // Reconcile the import-time guess: the picker can only infer gb vs
        // gbc from the extension, while the core reads the ROM header.
        // Log-only: a failed DB write must never eject a running game.
        applyRomInfo(db, romId, info).catch((error: unknown) =>
          console.error('applyRomInfo failed:', error)
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        showErrorAlert(
          "Couldn't start game",
          error,
          "This game couldn't be started. The ROM file may be missing, corrupted, or unsupported.",
          () => navigation.goBack()
        );
      });
    return () => {
      cancelled = true;
      errorSub?.remove();
      core.unloadRom().catch((error: unknown) => console.error('unloadRom failed:', error));
    };
  }, [core, db, romId, romUri, navigation]);

  return (
    <View style={styles.container}>
      <EmulatorView style={styles.emulator} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  emulator: { flex: 1 },
});
