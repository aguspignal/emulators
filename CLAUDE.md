# Emulators monorepo

Three Android-only Expo React Native apps, each emulating old Nintendo consoles with a different native core, sharing all UI and the TypeScript core contract through workspace packages.

| App            | Consoles                       | Native core            | Core licence                  | Android package          |
| -------------- | ------------------------------ | ---------------------- | ----------------------------- | ------------------------ |
| `apps/gba`     | Game Boy, GB Color, GB Advance | mGBA (C, via JNI)      | MPL 2.0 (+ LGPL 2.1 blip_buf) | `com.aguspignal.gba`     |
| `apps/nds`     | Nintendo DS                    | melonDS (C++, via JNI) | GPL v3                        | `com.aguspignal.nds`     |
| `apps/threeds` | Nintendo 3DS                   | Azahar (C++, via JNI)  | GPL v2                        | `com.aguspignal.threeds` |

**Android is the only target platform. Never add iOS or web code, config, or dependencies.**

## Layout

- `packages/core-interface` — `@emulators/core-interface`. Pure TypeScript: the `EmulatorCore` contract every native module implements, plus shared constants (`CONSOLES` screen specs, ROM extensions). Zero React/React Native dependencies — keep it that way.
- `packages/storage` — `@emulators/storage`. SQLite ROM library (schema, queries, import flow) + on-disk ROM file management. React-free; `expo-sqlite`/`expo-file-system`/`expo-document-picker` are **peerDependencies**.
- `packages/ui` — `@emulators/ui`. All shared UI: screens, React Navigation navigators, theme, components. React/React Native/navigation/`expo-sqlite` are **peerDependencies** only.
- `apps/gba`, `apps/nds`, `apps/threeds` — one Expo project each (own `app.json`, package name, `eas.json`). Each contains its native core as a local Expo Module under `modules/`. Apps hold the real React/React Native/navigation dependencies.

Each sub-project has its own CLAUDE.md with specifics.

## Architecture rules

- Anything that differs between apps flows through `AppConfig` (defined in `packages/ui/src/config.tsx`): console specs, the `core` object, the native `EmulatorView` component, the bundled `coverIndexes` (so each app ships only its own consoles' lookup tables), and the `licenseNotice` its Settings → Legal → License screen shows. Each app's `App.tsx` builds its config and renders the shared `<AppRoot />`; app-specific UI belongs in the config or in `packages/ui` — never add screens inside an app. Shared screens read the config via `useAppConfig()` — never import app code from `packages/*`.
- Dependency direction: `apps/*` → `@emulators/ui` → `@emulators/storage` → `@emulators/core-interface`. Native modules (`apps/*/modules/*`) import only from `@emulators/core-interface` (types), never from `@emulators/ui`.
- Persistent state lives in SQLite in `packages/storage`. ROM files are copied into `Paths.document/roms/` at import so the native core gets a real, durable `file://` path; imports are de-duplicated by content MD5; the DB stores relative filenames only — absolute URIs are derived at read time (`romFileUri`).
- **Save files belong to the core, their metadata belongs to the DB.** Each native module keys its battery save and savestates by `RomInfo.sha1` under its own private layout; JS never builds those paths and reaches them only through the contract (`saveState`/`loadState`/`deleteState`/`deleteSaveData`). What the library keeps is the `save_states` row per written slot — which slot, when — plus the slot's thumbnail in `Paths.document/state-thumbs/`, both keyed by `rom_id`. Slot 0 is reserved: it is written on exit and on backgrounding, and reloaded on the next boot.
- Video never crosses the JS bridge: each native module exposes a native view the core renders into directly. The `EmulatorCore` interface covers control, input, and persistence only.
- Changing the contract in `packages/core-interface` requires updating all three Kotlin modules and their TS wrappers (`apps/*/modules/*/src/index.ts`) in the same change.
- **The app version lives in two places and they must move together**: `version` in `apps/<app>/app.json` (what Android and the stores see) and `AppConfig.version` in `apps/<app>/App.tsx` (what Settings prints at its foot). `app.json` can't be imported — the base tsconfig has no `resolveJsonModule` — and `expo-constants`, which would read it at runtime, is only a nested dependency of `expo`, so adding it would mean `npx expo install` in all three apps plus a rebuild.
- **Each app must ship the licence notice for the core it vendors, in the app.** None of the core licences (table above) are permissive, and all three oblige us to tell the user where the corresponding source is, so `AppConfig.licenseNotice` is a required field. `docs/legal/license/license-<license>-<app>.md` is the source of truth for the wording and `apps/<app>/license.ts` is the shipped mirror — edit both together.

## General rules

- If more information is needed for an implementation or something is not specified, don't assume, ask questions instead.
- Avoid very large outputs, keep them simple and concise avoiding buzzword.
- Changes to any CLAUDE.md (root or sub-project) must stay concise: explain only what's necessary, avoid extensive or deep descriptions.

## Tooling

- npm workspaces (`apps/*`, `packages/*`). Always `npm install` from the **root**; use `npx expo install <pkg>` inside an app dir for SDK-compatible versions.
- Shared packages ship raw TS (`main: src/index.ts`) — Metro compiles them; no build step. Expo SDK ≥52 auto-configures Metro for monorepos, so there are no custom `metro.config.js` files.
- Expo SDK 57, React Native 0.86, React 19.2, TypeScript ~6.0 (strict, via root `tsconfig.base.json`).
- Each app's `eas.json` has `development`/`preview` (APK) and `production` (AAB) profiles.
- No tests yet. Verify with `npm run typecheck` (root, runs every workspace).

## Commands

- From root: `npm run gba` / `nds` / `threeds` — start Metro for that app; `npm run typecheck` — typecheck all workspaces.
- In any app dir, only if needed: `npm run start` / `npm run android` (`expo run:android`) / `npm run prebuild` / `npm run typecheck`. Kotlin/native changes need a full `expo run:android` rebuild, not Fast Refresh.

## Current state

Done — details live in each area's own CLAUDE.md:

- `apps/gba` is fully playable end to end: real mGBA core over JNI (`vendor/mgba` git submodule — run `git submodule update --init` after cloning), battery saves force-flushed on backgrounding, nine savestate slots with thumbnails, slot-0 auto-save/resume, and "Open with" from file managers plus share-to-app (`useOpenedRom` + `importRomFromUri`; SEND files bridge natively via `AppConfig.sharedFiles` since `Linking` can't see intent extras — Samsung My Files can't "open" unknown extensions at all. `apps/nds`/`threeds` still need their own `app.json` intent filters and `sharedFiles` bridge — the JS half is shared).
- ROM library (`packages/storage`): SQLite-backed poster-grid Home with single-file, whole-folder, and open-with import (MD5 dedup → copy into `roms/`), favorite/delete, boot-on-tap, and offline-matched cover art from the libretro CDN with DS banner fallback (`scripts/build-cover-index.mjs` generates the per-app indexes).
- Shared UI (`packages/ui`): multi-touch gamepad with diagonals and haptics, pause menu (save/load slots, mute, speed-up, reset, auto-save-and-exit, cheats stub), portrait+landscape emulator layouts, Settings (language, haptics, gamepad size/opacity per orientation, Legal), Help screen, i18next translations (ten catalogs), bundled Tourney/Roboto typography. Terms/Privacy URLs are set for gba only; the nds/threeds rows stay inert until their pages are hosted.
- The melonDS and Azahar Kotlin modules are stubs: `loadRom` hashes the ROM for real, everything else is a no-op.
- iOS/store submission config is out of scope.

Still to build: 3DS SMDH icons (needs ExeFS decryption), gamepad button remapping and repositioning, and user-selectable launcher icons (planned in `docs/app_icon_plan.md`).
