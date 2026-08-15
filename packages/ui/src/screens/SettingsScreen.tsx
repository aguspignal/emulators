import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { acceptedExtensions } from "@emulators/storage";
import { useAppConfig } from "../config";
import { LANGUAGES } from "../i18n";
import { useSettings } from "../settings/SettingsContext";
import { colors, radius, spacing, typography } from "../theme";
import { openExternalLink } from "../utils/links";
import type { RootScreenProps } from "../navigation/types";

/** App settings, plus the About panel. */
export function SettingsScreen({ navigation }: RootScreenProps<"Settings">) {
  const { t } = useTranslation();
  const { consoles, termsUrl, privacyUrl } = useAppConfig();
  const { hapticsEnabled, setHapticsEnabled, language } = useSettings();

  const activeLanguage =
    language === "auto"
      ? t("settings.automatic")
      : (LANGUAGES.find((entry) => entry.code === language)?.endonym ?? language);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionHeader}>{t("settings.general")}</Text>
      <View style={styles.card}>
        <NavRow
          label={t("settings.language")}
          value={activeLanguage}
          onPress={() => navigation.navigate("Language")}
          last
        />
      </View>
      <Text style={styles.sectionHeader}>{t("settings.controls")}</Text>
      <View style={styles.card}>
        <SwitchRow
          label={t("settings.buttonVibration")}
          description={t("settings.buttonVibrationDescription")}
          value={hapticsEnabled}
          onToggle={() => setHapticsEnabled(!hapticsEnabled)}
          last
        />
      </View>
      <Text style={styles.sectionHeader}>{t("settings.about")}</Text>
      <View style={styles.card}>
        <Row label={t("settings.consoles")} value={consoles.map((c) => c.displayName).join(", ")} />
        <Row label={t("settings.supportedFiles")} value={acceptedExtensions(consoles)} last />
      </View>
      <Text style={styles.sectionHeader}>{t("settings.legal")}</Text>
      <View style={styles.card}>
        <BrowserRow label={t("settings.termsOfUse")} url={termsUrl} />
        <BrowserRow label={t("settings.privacyPolicy")} url={privacyUrl} />
        <NavRow label={t("settings.license")} onPress={() => navigation.navigate("License")} last />
      </View>
      <Text style={styles.note}>{t("settings.note")}</Text>
    </ScrollView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowDivided]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/** A row that opens a document in the browser. Inert while its page isn't
    deployed yet (no URL in the app's config). */
function BrowserRow({ label, url, last }: { label: string; url?: string; last?: boolean }) {
  const content = (
    <>
      <Text style={styles.rowValue}>{label}</Text>
      <Ionicons name="open-outline" size={18} color={colors.textMuted} />
    </>
  );
  if (!url) {
    return (
      <View style={[styles.row, styles.browserRow, !last && styles.rowDivided]}>{content}</View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => openExternalLink(url)}
      style={({ pressed }) => [
        styles.row,
        styles.browserRow,
        !last && styles.rowDivided,
        pressed && styles.rowPressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

/** A row that pushes another screen in this app — chevron, not open-outline. */
function NavRow({
  label,
  value,
  onPress,
  last,
}: {
  label: string;
  /** Current selection, shown muted beside the chevron. */
  value?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        styles.browserRow,
        !last && styles.rowDivided,
        pressed && styles.rowPressed,
      ]}
    >
      <Text style={styles.rowValue}>{label}</Text>
      <View style={styles.navRowRight}>
        {value != null && (
          <Text style={styles.rowLabel} numberOfLines={1}>
            {value}
          </Text>
        )}
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

function SwitchRow({
  label,
  description,
  value,
  onToggle,
  last,
}: {
  label: string;
  description: string;
  value: boolean;
  onToggle: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        styles.switchRow,
        !last && styles.rowDivided,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.switchRowText}>
        <Text style={styles.rowValue}>{label}</Text>
        <Text style={styles.rowLabel}>{description}</Text>
      </View>
      {/* The whole row is the pressable; the switch is display-only so a tap
          on it can't fire a second, competing handler. */}
      <View pointerEvents="none">
        <Switch
          value={value}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.text}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.sm },
  sectionHeader: { ...typography.title, color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  row: { paddingVertical: spacing.sm + spacing.xs, gap: spacing.xs },
  rowDivided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowPressed: { opacity: 0.6 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  browserRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  navRowRight: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  switchRowText: { flex: 1, gap: spacing.xs },
  rowLabel: { ...typography.caption, color: colors.textMuted },
  rowValue: { ...typography.body, color: colors.text },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
});
