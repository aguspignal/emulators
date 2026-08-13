import { Linking, ScrollView, StyleSheet, Text } from "react-native";
import { useAppConfig } from "../config";
import { colors, spacing, typography } from "../theme";
import { showErrorAlert } from "../utils/errors";

/** Bare URLs in the notice — split on them so each becomes a tappable link. */
const URL_PATTERN = /(https?:\/\/\S+)/;

/**
 * The app's third-party licence notice, read from `AppConfig.licenseNotice`.
 * The text is bundled with the app rather than fetched: the source-availability
 * clause it satisfies has to be readable offline, and the whole point of the
 * screen is that it ships inside the binary the notice is about.
 */
export function LicenseScreen() {
  const { licenseNotice } = useAppConfig();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {licenseNotice
        .trim()
        .split(/\n{2,}/)
        .map((paragraph, i) => (
          <Text key={i} style={styles.paragraph}>
            {linkify(paragraph.replace(/\s*\n\s*/g, " "))}
          </Text>
        ))}
    </ScrollView>
  );
}

/** Renders a paragraph as text with its URLs as nested, pressable `Text`. */
function linkify(paragraph: string) {
  // split() with a capturing group keeps the delimiters and splits on every
  // match regardless of the /g flag, so odd indexes are the URLs and even
  // indexes the prose between them. Plain strings need no key.
  return paragraph.split(URL_PATTERN).map((chunk, i) =>
    i % 2 === 1 ? (
      <Text key={i} style={styles.link} onPress={() => openLink(chunk)}>
        {chunk}
      </Text>
    ) : (
      chunk
    ),
  );
}

function openLink(url: string) {
  // Trailing punctuation reads as part of the URL to the regex but not to a
  // browser; strip it rather than complicate the pattern.
  Linking.openURL(url.replace(/[.,;:)]+$/, "")).catch((e) =>
    showErrorAlert("Couldn't open link", e, "No app on this device can open that address."),
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.md },
  paragraph: { ...typography.body, color: colors.text, lineHeight: 21 },
  link: { color: colors.primary, textDecorationLine: "underline" },
});
