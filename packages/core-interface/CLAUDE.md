# @emulators/core-interface

The TypeScript contract every native emulator module (mGBA, melonDS, Azahar) implements, plus shared constants. See the root CLAUDE.md for the monorepo picture.

**Pure TypeScript. Never add a dependency on React, React Native, Expo, or anything else.** This package must stay importable from any context (native module wrappers, UI, future tooling).

- `src/types.ts` — `EmulatorCore` (the contract: ROM lifecycle, playback control, button/touch input, savestates, save-file cleanup, screenshots, volume/speed, events), `EmulatorButton`, `EmulatorState`, `RomInfo`, event map.
- `src/constants.ts` — `CONSOLES`: per-console screen dimensions, touch-screen index, display names and title abbreviations (both deliberately untranslated), ROM file extensions, and the console's physical `buttons` (which drives the on-screen gamepad, so the UI never branches on which app it is); `SAVESTATE_SLOTS` and `AUTO_SAVESTATE_SLOT` (slot 0, written on exit/background and reloaded on boot — never offered as a manual save target).

Notes:

- Video output is deliberately absent from `EmulatorCore` — each native module exposes a native view the core renders into. Don't add frame/pixel *streaming* APIs here. `captureScreenshot(uri)` is not an exception to that rule: it is persistence, taking a path and writing a PNG natively, and no pixel ever crosses into JS.
- **`RomInfo.sha1` is how saves stay private to each core.** Cores name their battery saves and savestates from it under their own layout; JS holds the hash, stores it, and hands it back to `deleteSaveData` — it never builds a save path. A core that cannot hash a ROM returns `''`, which callers must treat as "unknown", not "no saves".
- The contract is a draft and will evolve as real cores get wired in. Any change here must be mirrored in all three Kotlin modules and their TS wrappers (`apps/*/modules/*/src/index.ts`) in the same change.
- Ships raw TS (`main: src/index.ts`), no build step. `npm run typecheck` to verify.
