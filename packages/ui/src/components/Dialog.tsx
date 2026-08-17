import type { ComponentProps } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, radius, spacing, typography } from "../theme";

export type DialogButtonStyle = "default" | "cancel" | "destructive";

export interface DialogButton {
  /** Already localized by the caller, like `Alert.alert`'s `text` was. */
  label: string;
  onPress?: () => void;
  style?: DialogButtonStyle;
  /**
   * Drawn to the left of the label, in the label's own colour. Only reaches
   * the stacked layout — a row of two reads as a confirm, where icons on
   * "Cancel"/"Delete" are noise rather than help.
   */
  icon?: ComponentProps<typeof Ionicons>["name"];
  /**
   * Runs `onPress` immediately and leaves the dialog open, for a button whose
   * handler swaps in different content — a confirmation step. Closing first
   * would dismiss the Modal's window and open a new one a frame later, which
   * flickers; this way only the card's children change.
   */
  keepOpen?: boolean;
}

export interface DialogRequest {
  title: string;
  message?: string;
  /** Rendered in array order. Defaults to a single OK that only closes. */
  buttons?: DialogButton[];
}

export interface DialogProps {
  visible: boolean;
  /** Null while closing, so the card keeps its content through the fade-out. */
  request: DialogRequest | null;
  onClose: () => void;
}

/** Above this many, the buttons stop fitting side by side and stack. */
const ROW_LIMIT = 2;
/** A little above the 14px label, the way the pause menu's rows are drawn. */
const ICON_SIZE = 20;

/**
 * The app's replacement for `Alert.alert`: same shape (title, message, a list
 * of buttons), drawn in the app's own theme. Purely presentational — the
 * component that raises a dialog owns the `useState` and renders one of these.
 */
export function Dialog({ visible, request, onClose }: DialogProps) {
  const { t } = useTranslation();
  const buttons = request?.buttons ?? [{ label: t("common.ok") }];
  // Two fit on a line, more read better stacked — which is also what turns the
  // ROM long-press and the import picker into option lists rather than confirms.
  const stacked = buttons.length > ROW_LIMIT;
  // Reserved for the whole list once any option has one, so an option without
  // an icon (Cancel) keeps its label on the same left edge as the rest.
  const icons = stacked && buttons.some((button) => button.icon != null);

  const press = (button: DialogButton) => {
    if (button.keepOpen) {
      button.onPress?.();
      return;
    }
    onClose();
    // After the window is on its way out: some handlers start another Activity
    // (the file/folder pickers) or another Modal, which races the transition.
    requestAnimationFrame(() => button.onPress?.());
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Both, or the backdrop stops short of the system bars under the
      // edge-to-edge layout and leaves a seam.
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* Outer press dismisses, inner swallows — the same two-layer Pressable
          the savestate sheet uses, so tapping outside behaves alike in both. */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title} numberOfLines={2}>
            {request?.title}
          </Text>
          {request?.message != null && <Text style={styles.message}>{request.message}</Text>}
          <View style={stacked ? styles.buttonsStacked : styles.buttonsRow}>
            {buttons.map((button, index) => {
              const color = labelColors[button.style ?? "default"];
              return (
                <Pressable
                  // Labels can repeat across languages; position is what's stable.
                  key={index}
                  accessibilityRole="button"
                  onPress={() => press(button)}
                  style={({ pressed }) => [
                    stacked ? styles.buttonStacked : styles.button,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  {icons && (
                    <View style={styles.buttonIcon}>
                      {button.icon != null && (
                        <Ionicons name={button.icon} size={ICON_SIZE} color={color} />
                      )}
                    </View>
                  )}
                  <Text style={[styles.buttonLabel, { color }]}>{button.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000cc",
    padding: spacing.xl,
  },
  card: {
    alignSelf: "center",
    width: "100%",
    // Capped so landscape doesn't stretch the card across the wide axis.
    maxWidth: 420,
    // Landscape leaves little height; a long message scrolls into the ellipsis
    // rather than pushing the buttons off screen.
    maxHeight: "80%",
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Roboto, not typography.title: titles carry ROM display names and whole
  // translated sentences, and Tourney has no Cyrillic or CJK.
  title: {
    ...typography.body,
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  message: { ...typography.body, color: colors.textMuted },
  buttonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  buttonsStacked: { marginTop: spacing.sm },
  button: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  buttonStacked: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  // Fixed width rather than a gap, so every label starts at the same x whether
  // or not its own option has an icon.
  buttonIcon: { width: ICON_SIZE + spacing.md },
  buttonPressed: { opacity: 0.6 },
  buttonLabel: { ...typography.button },
});

/** Shared by each label and its icon, so the two never drift apart. */
const labelColors: Record<DialogButtonStyle, string> = {
  default: colors.text,
  cancel: colors.textMuted,
  destructive: colors.danger,
};
