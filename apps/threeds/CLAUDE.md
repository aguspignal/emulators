@AGENTS.md

# apps/threeds — 3DS Emulator

Android-only Expo app emulating the Nintendo 3DS via the **Azahar** core (C++, to be integrated over JNI). See the root CLAUDE.md for monorepo-wide rules.

- Android package: `com.aguspignal.threeds` · slug `threeds` · display name "3DS Emulator" (placeholder, changeable in `app.json`).
- `App.tsx` is intentionally thin: it builds the `AppConfig` (console `3ds`, `core` + `EmulatorView` from `./modules/azahar-core`) and renders the shared `<AppRoot />` from `@emulators/ui`. App-specific UI belongs in the config or in `packages/ui` — don't add screens here.
- `modules/azahar-core/` — local Expo Module (Android/Kotlin only):
  - `android/.../AzaharCoreModule.kt` — stub of the `EmulatorCore` contract; every function is a no-op until Azahar is wired in via JNI.
  - `android/.../AzaharCoreView.kt` — stub `ExpoView`; will render both 3DS screens (top 400×240, bottom 320×240 touch screen — see `CONSOLES['3ds']`).
  - `src/index.ts` — typed wrapper exporting `core: EmulatorCore` and `EmulatorView`. Keep it in lockstep with the Kotlin definition and `@emulators/core-interface`.
- 3DS-specific: touch input goes through `core.setTouch(x, y, pressed)` with coordinates in bottom-screen native pixels. Azahar is the heaviest core (GPU emulation); expect real graphics/performance work here later.

Commands (run here, or via root scripts): `npm run start`, `npm run android` (`expo run:android`), `npm run prebuild`, `npm run typecheck`. Kotlin/native changes need a full `expo run:android` rebuild, not Fast Refresh. Install new deps with `npx expo install <pkg>` from this directory; `npm install` always from the repo root.

EAS: `eas.json` has `development`/`preview` (APK) and `production` (AAB) profiles; `eas init` hasn't been run yet (no project ID).
