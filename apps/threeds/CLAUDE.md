@AGENTS.md

# apps/threeds — 3DS Emulator

Android-only Expo app emulating the Nintendo 3DS via the **Azahar** core (C++, integrated over JNI). See the root CLAUDE.md for monorepo-wide rules and the shared app commands.

- Android package: `com.aguspignal.threeds` · slug `threeds` · display name "3DS Emulator" (placeholder, changeable in `app.json`).
- **minSdk is 29** (`expo-build-properties` in `app.json` + the module's own `build.gradle`), not the Expo default 24: Azahar's floor is Android 10 and its NDK code uses API 26+ symbols. The other apps stay at 24.
- `App.tsx` builds the `AppConfig` — console `3ds`, `core` + `EmulatorView` from `./modules/azahar-core`, `licenseNotice` from `./license` — and renders the shared `<AppRoot />`.
- `license.ts` — the **GPL v2** notice for Azahar that Settings → Legal → License shows, mirroring `docs/legal/license/license-gpl-threeds.md`. Edit both together. v2, not v3 like the NDS app's: Azahar ships the GPLv2 text in its `license.txt`, inherited from Citra.
- `modules/azahar-core/` — local Expo Module (Android/Kotlin/C++):
  - `android/vendor/azahar` — **git submodule** pinned to Azahar `2126.0`, with **36 nested submodules**: after a fresh clone run `git submodule update --init --recursive` (a heavy download; only this app's submodule recurses).
  - `src/index.ts` — typed wrapper exporting `core: EmulatorCore` and `EmulatorView`. Keep it in lockstep with the Kotlin definition and `@emulators/core-interface`.
- `eas init` hasn't been run yet (no project ID). Intent filters and the share-to-app bridge are also still to do (gba has both, nds has the filters).

## How the native build works (unlike mgba/melonds)

Azahar's CMake assumes it is the **top-level project** (GenerateSCMRev, boost/zstd paths, `${CMAKE_BINARY_DIR}/src` includes), so the module does not `add_subdirectory` the vendor tree. Instead:

- `build.gradle` points `externalNativeBuild.cmake.path` at **`vendor/azahar/CMakeLists.txt`** and injects `src/main/cpp/azahar_inject.cmake` via `-DCMAKE_PROJECT_citra_INCLUDE`. That hook pre-seeds the option cache (Qt/SDL/web/scripting/OpenAL/Vulkan/LTO all OFF, **OpenGL ON**) and `cmake_language(DEFER)`-includes `azahar_jni_target.cmake`, which defines the `azahar-jni` library after the vendor targets exist. Deferred execution may not create subdirectories — hence an include()d file, and paths ride `AZAHAR_JNI_DIR` because list-dir variables aren't reliable there.
- The vendor tree's own `citra-android` target still gets configured; `targets "azahar-jni"` in build.gradle keeps ninja from ever building it.
- A Gradle pre-build task (`patchAzaharCMake`) neutralizes the vendor root's pre-commit-hook copy in place — impossible in a submodule, where `.git` is a pointer file. `.gitmodules` carries `ignore = dirty` for this submodule so the one-line edit stays out of `git status`.
- Requires **CMake ≥ 3.25** (3.31.6 installed in the SDK; AGP's default 3.22.1 cannot configure Azahar), NDK r27, `-DANDROID_ARM_NEON=true` (cryptopp), C++20.

## The frontend layer

Azahar has **no software renderer on Android** — it renders through EGL/GLES 3.2 into a real surface, so melonDS's CPU-blit engine model does not apply. `src/main/cpp/`:

- `frontend/` — Azahar's own Android JNI frontend files (`emu_window*.{h,cpp}`, `input_manager`, `ndk_motion`), copied from `vendor/azahar/src/android/app/src/main/jni/` (GPLv2+) and trimmed: no IDCache, no cameras, portrait detection hardwired off. Keep the set minimal at submodule bumps.
- `emulator_engine.{h,cpp}` — the singleton engine. Emulation thread mirrors upstream's `RunCitra`: `System::Load` then `RunLoop()` per iteration, parking on a cv while paused (volume muted to stop bleed) and processing a **command queue** between iterations — everything touching the core (`saveState`/`loadState`/`reset`/`captureFrame`) runs there via `runOnEmuThread`. Savestates call the public synchronous `System::SaveState/LoadState(slot)` directly (slot-keyed by title id in `UserDir/states/`); Azahar's async `SendSignal` path is not used. `captureFrame` always renders a **stacked 400×480** `RequestScreenshot` regardless of the on-screen layout (SlotSheet thumbnails assume it). Presentation is decoupled: the view's Choreographer callback drives `tryPresent()` on the UI thread, draining the renderer's frame mailbox; a mutex serializes it against `PollEvents`' EGL surface recreation on the emu thread.
- `azahar_jni.cpp` — `RegisterNatives` on `AzaharCoreNative` + `AndroidUtils::InitJNI` + the error-callback bridge (`onCoreError`).
- **`AndroidUtils` statics are load-bearing:** Azahar's `citra_common` calls static Kotlin methods for every file operation on Android (`getBuildFlavor`, `getUserDirectory`, …). `AzaharCoreNative` implements all 16 (`"vanilla"` semantics — raw paths); a missing one crashes `JNI_OnLoad`. Absolute paths handed to the core carry a `"!"` prefix ("already native"); un-prefixed paths resolve against the user dir.

## Kotlin / layout / input

- `AzaharCoreModule.kt` — the `EmulatorCore` contract and idle/paused/running state machine, mirroring `MelondsCoreModule`. Differences: savestates are **slot-based** (no paths cross JNI); `loadRom` records a **sha1 → title-id map** (`filesDir/azahar-map/<sha1>`) because Azahar keys saves by title id inside the emulated `sdmc`/`nand` tree — `deleteSaveData(sha1)` reads the map (no entry → nothing to delete); no `flushSaves` (the emulated OS writes saves through the file system as games commit them). The core's user tree lives under `filesDir/azahar/`.
- `AzaharCoreView.kt` — SurfaceView host + Choreographer presenter. `SurfaceHolder.setFixedSize` pins the surface to exactly the composited frame — **400×480** stacked (bottom screen centred: rect x=40) or **720×240** side-by-side — so the engine's `CustomLayout` rects map 1:1 and `touchScreenRect` in the shared UI stays truthful. Set the layout rects (native) *before* `setFixedSize`; the resulting `surfaceChanged` applies them.
- Input: `AzaharCoreNative.updateKey` maps contract buttons to Azahar's `InputManager` ids (a=700 … r=774) — and the **D-pad also drives the analog Circle Pad** at full tilt (normalized diagonals), because most 3DS games ignore the D-pad; menus still get the real D-pad ids. Touch goes through the live `FramebufferLayout`'s bottom-screen rect.
- **Encrypted ROMs do not boot** (verified on device): Azahar ships no decryption, so `System::Load` returns `ErrorLoader_ErrorEncrypted` (status 5) for any encrypted dump. `nativeLoadRom` returns that status int (0 = ok, -1 = surface timeout), the module maps it to a reason and throws `ERR_ROM_ENCRYPTED` for the encrypted case, and the shared UI shows `emulator.bootEncryptedMessage` ("import a decrypted copy"). `.cia` is install-only upstream and out of scope here.
