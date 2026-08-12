import type { EmulatorButton } from "@emulators/core-interface";

/** Absolute screen-coordinate rectangle. Matches touch `pageX`/`pageY`. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * A touchable area of the pad. `hit` is deliberately larger than `visual` so
 * a thumb that lands just off a button still presses it.
 */
export type Region =
  | {
      kind: "dpad";
      hit: Rect;
      visual: Rect;
      /** Distance from centre, in px, below which no direction is pressed. */
      deadZone: number;
    }
  | {
      kind: "button";
      hit: Rect;
      visual: Rect;
      button: EmulatorButton;
      label: string;
      shape: "round" | "pill";
    }
  | { kind: "menu"; hit: Rect; visual: Rect };

export type GamepadLayout = Region[];

export interface LayoutOptions {
  width: number;
  height: number;
  insets: Insets;
  buttons: readonly EmulatorButton[];
}

/** Extra touch margin around every visual rect. */
const HIT_SLOP = 10;

const LABELS: Partial<Record<EmulatorButton, string>> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  l: "L",
  r: "R",
  zl: "ZL",
  zr: "ZR",
  start: "START",
  select: "SELECT",
};

function grow(visual: Rect, by = HIT_SLOP): Rect {
  return {
    x: visual.x - by,
    y: visual.y - by,
    width: visual.width + by * 2,
    height: visual.height + by * 2,
  };
}

function round(button: EmulatorButton, visual: Rect): Region {
  return {
    kind: "button",
    hit: grow(visual),
    visual,
    button,
    label: LABELS[button] ?? button.toUpperCase(),
    shape: "round",
  };
}

function pill(button: EmulatorButton, visual: Rect): Region {
  return {
    kind: "button",
    hit: grow(visual),
    visual,
    button,
    label: LABELS[button] ?? button.toUpperCase(),
    shape: "pill",
  };
}

/**
 * Builds the landscape pad for a console's button set. Everything is derived
 * from the window size and safe-area insets, so the pad adapts to any device
 * and keeps clear of the camera cutout and gesture bar.
 *
 * Regions are ordered most-specific first; `hitRegion` returns the first
 * match, so overlapping hit slop never steals a touch from a real button.
 */
export function buildGamepadLayout({
  width,
  height,
  insets,
  buttons,
}: LayoutOptions): GamepadLayout {
  const has = (b: EmulatorButton) => buttons.includes(b);

  const left = insets.left;
  const right = width - insets.right;
  const top = insets.top;
  const bottom = height - insets.bottom;
  const usableHeight = bottom - top;

  const margin = Math.max(16, Math.round(usableHeight * 0.06));
  const regions: GamepadLayout = [];

  // --- Shoulders: top corners, clear of the cutout --------------------------
  const shoulderWidth = Math.round(Math.min(width * 0.14, 64));
  const shoulderHeight = Math.round(Math.min(usableHeight * 0.13, 36));
  if (has("l")) {
    regions.push(
      pill("l", {
        x: left + margin,
        y: top + margin,
        width: shoulderWidth,
        height: shoulderHeight,
      }),
    );
  }
  if (has("r")) {
    regions.push(
      pill("r", {
        x: right - margin - shoulderWidth,
        y: top + margin,
        width: shoulderWidth,
        height: shoulderHeight,
      }),
    );
  }
  // ZL/ZR sit just inboard of L/R.
  const zGap = shoulderWidth + 12;
  if (has("zl")) {
    regions.push(
      pill("zl", {
        x: left + margin + zGap,
        y: top + margin,
        width: shoulderWidth,
        height: shoulderHeight,
      }),
    );
  }
  if (has("zr")) {
    regions.push(
      pill("zr", {
        x: right - margin - shoulderWidth - zGap,
        y: top + margin,
        width: shoulderWidth,
        height: shoulderHeight,
      }),
    );
  }

  // --- Menu: top centre -----------------------------------------------------
  const menuSize = Math.round(Math.min(usableHeight * 0.12, 36));
  const menuVisual: Rect = {
    x: Math.round(width / 2 - menuSize / 2),
    y: top + margin,
    width: menuSize,
    height: menuSize,
  };
  regions.push({ kind: "menu", hit: grow(menuVisual), visual: menuVisual });

  // --- Face buttons: bottom right diamond -----------------------------------
  const faceSize = Math.round(Math.min(usableHeight * 0.2, 68));
  const faceGap = Math.round(faceSize * 0.28);
  // Cluster radius from its centre to a button centre.
  const spread = faceSize / 2 + faceGap / 2;
  const clusterCx = right - margin - faceSize - spread * 0.4;
  const clusterCy = bottom - margin - faceSize / 2 - spread * 0.6;

  const face = (button: EmulatorButton, dx: number, dy: number): Rect => ({
    x: Math.round(clusterCx + dx * spread - faceSize / 2),
    y: Math.round(clusterCy + dy * spread - faceSize / 2),
    width: faceSize,
    height: faceSize,
  });

  if (has("x") || has("y")) {
    // Four-button diamond (NDS/3DS): X top, Y left, A right, B bottom.
    if (has("x")) regions.push(round("x", face("x", 0, -1)));
    if (has("y")) regions.push(round("y", face("y", -1, 0)));
    if (has("a")) regions.push(round("a", face("a", 1, 0)));
    if (has("b")) regions.push(round("b", face("b", 0, 1)));
  } else {
    // GB/GBA: A and B side by side on the console's slight diagonal.
    if (has("b")) regions.push(round("b", face("b", -0.75, 0.45)));
    if (has("a")) regions.push(round("a", face("a", 0.75, -0.45)));
  }

  // --- Start / Select: bottom centre ---------------------------------------
  const smallWidth = Math.round(Math.min(width * 0.11, 56));
  const smallHeight = Math.round(Math.min(usableHeight * 0.1, 28));
  const smallY = bottom - margin - smallHeight;
  const smallGap = 14;
  if (has("select")) {
    regions.push(
      pill("select", {
        x: Math.round(width / 2 - smallWidth - smallGap / 2),
        y: smallY,
        width: smallWidth,
        height: smallHeight,
      }),
    );
  }
  if (has("start")) {
    regions.push(
      pill("start", {
        x: Math.round(width / 2 + smallGap / 2),
        y: smallY,
        width: smallWidth,
        height: smallHeight,
      }),
    );
  }

  // --- D-pad: bottom left, added LAST --------------------------------------
  // Its hit area is deliberately oversized so a thumb rolling past the edge
  // keeps steering. Because `hitRegion` takes the first match, appending it
  // after every precise button guarantees that slop can never steal a touch
  // aimed at Select or B.
  const dpadSize = Math.round(Math.min(usableHeight * 0.5, 150));
  const dpadVisual: Rect = {
    x: left + margin,
    y: bottom - margin - dpadSize,
    width: dpadSize,
    height: dpadSize,
  };
  regions.push({
    kind: "dpad",
    hit: grow(dpadVisual, Math.round(dpadSize * 0.18)),
    visual: dpadVisual,
    deadZone: dpadSize * 0.14,
  });

  return regions;
}
