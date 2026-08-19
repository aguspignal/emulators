import Ionicons from "@expo/vector-icons/Ionicons";
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { acceptedExtensions } from "@emulators/storage";
import { useAppConfig, usePrimaryColor } from "../config";
import { colors, radius, spacing, typography } from "../theme";

/**
 * A short guide on getting ROMs into the library. The step copy names the
 * import buttons by interpolating their own catalog keys rather than repeating
 * the words, so a re-worded button can't leave the guide describing a label
 * that no longer exists.
 */
export function HelpScreen() {
  const { t } = useTranslation();
  const { consoles } = useAppConfig();

  const steps: { title: string; body: string; options?: string[] }[] = [
    {
      title: t("help.step1Title"),
      body: t("help.step1Body", { extensions: acceptedExtensions(consoles) }),
    },
    {
      title: t("help.step2Title"),
      body: t("help.step2Body"),
      // The two picker options and the share-to-app one read as one choice, so
      // they are bullets under a single step rather than steps of their own.
      options: [
        t("help.step2OptionFile", { add: t("home.addRom"), file: t("home.importPickFile") }),
        t("help.step2OptionFolder", { add: t("home.addRom"), folder: t("home.importPickFolder") }),
        t("help.step2OptionShare"),
      ],
    },
    { title: t("help.step3Title"), body: t("help.step3Body") },
  ];

  const tips = [t("help.tip1"), t("help.tip2")];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>{t("help.intro")}</Text>

      <Text style={styles.sectionHeader}>{t("help.stepsTitle")}</Text>
      <View style={styles.card}>
        {steps.map((step, index) => (
          <Step
            key={step.title}
            number={index + 1}
            title={step.title}
            body={step.body}
            options={step.options}
            last={index === steps.length - 1}
          />
        ))}
      </View>

      <Text style={styles.sectionHeader}>{t("help.tipsTitle")}</Text>
      <View style={styles.card}>
        {tips.map((tip, index) => (
          <Tip key={tip} text={tip} last={index === tips.length - 1} />
        ))}
      </View>
    </ScrollView>
  );
}

function Step({
  number,
  title,
  body,
  options,
  last,
}: {
  number: number;
  title: string;
  body: string;
  /** Alternative ways of doing this one step, listed as bullets under it. */
  options?: string[];
  last?: boolean;
}) {
  const primary = usePrimaryColor();

  return (
    <View style={[styles.step, !last && styles.rowDivided]}>
      <View style={[styles.badge, { backgroundColor: primary }]}>
        <Text style={styles.badgeText}>{number}</Text>
      </View>
      {/* Translated sentences stay on the body face: the display family is
          Latin-only, so a Russian or Japanese heading would fall back per
          glyph. */}
      <View style={styles.stepText}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{body}</Text>
        {options?.map((option) => (
          <Bullet key={option} text={option} />
        ))}
      </View>
    </View>
  );
}

function Tip({ text, last }: { text: string; last?: boolean }) {
  return (
    <View style={!last && styles.rowDivided}>
      <Bullet text={text} style={styles.tipRow} />
    </View>
  );
}

function Bullet({ text, style }: { text: string; style?: ViewStyle }) {
  return (
    <View style={[styles.bullet, style]}>
      <Ionicons name="ellipse" size={6} color={colors.textMuted} style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.sm },
  intro: { ...typography.body, color: colors.textMuted, lineHeight: 20 },
  sectionHeader: { ...typography.title, color: colors.text, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowDivided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  // Digits only, so the display face is safe here in every language.
  badgeText: { ...typography.button, color: colors.text },
  stepText: { flex: 1, gap: spacing.xs },
  stepTitle: { ...typography.body, color: colors.text, fontWeight: "600" },
  stepBody: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  bullet: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  // Nudged down so the dot sits on the first line's optical centre.
  bulletDot: { marginTop: 6 },
  bulletText: { ...typography.caption, color: colors.textMuted, flex: 1, lineHeight: 18 },
  // A tip is a bullet that is a row of its own card, so it carries the padding
  // the step's own row already provides for the bullets nested inside it.
  tipRow: { paddingVertical: spacing.sm + spacing.xs },
});
