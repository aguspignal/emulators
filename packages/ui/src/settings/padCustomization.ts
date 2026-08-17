// Type-only, and deliberately the gamepad's own union rather than a second
// "portrait" | "landscape" declared here: the pad settings exist per
// orientation because the layout has orientations, so there is one definition.
import type { Orientation } from '../components/gamepad/layout';

/** An adjustable numeric setting: what a slider may produce, and where it starts. */
export interface Range {
  min: number;
  max: number;
  /** Quantum the slider snaps to. */
  step: number;
  default: number;
}

/**
 * Multiplier on every gamepad button size; 1 is exactly the pad that shipped
 * before this setting existed. The top of the range is what a roomy device can
 * fit — a short portrait band saturates earlier, visibly, in `buildGamepadLayout`.
 */
export const PAD_SCALE: Range = { min: 0.7, max: 1.4, step: 0.05, default: 1 };

/**
 * Alpha of the whole pad layer. It multiplies the buttons' own translucency,
 * so 1 is the current look and the slider can only make the pad fainter; the
 * floor is where it stops being findable at a glance.
 */
export const PAD_OPACITY: Range = { min: 0.3, max: 1, step: 0.05, default: 1 };

/** `settings` table keys, one per orientation. */
export const PAD_SCALE_KEYS: Record<Orientation, string> = {
  portrait: 'pad_scale_portrait',
  landscape: 'pad_scale_landscape',
};

export const PAD_OPACITY_KEYS: Record<Orientation, string> = {
  portrait: 'pad_opacity_portrait',
  landscape: 'pad_opacity_landscape',
};

export function clampToRange(value: number, range: Range): number {
  return Math.min(Math.max(value, range.min), range.max);
}

/**
 * A stored string back into a usable number. Never set, unparseable, or
 * outside a range that has since been narrowed all mean "use the default" —
 * the same discipline an unknown language code gets.
 */
export function parseStored(value: string | null, range: Range): number {
  if (value === null) return range.default;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < range.min || parsed > range.max) return range.default;
  return parsed;
}

/** How these values are written wherever one is shown to the user. */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
