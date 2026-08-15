# Emulators monorepo

Three Android-only Expo React Native apps, each emulating old Nintendo consoles with a different native core, sharing all UI and the TypeScript core contract through workspace packages.

| App            | Consoles                       | Native core            | Android package          |
| -------------- | ------------------------------ | ---------------------- | ------------------------ |
| `apps/gba`     | Game Boy, GB Color, GB Advance | mGBA (C, via JNI)      | `com.aguspignal.gba`     |
| `apps/nds`     | Nintendo DS                    | melonDS (C++, via JNI) | `com.aguspignal.nds`     |
| `apps/threeds` | Nintendo 3DS                   | Azahar (C++, via JNI)  | `com.aguspignal.threeds` |

**Android is the only target platform. Never add iOS or web code, config, or dependencies.**

## Layout

- `packages/core-interface` — `@emulators/core-interface`. Pure TypeScript: the `EmulatorCore` contract every native module implements, plus shared constants (`CONSOLES` screen specs, ROM extensions). Zero React/React Native dependencies — keep it that way.
- `packages/storage` — `@emulators/storage`. SQLite ROM library (schema, queries, import flow) + on-disk ROM file management. React-free; `expo-sqlite`/`expo-file-system`/`expo-document-picker` are **peerDependencies**.
- `packages/ui` — `@emulators/ui`. All shared UI: screens, React Navigation navigators, theme, components. React/React Native/navigation/`expo-sqlite` are **peerDependencies** only.
- `apps/gba`, `apps/nds`, `apps/threeds` — one Expo project each (own `app.json`, package name, `eas.json`). Each contains its native core as a local Expo Module under `modules/`. Apps hold the real React/React Native/navigation dependencies.

Each sub-project has its own CLAUDE.md with specifics.

## Architecture rules

- Anything that differs between apps flows through `AppConfig` (defined in `packages/ui/src/config.tsx`): app name, console specs, the `core` object, the native `EmulatorView` component, the bundled `coverIndexes` (so each app ships only its own consoles' lookup tables), and the `licenseNotice` its Settings → Legal → License screen shows. Each app's `App.tsx` builds its config and renders the shared `<AppRoot />`. Shared screens read it via `useAppConfig()` — never import app code from `packages/*`.
- Dependency direction: `apps/*` → `@emulators/ui` → `@emulators/storage` → `@emulators/core-interface`. Native modules (`apps/*/modules/*`) import only from `@emulators/core-interface` (types), never from `@emulators/ui`.
- Persistent state lives in SQLite in `packages/storage`. ROM files are copied into `Paths.document/roms/` at import so the native core gets a real, durable `file://` path; imports are de-duplicated by content MD5; the DB stores relative filenames only — absolute URIs are derived at read time (`romFileUri`).
- **Save files belong to the core, their metadata belongs to the DB.** Each native module keys its battery save and savestates by `RomInfo.sha1` under its own private layout; JS never builds those paths and reaches them only through the contract (`saveState`/`loadState`/`deleteState`/`deleteSaveData`). What the library keeps is the `save_states` row per written slot — which slot, when — plus the slot's thumbnail in `Paths.document/state-thumbs/`, both keyed by `rom_id`. Slot 0 is reserved: it is written on exit and on backgrounding, and reloaded on the next boot.
- Video never crosses the JS bridge: each native module exposes a native view the core renders into directly. The `EmulatorCore` interface covers control, input, and persistence only.
- Changing the contract in `packages/core-interface` requires updating all three Kotlin modules and their TS wrappers (`apps/*/modules/*/src/index.ts`) in the same change.
- **Each app must ship the licence notice for the core it vendors, in the app.** The cores are not permissively licensed and their terms are not the same one: mGBA is MPL 2.0 (plus an LGPL 2.1 blip_buf compiled into it), melonDS is GPL v3, Azahar is GPL v2. All three oblige us to tell the user where the corresponding source is, so `AppConfig.licenseNotice` is a required field. `docs/legal/license/license-<license>-<app>.md` is the source of truth for the wording and `apps/<app>/license.ts` is the shipped mirror — edit both together.

## General rules

- If more information is needed for an implementation or something is not specified, don't assume, ask questions instead.
- Avoid very large outputs, keep them simple and concise avoiding buzzword.

## Tooling

- npm workspaces (`apps/*`, `packages/*`). Always `npm install` from the **root**; use `npx expo install <pkg>` inside an app dir for SDK-compatible versions.
- Shared packages ship raw TS (`main: src/index.ts`) — Metro compiles them; no build step. Expo SDK ≥52 auto-configures Metro for monorepos, so there are no custom `metro.config.js` files.
- Expo SDK 57, React Native 0.86, React 19.2, TypeScript ~6.0 (strict, via root `tsconfig.base.json`).
- No tests yet. Verify with `npm run typecheck` (root, runs every workspace).

## Commands (from root)

- `npm run gba` / `nds` / `threeds` — start Metro for that app
- `npm run typecheck` — typecheck all workspaces

## Current state / roadmap

Scaffolding is complete and typechecks. `apps/gba` has the real mGBA core integrated over JNI (git submodule at `apps/gba/modules/mgba-core/android/vendor/mgba`, pinned to 0.10.5 — run `git submodule update --init` after cloning). The ROM library is built: SQLite-backed Home screen with import (picker → MD5 dedup → copy into `roms/`), favorite/delete, and boot-on-tap into the Emulator screen. Games are playable: the shared on-screen gamepad (`packages/ui/src/components/gamepad/`) drives `core.setButton` with real multi-touch and diagonals, plus a pause menu (Resume / Save state / Load state / Reset / Exit). The emulator screen rotates with the phone — landscape floats the pad over a full-bleed game, portrait puts the game on top with the pad in a band below. Saves are done: battery saves persist and are force-flushed on backgrounding, nine savestate slots with thumbnails are picked from the pause menu, and slot 0 auto-saves on exit/background so reopening a game resumes it. Cover art is done: the Home screen is a poster grid fed by box art from the libretro thumbnail CDN, matched offline against per-app MD5→name indexes generated by `scripts/build-cover-index.mjs`, with DS cartridge banner icons as a fallback and a background sweep that fills an existing library in (`docs/covers_plan.md`). The melonDS and Azahar Kotlin modules are still stubs (they hash ROMs for real, but every save call is a no-op). Haptics are done: the gamepad ticks on button presses via `expo-haptics`, behind a toggle on the Settings screen persisted in the SQLite `settings` table (`SettingsProvider` in `packages/ui`). Settings → Legal → License opens an in-app `LicenseScreen` showing that app's `licenseNotice`; the Terms of Use and Privacy Policy rows beside it stay inert until those pages are hosted somewhere. Translations are done: every UI string flows through i18next (`packages/ui/src/i18n`, ten bundled `.ts` catalogs — English default/fallback plus es-419, pt-BR, de, fr, it, ru, ja, ko, zh-Hans, matched to the device language by bare language code via `expo-localization`), with a Settings → General → Language override persisted in the `settings` table (`'auto'` follows the device); console names, app names, and the license notices deliberately stay English. Still to build: physical/Bluetooth controller support (needs key handling in the native views, which currently ignore all key events), battery-save import/export, 3DS SMDH icons (needs ExeFS decryption), and pad customization. iOS/store submission config is out of scope.
