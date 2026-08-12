import { Alert } from 'react-native';
import { RomImportError } from '@emulators/storage';

/**
 * The one way to show a user-facing error: logs the raw error, alerts copy
 * that is safe to display. `RomImportError` messages are written for users
 * and pass through; anything else shows `friendlyMessage` instead of leaking
 * internals (native messages embed absolute file paths).
 */
export function showErrorAlert(
  title: string,
  error: unknown,
  friendlyMessage = 'Something went wrong. Please try again.',
  onDismiss?: () => void
): void {
  console.error(`${title}:`, error);
  const message = error instanceof RomImportError ? error.message : friendlyMessage;
  Alert.alert(title, message, onDismiss ? [{ text: 'OK', onPress: onDismiss }] : undefined);
}
