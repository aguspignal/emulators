import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EmulatorButton } from "@emulators/core-interface";
import { buildEmulatorLayout, type EmulatorLayout, type Orientation } from "./layout";

/**
 * The emulator screen's geometry for the current device orientation. Both the
 * native view's rect and the pad come from one build, so they can never
 * disagree about where the game ends and the buttons begin.
 *
 * `useWindowDimensions` re-renders on rotation, which is the whole rotation
 * story on the JS side: the Android activity is configured with
 * `configChanges="orientation|screenSize"`, so a rotation never recreates it
 * and the native emulator view (and the running emulation thread behind it)
 * survives untouched.
 *
 * `scale` is the player's pad size for *both* orientations (from
 * `useSettings`), handed over whole: `buildEmulatorLayout` is the one place
 * that decides which orientation this is, so no caller has to pick first.
 */
export function useEmulatorLayout(
  buttons: readonly EmulatorButton[],
  scale: Record<Orientation, number>,
): EmulatorLayout {
  const { width, height } = useWindowDimensions();
  const { top, right, bottom, left } = useSafeAreaInsets();

  return useMemo(
    () =>
      buildEmulatorLayout({ width, height, insets: { top, right, bottom, left }, buttons, scale }),
    // The two scales are depended on as primitives, not as the object holding
    // them: a settings object rebuilt on an unrelated render must not produce a
    // new layout, which `GamepadOverlay` reads as "every button just moved" and
    // answers by releasing whatever is held.
    [width, height, top, right, bottom, left, buttons, scale.portrait, scale.landscape],
  );
}
