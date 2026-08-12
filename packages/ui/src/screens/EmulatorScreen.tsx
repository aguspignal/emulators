import { useEffect } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { applyRomInfo } from '@emulators/storage';
import { useAppConfig } from '../config';
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
    core
      .loadRom(romUri)
      .then((info) => {
        if (cancelled) return;
        core.start();
        // Reconcile the import-time guess: the picker can only infer gb vs
        // gbc from the extension, while the core reads the ROM header.
        return applyRomInfo(db, romId, info);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        Alert.alert(
          "Couldn't start game",
          error instanceof Error ? error.message : String(error),
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      });
    return () => {
      cancelled = true;
      core.unloadRom();
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
