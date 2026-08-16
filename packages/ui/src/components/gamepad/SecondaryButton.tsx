import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

export interface SecondaryButtonProps {
  label: string;
  onPress: () => void;
  danger?: boolean;
}

/** The outlined button the in-game menus are built from. */
export function SecondaryButton({ label, onPress, danger }: SecondaryButtonProps) {
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
  secondary: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  secondaryPressed: { opacity: 0.6 },
  secondaryLabel: { ...typography.button, color: colors.text },
  dangerLabel: { color: colors.danger },
});
