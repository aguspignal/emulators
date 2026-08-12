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

- Anything that differs between apps flows through `AppConfig` (defined in `packages/ui/src/config.tsx`): app name, console specs, the `core` object, and the native `EmulatorView` component. Each app's `App.tsx` builds its config and renders the shared `<AppRoot />`. Shared screens read it via `useAppConfig()` — never import app code from `packages/*`.
- Dependency direction: `apps/*` → `@emulators/ui` → `@emulators/storage` → `@emulators/core-interface`. Native modules (`apps/*/modules/*`) import only from `@emulators/core-interface` (types), never from `@emulators/ui`.
- Persistent state lives in SQLite in `packages/storage`. ROM files are copied into `Paths.document/roms/` at import so the native core gets a real, durable `file://` path; imports are de-duplicated by content MD5; the DB stores relative filenames only — absolute URIs are derived at read time (`romFileUri`).
- Video never crosses the JS bridge: each native module exposes a native view the core renders into directly. The `EmulatorCore` interface covers control, input, and persistence only.
- Changing the contract in `packages/core-interface` requires updating all three Kotlin modules and their TS wrappers (`apps/*/modules/*/src/index.ts`) in the same change.

## Tooling

- npm workspaces (`apps/*`, `packages/*`). Always `npm install` from the **root**; use `npx expo install <pkg>` inside an app dir for SDK-compatible versions.
- Shared packages ship raw TS (`main: src/index.ts`) — Metro compiles them; no build step. Expo SDK ≥52 auto-configures Metro for monorepos, so there are no custom `metro.config.js` files.
- Expo SDK 57, React Native 0.86, React 19.2, TypeScript ~6.0 (strict, via root `tsconfig.base.json`).
- No tests yet. Verify with `npm run typecheck` (root, runs every workspace).

## Commands (from root)

- `npm run gba` / `nds` / `threeds` — start Metro for that app
- `npm run typecheck` — typecheck all workspaces

## Current state / roadmap

Scaffolding is complete and typechecks. `apps/gba` has the real mGBA core integrated over JNI (git submodule at `apps/gba/modules/mgba-core/android/vendor/mgba`, pinned to 0.10.5 — run `git submodule update --init` after cloning). The ROM library is built: SQLite-backed Home screen with import (picker → MD5 dedup → copy into `roms/`), favorite/delete, and boot-on-tap into the Emulator screen. Games are playable: the shared on-screen gamepad (`packages/ui/src/components/gamepad/`) drives `core.setButton` with real multi-touch and diagonals, plus a pause menu (Resume / Reset / Exit). The melonDS and Azahar Kotlin modules are still stubs. Still to build: physical/Bluetooth controller support (needs key handling in the native views, which currently ignore all key events), haptics, savestate UI (blocked on exposing `RomInfo.sha1`), and pad customization. iOS/store submission config is out of scope.
