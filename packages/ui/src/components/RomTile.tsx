import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { COVER_ASPECT, coverUri, type RomRow } from "@emulators/storage";
import { colors, radius, spacing, typography } from "../theme";

/** Icons are 32x32 sources; anything larger than this only magnifies them. */
const ICON_SIZE = 64;

/** "Pokemon Emerald" -> "PE". Falls back to one letter, or none at all. */
function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/**
 * One poster in the library grid. Title lives below the art rather than over
 * it — a 120dp box scan is frequently unreadable, and every ROM without a
 * cover needs the text anyway. Art and title share one surface-filled card,
 * so a tile reads as a single object. Nothing marks a favourite here — the
 * Home screen gives favourites their own section instead.
 */
export function RomTile({
  rom,
  width,
  onPress,
  onLongPress,
  onCoverMissing,
}: {
  rom: RomRow;
  width: number;
  onPress: () => void;
  onLongPress: () => void;
  /** The file named by `cover_file` wouldn't load; queue it for re-fetch. */
  onCoverMissing: (romId: number) => void;
}) {
  const isIcon = rom.cover_source === "icon";
  // The box takes the cover's own shape, so nothing is ever letterboxed.
  // Box art has no common aspect — measured, it runs 0.64 to 1.65 on the
  // Game Boy family — so only a placeholder or an icon falls back to the
  // console's median shape.
  const aspectRatio = rom.cover_ratio ?? COVER_ASPECT[rom.console_id] ?? 1;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
    >
      <View style={[styles.poster, { aspectRatio }]}>
        {rom.cover_file ? (
          <Image
            source={{ uri: coverUri(rom.cover_file) }}
            style={isIcon ? styles.icon : styles.boxart}
            resizeMode="contain"
            // Self-heal: 'ok' pointing at a file that is gone (restored
            // backup, half-finished rename) would otherwise stay blank
            // forever. Never reload the list from here — that re-renders the
            // image, which errors again.
            onError={() => onCoverMissing(rom.id)}
          />
        ) : (
          <Text style={styles.initials}>{initials(rom.display_name)}</Text>
        )}
      </View>
      <View style={styles.caption}>
        <Text style={styles.title} numberOfLines={2}>
          {rom.display_name}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    // Clips the box art to the card's rounded top corners.
    overflow: "hidden",
  },
  poster: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  // The box already matches the art, so this fills it exactly; `contain`
  // only ever matters for the rounding between the stored ratio and the
  // laid-out pixel size.
  boxart: { width: "100%", height: "100%" },
  // An icon is pixel art at 32x32; stretching it to fill would be mush.
  icon: { width: ICON_SIZE, height: ICON_SIZE },
  initials: { ...typography.title, color: colors.textMuted },
  caption: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.body,
    color: colors.text,
  },
});
