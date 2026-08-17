@AGENTS.md

# apps/threeds — 3DS Emulator

Android-only Expo app emulating the Nintendo 3DS via the **Azahar** core (C++, to be integrated over JNI). See the root CLAUDE.md for monorepo-wide rules and the shared app commands.

- Android package: `com.aguspignal.threeds` · slug `threeds` · display name "3DS Emulator" (placeholder, changeable in `app.json`).
- `App.tsx` builds the `AppConfig` — console `3ds`, `core` + `EmulatorView` from `./modules/azahar-core`, `licenseNotice` from `./license` — and renders the shared `<AppRoot />`.
- `license.ts` — the **GPL v2** notice for Azahar that Settings → Legal → License shows, mirroring `docs/legal/license/license-gpl-threeds.md`. Edit both together. v2, not v3 like the NDS app's: Azahar ships the GPLv2 text in its `license.txt`, inherited from Citra.
- `modules/azahar-core/` — local Expo Module (Android/Kotlin only), still a stub:
  - `AzaharCoreModule.kt` — `loadRom` hashes the ROM's SHA-1 for real (the library stores it per ROM; a missing key would reach JS as `undefined`, which SQLite refuses to bind); every other `EmulatorCore` call is a no-op until Azahar is wired in via JNI.
  - `AzaharCoreView.kt` — stub `ExpoView`; will render both 3DS screens (top 400×240, bottom 320×240 touch screen — see `CONSOLES['3ds']`).
  - `src/index.ts` — typed wrapper exporting `core: EmulatorCore` and `EmulatorView`. Keep it in lockstep with the Kotlin definition and `@emulators/core-interface`.
- 3DS-specific: touch input goes through `core.setTouch(x, y, pressed)` with coordinates in bottom-screen native pixels. Azahar is the heaviest core (GPU emulation); expect real graphics/performance work here later.
- `eas init` hasn't been run yet (no project ID).
