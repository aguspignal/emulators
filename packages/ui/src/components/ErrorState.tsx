import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';
import { PrimaryButton } from './PrimaryButton';

/**
 * Full-screen error fallback. Deliberately context-free (no useAppConfig)
 * and paints its own background: it must render even when the providers
 * above it — SQLite, config, navigation theme — are broken or unmounted.
 */
export function ErrorState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? <PrimaryButton label={actionLabel} onPress={onAction} /> : null}
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
    backgroundColor: colors.background,
  },
  title: { ...typography.title, color: colors.text },
  message: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
