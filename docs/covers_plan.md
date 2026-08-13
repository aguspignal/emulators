# Covers plan: box art from the libretro CDN, DS banner icons, poster grid

Status: **implemented** (2026-08-13).

## Context

The library was text-only: `RomListItem` rendered a title, `console · size`, and a last-played caption, and `roms` had no image column. The only images anywhere were savestate thumbnails in `state-thumbs/`.

Covers come from the **libretro thumbnail CDN** (`thumbnails.libretro.com`), the same static host RetroArch uses. It is not an API — there is no search endpoint, so a cover can only be fetched if the exact canonical filename is already known. **The whole problem is identification, not retrieval.**

**Product decisions:** box art for every console, from the CDN · DS banner icons as a fallback where the CDN has nothing · 3DS SMDH extraction **out of scope** (retail dumps are encrypted; the icon sits in the CXI's ExeFS behind AES-CTR) · Home becomes a poster grid · lookup runs at import and as a background sweep, with no manual per-ROM action and no user-supplied images.

## Design decisions

- **Identification is offline and exact.** A bundled MD5 → canonical-name table per console, generated from libretro-database's No-Intro DATs, keyed by the `content_md5` that `import.ts` already computes before copying. Verified end-to-end: an index name resolves to a real CDN URL (`Pokemon - Emerald Version (USA, Europe)` → HTTP 200).
- **A URL is only ever built from an index entry.** This is the load-bearing rule. Resolving a *user's filename* straight to a URL produces confident wrong answers — `Pokemon Ruby.gba` is not `Pokemon - Ruby Version (USA)`, and matching loose enough to bridge that is loose enough to put Ruby's box on Sapphire — plus unbounded 404 traffic. A ROM that resolves to nothing is `missing` with **zero network calls**.
- **The fallback ladder is conservative by construction**: exact MD5, then exact equality on a *normalized* title (lowercase, parentheticals and brackets stripped, punctuation removed) against names already in the index. Normalized keys that collide onto two different canonical names are **dropped from the map entirely** — there is no principled way to pick between the `(USA, Europe)` and `(Japan)` dumps, and picking arbitrarily is how wrong art ships.
- **Every index the app bundles is searched, not just the row's `console_id`.** That column comes from the file extension at import and is only authoritative after the core has read the header once, so a Game Boy Color dump named `.gb` sits at `console_id: 'gb'`. MD5 is globally unique, so searching all of them is safe, and the *matching* index decides the system folder — self-correcting rather than tripping over the mismatch.
- **DS icons are parsed in pure TypeScript**, not through the core contract. A contract change would force edits to all three Kotlin modules in the same commit plus a native rebuild; `FileHandle` random-access reads make it unnecessary. The whole feature ships over Fast Refresh.
- **Icon vs. box art are recorded separately** (`cover_source`) and rendered differently. A 32×32 icon stretched to fill a poster tile is mush.
- **Every tile takes its own cover's shape.** Measuring 40 covers per console showed there is no common aspect to letterbox into: DS clusters at 1.111 (p10–p90 1.103–1.125) and 3DS at 1.130, but the Game Boy family runs 0.64 to 1.65 — the scans mix square cart shots, wide long-boxes and tall boxes. So `cover_ratio` stores each image's real width/height and the tile uses exactly that; a placeholder or an icon falls back to `COVER_ASPECT`, the measured per-console median. Rows top-align, since tiles in one row now differ in height.

## Schema (v3, v4)

```sql
-- v3
ALTER TABLE roms ADD COLUMN cover_file       TEXT;
ALTER TABLE roms ADD COLUMN cover_source     TEXT;
ALTER TABLE roms ADD COLUMN cover_state      TEXT    NOT NULL DEFAULT 'pending';
ALTER TABLE roms ADD COLUMN cover_checked_at INTEGER;
ALTER TABLE roms ADD COLUMN cover_attempts   INTEGER NOT NULL DEFAULT 0;
-- v4
ALTER TABLE roms ADD COLUMN cover_ratio      REAL;
```

Covers fetched before v4 are measured from the files already on disk by `backfillCoverRatios` at the top of a sweep — a 24-byte IHDR read each, no re-download. A cover whose file has vanished gets the console default written so the backfill converges; the tile's `onError` is what re-queues it.

The `NOT NULL DEFAULT` backfills every existing row to `'pending'`, which is exactly what makes the first sweep pick up a library that predates the column.

| State | Meaning | Retried? |
|---|---|---|
| `pending` | Never attempted, or reset. | Immediately. |
| `ok` | `cover_file` is set and on disk. | No. |
| `missing` | Every source was asked and none had art. Durable. | Only after 30 days, or by a migration block. |
| `failed` | Transient — network, timeout, IO, size cap. | Exponential backoff, 30s doubling to a 6h ceiling. |

**`cover_attempts` is a backoff exponent, not a give-up counter.** Nothing here can distinguish "offline" from "the CDN is down" from "this file is broken", so a cap would turn one flight in airplane mode into a permanently coverless library. The 6h ceiling bounds a broken row to ~4 requests/day, and a **circuit breaker** (3 consecutive failures ends the run) bounds one offline session to 3 requests rather than 24.

**Regenerating the index requires a migration block** resetting `missing` rows to `pending`, or existing installs keep the old verdict forever. Documented in `schema.ts` next to the migration rule.

## Layout

- `scripts/build-cover-index.mjs` — committed generator, zero dependencies. Fetches five DATs from libretro-database (not a submodule: that repo is enormous and this needs five text files), pairs each `game ( name … )` with its `rom ( … md5 … )`, lowercases and truncates the hash to 12 hex chars, and **throws on a truncation collision** rather than silently dropping a row.
- `apps/*/assets/covers/<console>.ts` — generated, committed. Each is `export const SOURCE = '<md5> <name>\n…'`: **one string literal, not JSON**. Metro turns `.json` into an object literal Hermes must construct eagerly at require time; a string constant lives in the string table and materializes lazily. ~475KB across the GBA app's three consoles, ~464KB for DS, ~128KB for 3DS.
- `packages/storage/src/coverIndex.ts` — parses a `SOURCE` into `byMd5` / `byName` maps once, memoized in a `WeakMap` keyed by the index object.
- `packages/storage/src/covers.ts` — system folders, name sanitization, URL building, the resolver, `ensureCover`, `sweepCovers`.
- `packages/storage/src/ndsBanner.ts` — the banner reader and `decodeNdsIcon`.
- `packages/storage/src/png.ts` — the encoder.
- `packages/ui/src/components/posterGrid.ts` / `RomTile.tsx` — pure grid maths and the tile.
- `packages/ui/src/storage/useCoverSweep.ts` — the React binding.

## URL construction

```
https://thumbnails.libretro.com/<System>/Named_Boxarts/<Name>.png
```

System folders are `Nintendo - Game Boy`, `… Game Boy Color`, `… Game Boy Advance`, `… Nintendo DS`, `… Nintendo 3DS` — the same strings as the DAT basenames. Per libretro's documented rule the characters ``&*/:`<>?\|"`` become `_`, then both the folder and the name are percent-encoded.

## DS banner icons

Offsets per GBATEK. A DS ROM runs to 512MB and this needs ~600 bytes of it, so `file.open()` → `FileHandle` with a settable `offset` is a requirement, not an optimisation.

| Field | Offset | Size |
|---|---|---|
| Banner offset | header + `0x068` | 4 (u32 LE) |
| Version | banner + `0x000` | 2 |
| Icon bitmap | banner + `0x020` | `0x200` |
| Icon palette | banner + `0x220` | `0x20` |

32×32 at 4bpp as a 4×4 grid of 8×8 tiles, four bytes per tile row, **low nibble is the left pixel**. Palette is 16 × BGR555; **index 0 is transparent**, not black — filling it black boxes every icon in a hard rectangle.

Icons are encoded at **4× nearest-neighbour (128×128)**. Android smooths on upscale with no nearest-neighbour option, so a 32×32 source in a 64dp box on a 3× screen is a blur; emitting 4× means the platform scales *down* instead.

## PNG encoding

Hand-rolled, ~180 lines, no dependency: CRC32, adler32, chunk framing, and a zlib stream of **stored** (uncompressed) deflate blocks. That is legal PNG and costs nothing worth having for a 16-colour icon. BMP would be less code but React Native's Android pipeline supports it inconsistently, and the failure mode is a silently blank tile.

Every accumulator is coerced with `>>> 0` before it is written — JS bitwise operators are 32-bit *signed*, and a negative CRC written through a shift yields a file desktop viewers accept and Android silently rejects. At 4× the raw stream is 65,664 bytes, 129 over the stored-block limit, so the multi-block path is genuinely exercised.

Verified in Node: chunk CRCs match an independent implementation, `zlib.inflateSync` accepts the stream (validating both block framing and the adler32), and pixels round-trip exactly including the scale.

## The sweep

`useCoverSweep(onChanged)` runs on Home focus, on import, and on pull-to-refresh (which first clears the backoff via `retryFailedCovers`).

- **Candidates come from the database, never from the `roms` array.** That decoupling is what makes it safe to pair with `onChanged`: a list re-render cannot re-trigger the sweep.
- Guards: an in-flight ref, a `LIMIT 24` per pass, and an `AbortController` cancelled on blur — aborting rather than flagging, because unlike a query there is real in-flight work to stop.
- **An external abort records nothing.** Navigating into a game mid-download must not burn an attempt and inflate the backoff for a row that never got a chance.
- `onChanged` fires **once per run and only if something changed**. Per-ROM would be 24 queries and 24 re-renders of a grid full of images.
- Ordered by the same key as `listRoms`, so the sweep fills the top of the visible grid first.

## Failure handling

Downloads go to `<name>.part` and are renamed into place. Android streams straight into the destination, so without this a mid-flight failure leaves a truncated file that looks like a real cover; `sweepPartialCovers()` clears strays at the top of each run. A non-2xx rejects with the status in the message, and `404` is classified `missing` — fragile string matching, but tolerable precisely because only names known to be in the index are ever requested.

Covers larger than 3MB are aborted and recorded `missing`. `RomTile` self-heals an `ok` row whose file has vanished by calling `resetRomCover` from `<Image onError>` — once per session, and deliberately **without** reloading the list, since that re-renders the image and errors again.

Deleting a ROM now cleans up **five** things; `deleteCoversForRom` sweeps by the `${romId}-` prefix (trailing dash deliberate, or ROM 1 eats ROM 12's files) and catches `.part` strays too.

## Deferred

- **3DS SMDH icons.** Needs AES-CTR over the CXI ExeFS plus key material. Nothing here precludes it: `cover_source` already distinguishes icons, and the fallback hook in `ensureCover` is one `console_id` check.
- **Android auto-backup.** `allowBackup="true"` with no exclusion rules means `Paths.document` is in the 25MB backup set. Covers are a rounding error next to the ROM files already there (16–512MB each), so this is a **pre-existing** whole-app backup-policy question, not a covers one — excluding only `covers/` would be theatre. Worth deciding separately for `roms/`, `covers/`, and `state-thumbs/` together.
- User-supplied cover images, a manual per-ROM refresh, and a list/grid toggle.
