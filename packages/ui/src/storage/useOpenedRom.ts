import { useEffect, useRef } from "react";
import { Linking } from "react-native";

/**
 * Schemes an `ACTION_VIEW` intent can carry a real file in. Anything else —
 * notably the app's own `gba://` / `exp+gba://` deep links, which arrive
 * through the very same channel — is not a file and must be ignored.
 */
const FILE_SCHEMES = ["content://", "file://"];

/**
 * Calls `onOpen` with the URI of a ROM the system asked this app to open.
 *
 * React Native's `Linking` already covers both delivery paths, so no native
 * code is needed: `getInitialURL()` returns `intent.getData()` when the
 * activity was started by an `ACTION_VIEW` intent (cold start), and the `url`
 * event fires from `onNewIntent` while the app is already running — the
 * activity is `singleTask`, so a second tap reuses it rather than launching a
 * new one.
 *
 * Deliberately React Native's `Linking` and not `expo-linking`: the latter
 * would be a new peerDependency needing `npx expo install` in all three apps,
 * for a wrapper around the same module.
 */
export function useOpenedRom(onOpen: (uri: string) => void | Promise<void>): void {
  const handler = useRef(onOpen);
  // Kept in a ref so the subscription below can stay mounted for the screen's
  // whole life: re-subscribing on every render of a changing callback would
  // race `getInitialURL`, which resolves once per mount.
  useEffect(() => {
    handler.current = onOpen;
  });

  useEffect(() => {
    // Both paths can deliver the same URI — a cold start reads the activity's
    // intent, which stays the activity's intent afterwards — and a killed
    // process is restored with it still attached.
    const handled = new Set<string>();
    const handle = (uri: string | null) => {
      if (!uri || !FILE_SCHEMES.some((scheme) => uri.startsWith(scheme))) return;
      if (handled.has(uri)) return;
      handled.add(uri);
      void handler.current(uri);
    };

    Linking.getInitialURL()
      .then(handle)
      .catch((error: unknown) => console.warn("could not read the launch intent:", error));
    const subscription = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => subscription.remove();
  }, []);
}
