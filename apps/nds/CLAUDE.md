@AGENTS.md

# apps/nds — NDS Emulator

Android-only Expo app emulating the Nintendo DS via the **melonDS** core (C++, integrated over JNI). See the root CLAUDE.md for monorepo-wide rules and the shared app commands.

- Android package: `com.aguspignal.nds` · slug `nds` · display name "NDS Emulator" (placeholder, changeable in `app.json`).
- `app.json` → `android.intentFilters` puts the app in Android's "Open with" list for `.nds` files and in the share sheet. Same five-filter shape as gba's (SEND + both `content://` filters + the `file://` `pathPattern` pairs) — see that app's CLAUDE.md for why each filter is load-bearing and why the `pathPattern`s are double-escaped. Editing this file needs a `prebuild` before the manifest changes take effect.
- `App.tsx` builds the `AppConfig` — console `nds`, `core` + `EmulatorView` + `sharedFiles` from `./modules/melonds-core`, `licenseNotice` from `./license` — and renders the shared `<AppRoot />`.
- `license.ts` — the GPL v3 notice for melonDS that Settings → Legal → License shows, mirroring `docs/legal/license/license-gpl-nds.md`. Edit both together.
- `modules/melonds-core/` — local Expo Module (Android/Kotlin/C++), mirroring gba's `mgba-core`:
  - `android/vendor/melonds` — **git submodule** pinned to melonDS `1.1` (teakra is in-tree, no nested submodules). After a fresh clone run `git submodule update --init`.
  - `android/src/main/cpp/` — `CMakeLists.txt` builds melonDS's `core` (+ teakra) static and headless: frontend, JIT, GL renderer and GDB stub all OFF. `emulator_engine.cpp` is a singleton owning the `melonDS::NDS` instance, a dedicated emulation thread (input → runFrame → composite → audio pump → SurfaceView blit, clock-paced), the framebuffer and the ANativeWindow; `audio_sink.cpp` is an Oboe output stream fed by an SPSC ring buffer; `melonds_jni.cpp` is the `RegisterNatives` table.
  - **`platform_impl.cpp` is not optional.** melonDS's `core` calls `melonDS::Platform::*` free functions that the library never defines — upstream implements them only in the Qt/SDL frontend, which this build excludes. Threading, logging, timing, file I/O, save write-back and stop are real; local multiplayer, networking, camera, mic, AAC and Slot-2 addons are link-time stubs. `SPU`'s constructor creates a `Platform::Mutex` before the first frame, so the sync primitives must work from the very first boot.
  - `android/.../MelondsCoreModule.kt` — implements the `EmulatorCore` contract and owns the idle/running/paused state machine + events, with the same `OnActivityEntersBackground`/`OnActivityEntersForeground`/`OnDestroy` hooks gba uses, and the same ACTION_SEND bridge (`initialSharedFile` + the `sharedFile` event via `OnNewIntent`). `console` is a fixed `"nds"` — one console per app, so there is no header sniffing.
  - `android/.../MelondsCoreNative.kt` — the JNI mirror; also maps contract button names → melonDS key bits (A=0 … Y=11). The mask it keeps is **pressed-high**; melonDS's `SetKeyMask` is active-low and the engine inverts it.
  - `android/.../RomFiles.kt` — resolves ROM URIs (copies `content://` into cache) and keys battery saves/savestates by ROM SHA-1 under `filesDir/melonds/`; `deleteSaveData` matches states by `<sha1>.ss` prefix so no slot can be missed.
  - `android/.../MelondsCoreView.kt` — hosts the SurfaceView, aspect-fits it and hands the Surface to the engine. **Video only** — it does no touch handling.
  - `src/index.ts` — typed wrapper exporting `core: EmulatorCore`, `EmulatorView` and `sharedFiles: SharedFileSource`. Keep it in lockstep with the Kotlin definition and `@emulators/core-interface`.

### Video, and the one composited buffer

Both 256×192 screens are composited into a **single framebuffer** — 256×384 top over bottom by default, 512×192 side by side when the view's `screenLayout` prop is `"horizontal"` (which the shared `EmulatorScreen` sets in landscape) — so the surface handling, the blit and the screenshot path are the same single-window code gba uses. `setScreenLayout` resizes the buffer on the emulation thread under the surface lock; `captureFrame` always produces the stacked shape, whatever the view shows, because that aspect is what `SlotSheet`'s thumbnails assume. melonDS renders `0xAARRGGBB` (its GPU2D comment calls it "32-bit BGRA", i.e. B,G,R,A in memory) while `WINDOW_FORMAT_RGBX_8888` wants red in the low byte, so **red and blue swap during the composite**; a blue-tinted picture means that swizzle broke.

### Touch

Touch input goes through `core.setTouch(x, y, pressed)` with coordinates in bottom-screen native pixels (0..255 × 0..191), and is handled entirely in the shared UI: `touchScreenRect` (in `packages/ui/.../gamepad/layout.ts`) re-derives the same aspect fit `MelondsCoreView.onLayout` does and returns the bottom screen's sub-rect, and `GamepadOverlay` routes a touch that hits no pad region into it. One finger owns the stylus until it lifts, and keeps it while sliding — which is what stops a stylus drag from pressing buttons in landscape, where the pad floats over a full-bleed game.

### Saves

- Battery save and savestates are independent; unlike mGBA, melonDS savestates need no "load without savedata" flag.
- `Platform::WriteNDSSave` fires on every cart SRAM write, so the engine only **marks the save dirty** there and writes the whole buffer once the game has been quiet for ~120 frames, on `flushSaves` (the backgrounding hook) and in `unloadRom`. A game usually saves in one burst, so this writes once instead of every frame it touches SRAM.
- The `.sav` is injected at boot through `NDSCartArgs.SRAM`; with no file, melonDS sizes a fresh buffer from the cart header.
- `NDS::DoSavestate` calls `Savestate::Finish()` itself, which patches the length field the loader validates — so `Length()` is correct on return and no explicit `Finish()` is needed. Loading uses the non-owning `Savestate(buffer, size, false)` ctor, whose size must be exactly the file length.
- `captureScreenshot` goes engine → JNI (`nativeCaptureFrame` returns `[width, height, pixels...]`) → Kotlin `Bitmap` → PNG at a path JS chose.
- Anything touching the core must go through `runOnEmuThread`, which runs the closure between frames and works while paused.

### Boot

No BIOS or firmware dump is needed: `NDSArgs` defaults to FreeBIOS plus generated firmware, and `NeedsDirectBoot()` is therefore always true, so retail carts **direct-boot**. Order matters and mirrors upstream's `EmuInstance::reset()` — `SetNDSCart` → `Reset` → `SetupDirectBoot` → `Start`. DSi is out of scope; it needs real BIOS/NAND dumps.

## Building

- The first native build compiles melonDS for 2 ABIs (arm64-v8a, x86_64) — expect several minutes cold. A linked `libmelonds-jni.so` is megabytes; if it is ~47 KB the core was garbage-collected because nothing referenced it.
- Gradle must run on **JDK 17–21** (e.g. Temurin 21 at `%LOCALAPPDATA%\Java\jdk-21.0.12+8` — set `JAVA_HOME` before building). The generated `android/local.properties` must point `sdk.dir` at the Android SDK, written with forward slashes.
- The software rasterizer runs **threaded** (`SoftRenderer::SetThreaded(true, GPU)`), which is why `Platform::Thread`/`Semaphore` are real implementations rather than stubs. Still to come: the JIT (needs Android W^X executable-memory handling) and the GL renderer.
