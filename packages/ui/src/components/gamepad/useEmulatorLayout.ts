import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EmulatorButton } from "@emulators/core-interface";
import { buildEmulatorLayout, type EmulatorLayout } from "./layout";

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
 */
export function useEmulatorLayout(buttons: readonly EmulatorButton[]): EmulatorLayout {
  const { width, height } = useWindowDimensions();
  const { top, right, bottom, left } = useSafeAreaInsets();

  return useMemo(
    () => buildEmulatorLayout({ width, height, insets: { top, right, bottom, left }, buttons }),
    [width, height, top, right, bottom, left, buttons],
  );
}
