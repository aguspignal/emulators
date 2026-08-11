import { NativeModule, requireNativeModule, requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import type {
  EmulatorCore,
  EmulatorEventMap,
  EmulatorEventName,
  EmulatorState,
  RomInfo,
} from '@emulators/core-interface';

type NativeEvents = {
  [E in EmulatorEventName]: (payload: EmulatorEventMap[E]) => void;
};

declare class MelondsCoreNativeModule extends NativeModule<NativeEvents> {
  loadRom(uri: string): Promise<RomInfo>;
  unloadRom(): Promise<void>;
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  getState(): EmulatorState;
  setButton(button: string, pressed: boolean): void;
  setTouch(x: number, y: number, pressed: boolean): void;
  saveState(slot: number): Promise<void>;
  loadState(slot: number): Promise<void>;
  setVolume(volume: number): void;
  setSpeed(multiplier: number): void;
}

const native = requireNativeModule<MelondsCoreNativeModule>('MelondsCore');

/** The view melonDS renders both DS screens into. */
export const EmulatorView = requireNativeView<ViewProps>('MelondsCore');

/** melonDS core, exposed through the shared @emulators/core-interface contract. */
export const core: EmulatorCore = {
  console: 'nds',
  loadRom: (uri) => native.loadRom(uri),
  unloadRom: () => native.unloadRom(),
  start: () => native.start(),
  pause: () => native.pause(),
  resume: () => native.resume(),
  reset: () => native.reset(),
  getState: () => native.getState(),
  setButton: (button, pressed) => native.setButton(button, pressed),
  setTouch: (x, y, pressed) => native.setTouch(x, y, pressed),
  saveState: (slot) => native.saveState(slot),
  loadState: (slot) => native.loadState(slot),
  setVolume: (volume) => native.setVolume(volume),
  setSpeed: (multiplier) => native.setSpeed(multiplier),
  addListener: <E extends EmulatorEventName>(
    event: E,
    listener: (payload: EmulatorEventMap[E]) => void
  ) => native.addListener(event, listener as NativeEvents[E]),
};
