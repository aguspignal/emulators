/** Consoles covered by the three apps. */
export type ConsoleId = 'gb' | 'gbc' | 'gba' | 'nds' | '3ds';

/**
 * Union of every physical button across all supported consoles.
 * Cores ignore buttons their console doesn't have (e.g. 'x'/'y' on GBA).
 */
export type EmulatorButton =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'a'
  | 'b'
  | 'x'
  | 'y'
  | 'l'
  | 'r'
  | 'zl'
  | 'zr'
  | 'start'
  | 'select';

export type EmulatorState = 'idle' | 'running' | 'paused';

export interface RomInfo {
  /** Title read from the ROM header, or the filename if unavailable. */
  title: string;
  console: ConsoleId;
  /** Size in bytes. */
  size: number;
  /**
   * SHA-1 of the ROM bytes, lower-case hex. The key every core uses to name
   * that ROM's save files, and the handle JS passes back to `deleteSaveData`.
   * Empty string when the core couldn't hash the ROM.
   */
  sha1: string;
}

export interface EmulatorEventMap {
  stateChange: { state: EmulatorState };
  error: { message: string };
}

export type EmulatorEventName = keyof EmulatorEventMap;

export interface EmulatorSubscription {
  remove(): void;
}

/**
 * The contract every native core module (mGBA, melonDS, Azahar) implements.
 *
 * Video output does NOT go through this interface: each native module also
 * exposes a native view that the core renders into directly. This interface
 * covers control, input, and persistence only.
 */
export interface EmulatorCore {
  /** Which console(s) this core handles. */
  readonly console: ConsoleId | ConsoleId[];

  /** Load a ROM from a local file URI and leave the core paused at frame 0. */
  loadRom(uri: string): Promise<RomInfo>;

  /** Stop emulation and release the loaded ROM and core resources. */
  unloadRom(): Promise<void>;

  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;

  getState(): EmulatorState;

  /** Press (true) or release (false) a button. */
  setButton(button: EmulatorButton, pressed: boolean): void;

  /**
   * Touch input for consoles with a touch screen (NDS bottom screen, 3DS
   * bottom screen). Coordinates are in native screen pixels of the touch
   * screen. Cores without a touch screen ignore this.
   */
  setTouch(x: number, y: number, pressed: boolean): void;

  /** Persist an in-memory savestate to a slot (0-based). */
  saveState(slot: number): Promise<void>;
  loadState(slot: number): Promise<void>;
  /** Discard the savestate in a slot. A slot with no state is not an error. */
  deleteState(slot: number): Promise<void>;

  /**
   * Delete every save file the core keeps for a ROM — battery save and all
   * savestates. Takes the hash rather than acting on the loaded ROM so the
   * library can clean up after a ROM it is deleting; rejects if that ROM is
   * currently loaded.
   */
  deleteSaveData(sha1: string): Promise<void>;

  /**
   * Write a PNG of the frame currently on screen to a local file URI.
   *
   * Persistence, not video: the pixels are encoded natively and never cross
   * into JS. Callers own the path, so savestate thumbnails can live beside
   * the rest of the app's data instead of in each core's private layout.
   */
  captureScreenshot(uri: string): Promise<void>;

  /** 0.0 – 1.0 */
  setVolume(volume: number): void;

  /** Emulation speed multiplier; 1.0 is normal speed. */
  setSpeed(multiplier: number): void;

  addListener<E extends EmulatorEventName>(
    event: E,
    listener: (payload: EmulatorEventMap[E]) => void
  ): EmulatorSubscription;
}
