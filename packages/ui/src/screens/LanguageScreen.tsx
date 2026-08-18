import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "../i18n";
import { useSettings } from "../settings/SettingsContext";
import { colors, radius, spacing, typography } from "../theme";
import { usePrimaryColor } from "../config";

/**
 * Picks the UI language: automatic (follow the device) or one of the shipped
 * catalogs, named in its own language. Picking retranslates the app on the
 * spot — that instant switch is the confirmation, so the screen stays put.
 */
export function LanguageScreen() {
  const { t } = useTranslation();
  const { language, setLanguage } = useSettings();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <LanguageRow
          label={t("settings.languageAutomatic")}
          active={language === "auto"}
          onPress={() => setLanguage("auto")}
        />
        {LANGUAGES.map((entry, index) => (
          <LanguageRow
            key={entry.code}
            label={entry.endonym}
            active={language === entry.code}
            onPress={() => setLanguage(entry.code)}
            last={index === LANGUAGES.length - 1}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function LanguageRow({
  label,
  active,
  onPress,
  last,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  const primary = usePrimaryColor();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowDivided, pressed && styles.rowPressed]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {active && <Ionicons name="checkmark" size={18} color={primary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm + spacing.xs,
  },
  rowDivided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowPressed: { opacity: 0.6 },
  rowLabel: { ...typography.body, color: colors.text },
});
