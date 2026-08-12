import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useKeepAwake } from 'expo-keep-awake';
import { CONSOLES, type EmulatorSubscription, type RomInfo } from '@emulators/core-interface';
import { applyRomInfo } from '@emulators/storage';
import { useAppConfig } from '../config';
import { colors } from '../theme';
import { showErrorAlert } from '../utils/errors';
import { GamepadOverlay } from '../components/gamepad/GamepadOverlay';
import { GameMenu } from '../components/gamepad/GameMenu';
import { useEmulatorLayout } from '../components/gamepad/useEmulatorLayout';
import type { Rect } from '../components/gamepad/layout';
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

  // Emulation must not keep running with the app backgrounded or the screen
  // off. The core's state is the only thing consulted: if the game is already
  // paused (pause menu open, still booting) nothing is remembered, so coming
  // back doesn't resume behind the menu. Cores are expected to enforce this
  // natively too — the emulation thread is native and outlives a throttled JS
  // thread — but both are idempotent, so whichever fires first wins.
  const resumeOnForeground = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (resumeOnForeground.current) {
          resumeOnForeground.current = false;
          core.resume();
        }
      } else if (core.getState() === 'running') {
        resumeOnForeground.current = true;
        core.pause();
      }
    });
    return () => sub.remove();
  }, [core]);

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
  // Rotating the device rebuilds this: landscape floats the pad over a
  // full-bleed game, portrait puts the game on top and the pad in a band below.
  const layout = useEmulatorLayout(spec.buttons);

  return (
    <View style={styles.container}>
      {layout.orientation === 'portrait' && (
        // The band's own surface, so the pad's translucent buttons read against
        // something other than the letterboxing above them. Runs to the bottom
        // edge rather than stopping at the inset, which would strand a black
        // strip under the gesture bar.
        <View style={[styles.padBand, { top: layout.padArea.y }]} />
      )}
      <EmulatorView style={absoluteRect(layout.screen)} />
      {booted && <GamepadOverlay layout={layout.pad} onMenu={openMenu} suspended={menuOpen} />}
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

function absoluteRect(rect: Rect) {
  return {
    position: 'absolute' as const,
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  padBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
  },
});
