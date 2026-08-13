import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { acceptedExtensions } from "@emulators/storage";
import { useAppConfig } from "../config";
import { useSettings } from "../settings/SettingsContext";
import { colors, radius, spacing, typography } from "../theme";
import type { RootScreenProps } from "../navigation/types";

/** App settings, plus the About panel. */
export function SettingsScreen({ navigation }: RootScreenProps<"Settings">) {
  const { appName, consoles } = useAppConfig();
  const { hapticsEnabled, setHapticsEnabled } = useSettings();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionHeader}>Controls</Text>
      <View style={styles.card}>
        <SwitchRow
          label="Button vibration"
          description="Vibrate when pressing gamepad buttons"
          value={hapticsEnabled}
          onToggle={() => setHapticsEnabled(!hapticsEnabled)}
          last
        />
      </View>
      <Text style={styles.sectionHeader}>About</Text>
      <View style={styles.card}>
        <Row label="Consoles" value={consoles.map((c) => c.displayName).join(", ")} />
        <Row label="Supported files" value={acceptedExtensions(consoles)} last />
      </View>
      <Text style={styles.sectionHeader}>Legal</Text>
      <View style={styles.card}>
        <BrowserRow label="Terms of Use" />
        <BrowserRow label="Privacy Policy" />
        <NavRow label="License" onPress={() => navigation.navigate("License")} last />
      </View>
      <Text style={styles.note}>Controller mapping and pad customization will live here.</Text>
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

/** A row that will open a document in the browser. Inert until the legal
    pages are deployed — then it becomes a Pressable around Linking.openURL. */
function BrowserRow({ label, last }: { label: string; last?: boolean }) {
  return (
    <View style={[styles.row, styles.browserRow, !last && styles.rowDivided]}>
      <Text style={styles.rowValue}>{label}</Text>
      <Ionicons name="open-outline" size={18} color={colors.textMuted} />
    </View>
  );
}

/** A row that pushes another screen in this app — chevron, not open-outline. */
function NavRow({ label, onPress, last }: { label: string; onPress: () => void; last?: boolean }) {
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
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
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
  switchRowText: { flex: 1, gap: spacing.xs },
  rowLabel: { ...typography.caption, color: colors.textMuted },
  rowValue: { ...typography.body, color: colors.text },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
});
