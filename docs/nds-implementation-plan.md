# NDS app — full melonDS implementation plan

## Context

The GBA app is complete; the NDS app is a finished JS shell whose native core is a
stub. The **first increment is already done and verified**: melonDS 1.1 is vendored
as a submodule and cross-compiles + links for Android (arm64-v8a + x86_64), with a
minimal JNI version probe. This plan covers **the rest of the NDS app** — real ROM
loading, the emulation engine, two-screen video, audio, input + touch, saves, the
native view, and the `Platform` layer that melonDS requires — turning the stub into
a playable DS emulator.

**Approach: mirror the verified gba `mgba-core` module** (`apps/gba/modules/mgba-core/`),
swapping mGBA calls for melonDS, with the DS-specific reworks below. Retail NDS only
(**DSi is out of scope** — it needs real BIOS/NAND dumps). No user BIOS needed:
melonDS boots retail carts via FreeBIOS **direct boot**. The gba module is the
working reference for every pattern; 3DS/Azahar later follows this same shape.

## Key design decisions (resolved during exploration)

- **Video — one stacked buffer.** Composite both 256×192 screens into a single
  **256×384** framebuffer (top over bottom), swapping **R↔B** per pixel during the
  copy (melonDS is `0xFFRRGGBB`/BGRA-in-memory; gba's format is R-low RGBX). The
  buffer then matches gba's exactly, so its single-`ANativeWindow` blit and its
  screenshot JNI transfer **verbatim**. `captureScreenshot` emits the same stacked
  256×384 PNG — which is what `SlotSheet.tsx` `thumbAspect` already assumes (256/384).
- **Audio — no manual resample.** Open the Oboe sink first, read its device rate,
  and pass it as `NDSArgs.OutputSampleRate`; `SPU.ReadOutput()` then yields S16
  stereo at that rate. gba's `audio_sink.{h,cpp}` (Oboe + SPSC ring) transfers
  almost verbatim — only the feed changes (SPU read instead of blip_buf).
- **Input — active-low.** melonDS `SetKeyMask` is active-**low** (bit clear =
  pressed), bits A=0,B=1,Select=2,Start=3,Right=4,Left=5,Up=6,Down=7,R=8,L=9,X=10,
  Y=11. Keep gba's Kotlin "pressed-mask" approach; the **engine inverts** to
  active-low before `SetKeyMask`. X/Y are now mapped (gba left them unmapped).
- **Touch — handled in shared UI, native view stays video-only.** JS already has
  everything to place the touch screen: `layout.screen` (the emulator rect) + the
  today-unused `CONSOLES.nds.screens`/`touchScreen`. Add a pure helper that
  aspect-fits 256×384 into `layout.screen` and returns the bottom-screen sub-rect
  (same math the native view uses, so they agree), then route non-pad touches
  inside it to `core.setTouch(x, y, pressed)` in 0..255×0..191. This finally
  activates the dormant `setTouch` contract + `touchScreen` field, keeps the single
  gamepad responder intact, and needs **no** native touch code.
- **Platform layer.** melonDS's `core` calls `melonDS::Platform::*` free functions
  that libcore leaves undefined — a new `platform_impl.cpp` must define them all, or
  the engine won't link. Mandatory for playback: `SignalStop`, `Log`, timing
  (`Sleep`/`GetMSCount`/`GetUSCount`), **Mutex** (SPU always locks one), `WriteNDSSave`,
  and the stdio file-I/O set. `Thread`/`Semaphore` only matter for the optional
  threaded rasterizer — implement them for real with std primitives so it can be
  switched on later. Everything else (MP_*, Net_*, Camera_*, Mic_*, AAC_*, Addon_*,
  DynamicLibrary_*) is a trivial return-0/false/nullptr stub. Ship single-threaded
  `SoftRenderer` first.
- **Save separation.** Battery save (cart SRAM) and savestates are independent, and
  melonDS savestates need no "load-without-savedata" flag (unlike mGBA). Simpler
  than gba: no `forceSaveClean` age machine.

## Boot / frame recipe (concrete melonDS calls, for the engine)

```cpp
// construct (audio opened first so we know the rate)
melonDS::NDSArgs args{};                 // FreeBIOS + generated firmware + SoftRenderer
args.OutputSampleRate = mAudio.sampleRate();
auto nds = std::make_unique<melonDS::NDS>(std::move(args), this /*userdata=engine*/);
nds->Reset();
// load  (C++17: construct then assign; SRAM injects the .sav, else melonDS sizes a fresh one)
melonDS::NDSCartArgs cartArgs; cartArgs.SRAM = std::move(savBuf); cartArgs.SRAMLength = savLen;
auto cart = melonDS::NDSCart::ParseROM(std::move(romBytes), romLen, this, std::move(cartArgs));
nds->SetNDSCart(std::move(cart));
if (nds->NeedsDirectBoot()) nds->SetupDirectBoot(romName);   // true with FreeBIOS
nds->Start();
// per frame (emu thread)
nds->SetKeyMask((~pressedMask) & 0xFFF);                     // invert → active-low
touching ? nds->TouchScreen(tx, ty) : nds->ReleaseScreen();
nds->RunFrame();
int fb = nds->GPU.FrontBuffer;
// composite nds->GPU.Framebuffer[fb][0].get() (top) + [fb][1].get() (bottom)
//   into one 256x384 buffer, swapping R<->B; blit like gba
int n = nds->SPU.ReadOutput(pcm, framesWanted); mAudio.push(pcm, n);
// savestate: melonDS::Savestate s; nds->DoSavestate(&s); write s.Buffer()/s.Length()
// battery: Platform::WriteNDSSave marks dirty → flush nds->GetNDSSave()/GetNDSSaveLength() to .sav
```

## Files

**Native — `apps/nds/modules/melonds-core/android/src/main/cpp/`**
- `platform_impl.cpp` (NEW) — the `melonDS::Platform` implementation (see decisions).
- `emulator_engine.{h,cpp}` (NEW) — mirror gba's `emulator_engine.*`: singleton,
  emu thread + `runOnEmuThread` command queue (runs closures between frames, works
  while paused), dual mutex (`mMutex` core/thread + `mSurfaceMutex` window) with the
  blocking `surfaceDestroyed` handshake, retained-frame repaint. DS reworks: 256×384
  composite + R↔B, atomic pressed-mask inverted to active-low, touch state, SPU→sink
  pump, melonDS `Savestate`/SRAM, **fixed ~16.71 ms pacing** (÷ speed).
- `audio_sink.{h,cpp}` (NEW) — copy gba's Oboe SPSC ring; feed = `SPU.ReadOutput`.
- `melonds_jni.cpp` (EXPAND from the probe) — full JNI surface mirroring gba's
  `mgba_jni.cpp` (load/unload/pause/reset/title/videoSize/setKeys/saveState/loadState/
  captureFrame/flush/volume/speed/surfaceChanged/surfaceDestroyed) **plus new
  `nativeSetTouch(x,y,down)`**; keep `JNI_OnLoad`/`RegisterNatives` against
  `expo/modules/melondscore/MelondsCoreNative`.
- `CMakeLists.txt` (MODIFY) — add the new sources to `melonds-jni`; add Oboe now
  (`find_package(oboe REQUIRED CONFIG)` + link `oboe::oboe`), as gba does.

**Kotlin — `.../java/expo/modules/melondscore/`**
- `MelondsCoreNative.kt` (EXPAND) — all `external fun`s + melonDS `BUTTON_BITS`
  (A=0…Y=11) and `updateKey`/`clearKeys` like `MgbaCoreNative.kt`.
- `MelondsCoreModule.kt` (EXPAND from stub) — full contract + `idle/paused/running`
  state machine + `stateChange`/`error` emission + `OnActivityEntersBackground`
  (flush)/`OnActivityEntersForeground`/`OnDestroy` hooks + `captureScreenshot`,
  mirroring `MgbaCoreModule.kt`; `setButton`→`updateKey`, real `setTouch`→native,
  `console` fixed `"nds"`. Remove the bring-up `OnCreate` probe.
- `RomFiles.kt` (NEW) — mirror gba's: `content://`-copy-into-cache-while-hashing,
  SHA-1 keying under `filesDir/melonds/{saves,states}/`, `savPath`/`statePath`,
  prefix-match `deleteSaveData`. Drop the GB/GBC header detection (single console).
- `MelondsCoreView.kt` (EXPAND from stub) — SurfaceView host aspect-fitting **256×384
  stacked** + Surface handoff + `refreshAllLayouts`, mirroring `MgbaCoreView.kt`.
  **Video only — no touch handling here.**

**Build** — `apps/nds/modules/melonds-core/android/build.gradle` (MODIFY): add
`buildFeatures { prefab true }` + `implementation "com.google.oboe:oboe:1.9.3"`.

**Shared UI — `packages/ui/src/components/gamepad/`** (gated on `spec.touchScreen`,
so gba is unaffected; honors the "one responder view" rule):
- `layout.ts` — add a pure `touchScreenRect(screen, spec)` helper (aspect-fit the
  stacked screens, return the touch screen's sub-rect + a window→native-pixel map).
- `GamepadOverlay.tsx` — for a touch that hits no pad region, if `spec.touchScreen`
  is set and the point is in that sub-rect, drive `core.setTouch` (track one screen
  touch id; release on lift). `hitTest.ts` may gain a small helper.

**App** — `apps/nds/app.json` (MODIFY): add the `.nds` "Open with" `intentFilters`,
mirroring gba's four-filter block (the JS open-with path is already shared).

## Stages (each builds; run-verification needs a device)

1. **Platform + audio + build deps** — `platform_impl.cpp`, `audio_sink.{h,cpp}`,
   CMake/gradle Oboe. *Verify:* `:melonds-core:assembleDebug` builds (links core with
   Platform defined).
2. **Engine boot + video + view** — `emulator_engine.*`, expand `melonds_jni.cpp`,
   `MelondsCoreNative.kt`, `MelondsCoreView.kt`, new `RomFiles.kt`, real `loadRom`/
   lifecycle/`captureScreenshot` in `MelondsCoreModule.kt`. *Verify (device):* load a
   `.nds`, both screens render, run/pause/reset, slot thumbnail captures.
3. **Input + touch** — `nativeSetKeys`/`nativeSetTouch`; engine key-invert + touch;
   `BUTTON_BITS`; module `setButton`/`setTouch`; shared-UI `touchScreenRect` + overlay
   routing. *Verify:* buttons play; the bottom screen is touch-controllable; pad still
   works (esp. landscape float).
4. **Audio** — SPU pump → sink, `OutputSampleRate` = device rate, `setVolume`/
   `setSpeed`. *Verify:* sound plays; 2× speed-up keeps pitch.
5. **Saves** — `WriteNDSSave`→`.sav` flush, load `.sav` via `SRAM` at boot,
   `flushSaves`, savestates via `Savestate`→file; module `saveState`/`loadState`/
   `deleteState`/`deleteSaveData` + background-flush/`OnDestroy`. *Verify:* battery
   persists across reload; manual slots; slot-0 auto-save/resume.
6. **Open-with + polish** — `.nds` intent filters. *Optional later perf:* enable the
   threaded soft rasterizer (`SoftRenderer::SetThreaded(true, GPU)`, needs the real
   `Thread`/`Semaphore` from stage 1) and, separately, re-enable the JIT (needs
   Android W^X executable-memory handling). *Verify:* open a `.nds` from a file
   manager.

## Verification

- **Build (any stage):** `cd apps/nds/android && JAVA_HOME=<jdk21> ANDROID_HOME=<sdk>
  ./gradlew :app:assembleDebug` (JDK 21; see the android-build-environment memory).
  No device is available in this session, so run-verification is on the user's device.
- **Typecheck** the shared-UI TS changes (stage 3): `npm run typecheck` at root.
- **End-to-end:** import a `.nds` in the library → boot → both screens render →
  buttons + bottom-screen touch play the game → audio → save/load slots + slot-0
  auto-resume → battery save survives a reload → "Open with" from a file manager.
- **Reference** `apps/gba/modules/mgba-core/` throughout — it is the working template
  every file here mirrors.
