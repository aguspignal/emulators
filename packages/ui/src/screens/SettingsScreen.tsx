import { ScrollView, StyleSheet, Text, View } from "react-native";
import { acceptedExtensions } from "@emulators/storage";
import { useAppConfig } from "../config";
import { colors, radius, spacing, typography } from "../theme";

/** App settings. Nothing is configurable yet — this is the About panel. */
export function SettingsScreen() {
  const { appName, consoles } = useAppConfig();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionHeader}>About</Text>
      <View style={styles.card}>
        <Row label="Consoles" value={consoles.map((c) => c.displayName).join(", ")} />
        <Row label="Supported files" value={acceptedExtensions(consoles)} last />
      </View>
      <Text style={styles.note}>
        Controller mapping, haptics and pad customization will live here.
      </Text>
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

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.sm },
  sectionHeader: { ...typography.title, color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  row: { paddingVertical: spacing.sm + spacing.xs, gap: spacing.xs },
  rowDivided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLabel: { ...typography.caption, color: colors.textMuted },
  rowValue: { ...typography.body, color: colors.text },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
});
