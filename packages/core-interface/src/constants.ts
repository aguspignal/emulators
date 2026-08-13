import type { ConsoleId, EmulatorButton } from './types';

export interface ScreenSpec {
  width: number;
  height: number;
}

export interface ConsoleSpec {
  id: ConsoleId;
  displayName: string;
  /** Top-to-bottom list of screens. Single-screen consoles have one entry. */
  screens: ScreenSpec[];
  /** Index into `screens` of the touch screen, or null if none. */
  touchScreen: number | null;
  /** Lower-cased ROM file extensions, without the dot. */
  romExtensions: string[];
  /**
   * The console's physical buttons. Drives the on-screen gamepad so the UI
   * never has to branch on which app it is running in.
   */
  buttons: EmulatorButton[];
}

const DPAD: EmulatorButton[] = ['up', 'down', 'left', 'right'];
const GB_BUTTONS: EmulatorButton[] = [...DPAD, 'a', 'b', 'start', 'select'];
const GBA_BUTTONS: EmulatorButton[] = [...GB_BUTTONS, 'l', 'r'];
const NDS_BUTTONS: EmulatorButton[] = [...GBA_BUTTONS, 'x', 'y'];
const THREEDS_BUTTONS: EmulatorButton[] = [...NDS_BUTTONS, 'zl', 'zr'];

export const CONSOLES: Record<ConsoleId, ConsoleSpec> = {
  gb: {
    id: 'gb',
    displayName: 'Game Boy',
    screens: [{ width: 160, height: 144 }],
    touchScreen: null,
    romExtensions: ['gb'],
    buttons: [...GB_BUTTONS],
  },
  gbc: {
    id: 'gbc',
    displayName: 'Game Boy Color',
    screens: [{ width: 160, height: 144 }],
    touchScreen: null,
    romExtensions: ['gbc'],
    buttons: [...GB_BUTTONS],
  },
  gba: {
    id: 'gba',
    displayName: 'Game Boy Advance',
    screens: [{ width: 240, height: 160 }],
    touchScreen: null,
    romExtensions: ['gba'],
    buttons: [...GBA_BUTTONS],
  },
  nds: {
    id: 'nds',
    displayName: 'Nintendo DS',
    screens: [
      { width: 256, height: 192 },
      { width: 256, height: 192 },
    ],
    touchScreen: 1,
    romExtensions: ['nds'],
    buttons: [...NDS_BUTTONS],
  },
  '3ds': {
    id: '3ds',
    displayName: 'Nintendo 3DS',
    screens: [
      { width: 400, height: 240 },
      { width: 320, height: 240 },
    ],
    touchScreen: 1,
    romExtensions: ['3ds', 'cci', 'cxi', 'app'],
    buttons: [...THREEDS_BUTTONS],
  },
};

export const SAVESTATE_SLOTS = 10;

/**
 * Slot reserved for the automatic savestate written when a game is closed or
 * backgrounded, and reloaded on the next boot. Never offered as a save target.
 */
export const AUTO_SAVESTATE_SLOT = 0;
