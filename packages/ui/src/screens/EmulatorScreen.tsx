import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppConfig } from '../config';
import type { RootScreenProps } from '../navigation/types';

/**
 * Hosts the app's native emulator view. Will grow the on-screen gamepad
 * overlay, pause menu, and savestate controls.
 */
export function EmulatorScreen({ route }: RootScreenProps<'Emulator'>) {
  const { core, EmulatorView } = useAppConfig();
  const { romUri } = route.params;

  useEffect(() => {
    let cancelled = false;
    core.loadRom(romUri).then(() => {
      if (!cancelled) core.start();
    });
    return () => {
      cancelled = true;
      core.unloadRom();
    };
  }, [core, romUri]);

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
