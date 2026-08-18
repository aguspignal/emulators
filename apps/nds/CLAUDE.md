@AGENTS.md

# apps/nds — NDS Emulator

Android-only Expo app emulating the Nintendo DS via the **melonDS** core (C++, to be integrated over JNI). See the root CLAUDE.md for monorepo-wide rules and the shared app commands.

- Android package: `com.aguspignal.nds` · slug `nds` · display name "NDS Emulator" (placeholder, changeable in `app.json`).
- `App.tsx` builds the `AppConfig` — console `nds`, `core` + `EmulatorView` from `./modules/melonds-core`, `licenseNotice` from `./license` — and renders the shared `<AppRoot />`.
- `license.ts` — the GPL v3 notice for melonDS that Settings → Legal → License shows, mirroring `docs/legal/license/license-gpl-nds.md`. Edit both together.
- `modules/melonds-core/` — local Expo Module (Android/Kotlin/C++); the core is wired to build but emulation is still stubbed:
  - `android/vendor/melonds` — **git submodule** pinned to melonDS `1.1` (teakra is in-tree, no nested submodules). After a fresh clone run `git submodule update --init`.
  - `android/src/main/cpp/` — `CMakeLists.txt` builds melonDS's `core` (+ teakra) static, **headless and minimal**: frontend, JIT, GL renderer and GDB stub are all OFF (JIT needs Android W^X handling; GL and audio come later). It then links the `melonds-jni` shared lib; `melonds_jni.cpp` is only a `nativeGetCoreVersion` probe so far. This expands as the core is wired in — see gba's `mgba-core` for the target shape (engine + Oboe audio + JNI). Verified: `core` and `libmelonds-jni.so` compile and link for arm64-v8a + x86_64.
  - `MelondsCoreNative.kt` — JNI mirror; `System.loadLibrary("melonds-jni")`. Only `nativeGetCoreVersion` so far.
  - `MelondsCoreModule.kt` — `loadRom` hashes the ROM's SHA-1 for real (the library stores it per ROM; a missing key would reach JS as `undefined`, which SQLite refuses to bind); every other `EmulatorCore` call is a no-op until melonDS is wired in via JNI. An `OnCreate` probe logs the core version, confirming the native lib loads.
  - `MelondsCoreView.kt` — stub `ExpoView`; will render both DS screens (256×192 each, bottom one is the touch screen — see `CONSOLES.nds`).
  - `src/index.ts` — typed wrapper exporting `core: EmulatorCore` and `EmulatorView`. Keep it in lockstep with the Kotlin definition and `@emulators/core-interface`.
- DS-specific: touch input goes through `core.setTouch(x, y, pressed)` with coordinates in bottom-screen native pixels.
- `eas init` hasn't been run yet (no project ID).
