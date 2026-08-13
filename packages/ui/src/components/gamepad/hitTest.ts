import type { EmulatorButton } from '@emulators/core-interface';
import type { GamepadLayout, Rect, Region } from './layout';

export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * First region whose hit rect contains the point, or null. Order matters:
 * `buildGamepadLayout` appends the loosely-bounded D-pad last so its slop
 * never wins over a precise button.
 */
export function hitRegion(layout: GamepadLayout, x: number, y: number): Region | null {
  for (const region of layout) {
    if (containsPoint(region.hit, x, y)) return region;
  }
  return null;
}

/**
 * Directions in the eight octants around the D-pad centre, starting east and
 * going counter-clockwise (the direction `Math.atan2` increases in screen
 * space once the y axis is flipped).
 */
const OCTANTS: EmulatorButton[][] = [
  ['right'],
  ['up', 'right'],
  ['up'],
  ['up', 'left'],
  ['left'],
  ['down', 'left'],
  ['down'],
  ['down', 'right'],
];

/**
 * Maps a touch point to the directions a D-pad press should produce. Inside
 * the dead zone nothing is pressed; otherwise the angle picks one of eight
 * equal octants, so the four corners give true diagonals.
 */
export function resolveDpad(
  region: Extract<Region, { kind: 'dpad' }>,
  x: number,
  y: number
): EmulatorButton[] {
  const cx = region.visual.x + region.visual.width / 2;
  const cy = region.visual.y + region.visual.height / 2;
  const dx = x - cx;
  // Screen y grows downward; flip it so positive angles point up.
  const dy = cy - y;

  if (Math.hypot(dx, dy) < region.deadZone) return [];

  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  // atan2 returns (-PI, PI], so the index can be negative or wrap to 8.
  return OCTANTS[((octant % 8) + 8) % 8];
}

/** The buttons a single touch at (x, y) presses via `region`. */
export function buttonsForTouch(region: Region, x: number, y: number): EmulatorButton[] {
  switch (region.kind) {
    case 'dpad':
      return resolveDpad(region, x, y);
    case 'button':
      return [region.button];
    case 'menu':
      // Fires as a one-shot on touch start; it is never held.
      return [];
  }
}
