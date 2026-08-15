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

  const value = useMemo(
    () => ({ hapticsEnabled, setHapticsEnabled, language, setLanguage }),
    [hapticsEnabled, setHapticsEnabled, language, setLanguage],
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
