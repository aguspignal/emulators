@AGENTS.md

# apps/nds — NDS Emulator

Android-only Expo app emulating the Nintendo DS via the **melonDS** core (C++, to be integrated over JNI). See the root CLAUDE.md for monorepo-wide rules.

- Android package: `com.aguspignal.nds` · slug `nds` · display name "NDS Emulator" (placeholder, changeable in `app.json`).
- `App.tsx` is intentionally thin: it builds the `AppConfig` (console `nds`, `core` + `EmulatorView` from `./modules/melonds-core`, `licenseNotice` from `./license`) and renders the shared `<AppRoot />` from `@emulators/ui`. App-specific UI belongs in the config or in `packages/ui` — don't add screens here.
- `license.ts` — the GPL v3 notice for melonDS that Settings → Legal → License shows, mirroring `docs/legal/license/license-gpl-nds.md`. Edit both together.
- `modules/melonds-core/` — local Expo Module (Android/Kotlin only):
  - `android/.../MelondsCoreModule.kt` — stub of the `EmulatorCore` contract; every function is a no-op until melonDS is wired in via JNI.
  - `android/.../MelondsCoreView.kt` — stub `ExpoView`; will render both DS screens (256×192 each, bottom one is the touch screen — see `CONSOLES.nds`).
  - `src/index.ts` — typed wrapper exporting `core: EmulatorCore` and `EmulatorView`. Keep it in lockstep with the Kotlin definition and `@emulators/core-interface`.
- DS-specific: touch input goes through `core.setTouch(x, y, pressed)` with coordinates in bottom-screen native pixels.

Commands (run here, or via root scripts): `npm run start`, `npm run android` (`expo run:android`), `npm run prebuild`, `npm run typecheck`. Kotlin/native changes need a full `expo run:android` rebuild, not Fast Refresh. Install new deps with `npx expo install <pkg>` from this directory; `npm install` always from the repo root.

EAS: `eas.json` has `development`/`preview` (APK) and `production` (AAB) profiles; `eas init` hasn't been run yet (no project ID).
