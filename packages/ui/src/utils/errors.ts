import { Alert } from 'react-native';
import { RomImportError } from '@emulators/storage';
import i18n from '../i18n';

/**
 * The one way to show a user-facing error: logs the raw error, alerts copy
 * that is safe to display. A `RomImportError`'s code maps to localized copy
 * (its English `message` is for the log); anything else shows
 * `friendlyMessage` instead of leaking internals (native messages embed
 * absolute file paths).
 */
export function showErrorAlert(
  title: string,
  error: unknown,
  friendlyMessage?: string,
  onDismiss?: () => void
): void {
  console.error(`${title}:`, error);
  const message =
    error instanceof RomImportError
      ? i18n.t(`import.${error.code}`, { ...error.params })
      : (friendlyMessage ?? i18n.t('errors.generic'));
  Alert.alert(
    title,
    message,
    onDismiss ? [{ text: i18n.t('common.ok'), onPress: onDismiss }] : undefined
  );
}
