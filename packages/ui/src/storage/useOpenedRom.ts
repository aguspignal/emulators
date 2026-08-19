import { useEffect, useRef } from "react";
import { Linking } from "react-native";
import { useAppConfig } from "../config";

/**
 * Schemes an `ACTION_VIEW` intent can carry a real file in. Anything else —
 * notably the app's own `gba://` / `exp+gba://` deep links, which arrive
 * through the very same channel — is not a file and must be ignored.
 */
const FILE_SCHEMES = ["content://", "file://"];

/**
 * Calls `onOpen` with the URI of a ROM the system asked this app to open —
 * a file manager's "open with" (`ACTION_VIEW`) or a share to the app
 * (`ACTION_SEND`).
 *
 * React Native's `Linking` already covers both VIEW delivery paths, so no
 * native code is needed for those: `getInitialURL()` returns `intent.getData()`
 * when the activity was started by an `ACTION_VIEW` intent (cold start), and
 * the `url` event fires from `onNewIntent` while the app is already running —
 * the activity is `singleTask`, so a second tap reuses it rather than
 * launching a new one.
 *
 * SEND is different: its file rides in the intent's `EXTRA_STREAM` extra, not
 * its data URI, so `Linking` never sees it. Apps that accept shares expose a
 * `SharedFileSource` from their native module through `AppConfig.sharedFiles`,
 * and this hook drains it through the same filter and de-dup as the VIEW
 * paths. (Share matters because Samsung's My Files cannot "open" unknown
 * extensions at all — it builds the VIEW intent with an empty-string MIME no
 * intent filter can match — while its Share button works.)
 *
 * Deliberately React Native's `Linking` and not `expo-linking`: the latter
 * would be a new peerDependency needing `npx expo install` in all three apps,
 * for a wrapper around the same module.
 */
export function useOpenedRom(onOpen: (uri: string) => void | Promise<void>): void {
  const { sharedFiles } = useAppConfig();
  const handler = useRef(onOpen);
  // Kept in a ref so the subscriptions below can stay mounted for the screen's
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

    try {
      handle(sharedFiles?.getInitialFile() ?? null);
    } catch (error) {
      console.warn("could not read the launch intent's shared file:", error);
    }
    const shared = sharedFiles?.addListener(handle);

    return () => {
      subscription.remove();
      shared?.remove();
    };
  }, [sharedFiles]);
}
