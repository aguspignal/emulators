@AGENTS.md

# apps/gba — GBA Emulator

Android-only Expo app emulating Game Boy, Game Boy Color, and Game Boy Advance via the **mGBA** core (C, to be integrated over JNI). See the root CLAUDE.md for monorepo-wide rules.

- Android package: `com.aguspignal.gba` · slug `gba` · display name "GBA Emulator" (placeholder, changeable in `app.json`).
- `App.tsx` is intentionally thin: it builds the `AppConfig` (consoles `gba`/`gbc`/`gb`, `core` + `EmulatorView` from `./modules/mgba-core`) and renders the shared `<AppRoot />` from `@emulators/ui`. App-specific UI belongs in the config or in `packages/ui` — don't add screens here.
- `modules/mgba-core/` — local Expo Module (Android/Kotlin only):
  - `android/.../MgbaCoreModule.kt` — stub of the `EmulatorCore` contract; every function is a no-op until mGBA is wired in via JNI.
  - `android/.../MgbaCoreView.kt` — stub `ExpoView`; will become the SurfaceView/GLSurfaceView mGBA renders into.
  - `src/index.ts` — typed wrapper exporting `core: EmulatorCore` and `EmulatorView`. Keep it in lockstep with the Kotlin definition and `@emulators/core-interface`.

Commands (run here, or via root scripts): `npm run start`, `npm run android` (`expo run:android`), `npm run prebuild`, `npm run typecheck`. Kotlin/native changes need a full `expo run:android` rebuild, not Fast Refresh. Install new deps with `npx expo install <pkg>` from this directory; `npm install` always from the repo root.

EAS: `eas.json` has `development`/`preview` (APK) and `production` (AAB) profiles; `eas init` hasn't been run yet (no project ID).
