import { NativeModule, requireNativeModule, requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import type {
  EmulatorCore,
  EmulatorEventMap,
  EmulatorEventName,
  EmulatorState,
  RomInfo,
  SharedFileSource,
} from '@emulators/core-interface';

type NativeEvents = {
  [E in EmulatorEventName]: (payload: EmulatorEventMap[E]) => void;
} & {
  sharedFile: (payload: { uri: string }) => void;
};

declare class MgbaCoreNativeModule extends NativeModule<NativeEvents> {
  initialSharedFile(): string | null;
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
  deleteState(slot: number): Promise<void>;
  deleteSaveData(sha1: string): Promise<void>;
  captureScreenshot(uri: string): Promise<void>;
  setVolume(volume: number): void;
  setSpeed(multiplier: number): void;
}

const native = requireNativeModule<MgbaCoreNativeModule>('MgbaCore');

/** The view mGBA renders video into. */
export const EmulatorView = requireNativeView<ViewProps>('MgbaCore');

/**
 * ROMs shared *to* the app (ACTION_SEND). The share sheet is the one-gesture
 * path on Samsung, whose My Files resolves unknown extensions to an
 * empty-string MIME that no VIEW intent filter can ever match — and a SEND
 * file arrives in the intent extras, where React Native's Linking can't see
 * it, so this crosses the bridge natively.
 */
export const sharedFiles: SharedFileSource = {
  getInitialFile: () => native.initialSharedFile(),
  addListener: (listener) =>
    native.addListener('sharedFile', (payload) => listener(payload.uri)),
};

/** mGBA core, exposed through the shared @emulators/core-interface contract. */
export const core: EmulatorCore = {
  console: ['gba', 'gbc', 'gb'],
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
  deleteState: (slot) => native.deleteState(slot),
  deleteSaveData: (sha1) => native.deleteSaveData(sha1),
  captureScreenshot: (uri) => native.captureScreenshot(uri),
  setVolume: (volume) => native.setVolume(volume),
  setSpeed: (multiplier) => native.setSpeed(multiplier),
  addListener: <E extends EmulatorEventName>(
    event: E,
    listener: (payload: EmulatorEventMap[E]) => void
  ) => native.addListener(event, listener as NativeEvents[E]),
};
