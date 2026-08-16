@AGENTS.md

# apps/nds — NDS Emulator

Android-only Expo app emulating the Nintendo DS via the **melonDS** core (C++, to be integrated over JNI). See the root CLAUDE.md for monorepo-wide rules and the shared app commands.

- Android package: `com.aguspignal.nds` · slug `nds` · display name "NDS Emulator" (placeholder, changeable in `app.json`).
- `App.tsx` builds the `AppConfig` — console `nds`, `core` + `EmulatorView` from `./modules/melonds-core`, `licenseNotice` from `./license` — and renders the shared `<AppRoot />`.
- `license.ts` — the GPL v3 notice for melonDS that Settings → Legal → License shows, mirroring `docs/legal/license/license-gpl-nds.md`. Edit both together.
- `modules/melonds-core/` — local Expo Module (Android/Kotlin only), still a stub:
  - `MelondsCoreModule.kt` — `loadRom` hashes the ROM's SHA-1 for real (the library stores it per ROM; a missing key would reach JS as `undefined`, which SQLite refuses to bind); every other `EmulatorCore` call is a no-op until melonDS is wired in via JNI.
  - `MelondsCoreView.kt` — stub `ExpoView`; will render both DS screens (256×192 each, bottom one is the touch screen — see `CONSOLES.nds`).
  - `src/index.ts` — typed wrapper exporting `core: EmulatorCore` and `EmulatorView`. Keep it in lockstep with the Kotlin definition and `@emulators/core-interface`.
- DS-specific: touch input goes through `core.setTouch(x, y, pressed)` with coordinates in bottom-screen native pixels.
- `eas init` hasn't been run yet (no project ID).
