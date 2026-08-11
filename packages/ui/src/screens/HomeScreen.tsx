import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';
import { useAppConfig } from '../config';
import type { RootScreenProps } from '../navigation/types';

/**
 * Placeholder home screen. Will grow into the ROM library: pick ROMs from
 * device storage, list them, and navigate to the Emulator screen.
 */
export function HomeScreen(_props: RootScreenProps<'Home'>) {
  const { appName, consoles } = useAppConfig();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{appName}</Text>
      <Text style={styles.subtitle}>
        Emulates: {consoles.map((c) => c.displayName).join(', ')}
      </Text>
      <Text style={styles.hint}>ROM library coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
});
