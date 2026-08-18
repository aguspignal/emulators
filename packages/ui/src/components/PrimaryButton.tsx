import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing, typography } from "../theme";
import { usePrimaryColor } from "../config";

export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const primary = usePrimaryColor();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary },
        (pressed || disabled) && styles.buttonDimmed,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  buttonDimmed: { opacity: 0.6 },
  label: { ...typography.button, color: colors.text },
});
