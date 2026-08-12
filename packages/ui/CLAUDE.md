# @emulators/ui

All UI shared by the three emulator apps: screens, React Navigation navigators, theme, components. See the root CLAUDE.md for the monorepo picture.

**React, React Native, navigation libs, and Expo native modules the shared UI needs (`expo-sqlite`) are peerDependencies — never move them to `dependencies`.** The apps own the real installed versions (kept SDK-compatible via `npx expo install` in each app), and adding a new Expo native module here means `npx expo install` in all three apps plus a rebuild — autolinking only sees an app's own `node_modules`. The only regular dependencies allowed are `@emulators/core-interface` and `@emulators/storage`.

## Structure

- `src/AppRoot.tsx` — shared root: `SafeAreaProvider` + `SQLiteProvider` (opens the library DB, runs `migrate`) + `NavigationContainer` + `RootNavigator`. Apps render `<AppRoot config={...} />`.
- `src/config.tsx` — `AppConfig` (app name, console specs, `core`, `EmulatorView`) + `useAppConfig()`. This is the only channel for per-app differences; screens must not know which app they're in.
- `src/navigation/` — native-stack `RootNavigator` and the typed `RootStackParamList` (`Home`, `Emulator { romId, romUri }` — `romUri` is derived at navigation time via `romFileUri()`, never persisted).
- `src/screens/` — `HomeScreen` (the ROM library: list, import, favorite/delete, boot-on-tap) and `EmulatorScreen` (hosts the app's native `EmulatorView`, loads/unloads the ROM, reconciles `RomInfo` into the DB via `applyRomInfo`; will grow the gamepad overlay and pause/savestate UI).
- `src/storage/useRoms.ts` — the one React hook over `@emulators/storage` (kept here so that package stays React-free). Re-queries on focus.
- `src/components/` — `RomListItem` (displays `display_name`, never `header_title`), `EmptyLibrary`, `PrimaryButton`.
- `src/utils/format.ts` — `formatBytes`, `formatLastPlayed`.
- `src/theme/` — colors, radius, spacing, typography.

## Rules

- Never import from `apps/*` — the dependency arrow points the other way.
- Anything console-specific (screen count, aspect ratios, touch screen) comes from `ConsoleSpec` data in `@emulators/core-interface`, not from conditionals on the app.
- Android is the only target; don't add `Platform.OS === 'ios'`/web branches.
- Ships raw TS/TSX (`main: src/index.ts`), no build step; Metro compiles it. New public exports go through `src/index.ts` (which also re-exports `@emulators/storage` so apps have one import surface). Verify with `npm run typecheck`.
