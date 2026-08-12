import { StyleSheet, Text, View } from 'react-native';
import { acceptedExtensions } from '@emulators/storage';
import { useAppConfig } from '../config';
import { colors, spacing, typography } from '../theme';
import { PrimaryButton } from './PrimaryButton';

export function EmptyLibrary({ onAdd }: { onAdd: () => void }) {
  const { consoles } = useAppConfig();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>No ROMs yet</Text>
      <Text style={styles.subtitle}>
        Add a ROM from your device to start playing. Supported files:{' '}
        {acceptedExtensions(consoles)}
      </Text>
      <PrimaryButton label="Add ROM" onPress={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
