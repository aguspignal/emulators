import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { acceptedExtensions } from '@emulators/storage';
import { useAppConfig } from '../config';
import { colors, spacing, typography } from '../theme';
import { PrimaryButton } from './PrimaryButton';

export function EmptyLibrary({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  const { consoles } = useAppConfig();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('home.emptyTitle')}</Text>
      <Text style={styles.subtitle}>
        {t('home.emptyMessage', { extensions: acceptedExtensions(consoles) })}
      </Text>
      <PrimaryButton label={t('home.addRom')} onPress={onAdd} />
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
