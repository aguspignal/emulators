import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppConfig } from "../config";
import { useSettings } from "../settings/SettingsContext";
import { PAD_OPACITY, PAD_SCALE, formatPercent, type Range } from "../settings/padCustomization";
import { colors, radius, spacing, typography } from "../theme";
import { Slider } from "../components/Slider";
import { PadVisuals } from "../components/gamepad/PadVisuals";
import { SecondaryButton } from "../components/gamepad/SecondaryButton";
import { PrimaryButton } from "../components/PrimaryButton";
import { useEmulatorLayout } from "../components/gamepad/useEmulatorLayout";
import { fittingScale } from "../components/gamepad/layout";
import type { RootScreenProps } from "../navigation/types";

/** The panel over the preview: `colors.surface`, but the pad reads through it. */
const PANEL_FILL = "rgba(28, 28, 34, 0.94)";

/**
 * Gamepad size and transparency, edited on top of a full-size preview of the
 * real pad. It runs headerless and unlocked in both orientations for the same
 * reason the emulator does — it calls the very same `useEmulatorLayout`, so
 * what is on screen here is exactly what the game will show, and a header
 * would eat the height that makes that true.
 *
 * It edits whichever orientation the phone is held in; rotating switches
 * sides. Deliberately no `GamepadOverlay`: the editor draws the pad and can
 * never press one.
 */
export function ControlsScreen({ navigation }: RootScreenProps<"Controls">) {
  const { t } = useTranslation();
  const { consoles } = useAppConfig();
  const { padScale, padOpacity, setPadScale, setPadOpacity, resetPad } = useSettings();

  // Drafts for both orientations, seeded once: rotating then shows the other
  // orientation's values with no re-seeding, and editing one can never touch
  // the other. Safe to seed from state because this screen is the only writer.
  const [scale, setScale] = useState(padScale);
  const [opacity, setOpacity] = useState(padOpacity);

  // No ROM is booted, so there is no `RomInfo.console` to lay the pad out for;
  // the app's headline console is the honest preview.
  const spec = consoles[0];
  const layout = useEmulatorLayout(spec, scale);
  const orientation = layout.orientation;

  // The size slider ends where this device's pad stops growing, not where the
  // range does: a portrait band saturates well below `PAD_SCALE.max`, and a
  // slider that keeps travelling past a pad that no longer changes reads as
  // broken. Snapped down to the slider's own step so every reachable value
  // still lands on the grid. Recomputed per render rather than memoized — it
  // depends on `padArea`, which is a fresh object on every drag frame anyway.
  const sizeRange: Range = {
    ...PAD_SCALE,
    max: snapDown(
      fittingScale({ area: layout.padArea, buttons: spec.buttons, scale: PAD_SCALE.max }),
      PAD_SCALE.step,
    ),
  };

  const previewScale = (value: number) => setScale((draft) => ({ ...draft, [orientation]: value }));
  const previewOpacity = (value: number) =>
    setOpacity((draft) => ({ ...draft, [orientation]: value }));

  const reset = () => {
    previewScale(PAD_SCALE.default);
    previewOpacity(PAD_OPACITY.default);
    resetPad(orientation);
  };

  return (
    <View style={styles.container}>
      {orientation === "portrait" && (
        // The band, exactly as the emulator screen draws it. Its height never
        // changes with the scale — the game area must not shift under the
        // player's finger while they drag the size slider.
        <View style={[styles.padBand, { top: layout.padArea.y }]} />
      )}
      <View
        style={[
          styles.mockScreen,
          {
            left: layout.screen.x,
            top: layout.screen.y,
            width: layout.screen.width,
            height: layout.screen.height,
          },
        ]}
      >
        <Text style={styles.mockLabel}>{spec.abbreviation}</Text>
      </View>
      <PadVisuals layout={layout.pad} opacity={opacity[orientation]} />
      {/* box-none: only the panel itself takes touches, so the preview below
          stays visible edge to edge. */}
      <View
        style={[
          styles.panelLayer,
          // Portrait confines the panel to the game area: the pad has its own
          // band there, and its Select/Menu/Start row runs along that band's
          // top edge — a panel centred in the window sits right on it. In
          // landscape the pad floats over the game and the centre is the one
          // region free of buttons, so the layer is the whole window.
          orientation === "portrait"
            ? {
                left: layout.screen.x,
                top: layout.screen.y,
                width: layout.screen.width,
                height: layout.screen.height,
              }
            : styles.fullWindow,
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.panel}>
          <Text style={styles.title}>{t("settings.customizeGamepad")}</Text>
          <SettingSlider
            label={t("settings.padSize")}
            // Clamped, not just positioned: a value stored on a roomier device
            // (or in landscape) can exceed what this pad area reaches, and the
            // percentage has to say what the preview is actually showing.
            value={Math.min(scale[orientation], sizeRange.max)}
            range={sizeRange}
            onChange={previewScale}
            onCommit={(value) => setPadScale(orientation, value)}
          />
          <SettingSlider
            label={t("settings.padOpacity")}
            value={opacity[orientation]}
            range={PAD_OPACITY}
            onChange={previewOpacity}
            onCommit={(value) => setPadOpacity(orientation, value)}
          />
          <View style={styles.actions}>
            <SecondaryButton label={t("settings.padReset")} onPress={reset} />
            <PrimaryButton label={t("settings.padDone")} onPress={() => navigation.goBack()} />
          </View>
        </View>
        <Text style={styles.hint}>
          {t(orientation === "portrait" ? "settings.padHintPortrait" : "settings.padHintLandscape")}
        </Text>
      </View>
    </View>
  );
}

/**
 * `value` down to the nearest multiple of `step`, and rounded like the slider
 * rounds — the result becomes a slider bound and is persisted as a string.
 *
 * The epsilon is not decoration: `1.4 / 0.05` is 27.999999999999996 in binary
 * floating point, so a bare `Math.floor` would take a whole step off every
 * device that does fit the top of the range.
 */
function snapDown(value: number, step: number): number {
  return Math.round(Math.floor(value / step + 1e-9) * step * 1000) / 1000;
}

/**
 * One labelled slider. `onChange` moves the preview on every frame of the
 * drag; `onCommit` fires once on release, which is where the SQLite write
 * belongs — a persist per frame would be a write per pixel.
 */
function SettingSlider({
  label,
  value,
  range,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  range: Range;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <View>
      <View style={styles.settingHeader}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{formatPercent(value)}</Text>
      </View>
      <Slider
        value={value}
        min={range.min}
        max={range.max}
        step={range.step}
        onChange={onChange}
        onCommit={onCommit}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  padBand: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
  },
  mockScreen: {
    position: "absolute",
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    // Where the game would end and the band begin, which is otherwise
    // invisible with a mock screen the same colour as the band.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mockLabel: { ...typography.title, fontSize: 32, color: colors.textMuted, opacity: 0.5 },
  // Positioned by the screen — the rect differs per orientation.
  panelLayer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fullWindow: { left: 0, right: 0, top: 0, bottom: 0 },
  panel: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: PANEL_FILL,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { ...typography.title, color: colors.text },
  settingHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  settingLabel: { ...typography.body, color: colors.text },
  settingValue: { ...typography.body, color: colors.textMuted },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
    maxWidth: 360,
    marginTop: spacing.sm,
  },
});
