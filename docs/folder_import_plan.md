# Import every ROM in a folder

## Context

Today the Home screen imports one ROM at a time. `pickAndImportRom` opens the
system file picker, takes a single file, and copies it into the library. A user
with 90 games has to repeat that 90 times.

The goal: let the user pick a **folder** and import every ROM inside it,
including ROMs in subfolders. The single-file flow stays, because picking one
game out of Downloads should not require choosing its whole folder.

Decisions already made:

- Keep both entry points. The "Add ROM" button asks first: one file, or a folder.
- Walk subfolders to any depth.
- Show a blocking progress overlay while the batch runs. No cancel button. Show
  one summary alert at the end.

## What the platform gives us

`expo-file-system` 57 already ships everything needed. No new dependency, no
native rebuild.

- `Directory.pickDirectoryAsync()` opens Android's folder picker (the system
  screen where the user grants access to one folder). It resolves to a
  `Directory`. Its URI is a `content://` tree URI — Android's handle for a
  granted folder, not a real path.
- `directory.list()` returns the children as `File` and `Directory` objects, and
  works on those tree URIs.
- `file.name` is derived by decoding the URI, so it gives back the real
  filename (`Pokemon Red.gb`) for the storage providers that matter.
- `file.md5`, `file.size` and `file.copy(destination)` already work on
  `content://` sources — `packages/storage/src/import.ts` lines 69-98 do exactly
  that today with the file picker's URI.

Two behaviours to code against:

- `pickDirectoryAsync()` **rejects** when the user backs out. The error code is
  `ERR_PICKER_CANCELLED`. Catch that one code and report a cancel; rethrow
  anything else.
- `file.md5` is a synchronous native call. Hashing 90 files back to back would
  freeze the UI thread, so the batch loop must pause for a tick between files.

## Plan

### 1. Split the per-file work out of `pickAndImportRom`

File: `packages/storage/src/import.ts`

Extract a private helper that handles exactly one file and **never throws**:

```ts
type RomFileOutcome =
  | { status: 'imported'; id: number }
  | { status: 'duplicate'; id: number; displayName: string }
  | { status: 'unsupported' }   // extension we do not emulate
  | { status: 'unreadable' }    // md5 came back null
  | { status: 'no_space' }
  | { status: 'failed'; error: unknown };  // copy or SQLite failure

async function importRomFile(
  db: SQLiteDatabase,
  consoles: ConsoleSpec[],
  source: File,
  name: string,
  size: number
): Promise<RomFileOutcome>
```

Move the existing body into it unchanged: extension check → console match →
`md5` → `findRomByMd5` → free-space check → `uniqueFileName` +
`sanitizeFileName` → `copy` → `insertRom`, with the same guarded delete of the
copied file when the insert fails.

Keep the per-file free-space check as it is. It reads
`Paths.availableDiskSpace` fresh each time, which stays correct across a batch
because each earlier file is already on disk.

`pickAndImportRom` keeps its current signature and behaviour. It calls the
helper, then converts the failure outcomes back into the `RomImportError`
throws it raises today, so `packages/ui/src/utils/errors.ts` and the `import.*`
catalog keys keep working untouched.

### 2. Add `pickAndImportFolder`

Same file. New public function:

```ts
export interface FolderImportProgress {
  done: number;
  total: number;
  currentName: string;
}

export type FolderImportResult =
  | { status: 'cancelled' }
  | {
      status: 'done';
      imported: number;
      duplicates: number;
      skipped: number;   // not a ROM we support
      failed: number;    // unreadable, no space, copy or DB error
    };

export async function pickAndImportFolder(
  db: SQLiteDatabase,
  consoles: ConsoleSpec[],
  onProgress?: (progress: FolderImportProgress) => void
): Promise<FolderImportResult>
```

Steps:

1. `await Directory.pickDirectoryAsync()`. Catch `ERR_PICKER_CANCELLED` and
   return `{ status: 'cancelled' }`. Rethrow every other error.
2. Collect candidates with a recursive walk. A private
   `collectRomFiles(dir, consoles): File[]` calls `dir.list()`, recurses into
   each `Directory`, and keeps each `File` whose `extensionOf(file.name)`
   matches a console — reuse `extensionOf` and `consoleForExtension` from
   `packages/storage/src/files.ts`. Filtering during the walk is what makes
   `total` a real number, so the overlay can show honest progress.
   Wrap each `list()` in a try/catch: one unreadable subfolder must not kill
   the walk.
3. Loop over the candidates. Call `onProgress` before each file, run
   `importRomFile`, and add the outcome to the tally. `unsupported` counts as
   skipped; `unreadable`, `no_space` and `failed` count as failed, and `failed`
   also logs its error.
4. Yield between files with `await new Promise((r) => setTimeout(r, 0))`, so
   React can repaint the overlay between the synchronous `md5` calls.
5. Return the tally.

Export `pickAndImportFolder`, `FolderImportProgress` and `FolderImportResult`
from `packages/storage/src/index.ts` next to the existing `pickAndImportRom`
line.

### 3. Progress overlay component

New file: `packages/ui/src/components/ImportProgress.tsx`

A `Modal` with `transparent` and `animationType="fade"`, holding an
`ActivityIndicator`, a title, a `done of total` line, and the current filename
(one line, `numberOfLines={1}`). Props: `visible`, `done`, `total`,
`currentName`. Style it from `packages/ui/src/theme` like the other components —
no new colors.

Set `onRequestClose={() => {}}` so the Android back button cannot close it
mid-copy.

### 4. Wire up the Home screen

File: `packages/ui/src/screens/HomeScreen.tsx`

- Rename today's `importRom` callback to `importOneRom`. Its body does not
  change.
- Add `importFolder`, which mirrors it: set `importing`, call
  `pickAndImportFolder` with an `onProgress` that writes to a
  `FolderImportProgress | null` state, then on `done` call `await reload()`,
  `sweepCovers()`, and show the summary alert. Clear the progress state in
  `finally`, next to `setImporting(false)`.
- Add `startImport`, the new `onPress` for both the list-header button and
  `EmptyLibrary`. It shows an `Alert.alert` with three buttons: pick a file,
  pick a folder, cancel.
- Render `<ImportProgress …/>` at the end of the screen, visible while the
  progress state is not null.

Summary alert: build the body from only the non-zero counts, joined with
newlines, so a clean run says just "12 games added". When the folder held no
supported ROMs at all, show `home.importNoneFound` instead, reusing
`acceptedExtensions(consoles)` the way `EmptyLibrary` already does.

Cover art needs no change. `sweepCovers` is already bounded per pass
(`SWEEP_LIMIT = 24` in `packages/storage/src/covers.ts`), so a 90-ROM import
fills its posters over the following screen focuses.

### 5. Translations

Files: `packages/ui/src/i18n/locales/en.ts` first, then the other nine.

Add to the `home` section:

| Key | English |
| --- | --- |
| `importChooseTitle` | Add ROMs |
| `importChooseMessage` | Import a single file, or every ROM in a folder. |
| `importPickFile` | Pick a file |
| `importPickFolder` | Pick a folder |
| `importingTitle` | Importing ROMs |
| `importingProgress` | `{{done}} of {{total}}` |
| `importDoneTitle` | Import finished |
| `importNoneFound` | No supported ROMs in that folder. Supported files: `{{extensions}}` |
| `importedCount_one` / `_other` | `{{count}}` game added / games added |
| `importDuplicateCount_one` / `_other` | `{{count}}` was already in your library / were already in your library |
| `importSkippedCount_one` / `_other` | `{{count}}` file skipped / files skipped |
| `importFailedCount_one` / `_other` | `{{count}}` file couldn't be imported / files couldn't be imported |

`en.ts` is what types `t()`, so add it there first or the other files will not
compile. Each locale keeps the plural suffixes its language needs — Russian
carries `_one`/`_few`/`_many`/`_other`, matching the `time.daysAgoLong` keys
already in `ru.ts`.

### 6. Documentation

- `packages/storage/CLAUDE.md` — extend the `src/import.ts` bullet: both entry
  points, and the rule that the batch path turns per-file failures into counts
  instead of throwing.
- `packages/ui/CLAUDE.md` — update the `HomeScreen` description and add
  `ImportProgress` to the components list.
- Root `CLAUDE.md` — one clause in the "Current state" paragraph.

## Verification

1. `npm run typecheck` from the root. This is the only automated check the repo
   has, and the typed catalog means a missing translation key fails here.
2. `npm run gba`, then on the device:
   - Put a test folder on the phone with a nested subfolder, a few `.gba`/`.gb`
     ROMs in both levels, one file that is not a ROM, and one ROM that is
     already in the library.
   - Tap "Add ROM" → "Pick a folder" → choose that folder.
   - Expect: the overlay counts up and names each file; the summary reports
     added, already-there, and skipped; the grid shows the new games; covers
     fill in over the next few seconds.
   - Back out of the folder picker. Expect no alert and no error.
   - Tap "Add ROM" → "Pick a file" and confirm the old flow is unchanged,
     including the duplicate alert and the unsupported-file alert.
3. Check `Paths.document/roms/` grew by exactly the number of added games, and
   that no orphan file is left from the skipped ones.
