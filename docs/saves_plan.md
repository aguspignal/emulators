# Saves plan: savestate slots with thumbnails, auto-resume, and durability hardening

Status: **approved, not yet implemented** (2026-08-12).

## Context

Saves are the next critical feature. The ground floor already exists in the GBA app:

- **Battery saves already persist**: `RomFiles.savPath` keys `filesDir/mgba/saves/<sha1>.sav`; the engine hands it to `core->loadSave` (mmap, periodic msync during play, final flush on `unloadRom`).
- **Savestates are fully plumbed with zero callers**: `core.saveState(slot)`/`loadState(slot)` work end-to-end (TS → Kotlin → JNI → `mCoreSaveStateNamed`, files at `filesDir/mgba/states/<sha1>.ss<slot>`), thread-safe via the emu-thread command queue (`runOnEmuThread`, works while paused).

Missing: JS never learns the ROM's SHA-1 (documented blocker, `packages/storage/src/schema.ts:56`), no savestate UI, deleting a ROM leaks its saves, backgrounding never flushes the battery save, and **loading a state currently rolls back the battery save** (verified in vendor source: with `SAVESTATE_SAVEDATA` on load, the state's embedded SRAM permanently overwrites the live `.sav` via `GBASavedataLoad`).

**Product decisions:** slot picker **with thumbnails** (per-slot screenshot + relative time, long-press delete) · **full auto-resume** (auto-savestate on exit/background, silent resume on boot, fresh start via existing Reset) · `.sav` import/export out of scope (don't preclude).

**Design decisions:**

- Slot 0 = reserved auto slot; user slots 1–9 (`SAVESTATE_SLOTS = 10`).
- Savestate metadata in SQLite (`save_states`), written by JS after each successful native save — shared UI never learns per-app native file layouts.
- Thumbnails are JS-owned: native `captureScreenshot(uri)` writes a PNG of the current frame to a JS-chosen `file://` URI. Pixels never cross the bridge. Files at `Paths.document/state-thumbs/<romId>-<slot>-<savedAt>.png` — savedAt in the name makes every overwrite a fresh URI (RN Image cache-busting).
- Load flags → `SAVESTATE_RTC` only. Vendor evidence: embedded savedata is applied *regardless* of the flag; the flag only controls **writeback**. Without it, mGBA masks the state's SRAM read-only over the file (`GBASavedataMask`, writeback-on-game-save) — the `.sav` is untouched unless the game itself saves. Matches upstream Qt default (`SCREENSHOT|RTC`; SCREENSHOT compiled out here, METADATA has no load-side branch). Save flags unchanged.
- Delete cleanup goes through the contract (`deleteSaveData(sha1)`) — native owns its layout; Kotlin file ops only.

## Phase 1 — Contract + native layer (one commit; full `expo run:android` rebuild)

Contract rule: types.ts + all 3 Kotlin modules + all 3 TS wrappers in the same change. JS behavior unchanged after this phase (no callers yet).

**`packages/core-interface/src/types.ts`** — `RomInfo.sha1: string` (lowercase hex; keys native save files); `EmulatorCore` gains:

- `deleteState(slot: number): Promise<void>` — requires loaded ROM; missing file is a no-op.
- `deleteSaveData(sha1: string): Promise<void>` — battery save + all states for that hash; callable with no ROM loaded; rejects if that ROM is loaded.
- `captureScreenshot(uri: string): Promise<void>` — PNG of current frame to a caller-chosen `file://` URI; persistence-only, pixels never enter JS.

**`packages/core-interface/src/constants.ts`** — add `AUTO_SAVESTATE_SLOT = 0`.

**`emulator_engine.{h,cpp}`** (apps/gba/.../cpp):

- Load-flag fix at `loadState` (~line 154): `mCoreLoadStateNamed(mCore_, vf, SAVESTATE_RTC)` + comment explaining the mask-vs-writeback semantics. Save side unchanged.
- `bool captureFrame(std::vector<uint32_t>& out, unsigned* w, unsigned* h)` — `runOnEmuThread` copies `mFramebuffer` + dims (race-free between frames; framebuffer retained while paused, so the pause-menu frame is captured).
- `void flushSaves()` → `runOnEmuThread` → private `forceSaveClean()`, and call `forceSaveClean()` directly in `unloadRom()` after the thread join, before `mCoreConfigDeinit`. Mechanism (internal headers are legal only inside the mgba-jni target — `M_CORE_*` defines match):

  ```cpp
  // Two calls: first absorbs DIRT_NEW → SEEN and stamps dirtAge; second exceeds
  // the age threshold → vf->sync + RTC footer write + mask-writeback commit.
  GBASavedataClean(&gba->memory.savedata, fc);
  GBASavedataClean(&gba->memory.savedata, fc + mSAVEDATA_CLEANUP_THRESHOLD + 1);
  // mPLATFORM_GB: same shape with GBSramClean(gb, fc...).
  ```

  Why unloadRom needs it: after a masked state load, `GBASavedataDeinit` discards pending writeback and deinit's raw msync never writes the RTC footer. Do **not** use `savedataClone`+rewrite — truncating a file the core mmaps risks SIGBUS and drops the RTC footer.

**`mgba_jni.cpp`** — `nativeCaptureFrame(): jintArray` returning `[w, h, ...pixels]`; swizzle framebuffer RGBX (R low byte, per `WINDOW_FORMAT_RGBX_8888` blit) → Android ARGB ints: `0xFF000000 | ((p&0xFF)<<16) | (p&0xFF00) | ((p>>16)&0xFF)`. Plus `nativeFlushSaves()`. kMethods: `("nativeCaptureFrame","()[I")`, `("nativeFlushSaves","()V")` — all three JNI pieces (external fun / wrapper / table entry) or `UnsatisfiedLinkError`.

**`MgbaCoreNative.kt`** — `external fun nativeCaptureFrame(): IntArray?`, `external fun nativeFlushSaves()`.

**`RomFiles.kt`** — `fun deleteSaveData(context, sha1)`: delete `saves/<sha1>.sav` + **prefix glob** `states/` files starting `"$sha1.ss"` (not a 0–9 loop — covers any slot count).

**`MgbaCoreModule.kt`**:

- `loadRom` map += `"sha1" to rom.sha1`.
- `AsyncFunction("deleteState")` — `NoRomLoadedException` guard → `File(statePath).delete()`.
- `AsyncFunction("deleteSaveData")` — validate `^[0-9a-f]{40}$` (path-traversal guard), throw `ERR_ROM_IN_USE` if `currentRom?.sha1 == sha1`, else `RomFiles.deleteSaveData`.
- `AsyncFunction("captureScreenshot")` — resolve `file://`/bare path like `RomFiles.resolve`; `nativeCaptureFrame()` → `Bitmap.createBitmap(raw, offset=2, stride=w, w, h, ARGB_8888)` (consumes `[w,h,...]` without recopy) → `compress(PNG)` to path (`parentFile?.mkdirs()`); `ERR_SCREENSHOT` on failure; `recycle()` in finally.
- `OnActivityEntersBackground` += `if (currentRom != null) nativeFlushSaves()` (blocks ≤ ~1 frame; msync is async — no ANR risk).
- `OnDestroy { MgbaCoreNative.nativeUnloadRom() }` — flush path runs even when JS cleanup never does (dev reload / activity teardown); already idempotent.

**Stubs (`MelondsCoreModule.kt`, `AzaharCoreModule.kt`)** — `loadRom` map **must** gain `"sha1" to sha1OfUri(uri)` (a missing key arrives in JS as `undefined`, which expo-sqlite rejects as a bind parameter in `applyRomInfo` — runtime breakage, not a style point). Small streaming `MessageDigest` helper per file (file:// → FileInputStream; content:// → contentResolver). No-op `deleteState` / `deleteSaveData` / `captureScreenshot`.

**TS wrappers ×3** (`apps/*/modules/*/src/index.ts`) — add the three methods to the `declare class` and the `core` object.

## Phase 2 — Storage layer (pure TS)

**`schema.ts`** — `RomRow.sha1: string | null`; new block (never edit v1; drop the stale deferred comment):

```ts
if (version < 2) {
  await db.execAsync(`
    ALTER TABLE roms ADD COLUMN sha1 TEXT;
    CREATE TABLE save_states (
      rom_id   INTEGER NOT NULL,
      slot     INTEGER NOT NULL,
      saved_at INTEGER NOT NULL,
      PRIMARY KEY (rom_id, slot)
    );
  `);
  version = 2;
}
```

Composite PK is the upsert key; no FK/extra index (project style).

**`roms.ts`** — `applyRomInfo` UPDATE gains `sha1 = ?` bound to `info.sha1` (backfills v1 rows on each play; use `COALESCE(NULLIF(?, ''), sha1)` so a stub's `""` never clobbers a real value).

**`saveStates.ts`** (new) — `SaveStateRow { rom_id; slot; saved_at }`; `listSaveStates(db, romId)` (ORDER BY slot), `getSaveState(db, romId, slot)`, `upsertSaveState(db, romId, slot, savedAt)` (`INSERT ... ON CONFLICT(rom_id, slot) DO UPDATE SET saved_at = excluded.saved_at`), `deleteSaveState`, `deleteSaveStatesForRom`.

**`files.ts`** — `stateThumbsDirectory()` (`Paths.document/state-thumbs/`, create-on-use like `romsDirectory`), `stateThumbUri(romId, slot, savedAt)`, `deleteStateThumb(romId, slot, savedAt)`, `deleteStateThumbsForRom(romId)` (list dir, prefix `${romId}-` — the dash stops romId 1 matching 12).

**`index.ts`** — export the new module + helpers (auto-surfaces through ui's `export * from '@emulators/storage'`).

## Phase 3 — Slot-picker UI

**`packages/ui/src/utils/format.ts`** — `formatRelativeTime(ts)`: Just now / Nm ago / Nh ago / Nd ago / date (`formatLastPlayed` is day-granularity, too coarse).

**`GameMenu.tsx`** — props gain `onSaveState` / `onLoadState`; two `SecondaryButton`s between Resume and Reset.

**`SlotSheet.tsx`** (new, `components/gamepad/`) — props `{ mode: 'save' | 'load'; romId; onPick(slot); onBack }`; `core`/`db` via `useAppConfig()`/`useSQLiteContext()`. Same scrim+card idiom as GameMenu; `FlatList` capped ~70% height (landscape). Rows merge `SAVESTATE_SLOTS` with `listSaveStates`: load mode shows Auto (slot 0) first when present then 1–9 (empty rows disabled); save mode shows 1–9 only. Row = thumbnail `Image` (~96×64, `resizeMode: 'contain'`, dark placeholder bg — degrades gracefully for missing/torn PNGs and stub apps) + "Slot N"/"Auto" + `formatRelativeTime(saved_at)` or muted "Empty". Long-press occupied → `Alert` confirm → `core.deleteState(slot)` → `deleteSaveState` → `deleteStateThumb` → re-query (sheet stays open).

**`EmulatorScreen.tsx`** — `menuOpen` becomes `menu: 'closed' | 'root' | 'save' | 'load'` (`GamepadOverlay suspended={menu !== 'closed'}`; SlotSheet `onBack` → `'root'`). Manual save handler (order matters):

```ts
await core.saveState(slot);
const stale = await getSaveState(db, romId, slot);
const savedAt = Date.now();
try { await core.captureScreenshot(stateThumbUri(romId, slot, savedAt)); }
catch (e) { console.warn('thumbnail failed:', e); }   // a state without a thumb is still a state
await upsertSaveState(db, romId, slot, savedAt);
if (stale) deleteStateThumb(romId, slot, stale.saved_at); // stale thumb only after upsert
// close menu, core.resume()
```

Failures → `showErrorAlert("Couldn't save state", ...)`, stay in menu. Load handler: `core.loadState(slot)` → close + resume; alert on failure, menu stays open.

## Phase 4 — Auto-resume (slot 0; `EmulatorScreen.tsx` only)

- **Boot** (between the error-listener registration and `core.start()`, with the existing `cancelled` guards around each await): `getSaveState(db, romId, 0)` → if present `await core.loadState(0)` in try/catch — failure is `console.warn` + fresh boot, never an alert (savestate failures only reject; Kotlin emits no `error` event for them, so no double-alert).
- **Shared `autoSave()`** callback (same sequence as manual save but slot 0), guarded by `bootedRef` (set alongside `setBooted`) and an `autoSaveInFlight` ref.
- **Exit interception**:

  ```ts
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (exitHandled.current || !bootedRef.current) return; // boot-failure goBack pops straight through
    e.preventDefault();
    exitHandled.current = true;
    core.pause();
    autoSave().finally(() => navigation.dispatch(e.data.action)); // ALWAYS exit, even on failure
  }), [navigation, core, autoSave]);
  ```

  Ordering is safe by construction: `unloadRom` lives in the unmount cleanup, which runs after `dispatch`, which runs after the awaited save chain — never fire-and-forget the exit save (that reintroduces the race with `unloadRom`). Covers menu Exit, hardware back, and gesture back (`predictiveBackGestureEnabled: false` in app.json keeps back on the JS path — verified).
- **Background**: in the AppState non-active branch after the pause logic, `void autoSave()` (fire-and-forget is safe here — nothing unloads). Process death mid-write worst-cases a torn `.ss0` → load fails at next boot → tolerated fresh start.
- Reset untouched — it's the fresh-start escape; slot 0 is overwritten at next exit/background.

## Phase 5 — Home delete cleanup + docs

**`HomeScreen.tsx`** — add `core` from `useAppConfig()`; in the delete action after the existing row+file deletes (replace the leak comment at ~90-92):

```ts
try {
  await deleteSaveStatesForRom(db, rom.id);
  deleteStateThumbsForRom(rom.id);
  if (rom.sha1) await core.deleteSaveData(rom.sha1); // null = pre-v2 row never replayed; one-time legacy leak, documented
} catch (e) { console.error('save cleanup failed:', e); } // row already gone; leftovers are harmless orphans
```

**Docs** — root `CLAUDE.md` roadmap (savestate UI done, blocker gone; note flush hardening); `packages/storage/CLAUDE.md` (Deferred → implemented; `save_states`, thumbs dir); `packages/core-interface/CLAUDE.md` (new members; clarify the video rule: no frame/pixel *streaming* APIs — `captureScreenshot` is persistence-only); `packages/ui/CLAUDE.md` (EmulatorScreen/GameMenu/SlotSheet); `apps/gba/CLAUDE.md` (flushSaves/captureFrame, unloadRom flush). Drop `- saves` from `forfutureself.md`.

## Risks

- JNI: all three pieces per function or `UnsatisfiedLinkError` at `System.loadLibrary` (check logcat first).
- Swizzle direction: blue-tinted thumbnails = R/B shifts inverted.
- Internal mGBA headers (`mgba/internal/...`) must never leak outside the mgba-jni target.
- Migration: append `if (version < 2)` only; never touch the v1 block.
- Thumbnail cache-busting relies entirely on savedAt-in-filename — never reuse a thumb path.
- Slot picker iterates `SAVESTATE_SLOTS`, no literal 10; slot 0 invisible in save mode.
- Kotlin/native changes need full rebuild (not Fast Refresh); Gradle on JDK 21 (`JAVA_HOME` → `%LOCALAPPDATA%\Java\jdk-21.0.12+8`).

## Verification

1. `npm run typecheck` (root) after every phase.
2. Build: `JAVA_HOME` → JDK 21, then `npm run android:gba` (root script). Build `android:nds` once to compile the stub Kotlin.
3. On-device (GBA app; include one GB/GBC ROM for the `GBSramClean` + thumb-aspect path):
   - Save slot 1 → resumes; Load sheet shows thumbnail (correct colors) + "Just now". Overwrite slot 1 → thumbnail visibly updates.
   - Battery protection: in-game save, load an *older* state, exit without saving in-game, relaunch → the newer in-game save must survive.
   - Exit → reopen ROM → resumes seamlessly (Auto row in Load sheet); menu Reset → fresh boot.
   - Background mid-game → kill from app switcher → relaunch → resumes from the background moment.
   - Flush hardening: in-game save, background immediately, kill → relaunch, Reset → in-game save present.
   - Long-press delete slot → row empties; `adb shell run-as com.aguspignal.gba ls files/mgba/states` confirms.
   - Delete a played ROM → `.sav`, `.ss*`, thumbs, and `save_states` rows all gone; re-import → boots fresh.
   - Upgrade path: install over the previous build → library intact; play once → delete now cleans native saves (sha1 backfilled).
