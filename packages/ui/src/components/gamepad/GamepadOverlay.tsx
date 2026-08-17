import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type NativeTouchEvent,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { EmulatorButton } from "@emulators/core-interface";
import { useAppConfig } from "../../config";
import { useSettings } from "../../settings/SettingsContext";
import type { GamepadLayout, Region } from "./layout";
import { buttonsForTouch, hitRegion } from "./hitTest";
import { NO_BUTTONS_PRESSED, PadVisuals } from "./PadVisuals";

/** Whatever the platform stamps on a touch; only ever used as a map key. */
type TouchId = NativeTouchEvent["identifier"];

export interface GamepadOverlayProps {
  /**
   * The regions to draw and hit-test, in absolute screen coordinates. Built by
   * the screen (via `useEmulatorLayout`) rather than here, so the pad and the
   * emulator view are placed from one shared orientation decision.
   */
  layout: GamepadLayout;
  onMenu: () => void;
  /** Stops accepting touches and releases everything held (pause menu open). */
  suspended?: boolean;
  /** The player's pad transparency; applied to the drawing, never to this view. */
  opacity?: number;
}

/**
 * The on-screen gamepad, drawn over the running game.
 *
 * React Native allows exactly one responder view at a time, so a `Pressable`
 * per button could never register the D-pad and A together. Instead this is a
 * single full-screen responder that hit-tests every entry in
 * `nativeEvent.touches` itself — which is also why the menu is a region here
 * rather than a sibling `Pressable` that would steal the responder.
 *
 * The drawing is `PadVisuals`, a child: this component owns the input and
 * nothing else, which is what lets the settings editor preview a pad without
 * being able to press one.
 */
export function GamepadOverlay({
  layout,
  onMenu,
  suspended = false,
  opacity,
}: GamepadOverlayProps) {
  const { core } = useAppConfig();
  const { hapticsEnabled } = useSettings();

  // Fire-and-forget: input must never wait on the haptics bridge call, and a
  // device without a vibrator failing the promise is not worth reporting.
  const buzz = useCallback(() => {
    if (!hapticsEnabled) return;
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key).catch(() => {});
  }, [hapticsEnabled]);

  // The authoritative held set lives in a ref so input never waits on React.
  const pressed = useRef<Set<EmulatorButton>>(new Set());
  // Touch identifier -> the region that finger is steering (D-pad only).
  const owners = useRef<Map<TouchId, Region>>(new Map());
  const [visiblePressed, setVisiblePressed] =
    useState<ReadonlySet<EmulatorButton>>(NO_BUTTONS_PRESSED);

  const applyPressed = useCallback(
    (next: Set<EmulatorButton>) => {
      const prev = pressed.current;
      let changed = false;
      let pressedNew = false;
      for (const button of next) {
        if (!prev.has(button)) {
          core.setButton(button, true);
          changed = true;
          pressedNew = true;
        }
      }
      for (const button of prev) {
        if (!next.has(button)) {
          core.setButton(button, false);
          changed = true;
        }
      }
      pressed.current = next;
      // One tick per event, not per button — a diagonal is one press to the
      // thumb. Sliding onto a new button ticks too, so D-pad rolls feel real.
      if (pressedNew) buzz();
      // Only real transitions re-render; a move that changes nothing is free.
      if (changed) setVisiblePressed(next);
    },
    [core, buzz],
  );

  const releaseAll = useCallback(() => {
    owners.current.clear();
    applyPressed(new Set());
  }, [applyPressed]);

  const sync = useCallback(
    (event: GestureResponderEvent, ending: boolean) => {
      const { touches, changedTouches } = event.nativeEvent;
      // Android can still list a lifting pointer in `touches`, so drop the
      // ones this event reports as changed when the event is an end.
      const lifting = ending ? new Set(changedTouches.map((t) => t.identifier)) : null;
      const next = new Set<EmulatorButton>();
      const stillDown = new Set<TouchId>();

      for (const touch of touches) {
        if (lifting?.has(touch.identifier)) continue;
        stillDown.add(touch.identifier);
        // `pageX`/`pageY` are screen coordinates and match the layout rects.
        // `locationX`/`locationY` are relative to each touch's own target
        // view, so they cannot be compared across fingers.
        const { pageX: x, pageY: y } = touch;
        // A finger that started on the D-pad keeps steering it even after it
        // slides past the edge. Every other button re-tests on each move, so
        // dragging off A releases A, as players expect.
        const region = owners.current.get(touch.identifier) ?? hitRegion(layout, x, y);
        if (!region) continue;
        if (region.kind === "dpad") owners.current.set(touch.identifier, region);
        for (const button of buttonsForTouch(region, x, y)) next.add(button);
      }

      for (const identifier of owners.current.keys()) {
        if (!stillDown.has(identifier)) owners.current.delete(identifier);
      }

      applyPressed(next);
    },
    [applyPressed, layout],
  );

  const handleStart = useCallback(
    (event: GestureResponderEvent) => {
      for (const touch of event.nativeEvent.changedTouches) {
        const region = hitRegion(layout, touch.pageX, touch.pageY);
        if (region?.kind === "menu") {
          // One-shot, never held. The screen suspends us, which releases
          // anything still down.
          buzz();
          onMenu();
          return;
        }
      }
      sync(event, false);
    },
    [layout, onMenu, sync, buzz],
  );

  const handleMove = useCallback((event: GestureResponderEvent) => sync(event, false), [sync]);
  const handleEnd = useCallback((event: GestureResponderEvent) => sync(event, true), [sync]);

  useEffect(() => {
    if (suspended) releaseAll();
  }, [suspended, releaseAll]);

  // Never leave a button held when the game loses the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") releaseAll();
    });
    return () => sub.remove();
  }, [releaseAll]);

  // On unmount, and whenever a rotation rebuilds the pad: every button has just
  // moved out from under the fingers holding it.
  useEffect(() => {
    releaseAll();
    return releaseAll;
  }, [layout, releaseAll]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={suspended ? "none" : "auto"}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      // Nothing may steal the pad mid-game.
      onResponderTerminationRequest={() => false}
      onResponderStart={handleStart}
      onResponderMove={handleMove}
      onResponderEnd={handleEnd}
      onResponderRelease={handleEnd}
      onResponderTerminate={releaseAll}
    >
      <PadVisuals layout={layout} pressed={visiblePressed} opacity={opacity} />
    </View>
  );
}

