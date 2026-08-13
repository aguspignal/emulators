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

const HAPTICS_KEY = "haptics_enabled";

export interface Settings {
  /** Vibrate on gamepad button presses. Defaults to on until the user says otherwise. */
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
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

  const setHapticsEnabled = useCallback(
    (enabled: boolean) => {
      setHapticsState(enabled);
      setSetting(db, HAPTICS_KEY, enabled ? "1" : "0").catch((error: unknown) =>
        console.error("settings save failed:", error),
      );
    },
    [db],
  );

  const value = useMemo(
    () => ({ hapticsEnabled, setHapticsEnabled }),
    [hapticsEnabled, setHapticsEnabled],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error("useSettings must be used within SettingsProvider");
  return settings;
}
