@AGENTS.md

# apps/gba — GBA Emulator

Android-only Expo app emulating Game Boy, Game Boy Color, and Game Boy Advance via the **mGBA** core (C, integrated over JNI). See the root CLAUDE.md for monorepo-wide rules.

- Android package: `com.aguspignal.gba` · slug `gba` · display name "GBA Emulator" (placeholder, changeable in `app.json`).
- `App.tsx` is intentionally thin: it builds the `AppConfig` (consoles `gba`/`gbc`/`gb`, `core` + `EmulatorView` from `./modules/mgba-core`) and renders the shared `<AppRoot />` from `@emulators/ui`. App-specific UI belongs in the config or in `packages/ui` — don't add screens here.
- `modules/mgba-core/` — local Expo Module (Android/Kotlin/C++):
  - `android/vendor/mgba` — **git submodule** pinned to mGBA `0.10.5`. After a fresh clone run `git submodule update --init`. Keep the pin at 0.10.x: the JNI audio code uses the blip_buf API, which 0.11 replaces with `mAudioBuffer`.
  - `android/src/main/cpp/` — the JNI layer: `CMakeLists.txt` builds libmgba (static, `LIBMGBA_ONLY`, GBA+GB cores) plus the `mgba-jni` shared lib; `emulator_engine.cpp` is a singleton owning the mCore instance, a dedicated emulation thread (runFrame → audio pump → SurfaceView blit, clock-paced), the framebuffer, and the ANativeWindow; `audio_sink.cpp` is an Oboe output stream fed by an SPSC ring buffer. Never include mGBA headers outside the `mgba-jni` target — its `M_CORE_*` defines must match the lib's or struct layouts silently diverge.
  - `android/.../MgbaCoreModule.kt` — implements the `EmulatorCore` contract and owns the idle/running/paused state machine + events. `MgbaCoreNative.kt` is the JNI mirror (also maps contract button names → mGBA key bits). `RomFiles.kt` resolves ROM URIs (copies `content://` into cache) and keys battery saves/savestates by ROM SHA-1 under `filesDir/mgba/`. `MgbaCoreView.kt` hosts the SurfaceView, aspect-fits it, and hands the Surface to the engine.
  - `src/index.ts` — typed wrapper exporting `core: EmulatorCore` and `EmulatorView`. Keep it in lockstep with the Kotlin definition and `@emulators/core-interface`.

Commands (run here, or via root scripts): `npm run start`, `npm run android` (`expo run:android`), `npm run prebuild`, `npm run typecheck`. Kotlin/native changes need a full `expo run:android` rebuild, not Fast Refresh. The first native build compiles ~500 mGBA C files for 2 ABIs (arm64-v8a, x86_64) — expect several minutes cold. Install new deps with `npx expo install <pkg>` from this directory; `npm install` always from the repo root.

Gradle must run on **JDK 17–21** (e.g. Temurin 21 at `%LOCALAPPDATA%\Java\jdk-21.0.12+8` on this machine — set `JAVA_HOME` before building). JDK 24+/Android Studio JBR 25 breaks AGP's native-build tasks: the child JVM's "restricted method" native-access warning on stderr fails `configureCMake*`. The generated `android/local.properties` must point `sdk.dir` at the Android SDK.

EAS: `eas.json` has `development`/`preview` (APK) and `production` (AAB) profiles.
