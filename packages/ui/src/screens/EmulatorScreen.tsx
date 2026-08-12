import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useKeepAwake } from 'expo-keep-awake';
import { CONSOLES, type EmulatorSubscription, type RomInfo } from '@emulators/core-interface';
import { applyRomInfo } from '@emulators/storage';
import { useAppConfig } from '../config';
import { showErrorAlert } from '../utils/errors';
import { GamepadOverlay } from '../components/gamepad/GamepadOverlay';
import { GameMenu } from '../components/gamepad/GameMenu';
import type { RootScreenProps } from '../navigation/types';

/**
 * Hosts the app's native emulator view, the on-screen gamepad, and the pause
 * menu. Will grow savestate controls.
 */
export function EmulatorScreen({ route, navigation }: RootScreenProps<'Emulator'>) {
  const { core, EmulatorView, consoles } = useAppConfig();
  const db = useSQLiteContext();
  const { romId, romUri } = route.params;
  const [booted, setBooted] = useState<RomInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useKeepAwake();

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
        setBooted(info);
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

  const openMenu = useCallback(() => {
    core.pause();
    setMenuOpen(true);
  }, [core]);

  const resume = useCallback(() => {
    setMenuOpen(false);
    core.resume();
  }, [core]);

  const reset = useCallback(() => {
    core.reset();
    setMenuOpen(false);
    core.resume();
  }, [core]);

  // The pad is laid out for the console the core actually detected from the
  // ROM header, not the app's headline console: a Game Boy ROM in the GBA app
  // must not show L/R.
  const spec = booted ? CONSOLES[booted.console] : consoles[0];

  return (
    <View style={styles.container}>
      <EmulatorView style={styles.emulator} />
      {booted && <GamepadOverlay spec={spec} onMenu={openMenu} suspended={menuOpen} />}
      {menuOpen && (
        <GameMenu
          title={booted?.title ?? ''}
          onResume={resume}
          onReset={reset}
          onExit={() => navigation.goBack()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  emulator: { flex: 1 },
});
