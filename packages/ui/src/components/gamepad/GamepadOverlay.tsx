import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type NativeTouchEvent,
} from "react-native";
import type { EmulatorButton } from "@emulators/core-interface";
import { useAppConfig } from "../../config";
import { colors, radius } from "../../theme";
import type { GamepadLayout, Rect, Region } from "./layout";
import { buttonsForTouch, hitRegion } from "./hitTest";

const EMPTY_PRESSED: ReadonlySet<EmulatorButton> = new Set();

/** Whatever the platform stamps on a touch; only ever used as a map key. */
type TouchId = NativeTouchEvent["identifier"];

const PAD_FILL = "rgba(242, 242, 245, 0.16)";
const PAD_FILL_PRESSED = "rgba(230, 0, 18, 0.62)";
const PAD_BORDER = "rgba(242, 242, 245, 0.30)";

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
}

/**
 * The on-screen gamepad, drawn over the running game.
 *
 * React Native allows exactly one responder view at a time, so a `Pressable`
 * per button could never register the D-pad and A together. Instead this is a
 * single full-screen responder that hit-tests every entry in
 * `nativeEvent.touches` itself — which is also why the menu is a region here
 * rather than a sibling `Pressable` that would steal the responder.
 */
export function GamepadOverlay({ layout, onMenu, suspended = false }: GamepadOverlayProps) {
  const { core } = useAppConfig();

  // The authoritative held set lives in a ref so input never waits on React.
  const pressed = useRef<Set<EmulatorButton>>(new Set());
  // Touch identifier -> the region that finger is steering (D-pad only).
  const owners = useRef<Map<TouchId, Region>>(new Map());
  const [visiblePressed, setVisiblePressed] = useState<ReadonlySet<EmulatorButton>>(EMPTY_PRESSED);

  const applyPressed = useCallback(
    (next: Set<EmulatorButton>) => {
      const prev = pressed.current;
      let changed = false;
      for (const button of next) {
        if (!prev.has(button)) {
          core.setButton(button, true);
          changed = true;
        }
      }
      for (const button of prev) {
        if (!next.has(button)) {
          core.setButton(button, false);
          changed = true;
        }
      }
      pressed.current = next;
      // Only real transitions re-render; a move that changes nothing is free.
      if (changed) setVisiblePressed(next);
    },
    [core],
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
          onMenu();
          return;
        }
      }
      sync(event, false);
    },
    [layout, onMenu, sync],
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
      {layout.map((region) => (
        <RegionView key={regionKey(region)} region={region} pressed={visiblePressed} />
      ))}
    </View>
  );
}

function regionKey(region: Region): string {
  return region.kind === "button" ? region.button : region.kind;
}

function rectStyle(rect: Rect) {
  return {
    position: "absolute" as const,
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function RegionView({ region, pressed }: { region: Region; pressed: ReadonlySet<EmulatorButton> }) {
  if (region.kind === "dpad") return <DpadView region={region} pressed={pressed} />;

  if (region.kind === "menu") {
    return (
      <View style={[rectStyle(region.visual), styles.face, styles.menu]}>
        <View style={styles.menuBar} />
        <View style={styles.menuBar} />
        <View style={styles.menuBar} />
      </View>
    );
  }

  const isPressed = pressed.has(region.button);
  return (
    <View
      style={[
        rectStyle(region.visual),
        styles.face,
        { borderRadius: region.shape === "round" ? region.visual.height / 2 : radius.sm },
        isPressed && styles.facePressed,
      ]}
    >
      <Text style={[styles.label, region.shape === "pill" && styles.labelSmall]}>
        {region.label}
      </Text>
    </View>
  );
}

const DIRECTIONS = ["up", "left", "right", "down"] as const;
const ARROWS: Record<(typeof DIRECTIONS)[number], string> = {
  up: "▲",
  left: "◀",
  right: "▶",
  down: "▼",
};

function DpadView({
  region,
  pressed,
}: {
  region: Extract<Region, { kind: "dpad" }>;
  pressed: ReadonlySet<EmulatorButton>;
}) {
  const cell = region.visual.width / 3;
  // Column/row of each arm in the 3x3 grid the cross is drawn on.
  const cells: Record<(typeof DIRECTIONS)[number], [number, number]> = {
    up: [1, 0],
    left: [0, 1],
    right: [2, 1],
    down: [1, 2],
  };

  return (
    <View style={rectStyle(region.visual)}>
      <View
        style={[
          styles.face,
          { position: "absolute", left: cell, top: cell, width: cell, height: cell },
        ]}
      />
      {DIRECTIONS.map((direction) => {
        const [col, row] = cells[direction];
        return (
          <View
            key={direction}
            style={[
              styles.face,
              styles.dpadArm,
              { left: col * cell, top: row * cell, width: cell, height: cell },
              pressed.has(direction) && styles.facePressed,
            ]}
          >
            <Text style={styles.dpadArrow}>{ARROWS[direction]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    backgroundColor: PAD_FILL,
    borderWidth: 1,
    borderColor: PAD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  facePressed: { backgroundColor: PAD_FILL_PRESSED },
  dpadArm: { position: "absolute", borderRadius: radius.sm },
  dpadArrow: { color: colors.text, fontSize: 16, opacity: 0.75 },
  label: { color: colors.text, fontSize: 20, fontWeight: "700", opacity: 0.85 },
  labelSmall: { fontSize: 11, letterSpacing: 1 },
  menu: { borderRadius: radius.sm, gap: 3 },
  menuBar: {
    width: "45%",
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.text,
    opacity: 0.85,
  },
});
