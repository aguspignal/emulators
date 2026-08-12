import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RomRow } from '@emulators/storage';
import { colors, radius, spacing, typography } from '../theme';
import { formatBytes, formatLastPlayed } from '../utils/format';

/**
 * Title is always `display_name` — the picked filename beats header titles,
 * which are all-caps internal codes like "POKEMON RED". `header_title` stays
 * stored for future search/matching, never for display.
 */
export function RomListItem({
  rom,
  consoleName,
  onPress,
  onLongPress,
}: {
  rom: RomRow;
  consoleName: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {rom.favorite === 1 && <View style={styles.favoriteBar} />}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {rom.display_name}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {consoleName} · {formatBytes(rom.size)}
        </Text>
      </View>
      <Text style={styles.lastPlayed}>{formatLastPlayed(rom.last_played_at)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.md,
    overflow: 'hidden',
  },
  rowPressed: { opacity: 0.7 },
  favoriteBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: colors.primary,
  },
  info: { flex: 1, gap: spacing.xs },
  title: { ...typography.body, fontWeight: '600', color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
  lastPlayed: { ...typography.caption, color: colors.textMuted },
});
