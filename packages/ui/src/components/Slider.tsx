import { useCallback, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { colors, radius } from "../theme";
import { usePrimaryColor } from "../config";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** Quantum the value snaps to. */
  step: number;
  /** Fires continuously while the finger moves — drives a live preview. */
  onChange: (value: number) => void;
  /** Fires once, when the finger lifts. Persisting belongs here, not in `onChange`. */
  onCommit: (value: number) => void;
  accessibilityLabel: string;
}

const TRACK_HEIGHT = 4;
const THUMB_SIZE = 22;
/** Taller than the track it draws: the touch target is the whole row. */
const ROW_HEIGHT = 40;

/**
 * A plain value slider on the responder API — no dependency, and nothing here
 * needs a native rebuild.
 *
 * `locationX` is used deliberately, and it does not contradict the gamepad's
 * `pageX` rule: that rule exists because the pad compares several fingers
 * across different target views. This is one finger on one view, and its
 * children are `pointerEvents="none"` so that view is always the touch target.
 */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  accessibilityLabel,
}: SliderProps) {
  const [width, setWidth] = useState(0);
  const primary = usePrimaryColor();
  // What the drag last produced. The lift has to commit this rather than
  // `value`: the prop cannot have come back through React yet.
  const latest = useRef(value);

  const quantize = useCallback(
    (raw: number) => {
      const stepped = Math.round(raw / step) * step;
      // Snapping a float leaves 0.7000000000000001; this value is written to
      // SQLite as a string and read back, so it is rounded to something sane.
      const clean = Math.round(stepped * 1000) / 1000;
      return Math.min(Math.max(clean, min), max);
    },
    [min, max, step],
  );

  const track = useCallback(
    (event: GestureResponderEvent) => {
      if (width <= 0) return;
      const ratio = Math.min(Math.max(event.nativeEvent.locationX / width, 0), 1);
      const next = quantize(min + ratio * (max - min));
      if (next === latest.current) return;
      latest.current = next;
      onChange(next);
    },
    [width, min, max, quantize, onChange],
  );

  // Re-anchored at the start of every gesture: between drags the value can
  // have moved without this component (Reset), and a stale `latest` would make
  // the dedupe above swallow a real change.
  const grant = useCallback(
    (event: GestureResponderEvent) => {
      latest.current = value;
      track(event);
    },
    [value, track],
  );

  const nudge = useCallback(
    (by: number) => {
      const next = quantize(value + by);
      if (next === value) return;
      latest.current = next;
      onChange(next);
      // An accessibility action is a whole change, not the middle of a drag.
      onCommit(next);
    },
    [value, quantize, onChange, onCommit],
  );

  const ratio = max > min ? (value - min) / (max - min) : 0;
  const percent = `${Math.min(Math.max(ratio, 0), 1) * 100}%` as const;

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      // Percentages: the underlying values are fractions no screen reader
      // would read usefully, and the percentage is what the UI shows anyway.
      accessibilityValue={{
        min: Math.round(min * 100),
        max: Math.round(max * 100),
        now: Math.round(value * 100),
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) =>
        nudge(event.nativeEvent.actionName === "increment" ? step : -step)
      }
      style={styles.container}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      // Nothing may take the gesture mid-drag — a scroll view that grabbed it
      // would leave the value wherever the finger happened to be.
      onResponderTerminationRequest={() => false}
      onResponderGrant={grant}
      onResponderMove={track}
      onResponderRelease={() => onCommit(latest.current)}
      onResponderTerminate={() => onCommit(latest.current)}
    >
      {/* Every child is untouchable so `locationX` stays relative to the
          responder above, whatever the finger lands on. */}
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.fill, { width: percent, backgroundColor: primary }]} />
      </View>
      <View style={[styles.thumb, { left: percent }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: ROW_HEIGHT, justifyContent: "center" },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  fill: { height: TRACK_HEIGHT },
  thumb: {
    position: "absolute",
    // Stated rather than left to how the parent aligns an absolute child.
    top: (ROW_HEIGHT - THUMB_SIZE) / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.lg,
    backgroundColor: colors.text,
    // Centres the thumb on its value; `left` alone would hang it off the end.
    transform: [{ translateX: -THUMB_SIZE / 2 }],
  },
});
