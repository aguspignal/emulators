import type { ConsoleId } from './types';

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
}

export const CONSOLES: Record<ConsoleId, ConsoleSpec> = {
  gb: {
    id: 'gb',
    displayName: 'Game Boy',
    screens: [{ width: 160, height: 144 }],
    touchScreen: null,
    romExtensions: ['gb'],
  },
  gbc: {
    id: 'gbc',
    displayName: 'Game Boy Color',
    screens: [{ width: 160, height: 144 }],
    touchScreen: null,
    romExtensions: ['gbc'],
  },
  gba: {
    id: 'gba',
    displayName: 'Game Boy Advance',
    screens: [{ width: 240, height: 160 }],
    touchScreen: null,
    romExtensions: ['gba'],
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
  },
};

export const SAVESTATE_SLOTS = 10;
