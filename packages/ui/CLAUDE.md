# @emulators/ui

All UI shared by the three emulator apps: screens, React Navigation navigators, theme, components. See the root CLAUDE.md for the monorepo picture.

**React, React Native, and navigation libs are peerDependencies — never move them to `dependencies`.** The apps own the real installed versions (kept SDK-compatible via `npx expo install` in each app). The only regular dependency allowed is `@emulators/core-interface`.

## Structure

- `src/AppRoot.tsx` — shared root: `SafeAreaProvider` + `NavigationContainer` + `RootNavigator`. Apps render `<AppRoot config={...} />`.
- `src/config.tsx` — `AppConfig` (app name, console specs, `core`, `EmulatorView`) + `useAppConfig()`. This is the only channel for per-app differences; screens must not know which app they're in.
- `src/navigation/` — native-stack `RootNavigator` and the typed `RootStackParamList` (`Home`, `Emulator { romUri }`).
- `src/screens/` — `HomeScreen` (placeholder; will become the ROM library) and `EmulatorScreen` (hosts the app's native `EmulatorView`, loads/unloads the ROM; will grow the gamepad overlay and pause/savestate UI).
- `src/theme/` — colors, spacing, typography.

## Rules

- Never import from `apps/*` — the dependency arrow points the other way.
- Anything console-specific (screen count, aspect ratios, touch screen) comes from `ConsoleSpec` data in `@emulators/core-interface`, not from conditionals on the app.
- Android is the only target; don't add `Platform.OS === 'ios'`/web branches.
- Ships raw TS/TSX (`main: src/index.ts`), no build step; Metro compiles it. New public exports go through `src/index.ts`. Verify with `npm run typecheck`.
