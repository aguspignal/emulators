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

export type Orientation = "landscape" | "portrait";

export interface LayoutOptions {
  /** Usable rect the pad is laid out in — safe-area insets already applied. */
  area: Rect;
  buttons: readonly EmulatorButton[];
}

export interface EmulatorLayoutOptions {
  width: number;
  height: number;
  insets: Insets;
  buttons: readonly EmulatorButton[];
}

export interface EmulatorLayout {
  orientation: Orientation;
  /** Where the native emulator view goes, in absolute screen coordinates. */
  screen: Rect;
  /** The pad's usable rect: the whole window in landscape, a band in portrait. */
  padArea: Rect;
  pad: GamepadLayout;
}

/**
 * Portrait pad height, as a fraction of the usable width: a pad's natural size
 * follows how far a thumb reaches across the device, not how tall the screen
 * is, so it is derived from width and only then bounded.
 */
const PORTRAIT_PAD_RATIO = 0.9;
/** Below this the pad is too cramped to play on; above it, just empty space. */
const PORTRAIT_PAD_MIN_PX = 260;
const PORTRAIT_PAD_MAX_PX = 460;
/** Whatever the width says, the game keeps most of the screen. */
const PORTRAIT_PAD_MAX_RATIO = 0.62;

/**
 * Splits the window between the emulator view and the pad for the current
 * device orientation.
 *
 * Landscape keeps the game full-bleed with the pad floating over it — there is
 * no room for a band, and the game's 4:3-ish frame leaves wide empty margins to
 * put buttons in anyway. Portrait has the opposite problem: buttons over the
 * game would cover it, so the game takes the top and the pad gets its own band
 * underneath. The native view aspect-fits whatever rect it is given, so neither
 * case needs to know the console's screen dimensions.
 */
export function buildEmulatorLayout({
  width,
  height,
  insets,
  buttons,
}: EmulatorLayoutOptions): EmulatorLayout {
  if (width >= height) {
    const area: Rect = {
      x: insets.left,
      y: insets.top,
      width: width - insets.left - insets.right,
      height: height - insets.top - insets.bottom,
    };
    return {
      orientation: "landscape",
      screen: { x: 0, y: 0, width, height },
      padArea: area,
      pad: buildGamepadLayout({ area, buttons }),
    };
  }

  const usableWidth = width - insets.left - insets.right;
  const usableHeight = height - insets.top - insets.bottom;
  const padHeight = Math.round(
    Math.min(
      Math.max(usableWidth * PORTRAIT_PAD_RATIO, PORTRAIT_PAD_MIN_PX),
      PORTRAIT_PAD_MAX_PX,
      usableHeight * PORTRAIT_PAD_MAX_RATIO,
    ),
  );
  const padArea: Rect = {
    x: insets.left,
    y: insets.top + usableHeight - padHeight,
    width: usableWidth,
    height: padHeight,
  };

  return {
    orientation: "portrait",
    screen: {
      x: insets.left,
      y: insets.top,
      width: usableWidth,
      height: usableHeight - padHeight,
    },
    padArea,
    pad: buildGamepadLayout({ area: padArea, buttons }),
  };
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
 * Builds the pad for a console's button set inside `area`. Everything is
 * derived from that rect, so the same code lays out the landscape pad (the
 * whole usable window, floating over the game) and the portrait one (the band
 * below the game) — and either way it keeps clear of the camera cutout and
 * gesture bar, since insets are already baked into the rect.
 *
 * Regions are ordered most-specific first; `hitRegion` returns the first
 * match, so overlapping hit slop never steals a touch from a real button.
 */
export function buildGamepadLayout({ area, buttons }: LayoutOptions): GamepadLayout {
  const has = (b: EmulatorButton) => buttons.includes(b);

  const left = area.x;
  const right = area.x + area.width;
  const top = area.y;
  const bottom = area.y + area.height;
  const centerX = area.x + area.width / 2;
  const usableHeight = area.height;

  const margin = Math.max(16, Math.round(usableHeight * 0.06));
  const regions: GamepadLayout = [];

  // Every size below is derived from the pad area's HEIGHT, never its width.
  // The area is about as tall in portrait as in landscape (the band vs. the
  // whole window) while its width more than doubles, so a width-derived size
  // lands on opposite sides of its `Math.min` in the two orientations — the
  // cap binds in landscape and the fraction binds in portrait, which makes
  // editing the cap silently do nothing in portrait.

  // --- Shoulders: top corners, clear of the cutout --------------------------
  const shoulderWidth = Math.round(Math.min(usableHeight * 0.22, 64));
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

  // --- D-pad geometry (pushed last, see below) ------------------------------
  const dpadSize = Math.round(Math.min(usableHeight * 0.5, 150));
  const dpadVisual: Rect = {
    x: left + margin,
    y: bottom - margin - dpadSize,
    width: dpadSize,
    height: dpadSize,
  };

  // --- Select / Menu / Start: one centred row ------------------------------
  const smallWidth = Math.round(Math.min(usableHeight * 0.22, 64));
  const smallHeight = Math.round(Math.min(usableHeight * 0.1, 28));
  const smallGap = 8;
  const menuSize = Math.round(Math.min(usableHeight * 0.12, 36));
  // The menu sits between Select and Start, so its gap has to clear both
  // neighbours' hit slop as well: overlapping slop there would pause the game
  // on a mistimed Start.
  const menuGap = smallGap + HIT_SLOP * 2;
  const rowHalfWidth = menuSize / 2 + menuGap + smallWidth;
  // A landscape pad is wide enough to sit this row between the D-pad and the
  // face cluster along the bottom. A portrait band is not: there the row would
  // collide with the D-pad, so it moves up into the empty middle instead.
  const rowFits =
    centerX - rowHalfWidth > dpadVisual.x + dpadSize + smallGap &&
    centerX + rowHalfWidth < clusterCx - spread - faceSize / 2 - smallGap;
  const smallY = rowFits
    ? bottom - margin - smallHeight
    : Math.round(dpadVisual.y - margin - smallHeight);
  if (has("select")) {
    regions.push(
      pill("select", {
        x: Math.round(centerX - menuSize / 2 - menuGap - smallWidth),
        y: smallY,
        width: smallWidth,
        height: smallHeight,
      }),
    );
  }
  if (has("start")) {
    regions.push(
      pill("start", {
        x: Math.round(centerX + menuSize / 2 + menuGap),
        y: smallY,
        width: smallWidth,
        height: smallHeight,
      }),
    );
  }
  // Pushed after the pills so that if the gap is ever tightened enough for the
  // slop to overlap, the game button wins the tie rather than the menu.
  // Centred on the pills' row: the menu is taller, so it overhangs evenly.
  const menuVisual: Rect = {
    x: Math.round(centerX - menuSize / 2),
    y: Math.round(smallY + (smallHeight - menuSize) / 2),
    width: menuSize,
    height: menuSize,
  };
  regions.push({ kind: "menu", hit: grow(menuVisual), visual: menuVisual });

  // --- D-pad: bottom left, added LAST --------------------------------------
  // Its hit area is deliberately oversized so a thumb rolling past the edge
  // keeps steering. Because `hitRegion` takes the first match, appending it
  // after every precise button guarantees that slop can never steal a touch
  // aimed at Select or B.
  regions.push({
    kind: "dpad",
    hit: grow(dpadVisual, Math.round(dpadSize * 0.18)),
    visual: dpadVisual,
    deadZone: dpadSize * 0.14,
  });

  return regions;
}
