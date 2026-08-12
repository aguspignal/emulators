# @emulators/core-interface

The TypeScript contract every native emulator module (mGBA, melonDS, Azahar) implements, plus shared constants. See the root CLAUDE.md for the monorepo picture.

**Pure TypeScript. Never add a dependency on React, React Native, Expo, or anything else.** This package must stay importable from any context (native module wrappers, UI, future tooling).

- `src/types.ts` — `EmulatorCore` (the contract: ROM lifecycle, playback control, button/touch input, savestates, volume/speed, events), `EmulatorButton`, `EmulatorState`, `RomInfo`, event map.
- `src/constants.ts` — `CONSOLES`: per-console screen dimensions, touch-screen index, display names, ROM file extensions, and the console's physical `buttons` (which drives the on-screen gamepad, so the UI never branches on which app it is); `SAVESTATE_SLOTS`.

Notes:

- Video output is deliberately absent from `EmulatorCore` — each native module exposes a native view the core renders into. Don't add frame/pixel APIs here.
- The contract is a draft and will evolve as real cores get wired in. Any change here must be mirrored in all three Kotlin modules and their TS wrappers (`apps/*/modules/*/src/index.ts`) in the same change.
- Ships raw TS (`main: src/index.ts`), no build step. `npm run typecheck` to verify.
