import { StyleSheet, Text, View } from "react-native";
import type { EmulatorButton } from "@emulators/core-interface";
import { colors, fonts, radius } from "../../theme";
import type { GamepadLayout, Rect, Region } from "./layout";

const PAD_FILL = "rgba(242, 242, 245, 0.16)";
const PAD_FILL_PRESSED = "rgba(230, 0, 18, 0.62)";
const PAD_BORDER = "rgba(242, 242, 245, 0.30)";

/** Shared so nothing has to allocate an empty set to mean "nothing held". */
export const NO_BUTTONS_PRESSED: ReadonlySet<EmulatorButton> = new Set();

export interface PadVisualsProps {
  layout: GamepadLayout;
  pressed?: ReadonlySet<EmulatorButton>;
  /** Alpha of the whole layer, buttons and menu together. 1 is the stock pad. */
  opacity?: number;
}

/**
 * Draws a pad layout — and nothing else. No responder, no core, no state, so
 * the settings editor can preview a pad at full size without any risk of
 * sending input to a game.
 *
 * The opacity lives on this view rather than on `GamepadOverlay`'s root so the
 * responder above keeps an alpha of 1 and is never composited off-screen; with
 * `pointerEvents="none"` touches fall straight through to it. Hit-testing is
 * arithmetic against rects, so how faint the pad is drawn cannot reach input.
 */
export function PadVisuals({ layout, pressed = NO_BUTTONS_PRESSED, opacity = 1 }: PadVisualsProps) {
  return (
    <View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      {layout.map((region) => (
        <RegionView key={regionKey(region)} region={region} pressed={pressed} />
      ))}
    </View>
  );
}

function regionKey(region: Region): string {
  return region.kind === "button" ? region.button : region.kind;
}

function rectStyle(rect: Rect) {
  return {
    position: "absolute" as const,
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function RegionView({ region, pressed }: { region: Region; pressed: ReadonlySet<EmulatorButton> }) {
  if (region.kind === "dpad") return <DpadView region={region} pressed={pressed} />;

  if (region.kind === "menu") {
    return (
      <View style={[rectStyle(region.visual), styles.face, styles.menu]}>
        <View style={styles.menuBar} />
        <View style={styles.menuBar} />
        <View style={styles.menuBar} />
      </View>
    );
  }

  const isPressed = pressed.has(region.button);
  return (
    <View
      style={[
        rectStyle(region.visual),
        styles.face,
        { borderRadius: region.shape === "round" ? region.visual.height / 2 : radius.sm },
        isPressed && styles.facePressed,
      ]}
    >
      <Text style={[styles.label, region.shape === "pill" && styles.labelSmall]}>
        {region.label}
      </Text>
    </View>
  );
}

const DIRECTIONS = ["up", "left", "right", "down"] as const;
const ARROWS: Record<(typeof DIRECTIONS)[number], string> = {
  up: "▲",
  left: "◀",
  right: "▶",
  down: "▼",
};

function DpadView({
  region,
  pressed,
}: {
  region: Extract<Region, { kind: "dpad" }>;
  pressed: ReadonlySet<EmulatorButton>;
}) {
  const cell = region.visual.width / 3;
  // Column/row of each arm in the 3x3 grid the cross is drawn on.
  const cells: Record<(typeof DIRECTIONS)[number], [number, number]> = {
    up: [1, 0],
    left: [0, 1],
    right: [2, 1],
    down: [1, 2],
  };

  return (
    <View style={rectStyle(region.visual)}>
      <View
        style={[
          styles.face,
          { position: "absolute", left: cell, top: cell, width: cell, height: cell },
        ]}
      />
      {DIRECTIONS.map((direction) => {
        const [col, row] = cells[direction];
        return (
          <View
            key={direction}
            style={[
              styles.face,
              styles.dpadArm,
              { left: col * cell, top: row * cell, width: cell, height: cell },
              pressed.has(direction) && styles.facePressed,
            ]}
          >
            <Text style={styles.dpadArrow}>{ARROWS[direction]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    backgroundColor: PAD_FILL,
    borderWidth: 1,
    borderColor: PAD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  facePressed: { backgroundColor: PAD_FILL_PRESSED },
  dpadArm: { position: "absolute", borderRadius: radius.sm },
  // dpadArrow stays on the system font on purpose: ARROWS are U+25B2-block
  // geometric shapes, outside Tourney's Latin-only coverage.
  dpadArrow: { color: colors.text, fontSize: 16, opacity: 0.75 },
  label: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: "900",
    opacity: 0.85,
  },
  labelSmall: { fontSize: 11, letterSpacing: 1 },
  menu: { borderRadius: radius.sm, gap: 3 },
  menuBar: {
    width: "45%",
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.text,
    opacity: 0.85,
  },
});
