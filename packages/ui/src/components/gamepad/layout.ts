import type { ConsoleSpec, EmulatorButton } from "@emulators/core-interface";

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
  /**
   * Multiplier on every button size; 1 is the stock pad. Sizes only — the
   * outer margin does not scale, so buttons stay pinned to the area's edges
   * and grow inward. A scale the area cannot fit is saturated down (never
   * below 1); see `buildGamepadLayout`.
   */
  scale?: number;
}

export interface EmulatorLayoutOptions {
  width: number;
  height: number;
  insets: Insets;
  buttons: readonly EmulatorButton[];
  /**
   * The player's pad size for each orientation. Passed as a pair, not as one
   * number, because this function is the single place that decides which
   * orientation the window is in — no caller should have to guess first.
   */
  scale?: Record<Orientation, number>;
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
  scale,
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
      pad: buildGamepadLayout({ area, buttons, scale: scale?.landscape }),
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
    pad: buildGamepadLayout({ area: padArea, buttons, scale: scale?.portrait }),
  };
}

/** Where a console's touch screen ends up on the device, and how big it is natively. */
export interface TouchScreenRect {
  /** Absolute screen coordinates, comparable with touch `pageX`/`pageY`. */
  rect: Rect;
  /** The touch screen's native pixel size, which `core.setTouch` expects. */
  width: number;
  height: number;
}

/**
 * Locates a console's touch screen inside the rect the native view was given,
 * or null for a console without one.
 *
 * This is the one place layout code needs the console's pixel dimensions, and
 * it is unavoidable: the native view aspect-fits the whole composited
 * framebuffer inside its rect and centres it, so only the same arithmetic can
 * say where one of the stacked screens landed. Cores composite every screen
 * into one framebuffer top to bottom — the same assumption `SlotSheet`'s
 * thumbnail aspect makes — so a core that composites differently must change
 * both.
 */
export function touchScreenRect(screen: Rect, spec: ConsoleSpec): TouchScreenRect | null {
  const index = spec.touchScreen;
  if (index === null || index < 0 || index >= spec.screens.length) return null;

  const stackedWidth = Math.max(...spec.screens.map((s) => s.width));
  const stackedHeight = spec.screens.reduce((total, s) => total + s.height, 0);
  if (stackedWidth <= 0 || stackedHeight <= 0) return null;

  const scale = Math.min(screen.width / stackedWidth, screen.height / stackedHeight);
  if (!(scale > 0)) return null;

  const left = screen.x + (screen.width - stackedWidth * scale) / 2;
  const top = screen.y + (screen.height - stackedHeight * scale) / 2;

  const target = spec.screens[index];
  const above = spec.screens.slice(0, index).reduce((total, s) => total + s.height, 0);

  return {
    rect: {
      // A screen narrower than the widest is centred in the stack, which is
      // what compositing them into one framebuffer implies.
      x: left + ((stackedWidth - target.width) / 2) * scale,
      y: top + above * scale,
      width: target.width * scale,
      height: target.height * scale,
    },
    width: target.width,
    height: target.height,
  };
}

/**
 * Maps an absolute screen point into the touch screen's native pixels, clamped
 * to its bounds so a drag that leaves the screen still reads as an edge touch —
 * which is how a stylus sliding off the plastic behaves.
 */
export function toTouchPoint(
  touch: TouchScreenRect,
  x: number,
  y: number,
): { x: number; y: number } {
  const { rect } = touch;
  const nx = ((x - rect.x) / rect.width) * touch.width;
  const ny = ((y - rect.y) / rect.height) * touch.height;
  return {
    x: Math.min(Math.max(Math.floor(nx), 0), touch.width - 1),
    y: Math.min(Math.max(Math.floor(ny), 0), touch.height - 1),
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

/** How much the fit guard gives up per attempt when a scale does not fit. */
const SCALE_STEP_DOWN = 0.02;

/**
 * The largest scale at or below the requested one that `area` can actually fit.
 *
 * The portrait band keeps its height at every scale — the game area must not
 * move while the player drags a size slider — so on a short device the pad
 * fills the band well before the top of the range. Rather than clamp every
 * device to the worst one, grow until it stops fitting and then stop.
 *
 * Never below 1. That is the layout everything shipped with, and its fit is a
 * given, so a request at or under the stock size is always honoured exactly.
 */
function fitMetrics(area: Rect, buttons: readonly EmulatorButton[], scale: number) {
  const floor = Math.min(scale, 1);
  let metrics = padMetrics(area, buttons, scale);
  while (metrics.scale > floor && metrics.overflows) {
    metrics = padMetrics(area, buttons, Math.max(floor, metrics.scale - SCALE_STEP_DOWN));
  }
  return metrics;
}

/**
 * What a scale request would really come out as in this area — the same
 * saturation `buildGamepadLayout` applies, without building anything.
 *
 * The settings editor asks for the top of the range and gets back the top this
 * device can reach, which is what its size slider ends at: a slider that keeps
 * travelling after the pad has stopped growing is a slider that lies. Rounded
 * because repeated subtraction of `SCALE_STEP_DOWN` drifts (1.16 arrives as
 * 1.1600000000000001).
 */
export function fittingScale({ area, buttons, scale = 1 }: LayoutOptions): number {
  return Math.round(fitMetrics(area, buttons, scale).scale * 1000) / 1000;
}

/**
 * Every size and anchor the pad is built from, evaluated at one candidate
 * scale. Separate from the placement below so a scale can be *tried*: an area
 * too short for the sizes it asks for reports `overflows`, and
 * `buildGamepadLayout` comes back for something smaller.
 *
 * Nothing is placed until every size is known: the shoulders hang off the top
 * of the D-pad / face cluster, and in portrait it is the Select row's height
 * that stops them riding up into it.
 */
function padMetrics(area: Rect, buttons: readonly EmulatorButton[], scale: number) {
  const has = (b: EmulatorButton) => buttons.includes(b);

  const left = area.x;
  const right = area.x + area.width;
  const top = area.y;
  const bottom = area.y + area.height;
  const centerX = area.x + area.width / 2;
  const usableHeight = area.height;

  // Deliberately outside `scale`: buttons stay pinned to the pad area's outer
  // edges and grow inward, so a larger pad never reaches past the rect it was
  // given. `smallGap` and `HIT_SLOP` are fixed for a different reason — touch
  // slop tracks the size of a finger, not the size of a button.
  const margin = Math.max(16, Math.round(usableHeight * 0.06));

  // Every size below is derived from the pad area's HEIGHT, never its width.
  // The area is about as tall in portrait as in landscape (the band vs. the
  // whole window) while its width more than doubles, so a width-derived size
  // lands on opposite sides of its `Math.min` in the two orientations — the
  // cap binds in landscape and the fraction binds in portrait, which makes
  // editing the cap silently do nothing in portrait.
  //
  // `scale` multiplies each finished size — the cap included, or growing would
  // do nothing in landscape, where the cap is what binds.

  const shoulderWidth = Math.round(Math.min(usableHeight * 0.22, 124) * scale);
  const shoulderHeight = Math.round(Math.min(usableHeight * 0.13, 64) * scale);
  // ZL/ZR sit just inboard of L/R.
  const zGap = shoulderWidth + 12;

  const faceSize = Math.round(Math.min(usableHeight * 0.2, 68) * scale);
  const faceGap = Math.round(faceSize * 0.28);
  // Cluster radius from its centre to a button centre.
  const spread = faceSize / 2 + faceGap / 2;
  const clusterCx = right - margin - faceSize - spread * 0.4;
  const clusterCy = bottom - margin - faceSize / 2 - spread * 0.6;
  // The diamond's top button sits a full radius up; the GB/GBA pair only 0.45.
  const diamond = has("x") || has("y");
  const faceTop = clusterCy - spread * (diamond ? 1 : 0.45) - faceSize / 2;
  // Likewise the far side of the cluster, which is what the D-pad grows toward.
  const faceLeft = clusterCx - spread * (diamond ? 1 : 0.75) - faceSize / 2;

  const dpadSize = Math.round(Math.min(usableHeight * 0.5, 150) * scale);
  const dpadVisual: Rect = {
    x: left + margin,
    y: bottom - margin - dpadSize,
    width: dpadSize,
    height: dpadSize,
  };

  const smallWidth = Math.round(Math.min(usableHeight * 0.22, 64) * scale);
  const smallHeight = Math.round(Math.min(usableHeight * 0.1, 28) * scale);
  const smallGap = 8;
  const menuSize = Math.round(Math.min(usableHeight * 0.12, 36) * scale);
  // The menu sits between Select and Start, so its gap has to clear both
  // neighbours' hit slop as well: overlapping slop there would pause the game
  // on a mistimed Start.
  const menuGap = smallGap + HIT_SLOP * 2;
  const rowHalfWidth = menuSize / 2 + menuGap + smallWidth;
  // A landscape pad is wide enough to sit the Select/Menu/Start row between the
  // D-pad and the face cluster along the bottom. A portrait band is not: there
  // the row would collide with the D-pad, so it goes to the band's top edge —
  // the far end of the pad from the thumbs, which is where the least-pressed
  // buttons belong.
  const rowFits =
    centerX - rowHalfWidth > dpadVisual.x + dpadSize + smallGap &&
    centerX + rowHalfWidth < clusterCx - spread - faceSize / 2 - smallGap;
  const smallY = rowFits ? bottom - margin - smallHeight : top + margin;
  // The menu is taller than the pills and centred on them, so it — not the
  // pills — is the row's real bottom edge.
  const rowBottom = smallY + Math.max(smallHeight, (smallHeight + menuSize) / 2);

  // Shoulders ride just above whichever of the D-pad and the face cluster
  // reaches highest, so they stay within a thumb's roll of the controls the
  // hands are already on rather than stranded in the empty top corners. In
  // portrait that lands them exactly where the Select row used to sit; the
  // floor keeps them clear of the row that has since moved up there.
  const shoulderMinY = rowFits ? top + margin : rowBottom + smallGap;
  const shoulderY = Math.round(
    Math.max(shoulderMinY, Math.min(dpadVisual.y, faceTop) - margin - shoulderHeight),
  );

  // Whether this scale actually fits, in the three ways a bigger pad runs out
  // of room. Vertically the top stack — the shoulders, or the Select row once
  // it has moved up there — has to stay clear of whichever of the D-pad and
  // the face cluster reaches highest; at the stock size the `Math.max` above
  // absorbs that collision silently, so this is the same condition stated
  // positively.
  const ceiling = Math.min(dpadVisual.y, faceTop);
  const hasShoulders = has("l") || has("r") || has("zl") || has("zr");
  const stackCollides = hasShoulders
    ? shoulderMinY + shoulderHeight + margin > ceiling
    : !rowFits && rowBottom + smallGap > ceiling;
  // Horizontally there are two, both only reachable in a portrait band: the
  // D-pad and the face cluster grow toward each other along the bottom, and
  // ZL/ZR grow toward each other in the middle of the shoulder row. Neither
  // asks for clearance beyond not overlapping — the stock pad already runs as
  // close as 3px on a small phone, so demanding a gap would refuse every
  // narrow device the growth it can genuinely afford.
  const bottomRowCollides = dpadVisual.x + dpadSize > faceLeft;
  const zCollide =
    has("zl") &&
    has("zr") &&
    left + margin + zGap + shoulderWidth > right - margin - shoulderWidth - zGap;
  const overflows =
    ceiling < top + margin || stackCollides || bottomRowCollides || zCollide;

  return {
    scale,
    overflows,
    left,
    right,
    centerX,
    margin,
    shoulderWidth,
    shoulderHeight,
    shoulderY,
    zGap,
    faceSize,
    spread,
    clusterCx,
    clusterCy,
    diamond,
    dpadSize,
    dpadVisual,
    smallWidth,
    smallHeight,
    smallY,
    menuSize,
    menuGap,
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
export function buildGamepadLayout({ area, buttons, scale = 1 }: LayoutOptions): GamepadLayout {
  const has = (b: EmulatorButton) => buttons.includes(b);
  const regions: GamepadLayout = [];

  // Saturated down to what this area can hold; see `fitMetrics`. The settings
  // editor caps its slider at the same number via `fittingScale`, so the pad
  // and the slider run out of room together.
  const metrics = fitMetrics(area, buttons, scale);

  const {
    left,
    right,
    centerX,
    margin,
    shoulderWidth,
    shoulderHeight,
    shoulderY,
    zGap,
    faceSize,
    spread,
    clusterCx,
    clusterCy,
    diamond,
    dpadSize,
    dpadVisual,
    smallWidth,
    smallHeight,
    smallY,
    menuSize,
    menuGap,
  } = metrics;

  const face = (button: EmulatorButton, dx: number, dy: number): Rect => ({
    x: Math.round(clusterCx + dx * spread - faceSize / 2),
    y: Math.round(clusterCy + dy * spread - faceSize / 2),
    width: faceSize,
    height: faceSize,
  });

  // --- Shoulders ------------------------------------------------------------
  if (has("l")) {
    regions.push(
      pill("l", {
        x: left + margin,
        y: shoulderY,
        width: shoulderWidth,
        height: shoulderHeight,
      }),
    );
  }
  if (has("r")) {
    regions.push(
      pill("r", {
        x: right - margin - shoulderWidth,
        y: shoulderY,
        width: shoulderWidth,
        height: shoulderHeight,
      }),
    );
  }
  if (has("zl")) {
    regions.push(
      pill("zl", {
        x: left + margin + zGap,
        y: shoulderY,
        width: shoulderWidth,
        height: shoulderHeight,
      }),
    );
  }
  if (has("zr")) {
    regions.push(
      pill("zr", {
        x: right - margin - shoulderWidth - zGap,
        y: shoulderY,
        width: shoulderWidth,
        height: shoulderHeight,
      }),
    );
  }

  // --- Face buttons: bottom right diamond -----------------------------------
  if (diamond) {
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

  // --- Select / Menu / Start: one centred row ------------------------------
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
