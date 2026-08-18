import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, typography } from '../theme';
import { usePrimaryColor } from '../config';

export interface ImportProgressProps {
  visible: boolean;
  done: number;
  total: number;
  currentName: string;
}

/**
 * Blocking overlay for a folder import. Deliberately has no cancel: a batch
 * stopped mid-file would leave the library in a state the summary can't
 * describe honestly.
 */
export function ImportProgress({ visible, done, total, currentName }: ImportProgressProps) {
  const { t } = useTranslation();
  const primary = usePrimaryColor();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // With statusBarTranslucent alone the backdrop stops short of the
      // navigation bar and leaves a seam under the edge-to-edge layout.
      navigationBarTranslucent
      // Android back must not dismiss it mid-copy.
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={primary} />
          <Text style={styles.title}>{t('home.importingTitle')}</Text>
          <Text style={styles.count}>{t('home.importingProgress', { done, total })}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {currentName}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000cc',
    padding: spacing.xl,
  },
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { ...typography.title, color: colors.text, marginTop: spacing.xs },
  count: { ...typography.body, color: colors.text },
  name: { ...typography.caption, color: colors.textMuted, alignSelf: 'stretch', textAlign: 'center' },
});
