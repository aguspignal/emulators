# @emulators/storage

SQLite-backed ROM library (schema, queries, import flow) plus the on-disk ROM file management shared by the three apps. See the root CLAUDE.md for the monorepo picture.

**No React, no react-navigation, never import from `packages/ui`.** Pure data + filesystem, same discipline as `core-interface`. The one hook that consumes this package (`useRoms`) lives in `packages/ui` for exactly this reason. Expo native modules (`expo-sqlite`, `expo-file-system`, `expo-document-picker`) are **peerDependencies** — the apps own the SDK-pinned installed versions.

## Structure

- `src/schema.ts` — `DATABASE_NAME`, `RomRow`, `migrate()` (passed to `SQLiteProvider`'s `onInit`). Two tables: `roms` and `save_states`.
- `src/roms.ts` — queries. Plain functions taking `db` first (no hooks), so they work in effects and event handlers alike.
- `src/saveStates.ts` — one row per written savestate slot (`rom_id`, `slot`, `saved_at`, composite PK). This is metadata *about* files the core owns, never the states themselves; `upsertSaveState` is what makes a slot show as occupied.
- `src/files.ts` — the `roms/` directory, filename sanitizing/uniquing, extension↔console matching, `romFileUri`, and the `state-thumbs/` directory.
- `src/import.ts` — `pickAndImportRom`: pick → dedup by MD5 → copy into `Paths.document/roms/`. User-attributable failures throw `RomImportError`, whose `message` is user-facing copy — `@emulators/ui`'s `showErrorAlert` shows it verbatim and replaces every other error with generic text.

## Invariants

- **ROMs are copied once, at import time, into `Paths.document/roms/`.** A picked `content://` URI is a temporary ticket: it expires with the process, the underlying file can move, and C cores need a real path for `fopen()`. Without the import copy the native side re-copies into evictable `cacheDir` on *every* launch. The durable copy makes `loadRom` hit the fast `fromFile` branch.
- **Imports are de-duplicated by content MD5** (`content_md5 UNIQUE`), hashed *before* copying (`File#md5` streams a `content://` source), so a duplicate costs zero disk. The UNIQUE constraint is the backstop if the check races the insert; the import's `catch` deletes the copied file so a constraint failure can't strand an orphan (that cleanup is itself guarded so it can never mask the original error).
- **The DB stores relative `file_name` only.** Absolute `file://` URIs exist only at runtime via `romFileUri()` — the app-data prefix isn't stable across backup restore / user profiles.
- **`sanitizeFileName` keeps names ASCII** so `Paths.join` never percent-encodes and Kotlin's `Uri.parse(uri).path` is exact. Do not drop it.
- **`header_title` holds real ROM-header titles only.** When the header is blank the native side falls back to the filename stem; `applyRomInfo` detects that case (title === stem of `file_name`) and keeps the column `NULL`. Display always uses `display_name`.
- **Migrations**: add a new `if (version < N)` block per change in `migrate()`, never edit an existing one. No index on `roms`, deliberately — the list sort (`COALESCE(last_played_at, added_at)`) can't use one and the table stays small; `save_states` needs none beyond its composite primary key.
- **`roms.sha1` is the core's handle, not ours.** It arrives from `RomInfo` and is written by `applyRomInfo` on every play, so it backfills itself on databases created before v2. A core that couldn't hash reports `''`, which `COALESCE(NULLIF(?, ''), sha1)` discards rather than overwriting a hash we already had. Null means "never played since v2", so no saves exist to clean up either way.
- **Savestate thumbnails are `state-thumbs/<romId>-<slot>-<savedAt>.png`.** The timestamp is in the filename because React Native caches images by URI — reusing a name would keep showing the previous frame. Writing a slot therefore means: capture to the new name, upsert the row, then delete the old name.
- **Deleting a ROM must clean up four things**: the row, the ROM file, its `save_states` rows plus thumbnails, and — through `core.deleteSaveData(sha1)` — the core's own battery save and states. `HomeScreen` does this row-first, everything-else-after, so a partial failure leaves orphans rather than an entry pointing at nothing.

## Deferred

- Battery-save import/export (bringing a `.sav` from another device, or backing one up). Needs contract surface for handing `.sav` bytes in and out; nothing here precludes it.
