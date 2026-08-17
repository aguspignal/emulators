import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, StyleSheet, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useKeepAwake } from "expo-keep-awake";
import {
  AUTO_SAVESTATE_SLOT,
  CONSOLES,
  type EmulatorSubscription,
  type RomInfo,
} from "@emulators/core-interface";
import {
  applyRomInfo,
  deleteStateThumb,
  getSaveState,
  stateThumbUri,
  upsertSaveState,
} from "@emulators/storage";
import { useAppConfig } from "../config";
// Global i18n.t on purpose, throughout this file: useTranslation()'s t would
// change identity on a language switch, and through the callback deps that
// would re-run the boot effect — unloading and rebooting the running game.
import i18n from "../i18n";
import { useSettings } from "../settings/SettingsContext";
import { colors } from "../theme";
import { showErrorAlert } from "../utils/errors";
import { GamepadOverlay } from "../components/gamepad/GamepadOverlay";
import { GameMenu } from "../components/gamepad/GameMenu";
import { SlotSheet } from "../components/gamepad/SlotSheet";
import { useEmulatorLayout } from "../components/gamepad/useEmulatorLayout";
import type { Rect } from "../components/gamepad/layout";
import type { RootScreenProps } from "../navigation/types";

/** Which menu layer is up. The gamepad is suspended for all but 'closed'. */
type MenuView = "closed" | "root" | "save" | "load";

/** Emulation speed while the fast-forward toggle is on. */
const FAST_FORWARD_SPEED = 1.75;

/**
 * Hosts the app's native emulator view, the on-screen gamepad, the pause menu,
 * and the savestate slots.
 */
export function EmulatorScreen({ route, navigation }: RootScreenProps<"Emulator">) {
  const { core, EmulatorView, consoles } = useAppConfig();
  const { padScale, padOpacity } = useSettings();
  const db = useSQLiteContext();
  const { romId, romUri, romName } = route.params;
  const [booted, setBooted] = useState<RomInfo | null>(null);
  const [menu, setMenu] = useState<MenuView>("closed");
  const [muted, setMuted] = useState(false);
  const [fastForward, setFastForward] = useState(false);
  // Read from callbacks that must not be re-created (and re-subscribed) every
  // time the game boots.
  const bootedRef = useRef(false);

  useKeepAwake();

  useEffect(() => {
    let cancelled = false;
    let errorSub: EmulatorSubscription | undefined;

    const boot = async () => {
      let info: RomInfo;
      try {
        info = await core.loadRom(romUri);
      } catch (error) {
        if (cancelled) return;
        showErrorAlert(
          i18n.t("emulator.bootFailedTitle"),
          error,
          i18n.t("emulator.bootFailedMessage"),
          () => navigation.goBack(),
        );
        return;
      }
      if (cancelled) return;

      // Subscribe only after boot: the core both emits 'error' and rejects
      // on the same loadRom failure, so an earlier subscription would
      // double-alert. Post-boot, the event covers mid-game errors.
      errorSub = core.addListener("error", ({ message }) =>
        showErrorAlert(
          i18n.t("emulator.problemTitle"),
          new Error(message),
          i18n.t("emulator.problemMessage"),
        ),
      );

      // Pick up where the last session left off. A state that won't load —
      // corrupt, or written by an older core — must never keep the game from
      // starting; the cost of failing is beginning from the ROM's own boot.
      try {
        const auto = await getSaveState(db, romId, AUTO_SAVESTATE_SLOT);
        if (auto && !cancelled) await core.loadState(AUTO_SAVESTATE_SLOT);
      } catch (error) {
        console.warn("auto-resume failed; starting fresh:", error);
      }
      if (cancelled) return;

      core.start();
      setBooted(info);
      bootedRef.current = true;
      // Reconcile the import-time guess: the picker can only infer gb vs
      // gbc from the extension, while the core reads the ROM header. Also
      // records the ROM hash that names its save files.
      // Log-only: a failed DB write must never eject a running game.
      applyRomInfo(db, romId, info).catch((error: unknown) =>
        console.error("applyRomInfo failed:", error),
      );
    };
    void boot();

    return () => {
      cancelled = true;
      bootedRef.current = false;
      errorSub?.remove();
      core.unloadRom().catch((error: unknown) => console.error("unloadRom failed:", error));
    };
  }, [core, db, romId, romUri, navigation]);

  /**
   * Everything that follows a successful `core.saveState`: a preview frame for
   * the slot, the library row that makes the slot show as occupied, and the
   * thumbnail the slot used to have.
   */
  const recordState = useCallback(
    async (slot: number) => {
      const stale = await getSaveState(db, romId, slot);
      const savedAt = Date.now();
      try {
        await core.captureScreenshot(stateThumbUri(romId, slot, savedAt));
      } catch (error) {
        // A slot with no preview is still a perfectly good savestate.
        console.warn("savestate thumbnail failed:", error);
      }
      await upsertSaveState(db, romId, slot, savedAt);
      // Only after the row points at the new file, and never when the two
      // names collide — that would delete the thumbnail just written.
      if (stale && stale.saved_at !== savedAt) {
        try {
          deleteStateThumb(romId, slot, stale.saved_at);
        } catch (error) {
          console.error("old thumbnail left behind:", error);
        }
      }
    },
    [core, db, romId],
  );

  /** Writes the automatic slot — the state the next boot resumes from. */
  const autoSaveInFlight = useRef(false);
  const autoSave = useCallback(async () => {
    if (!bootedRef.current || autoSaveInFlight.current) return;
    autoSaveInFlight.current = true;
    try {
      await core.saveState(AUTO_SAVESTATE_SLOT);
      await recordState(AUTO_SAVESTATE_SLOT);
    } catch (error) {
      // Silent: the player asked to leave, not to save. They still have their
      // in-game save and any slot they wrote by hand.
      console.error("auto-save failed:", error);
    } finally {
      autoSaveInFlight.current = false;
    }
  }, [core, recordState]);

  // Emulation must not keep running with the app backgrounded or the screen
  // off. The core's state is the only thing consulted: if the game is already
  // paused (pause menu open, still booting) nothing is remembered, so coming
  // back doesn't resume behind the menu. Cores are expected to enforce this
  // natively too — the emulation thread is native and outlives a throttled JS
  // thread — but both are idempotent, so whichever fires first wins.
  const resumeOnForeground = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (resumeOnForeground.current) {
          resumeOnForeground.current = false;
          core.resume();
        }
        return;
      }
      if (core.getState() === "running") {
        resumeOnForeground.current = true;
        core.pause();
      }
      // Android can kill a backgrounded process without another word, so this
      // is the last chance to record where the player was.
      void autoSave();
    });
    return () => sub.remove();
  }, [core, autoSave]);

  // Leaving the game saves it first. The pop is held until that finishes:
  // unmounting tears the core down, and a save still in flight would be lost.
  const exitHandled = useRef(false);
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (e) => {
        // Nothing to save before the game booted (the failure alert pops the
        // screen itself), and the re-dispatched action must pass straight
        // through or the screen could never be left.
        if (exitHandled.current || !bootedRef.current) return;
        e.preventDefault();
        exitHandled.current = true;
        core.pause();
        void autoSave().finally(() => navigation.dispatch(e.data.action));
      }),
    [navigation, core, autoSave],
  );

  // Applied on boot as well as on toggle: the native audio sink and frame
  // pacing outlive the ROM, so a mute or fast-forward left on by the previous
  // game would silently carry over into this one, where the menu shows both
  // toggles as off.
  useEffect(() => {
    if (!booted) return;
    core.setVolume(muted ? 0 : 1);
  }, [core, booted, muted]);
  useEffect(() => {
    if (!booted) return;
    core.setSpeed(fastForward ? FAST_FORWARD_SPEED : 1);
  }, [core, booted, fastForward]);

  const openMenu = useCallback(() => {
    core.pause();
    setMenu("root");
  }, [core]);

  const resumeGame = useCallback(() => {
    setMenu("closed");
    core.resume();
  }, [core]);

  // While a menu layer is up, hardware back peels it instead of popping the
  // screen. Registered only then, so with the menu closed back falls through
  // to the navigation pop — and its `beforeRemove` auto-save — as usual.
  useEffect(() => {
    if (menu === "closed") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (menu === "save" || menu === "load") setMenu("root");
      else resumeGame();
      return true;
    });
    return () => sub.remove();
  }, [menu, resumeGame]);

  const reset = useCallback(() => {
    core.reset();
    setMenu("closed");
    core.resume();
  }, [core]);

  const saveToSlot = useCallback(
    async (slot: number) => {
      try {
        await core.saveState(slot);
        await recordState(slot);
      } catch (error) {
        showErrorAlert(i18n.t("emulator.saveFailed"), error);
        return; // stay in the sheet so the slot can be tried again
      }
      resumeGame();
    },
    [core, recordState, resumeGame],
  );

  const loadFromSlot = useCallback(
    async (slot: number) => {
      try {
        await core.loadState(slot);
      } catch (error) {
        showErrorAlert(i18n.t("emulator.loadFailed"), error);
        return;
      }
      resumeGame();
    },
    [core, resumeGame],
  );

  // The pad is laid out for the console the core actually detected from the
  // ROM header, not the app's headline console: a Game Boy ROM in the GBA app
  // must not show L/R.
  const spec = booted ? CONSOLES[booted.console] : consoles[0];
  // Rotating the device rebuilds this: landscape floats the pad over a
  // full-bleed game, portrait puts the game on top and the pad in a band below.
  // The size is the player's, per orientation; `buildEmulatorLayout` picks.
  const layout = useEmulatorLayout(spec.buttons, padScale);

  return (
    <View style={styles.container}>
      {layout.orientation === "portrait" && (
        // The band's own surface, so the pad's translucent buttons read against
        // something other than the letterboxing above them. Runs to the bottom
        // edge rather than stopping at the inset, which would strand a black
        // strip under the gesture bar.
        <View style={[styles.padBand, { top: layout.padArea.y }]} />
      )}
      <EmulatorView style={absoluteRect(layout.screen)} />
      {booted && (
        <GamepadOverlay
          layout={layout.pad}
          onMenu={openMenu}
          suspended={menu !== "closed"}
          opacity={padOpacity[layout.orientation]}
        />
      )}
      {booted && menu === "root" && (
        <GameMenu
          title={romName}
          muted={muted}
          fastForward={fastForward}
          onResume={resumeGame}
          onSaveState={() => setMenu("save")}
          onLoadState={() => setMenu("load")}
          onToggleMute={() => setMuted((m) => !m)}
          onToggleFastForward={() => setFastForward((f) => !f)}
          onReset={reset}
          onExit={() => navigation.goBack()}
        />
      )}
      {booted && (menu === "save" || menu === "load") && (
        <SlotSheet
          mode={menu}
          romId={romId}
          spec={spec}
          onPick={(slot) => void (menu === "save" ? saveToSlot(slot) : loadFromSlot(slot))}
          onBack={() => setMenu("root")}
        />
      )}
    </View>
  );
}

function absoluteRect(rect: Rect) {
  return {
    position: "absolute" as const,
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  padBand: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
  },
});
