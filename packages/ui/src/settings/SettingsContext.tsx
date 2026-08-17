import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSQLiteContext } from "expo-sqlite";
import { getSetting, setSetting } from "@emulators/storage";
import i18n, { isSupportedLanguage, resolveDeviceLanguage, type SupportedLanguage } from "../i18n";
import type { Orientation } from "../components/gamepad/layout";
import {
  PAD_OPACITY,
  PAD_OPACITY_KEYS,
  PAD_SCALE,
  PAD_SCALE_KEYS,
  clampToRange,
  parseStored,
} from "./padCustomization";

const HAPTICS_KEY = "haptics_enabled";
const LANGUAGE_KEY = "language";

/** `'auto'` follows the device language; anything else is a manual override. */
export type LanguagePreference = "auto" | SupportedLanguage;

export interface Settings {
  /** Vibrate on gamepad button presses. Defaults to on until the user says otherwise. */
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
  /** UI language preference. Defaults to `'auto'` until the user picks one. */
  language: LanguagePreference;
  setLanguage: (language: LanguagePreference) => void;
  /**
   * Gamepad size and transparency, per orientation: the landscape pad floats
   * over the running game, where a faint pad is usually wanted, while the
   * portrait one sits in its own band below it — the same number rarely suits
   * both. 1 is the stock pad in each case.
   */
  padScale: Record<Orientation, number>;
  padOpacity: Record<Orientation, number>;
  setPadScale: (orientation: Orientation, value: number) => void;
  setPadOpacity: (orientation: Orientation, value: number) => void;
  /** Restores both defaults, for that orientation only. */
  resetPad: (orientation: Orientation) => void;
}

const SettingsContext = createContext<Settings | null>(null);

/**
 * App settings, read once from SQLite and kept in React state from then on.
 * Sits inside `SQLiteProvider` in `AppRoot`. Writes are fire-and-forget: the
 * toggle must respond instantly, and a failed persist costs one preference,
 * not a session.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [hapticsEnabled, setHapticsState] = useState(true);
  const [language, setLanguageState] = useState<LanguagePreference>("auto");
  // Four primitives rather than two objects: they are what the pad's layout
  // memo actually depends on, and a primitive cannot churn identity.
  const [scalePortrait, setScalePortrait] = useState(PAD_SCALE.default);
  const [scaleLandscape, setScaleLandscape] = useState(PAD_SCALE.default);
  const [opacityPortrait, setOpacityPortrait] = useState(PAD_OPACITY.default);
  const [opacityLandscape, setOpacityLandscape] = useState(PAD_OPACITY.default);
  // Children are held back until the stored language has been applied —
  // otherwise a saved override would flash the device language on every cold
  // start. i18next starts on the device language, so 'auto' has nothing to do.
  const [languageLoaded, setLanguageLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSetting(db, HAPTICS_KEY)
      .then((value) => {
        // null means never set — keep the default.
        if (!cancelled && value !== null) setHapticsState(value === "1");
      })
      .catch((error: unknown) => console.error("settings load failed:", error));
    return () => {
      cancelled = true;
    };
  }, [db]);

  useEffect(() => {
    let cancelled = false;
    getSetting(db, LANGUAGE_KEY)
      .then(async (value) => {
        // null (never set) or an unknown value both mean "follow the device".
        if (cancelled || value === null || !isSupportedLanguage(value)) return;
        setLanguageState(value);
        await i18n.changeLanguage(value);
      })
      .catch((error: unknown) => console.error("settings load failed:", error))
      .finally(() => {
        // Loading (or failing to load) must never hold the app: children
        // render with the device language either way.
        if (!cancelled) setLanguageLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  // Unlike the language, these are not gated: the pad is only built once a game
  // is on screen, which is several navigations after this read resolves.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getSetting(db, PAD_SCALE_KEYS.portrait),
      getSetting(db, PAD_SCALE_KEYS.landscape),
      getSetting(db, PAD_OPACITY_KEYS.portrait),
      getSetting(db, PAD_OPACITY_KEYS.landscape),
    ])
      .then(([sPortrait, sLandscape, oPortrait, oLandscape]) => {
        if (cancelled) return;
        setScalePortrait(parseStored(sPortrait, PAD_SCALE));
        setScaleLandscape(parseStored(sLandscape, PAD_SCALE));
        setOpacityPortrait(parseStored(oPortrait, PAD_OPACITY));
        setOpacityLandscape(parseStored(oLandscape, PAD_OPACITY));
      })
      .catch((error: unknown) => console.error("settings load failed:", error));
    return () => {
      cancelled = true;
    };
  }, [db]);

  const setHapticsEnabled = useCallback(
    (enabled: boolean) => {
      setHapticsState(enabled);
      setSetting(db, HAPTICS_KEY, enabled ? "1" : "0").catch((error: unknown) =>
        console.error("settings save failed:", error),
      );
    },
    [db],
  );

  const setLanguage = useCallback(
    (next: LanguagePreference) => {
      setLanguageState(next);
      void i18n.changeLanguage(next === "auto" ? resolveDeviceLanguage() : next);
      setSetting(db, LANGUAGE_KEY, next).catch((error: unknown) =>
        console.error("settings save failed:", error),
      );
    },
    [db],
  );

  const setPadScale = useCallback(
    (orientation: Orientation, next: number) => {
      const clamped = clampToRange(next, PAD_SCALE);
      if (orientation === "portrait") setScalePortrait(clamped);
      else setScaleLandscape(clamped);
      setSetting(db, PAD_SCALE_KEYS[orientation], String(clamped)).catch((error: unknown) =>
        console.error("settings save failed:", error),
      );
    },
    [db],
  );

  const setPadOpacity = useCallback(
    (orientation: Orientation, next: number) => {
      const clamped = clampToRange(next, PAD_OPACITY);
      if (orientation === "portrait") setOpacityPortrait(clamped);
      else setOpacityLandscape(clamped);
      setSetting(db, PAD_OPACITY_KEYS[orientation], String(clamped)).catch((error: unknown) =>
        console.error("settings save failed:", error),
      );
    },
    [db],
  );

  const resetPad = useCallback(
    (orientation: Orientation) => {
      setPadScale(orientation, PAD_SCALE.default);
      setPadOpacity(orientation, PAD_OPACITY.default);
    },
    [setPadScale, setPadOpacity],
  );

  // The two Records are built HERE, never inline in a consumer. A fresh object
  // per render would change `useEmulatorLayout`'s memo input every render, and
  // `GamepadOverlay` releases every held button whenever the layout identity
  // changes — the pad would drop whatever the player is holding, constantly.
  const value = useMemo(
    () => ({
      hapticsEnabled,
      setHapticsEnabled,
      language,
      setLanguage,
      padScale: { portrait: scalePortrait, landscape: scaleLandscape },
      padOpacity: { portrait: opacityPortrait, landscape: opacityLandscape },
      setPadScale,
      setPadOpacity,
      resetPad,
    }),
    [
      hapticsEnabled,
      setHapticsEnabled,
      language,
      setLanguage,
      scalePortrait,
      scaleLandscape,
      opacityPortrait,
      opacityLandscape,
      setPadScale,
      setPadOpacity,
      resetPad,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {languageLoaded ? children : null}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Settings {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error("useSettings must be used within SettingsProvider");
  return settings;
}
