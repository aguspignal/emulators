import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { PrimaryButton } from '../PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

export interface GameMenuProps {
  title: string;
  onResume: () => void;
  onSaveState: () => void;
  onLoadState: () => void;
  onReset: () => void;
  onExit: () => void;
}

/**
 * The in-game pause menu. Rendered above `GamepadOverlay`, which is suspended
 * while this is open so ordinary `Pressable`s can claim the responder.
 */
export function GameMenu({
  title,
  onResume,
  onSaveState,
  onLoadState,
  onReset,
  onExit,
}: GameMenuProps) {
  return (
    // Tapping the scrim resumes, the usual way out of a pause screen.
    <Pressable style={styles.scrim} onPress={onResume}>
      <Pressable style={styles.card} onPress={() => {}}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <PrimaryButton label="Resume" onPress={onResume} />
        <SecondaryButton label="Save state" onPress={onSaveState} />
        <SecondaryButton label="Load state" onPress={onLoadState} />
        <SecondaryButton label="Reset game" onPress={onReset} />
        <SecondaryButton label="Exit to library" onPress={onExit} danger />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    minWidth: 300,
    maxWidth: '85%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
});
