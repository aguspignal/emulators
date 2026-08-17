import { useState, type ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, spacing, typography } from "../../theme";
import { Dialog, type DialogRequest } from "../Dialog";

export interface GameMenuProps {
  title: string;
  muted: boolean;
  fastForward: boolean;
  onResume: () => void;
  onSaveState: () => void;
  onLoadState: () => void;
  onToggleMute: () => void;
  onToggleFastForward: () => void;
  onReset: () => void;
  onExit: () => void;
}

/**
 * The in-game pause menu: a full-screen layer with the game's library name on
 * top of the option list. Rendered above `GamepadOverlay`, which is suspended
 * while this is open so ordinary `Pressable`s can claim the responder.
 */
export function GameMenu({
  title,
  muted,
  fastForward,
  onResume,
  onSaveState,
  onLoadState,
  onToggleMute,
  onToggleFastForward,
  onReset,
  onExit,
}: GameMenuProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [dialog, setDialog] = useState<DialogRequest | null>(null);

  const notAvailable = () =>
    setDialog({
      title: t("gameMenu.notAvailableTitle"),
      message: t("gameMenu.notAvailableMessage"),
    });

  // Resetting throws away everything since the last save; make sure it's meant.
  const confirmReset = () =>
    setDialog({
      title: t("gameMenu.reset"),
      message: t("gameMenu.resetConfirmMessage"),
      buttons: [
        { label: t("common.cancel"), style: "cancel" },
        { label: t("gameMenu.resetAction"), style: "destructive", onPress: onReset },
      ],
    });

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.divider} />
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}>
          <MenuRow icon="play-outline" label={t("gameMenu.resume")} onPress={onResume} />
          <MenuRow icon="save-outline" label={t("gameMenu.save")} onPress={onSaveState} />
          <MenuRow icon="folder-open-outline" label={t("gameMenu.load")} onPress={onLoadState} />
          <MenuRow
            icon="volume-mute-outline"
            label={t("gameMenu.mute")}
            onPress={onToggleMute}
            toggled={muted}
          />
          <MenuRow
            icon="play-forward-outline"
            label={t("gameMenu.fastForward")}
            onPress={onToggleFastForward}
            toggled={fastForward}
          />
          <MenuRow icon="code-slash-outline" label={t("gameMenu.cheats")} onPress={notAvailable} />
          <MenuRow icon="refresh-outline" label={t("gameMenu.reset")} onPress={confirmReset} danger />
          <MenuRow icon="exit-outline" label={t("gameMenu.exit")} onPress={onExit} />
        </ScrollView>
      </View>
      <Dialog visible={dialog !== null} request={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  danger,
  toggled,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  danger?: boolean;
  /** When set, the row is a toggle and shows a switch reflecting this value. */
  toggled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={toggled === undefined ? "button" : "switch"}
      accessibilityState={toggled === undefined ? undefined : { checked: toggled }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.text} />
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
      {toggled !== undefined && (
        // The whole row is the pressable; the switch is display-only so a tap
        // on it can't fire a second, competing handler.
        <View pointerEvents="none" style={styles.rowSwitch}>
          <Switch
            value={toggled}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.text}
          />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  // Capped so landscape doesn't stretch rows edge-to-edge across the wide axis.
  content: {
    flex: 1,
    alignSelf: "center",
    width: "100%",
    maxWidth: 420,
  },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowSwitch: {
    marginLeft: "auto",
  },
  rowLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.text,
  },
  rowLabelDanger: {
    color: colors.danger,
  },
});
