# @emulators/storage

SQLite-backed ROM library (schema, queries, import flow) plus the on-disk ROM file management shared by the three apps. See the root CLAUDE.md for the monorepo picture.

**No React, no react-navigation, never import from `packages/ui`.** Pure data + filesystem, same discipline as `core-interface`. The one hook that consumes this package (`useRoms`) lives in `packages/ui` for exactly this reason. Expo native modules (`expo-sqlite`, `expo-file-system`, `expo-document-picker`) are **peerDependencies** — the apps own the SDK-pinned installed versions.

## Structure

- `src/schema.ts` — `DATABASE_NAME`, `RomRow`, `migrate()` (passed to `SQLiteProvider`'s `onInit`).
- `src/roms.ts` — queries. Plain functions taking `db` first (no hooks), so they work in effects and event handlers alike.
- `src/files.ts` — the `roms/` directory, filename sanitizing/uniquing, extension↔console matching, `romFileUri`.
- `src/import.ts` — `pickAndImportRom`: pick → dedup by MD5 → copy into `Paths.document/roms/`.

## Invariants

- **ROMs are copied once, at import time, into `Paths.document/roms/`.** A picked `content://` URI is a temporary ticket: it expires with the process, the underlying file can move, and C cores need a real path for `fopen()`. Without the import copy the native side re-copies into evictable `cacheDir` on *every* launch. The durable copy makes `loadRom` hit the fast `fromFile` branch.
- **Imports are de-duplicated by content MD5** (`content_md5 UNIQUE`), hashed *before* copying (`File#md5` streams a `content://` source), so a duplicate costs zero disk. The UNIQUE constraint is the backstop if the check races the insert; the import's `catch` deletes the copied file so a constraint failure can't strand an orphan.
- **The DB stores relative `file_name` only.** Absolute `file://` URIs exist only at runtime via `romFileUri()` — the app-data prefix isn't stable across backup restore / user profiles.
- **`sanitizeFileName` keeps names ASCII** so `Paths.join` never percent-encodes and Kotlin's `Uri.parse(uri).path` is exact. Do not drop it.
- **`header_title` holds real ROM-header titles only.** When the header is blank the native side falls back to the filename stem; `applyRomInfo` detects that case (title === stem of `file_name`) and keeps the column `NULL`. Display always uses `display_name`.
- **Migrations**: add a new `if (version < N)` block per change in `migrate()`, never edit an existing one. No index on `roms`, deliberately — the list sort (`COALESCE(last_played_at, added_at)`) can't use one and the table stays small.

## Deferred

- `RomInfo.sha1` is not exposed to JS yet, so deleting a ROM cannot delete its battery save/savestates under `filesDir/mgba/{saves,states}/<sha1>.*`. Blocking for savestate UI; costs 1 `core-interface` edit + 3 Kotlin + 3 TS wrappers + migration v2.
- `save_states` table → migration v2, once `RomInfo` carries the SHA-1.
