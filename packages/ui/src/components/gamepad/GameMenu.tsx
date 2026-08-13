import type { ComponentProps } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing, typography } from '../../theme';

export interface GameMenuProps {
  title: string;
  onResume: () => void;
  onSaveState: () => void;
  onLoadState: () => void;
  onReset: () => void;
  onExit: () => void;
}

const notAvailable = () =>
  Alert.alert('Not available yet', 'This feature is coming in a future update.');

/**
 * The in-game pause menu: a full-screen layer with the game's library name on
 * top of the option list. Rendered above `GamepadOverlay`, which is suspended
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
  const insets = useSafeAreaInsets();

  // Resetting throws away everything since the last save; make sure it's meant.
  const confirmReset = () =>
    Alert.alert('Reset game', 'Restart from the beginning? Unsaved progress will be lost.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: onReset },
    ]);

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
          <MenuRow icon="play-outline" label="Resume" onPress={onResume} />
          <MenuRow icon="save-outline" label="Save" onPress={onSaveState} />
          <MenuRow icon="folder-open-outline" label="Load" onPress={onLoadState} />
          <MenuRow icon="volume-mute-outline" label="Mute game" onPress={notAvailable} />
          <MenuRow icon="speedometer-outline" label="Speed up the game" onPress={notAvailable} />
          <MenuRow icon="code-slash-outline" label="Cheat codes" onPress={notAvailable} />
          <MenuRow icon="refresh-outline" label="Reset game" onPress={confirmReset} danger />
          <MenuRow icon="exit-outline" label="Auto save and exit" onPress={onExit} />
        </ScrollView>
      </View>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.text} />
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  // Capped so landscape doesn't stretch rows edge-to-edge across the wide axis.
  content: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
  },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  rowLabelDanger: {
    color: colors.danger,
  },
});
