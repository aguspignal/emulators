# @emulators/ui

All UI shared by the three emulator apps: screens, React Navigation navigators, theme, components. See the root CLAUDE.md for the monorepo picture.

**React, React Native, navigation libs, and Expo native modules the shared UI needs (`expo-sqlite`, `expo-keep-awake`) are peerDependencies — never move them to `dependencies`.** The apps own the real installed versions (kept SDK-compatible via `npx expo install` in each app), and adding a new Expo native module here means `npx expo install` in all three apps plus a rebuild — autolinking only sees an app's own `node_modules`. The only regular dependencies allowed are `@emulators/core-interface` and `@emulators/storage`.

## Structure

- `src/AppRoot.tsx` — shared root: `ErrorBoundary` (outermost — one boundary covers all three apps) + `SafeAreaProvider` + `SQLiteProvider` (opens the library DB, runs `migrate`) + `NavigationContainer` + `RootNavigator`. Apps render `<AppRoot config={...} />`. A DB open/migrate failure swaps the provider for `ErrorState` with a retry that remounts it; expo-sqlite calls `onError` **during render**, so the handler defers its setState with `queueMicrotask` — keep that.
- `src/config.tsx` — `AppConfig` (app name, console specs, `core`, `EmulatorView`) + `useAppConfig()`. This is the only channel for per-app differences; screens must not know which app they're in.
- `src/navigation/` — native-stack `RootNavigator` and the typed `RootStackParamList` (`Home`, `Emulator { romId, romUri }` — `romUri` is derived at navigation time via `romFileUri()`, never persisted).
- `src/screens/` — `HomeScreen` (the ROM library: list, import, favorite/delete, boot-on-tap; delete is DB-row-first-then-file, so a partial failure strands at worst a harmless orphan file, never an undeletable entry) and `EmulatorScreen` (hosts the app's native `EmulatorView`, loads/unloads the ROM, reconciles `RomInfo` into the DB via `applyRomInfo` — log-only, a failed DB write must never eject a running game; subscribes to the core `error` event only **after** a successful boot, because load failures also reject and an earlier subscription double-alerts; holds `useKeepAwake()` and renders the gamepad + pause menu once booted, laying the pad out from `CONSOLES[RomInfo.console]` — the console the core read from the header, not `consoles[0]`, so a Game Boy ROM in the GBA app shows no L/R; will grow savestate UI).
- `src/components/gamepad/` — the on-screen pad. `layout.ts` and `hitTest.ts` are pure (no React): `buildGamepadLayout` turns window size + safe-area insets + a `ConsoleSpec`'s `buttons` into absolute-coordinate regions, `hitTest.ts` resolves a touch point to buttons (the D-pad uses eight equal octants, so corners give true diagonals). `GamepadOverlay.tsx` is the responder layer; `GameMenu.tsx` is the pause menu (Resume / Reset / Exit).
- `src/storage/useRoms.ts` — the one React hook over `@emulators/storage` (kept here so that package stays React-free). Re-queries on focus; exposes `error`, and `reload` **never rejects** — callers may fire-and-forget it.
- `src/components/` — `RomListItem` (displays `display_name`, never `header_title`), `EmptyLibrary`, `PrimaryButton`, `ErrorState` (full-screen fallback — deliberately context-free with its own background so it renders even when the providers above it are broken), `ErrorBoundary`.
- `src/utils/` — `format.ts` (`formatBytes`, `formatLastPlayed`); `errors.ts` (`showErrorAlert` — logs the raw error, alerts safe copy).
- `src/theme/` — colors, radius, spacing, typography.

## Rules

- Never import from `apps/*` — the dependency arrow points the other way.
- **The gamepad must stay one responder view.** React Native allows a single responder at a time, so a `Pressable` per button cannot register the D-pad and A together — `GamepadOverlay` claims the responder once and hit-tests every entry in `nativeEvent.touches` itself. For the same reason the menu button is a *region* in that overlay, not a sibling `Pressable`, and the pause menu only works because the overlay is `suspended` (which also releases everything held). Use touch `pageX`/`pageY`, never `locationX`/`locationY` — the latter are relative to each touch's own target view and cannot be compared across fingers. `buildGamepadLayout` appends the loosely-bounded D-pad last because `hitRegion` returns the first match.
- Anything console-specific (screen count, aspect ratios, touch screen) comes from `ConsoleSpec` data in `@emulators/core-interface`, not from conditionals on the app.
- User-facing failures go through `showErrorAlert` (alerts) or `ErrorState` (full-screen states) — never a hand-rolled `Alert.alert` with raw error text. Only `RomImportError` messages are written for users; anything else (native, SQLite, FS) can leak internals like absolute paths.
- Android is the only target; don't add `Platform.OS === 'ios'`/web branches.
- Ships raw TS/TSX (`main: src/index.ts`), no build step; Metro compiles it. New public exports go through `src/index.ts` (which also re-exports `@emulators/storage` so apps have one import surface). Verify with `npm run typecheck`.
