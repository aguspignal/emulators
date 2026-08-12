import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { PrimaryButton } from '../PrimaryButton';

export interface GameMenuProps {
  title: string;
  onResume: () => void;
  onReset: () => void;
  onExit: () => void;
}

/**
 * The in-game pause menu. Rendered above `GamepadOverlay`, which is suspended
 * while this is open so ordinary `Pressable`s can claim the responder.
 */
export function GameMenu({ title, onResume, onReset, onExit }: GameMenuProps) {
  return (
    // Tapping the scrim resumes, the usual way out of a pause screen.
    <Pressable style={styles.scrim} onPress={onResume}>
      <Pressable style={styles.card} onPress={() => {}}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <PrimaryButton label="Resume" onPress={onResume} />
        <SecondaryButton label="Reset game" onPress={onReset} />
        <SecondaryButton label="Exit to library" onPress={onExit} danger />
      </Pressable>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
    >
      <Text style={[styles.secondaryLabel, danger && styles.dangerLabel]}>{label}</Text>
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
    minWidth: 260,
    maxWidth: '80%',
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
  secondary: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  secondaryPressed: { opacity: 0.6 },
  secondaryLabel: { ...typography.body, fontWeight: '600', color: colors.text },
  dangerLabel: { color: colors.danger },
});
