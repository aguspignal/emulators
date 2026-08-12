# SQLite storage + ROM picker + ROM library

> Implementation plan. Not yet executed.

## Context

`HomeScreen` is a placeholder and nothing in the app can open a ROM, so the freshly-integrated mGBA core has never actually run a game. The blocker isn't the core — it's that the app has no way to *name* a ROM. `EmulatorScreen` already accepts a `romUri` route param and calls `core.loadRom(uri)`, but no screen navigates to it.

The app is offline-first by nature (no accounts, no sync, no remote catalog), so the library needs durable local state: which ROMs the user has, what they're called, which console each is, when they were last played. That's relational, queryable, and must survive restarts — SQLite via `expo-sqlite`.

Outcome: a Home screen listing the user's ROMs, an "Add ROM" flow that imports from device storage, and a tap that boots the game.

---

## Why the app must copy the ROM file (plain version)

When you pick a file through Android's file picker, the app doesn't get the file. It gets a **temporary ticket** (a `content://` URI) that says "you may read this file, for now." Three things go wrong if we just save the ticket:

1. **The ticket expires.** It's valid until the app process dies. Save it in the database, restart the app, and it throws a permissions error.
2. **The file can move.** The user clears Downloads, renames the file, or moves it to the SD card — the library entry now points at nothing.
3. **A ticket is not a file path.** mGBA is C code that calls `fopen()`, which needs a real path. It can't use a ticket. So the Kotlin layer already works around this by copying the ROM into a scratch folder — and looking at [RomFiles.kt:61-87](../apps/gba/modules/mgba-core/android/src/main/java/expo/modules/mgbacore/RomFiles.kt#L61-L87), it does that **every single time you launch the game**, into `cacheDir`, which Android is free to delete whenever storage runs low.

So the choice isn't "copy vs. don't copy" — the copy is already happening, just repeatedly and into a folder that evaporates.

Copying once at import time fixes all three: we own a real file at a real path that nothing else can move, `loadRom` takes the fast [`fromFile`](../apps/gba/modules/mgba-core/android/src/main/java/expo/modules/mgbacore/RomFiles.kt#L49-L55) branch (one read, zero writes), and uninstalling the app cleans it up.

The cost is one duplicated copy per ROM. **Which is exactly why import is de-duplicated by content hash** — see below. Pick the same ROM twice, from two different folders, under two different filenames, and you still get one copy on disk and one row in the library.

---

## Decisions

| Decision | Choice |
|---|---|
| Storage location | New workspace `packages/storage` (`@emulators/storage`) |
| Data layer | Raw `expo-sqlite` — no Drizzle (it needs `drizzle-kit` codegen + a custom `metro.config.js`, and root CLAUDE.md notes there are none) |
| ROM files | Copied into `Paths.document/roms/` for **every** console |
| DB path storage | Relative `file_name` only — the `file://` URI is derived from `Paths.document` at read time (`romFileUri`). An absolute-URI column would duplicate `file_name` and bake in the app-data prefix, which isn't stable across backup restore / user profiles |
| De-duplication | MD5 of the picked file, `content_md5 TEXT NOT NULL UNIQUE`; hash computed *before* copying so a duplicate costs zero disk |
| ROM SHA-1 | Deferred. Native computes it and keys saves by it, but never exposes it to JS. Not needed for the library to work; adding it to `RomInfo` costs 3 Kotlin + 3 TS-wrapper edits |
| Savestates table | Deferred to migration v2, once `RomInfo` carries the SHA-1 |

New dependency direction: `apps/*` → `@emulators/ui` → `@emulators/storage` → `@emulators/core-interface`.

### Verified against `node_modules` (not assumed)

- `expo-file-system` 57.0.2 — new object API at `expo-file-system` (legacy at `/legacy`). `Paths.document`/`Paths.cache` are `Directory` instances; `Paths.availableDiskSpace` exists.
- `File#copy(dest, opts?): Promise<void>` is **async**; `File#delete()` / `Directory#create()` are **sync**.
- `File#md5` streams via `file.inputStream()` (`FileSystemFile.kt:159-171`), and `ContentProviderFile.inputStream()` is `contentResolver.openInputStream(uri)` — so **MD5 works directly on a `content://` URI**, before any copy. This is what makes zero-cost dedup possible. The JS property is **`string | null`**, not `string`: the module-level getter swallows read errors and returns null (`FileSystemModule.kt:235-241`), so import must null-check it.
- `content://` → `file://` copy works (`fsops/Utilities.kt: copyFileViaStream`).
- SDK 57 pinned versions from `node_modules/expo/bundledNativeModules.json`: `expo-sqlite ~57.0.1`, `expo-file-system ~57.0.2`, `expo-document-picker ~57.0.1`.
- `File#name` is only `Paths.basename(uri)` — useless for a Downloads pick (`msf:1000000123`). **This is why the picker is `expo-document-picker`**, whose `asset.name` is the real `OpenableColumns.DISPLAY_NAME`; we need the true filename to read the extension and pick the console.

---

## Implementation

### 1. Dependencies

```
cd apps/gba   && npx expo install expo-sqlite expo-file-system expo-document-picker
cd ../nds     && npx expo install expo-sqlite expo-file-system expo-document-picker
cd ../threeds && npx expo install expo-sqlite expo-file-system expo-document-picker
cd ../..      && npm install
```

Declaring `expo-file-system` explicitly hoists it out of `node_modules/expo/node_modules/` so `packages/*` can resolve its types. No config plugins, no new manifest permissions.

### 2. New workspace `packages/storage`

Mirror `packages/core-interface`'s shape: `main`/`types` → `src/index.ts`, a `typecheck` script (root `npm run typecheck` runs every workspace), `tsconfig.json` extending `../../tsconfig.base.json` with `include: ["src"]`.

```json
{
  "name": "@emulators/storage",
  "main": "src/index.ts",
  "dependencies": { "@emulators/core-interface": "*" },
  "peerDependencies": {
    "expo-sqlite": "*", "expo-file-system": "*", "expo-document-picker": "*"
  }
}
```

**No React, no react-navigation, no `@emulators/ui`.** Pure data + filesystem, same discipline as `core-interface`. The one hook (`useRoms`) lives in `packages/ui` for this reason.

Add `packages/storage/CLAUDE.md` covering: peerDep rule, the copy-on-import rationale, the dedup invariant, the relative-`file_name`-only rule (absolute URIs exist only at runtime via `romFileUri`), the `header_title` fallback guard, and "never import React or from `packages/ui`".

### 3. `packages/storage/src/schema.ts`

```ts
export const DATABASE_NAME = 'emulators.db';

export interface RomRow {
  id: number;
  file_name: string;       // sanitized basename on disk, UNIQUE; the file:// URI loadRom needs is derived at runtime via romFileUri()
  display_name: string;    // picked filename without extension; what the library displays
  header_title: string | null;  // real ROM-header title only; null until first load, and kept null when the core fell back to the filename stem
  console_id: string;      // ConsoleId. Provisional (from extension) until the core reports it
  extension: string;
  size: number;
  content_md5: string;     // dedup key
  added_at: number;
  last_played_at: number | null;
  play_count: number;
  favorite: number;        // 0 | 1
}

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  if (version < 1) {
    await db.execAsync(`
      CREATE TABLE roms (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name      TEXT    NOT NULL UNIQUE,
        display_name   TEXT    NOT NULL,
        header_title   TEXT,
        console_id     TEXT    NOT NULL,
        extension      TEXT    NOT NULL,
        size           INTEGER NOT NULL DEFAULT 0,
        content_md5    TEXT    NOT NULL UNIQUE,
        added_at       INTEGER NOT NULL,
        last_played_at INTEGER,
        play_count     INTEGER NOT NULL DEFAULT 0,
        favorite       INTEGER NOT NULL DEFAULT 0
      );
    `);
    version = 1;
  }
  // v2 (deferred): ALTER TABLE roms ADD COLUMN sha1 TEXT; + save_states, once RomInfo exposes the SHA-1.

  await db.execAsync(`PRAGMA user_version = ${version}`); // PRAGMA can't be parameterised; local int only
}
```

Migration rule to document: add a new `if (version < N)` block per change, **never edit an existing one**.

No index on `roms`, deliberately: the list query sorts by `COALESCE(last_played_at, added_at)`, which an index on the raw columns can't serve (SQLite full-scans and sorts either way), and the table is a few hundred rows at most. Don't re-add one.

### 4. `packages/storage/src/roms.ts` — queries

Plain functions taking `db` first (no hooks), so they work in effects and event handlers alike:

- `listRoms(db)` — `ORDER BY favorite DESC, COALESCE(last_played_at, added_at) DESC, id DESC`
- `getRom(db, id)`, `findRomByMd5(db, md5)` — the dedup lookup
- `insertRom(db, NewRom)` → `lastInsertRowId`
- `applyRomInfo(db, id, info: RomInfo)` — writes `header_title`, authoritative `console_id`, `size`, bumps `last_played_at` + `play_count`. **Fallback guard:** when the ROM header has no title, the native side substitutes the on-disk filename stem ([RomFiles.kt:54](../apps/gba/modules/mgba-core/android/src/main/java/expo/modules/mgbacore/RomFiles.kt#L54) `fallbackTitle`) — which by then is the sanitized/`_2`-suffixed name. `RomInfo.title` can't distinguish the two, so store `header_title` only if `info.title !== stripExtension(row.file_name)`; otherwise keep it `NULL`
- `setFavorite(db, id, boolean)`, `deleteRomRow(db, id)`

### 5. `packages/storage/src/files.ts` — disk

- `romsDirectory(): Directory` — `new Directory(Paths.document, 'roms')`, `create({ intermediates: true, idempotent: true })` if missing
- `sanitizeFileName(name)` — `[^A-Za-z0-9._-]+` → `_`, capped at 120 chars. Keeps names ASCII so `Paths.join` never percent-encodes and Kotlin's `Uri.parse(uri).path` is exact. **Do not drop this.**
- `extensionOf(name)`, `stripExtension(name)`
- `consoleForExtension(consoles, ext)` — matches `ConsoleSpec.romExtensions` from `@emulators/core-interface`; `acceptedExtensions(consoles)` for error text and the empty state
- `uniqueFileName(dir, name)` — `Game.gba` → `Game_2.gba` if taken (different ROM, same filename)
- `romFileUri(fileName)` — `new File(romsDirectory(), fileName).uri`. The single place an absolute ROM path exists; the DB stores only `file_name`
- `deleteRomFile(fileName)`

### 6. `packages/storage/src/import.ts` — pick, dedup, copy

```ts
export type RomImportResult =
  | { status: 'cancelled' }
  | { status: 'duplicate'; id: number; displayName: string }
  | { status: 'imported'; id: number };

export async function pickAndImportRom(db, consoles: ConsoleSpec[]): Promise<RomImportResult> {
  // .gba/.nds/.3ds have no registered MIME type -> must accept everything and filter ourselves.
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*', copyToCacheDirectory: false, multiple: false,
  });
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets?.[0];
  if (!asset) return { status: 'cancelled' };

  const extension = extensionOf(asset.name);
  const spec = consoleForExtension(consoles, extension);
  if (!spec) throw new RomImportError(`"${asset.name}" isn't a supported ROM. Expected: ...`);

  const source = new File(asset.uri);

  // Dedup BEFORE copying: hashing streams the source, it never writes.
  // Catches the same ROM re-picked from another folder or under another name.
  const md5 = source.md5;   // string | null — the native getter swallows read errors
  if (!md5) throw new RomImportError(`Couldn't read "${asset.name}".`);
  const existing = await findRomByMd5(db, md5);
  if (existing) return { status: 'duplicate', id: existing.id, displayName: existing.display_name };

  const size = asset.size ?? source.size ?? 0;
  if (size > Paths.availableDiskSpace) throw new RomImportError('Not enough free space...');

  const dir = romsDirectory();
  const fileName = uniqueFileName(dir, sanitizeFileName(asset.name));
  const destination = new File(dir, fileName);
  await source.copy(destination);            // async; content:// -> file:// stream copy

  let id: number;
  try {
    id = await insertRom(db, {
      file_name: fileName,
      display_name: stripExtension(asset.name),
      console_id: spec.id, extension, size, content_md5: md5,
    });
  } catch (e) {
    destination.delete();   // don't strand an orphan copy the library can't see
    throw e;
  }
  return { status: 'imported', id };
}
```

`content_md5 UNIQUE` is the backstop if the check ever races the insert — and the `catch` above deletes the already-copied file when it fires, so a constraint failure can't leave an orphan in `roms/`.

### 7. `packages/ui` changes

**`package.json`** — add `@emulators/storage: "*"` to `dependencies`, `expo-sqlite: "*"` to `peerDependencies` (AppRoot and HomeScreen use `SQLiteProvider` / `useSQLiteContext` directly).

**`CLAUDE.md`** — amend *"The only regular dependency allowed is `@emulators/core-interface`"* to also allow `@emulators/storage`, and state that Expo native modules shared UI needs are peerDependencies for the same reason React and navigation are: the apps own the SDK-pinned versions, and adding one means `npx expo install` in all three apps plus a rebuild (autolinking only sees an app's own `node_modules`).

**`src/AppRoot.tsx`** — `SQLiteProvider` inside `SafeAreaProvider`, wrapping `AppConfigProvider`:

```tsx
<SafeAreaProvider>
  <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate} onError={...}>
    <AppConfigProvider config={config}>  {/* …unchanged from here */}
```
No `useSuspense`, so no error boundary is required; the provider renders nothing for the few ms the DB takes to open, imperceptible on the dark background.

**`src/storage/useRoms.ts`** (new) — `useSQLiteContext()` + `useFocusEffect` re-query, returning `{ roms, loading, reload }`. Lives here, not in `packages/storage`, so that package stays React-free.

**`src/navigation/types.ts`** — `Emulator: { romId: number; romUri: string }`. Nothing navigates there yet, so no call sites break.

**`src/screens/EmulatorScreen.tsx`** — keep the existing load/start/unload effect, add `useSQLiteContext()` and chain `applyRomInfo(db, romId, info)` onto the resolved `loadRom`. This is what reconciles the guess: the picker can only infer `gb` vs `gbc` from the extension, while the core reads ROM header byte `0x143`. Add a `.catch` that alerts and `goBack()`s — currently a bad ROM fails silently.

**`src/screens/HomeScreen.tsx`** (rewrite) — `FlatList` of `RomListItem`, `ListEmptyComponent` = `EmptyLibrary`, `RefreshControl` → `reload`, header-right `+` calling the import. Tap a row → `navigate('Emulator', { romId: rom.id, romUri: romFileUri(rom.file_name) })` — the absolute URI is derived at tap time, never persisted. Handle all three `RomImportResult` cases; `duplicate` shows *"<name> is already in your library."* rather than an error. Long-press → `Alert` with Favorite / Delete (delete removes file **and** row).

Comment to leave in the delete handler: deleting a ROM does **not** remove its battery save or savestates under `filesDir/mgba/{saves,states}/<sha1>.*`, because JS has no access to the SHA-1. Resolved by the deferred `RomInfo.sha1` change.

**`src/components/`** (new) — `RomListItem` (title = `display_name` — the picked filename beats header titles, which are all-caps internal codes like `POKEMON RED`; `header_title` stays stored for future search/matching, never for display — subtitle `${consoleName} · ${formatBytes(size)}`, right = last played, `colors.primary` accent bar when favorited), `PrimaryButton`, `EmptyLibrary`.

**`src/utils/format.ts`** (new) — `formatBytes`, `formatLastPlayed`. No new deps.

**`src/theme/index.ts`** — add `colors.danger` and a `radius` scale.

**`src/index.ts`** — re-export the new components and `useRoms`, and `export * from '@emulators/storage'` so apps have one import surface.

### 8. Docs

Root `CLAUDE.md`: update the dependency-direction line to include `@emulators/storage`, add the new package to Layout, add an architecture rule ("persistent state lives in SQLite in `packages/storage`; ROM files are copied into `Paths.document/roms/` at import so the native core gets a real `file://` path, imports are de-duplicated by content MD5, and the DB stores relative filenames only — absolute URIs are derived at read time"), and update the roadmap — ROM library done, gamepad overlay + savestate UI remain.

---

## Verification

```
npm run typecheck                 # from root; covers the new workspace too
npm run android:gba               # JAVA_HOME -> JDK 21. Native modules; Fast Refresh is not enough.
```

If `packages/*` can't resolve `expo-sqlite`/`expo-file-system` types, the hoist didn't happen — re-run `npm install` from root and confirm `node_modules/expo-file-system` exists at the **root**, not only under `node_modules/expo/`.

On device:

1. App opens on an empty library: "No ROMs yet", accepted extensions `.gba, .gbc, .gb`, an Add ROM button, `+` in the header.
2. **Add ROM** → picker shows all file types (correct — `.gba` has no MIME type). Pick the downloaded ROM. Row appears: filename-without-extension, `Game Boy Advance · <size>`, `Never played`.
3. **Dedup check:** Add ROM again, same file → *"… is already in your library."* No second row. Then copy the ROM to another folder, rename it, and import that → still refused, still one row. This is the whole point of `content_md5`.
4. Tap the row → landscape, mGBA boots, BIOS/boot logo animates.
5. Back → Home. Right side now reads `Today`; the subtitle's console may change to the header-derived value (a `.gb` that is really GBC). The title must **not** change — `display_name` always wins for display. That round-trip proves both the SQLite write and the console reconciliation.
6. Long-press → Favorite (jumps to top, red accent) / Delete (row and file both gone).
7. Kill and relaunch → library intact, `last_played_at` preserved. This is what a `content://` URI could not have done.
8. **Durability check:** `adb shell run-as com.aguspignal.gba ls -l files/roms` lists the sanitized filename, and `ls cache/roms` fails with *No such file or directory* — that directory is only ever created by the `content://` branch ([RomFiles.kt:63](../apps/gba/modules/mgba-core/android/src/main/java/expo/modules/mgbacore/RomFiles.kt#L63)), so its absence proves `RomFiles.resolve` took the `fromFile` branch and never made a cache copy.
9. Negative: pick a `.txt` → *"isn't a supported ROM. Expected: .gba, .gbc, .gb"*, nothing inserted.
10. Optionally `npm run android:nds` — builds, empty library accepts only `.nds`, rejects a `.gba`. Confirms the shared code is app-agnostic via `useAppConfig().consoles`.

---

## Open questions (confirm at implementation time, don't guess)

1. **`expo-sqlite` 57 API — not verified on disk** (package absent until installed). Assumed `SQLiteProvider({ databaseName, onInit, onError })`, `useSQLiteContext()`, `execAsync`, `runAsync → { lastInsertRowId, changes }`, `getAllAsync<T>`, `getFirstAsync<T>`. After install, read `node_modules/expo-sqlite/build/index.d.ts` and confirm: `onInit` is `(db) => Promise<void>`; **what `SQLiteProvider` renders while opening** — if it renders children eagerly, `useSQLiteContext()` throws and a Suspense boundary becomes mandatory; and that `getFirstAsync('PRAGMA user_version')` returns `{ user_version: n }`.
2. **`expo-document-picker` 57 API — not verified on disk.** Assumed `getDocumentAsync({ type, copyToCacheDirectory, multiple })` → `{ canceled, assets: [{ uri, name, size?, mimeType? }] | null }`. Confirm `type: '*/*'` is accepted as a string (vs an array), and that `copyToCacheDirectory: false` yields a readable `content://` URI. Fallback if not: `true` + `source.move(destination)` — a same-volume rename, no extra disk cost.
3. **`File#md5` on a large file blocks.** It streams the whole ROM on the JS thread's native call. Fine for 32 MB GBA; if a future NDS/3DS import janks the UI, move the hash behind the existing `importing` spinner state (already in the design) or revisit.
4. **`RomInfo.sha1` deferral** becomes blocking before: deleting a ROM's saves, showing savestate slots, or dedup-by-native-hash. Cost: 1 edit in `packages/core-interface/src/types.ts` + 3 Kotlin + 3 TS wrappers, plus migration v2 to backfill.
