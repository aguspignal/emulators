# App icon plan: user-selectable launcher icon (5 color variants), gba first

Status: **planned** (2026-08-15). Not implemented.

## Context

Let the user pick the launcher icon from a set of 5 color variants on the Settings screen. Android has no icon-change API; the standard mechanism is one `<activity-alias>` per variant in the AndroidManifest, all targeting `MainActivity` with their own `android:icon`, toggled at runtime via `PackageManager.setComponentEnabledSetting`.

The **`expo-alternate-app-icons`** library (v8.0.0, maintained, peer `expo >= 53` — SDK 57 compatible) does exactly this: its config plugin generates the aliases at prebuild — the only correct place, since `apps/*/android/` is gitignored and prebuild-generated — and its runtime API flips the enabled alias with `DONT_KILL_APP`, so **the app is not killed by the switch**; only the home-screen icon may take a moment to refresh on some OEM launchers.

**Product decisions:** only `apps/gba` ships variants in this change · the shared UI and a new optional `AppConfig.appIcons` field are wired so nds/threeds can adopt later (their row stays absent, same pattern as `termsUrl`) · the 5 icon PNGs are provided by hand, not generated.

## Verified library facts

- Android plugin config requires the adaptive-icon shape per variant: `{ name, android: { foregroundImage, backgroundColor } }`. A plain PNG path is not accepted for Android. Omit `ios` keys entirely — gba is `"platforms": ["android"]`, so the plugin's iOS mods never execute.
- `.MainActivity` keeps its own LAUNCHER intent-filter and icon — **the default icon is not an alias**. Generated aliases ship `enabled="false"` with their own MAIN/LAUNCHER filters.
- Runtime API: `setAlternateAppIcon(name | null): Promise<string | null>`, `getAppIconName(): string | null` (synchronous; `null` = default; returns the PascalCase variant name), `resetAppIcon(): Promise<void>`, `supportsAlternateIcons: boolean`.
- **Hard rule: once a variant ships, never rename or remove it.** If the alias a user has enabled disappears from the manifest in an update, their launcher icon vanishes entirely. Only ever add variants.

## Prerequisite: icon assets (hand-provided)

5 PNGs in `apps/gba/assets/icons/`: `icon-red.png`, `icon-blue.png`, `icon-green.png`, `icon-purple.png`, `icon-gold.png`.

- 1024×1024 square PNG.
- Each is an **adaptive-icon foreground layer**: launchers mask to the center ~66%, so artwork must sit inside the central safe zone with transparent padding around it; the plugin's `backgroundColor` fills the plate behind it.

Code work can proceed before the files exist; `expo prebuild` fails until they are in place.

## Design decisions

- **The package installs in all three apps.** The shared `AppIconScreen` statically imports the JS API, whose module calls `requireNativeModule` at evaluation time — without the native module autolinked, nds/threeds would crash the moment the screen module evaluates. So: `"expo-alternate-app-icons": "*"` in `packages/ui` `peerDependencies`, real dependency via `npx expo install` in gba, nds, and threeds — exactly the existing rule in `packages/ui/CLAUDE.md` for new Expo native modules. nds/threeds get no plugin entry in `app.json`: no aliases, no Settings row, just an inert linked module.
- **No SQLite persistence.** The package manager itself persists which alias is enabled, across restarts and updates; `getAppIconName()` is the synchronous source of truth. A stored copy in the `settings` table could only drift (failed set, backup/restore). No `SettingsContext` change at all.
- **Swatch preview, not PNG preview.** `AppConfig` gains `appIcons?: { name: string; color: string }[]`. Rendering the real PNGs would `require()` five 1024px images into the JS bundle that already ship as mipmaps — pure bloat — and duplicate the asset list between `app.json` and `App.tsx`. A color circle matches the "5 color variants" concept and needs no assets.
- **Variant names are PascalCase and untranslated.** `"Red"`, `"Blue"`, … must match the plugin config exactly; already-PascalCase names mean the plugin's name→alias conversion can't diverge from what `getAppIconName()` returns. They stay untranslated on purpose — config-provided identifiers, same carve-out as console names and language endonyms — with `accessibilityLabel` from the name.
- **Three i18n keys only**, across all ten catalogs (`en.ts` first — it types `t()`): `settings.appIcon` (row label + screen title), `settings.appIconDefault` ("Default" row and the Settings-row value when no variant is active), `settings.appIconNote` (caption: the home-screen icon may take a moment to update).
- **No confirm dialog.** The switch doesn't kill the app, and Settings is only reachable from Home so no game is running. Like `LanguageScreen`, picking stays on the screen — the moved checkmark is the confirmation.

## Implementation steps

1. `packages/ui/package.json` — add `"expo-alternate-app-icons": "*"` to `peerDependencies`.
2. `npx expo install expo-alternate-app-icons` in `apps/gba`, `apps/nds`, `apps/threeds`; then `npm install` from root.
3. `apps/gba/app.json` — append the plugin entry (backgroundColor to taste, matching the assets):

   ```json
   ["expo-alternate-app-icons", [
     { "name": "Red",    "android": { "foregroundImage": "./assets/icons/icon-red.png",    "backgroundColor": "#1c1c22" } },
     { "name": "Blue",   "android": { "foregroundImage": "./assets/icons/icon-blue.png",   "backgroundColor": "#1c1c22" } },
     { "name": "Green",  "android": { "foregroundImage": "./assets/icons/icon-green.png",  "backgroundColor": "#1c1c22" } },
     { "name": "Purple", "android": { "foregroundImage": "./assets/icons/icon-purple.png", "backgroundColor": "#1c1c22" } },
     { "name": "Gold",   "android": { "foregroundImage": "./assets/icons/icon-gold.png",   "backgroundColor": "#1c1c22" } }
   ]]
   ```

4. `packages/ui/src/config.tsx` — add `export interface AppIconVariant { name: string; color: string }` and optional `appIcons?: AppIconVariant[]` to `AppConfig`, doc comment stating: names must match the plugin config, are permanent once shipped, and the Settings row hides when unset.
5. i18n — the 3 `settings.*` keys in `packages/ui/src/i18n/locales/en.ts`, then the other nine catalogs.
6. **New** `packages/ui/src/screens/AppIconScreen.tsx` — modeled on `LanguageScreen.tsx`: one card; a "Default" row calling `resetAppIcon()`, then one row per `useAppConfig().appIcons` showing a color circle + name, calling `setAlternateAppIcon(name)`; checkmark driven by local state seeded from `getAppIconName()` and updated after the promise resolves; `settings.appIconNote` caption under the card.
7. `packages/ui/src/screens/SettingsScreen.tsx` — in the General card, an App icon `NavRow` rendered only when `appIcons?.length` (the Language row's `last` becomes conditional). Row value: active variant name, or `t("settings.appIconDefault")`. Read `getAppIconName()` and refresh via `useIsFocused()` — Settings stays mounted under the pushed screen, so the value goes stale otherwise. Optionally extend `NavRow` with a swatch-color dot in `navRowRight`.
8. `packages/ui/src/navigation/types.ts` — `AppIcon: undefined` in `RootStackParamList`.
9. `packages/ui/src/navigation/RootNavigator.tsx` — register `AppIcon` with `{ title: t("settings.appIcon"), orientation: "portrait_up" }`. Unconditional registration is safe: the row that navigates there is gated, and the native module exists in all apps.
10. `packages/ui/src/index.ts` — export `AppIconVariant` (and the screen, if screens are exported individually).
11. `apps/gba/App.tsx` — `appIcons: [{ name: "Red", color: "#e74c3c" }, { name: "Blue", color: "#3b82f6" }, { name: "Green", color: "#22c55e" }, { name: "Purple", color: "#a855f7" }, { name: "Gold", color: "#eab308" }]` — colors matched to the actual PNG tints. nds/threeds `App.tsx` untouched.
12. Docs — `packages/ui/CLAUDE.md` (new screen/route, the `appIcons` config field) and `apps/gba/CLAUDE.md` (never remove a shipped variant; icon PNGs are adaptive foregrounds).

## Build steps

Native change — Metro reload is insufficient.

- gba: from `apps/gba`, `npx expo prebuild --clean -p android`, then the usual run/build (JDK 21; expect the long mGBA native build).
- nds/threeds: rebuild at their next `expo run:android` (new autolinked module). Until rebuilt they must not ship the new ui code — standard peer-dep rule.

## Verification

- `npm run typecheck` from root — catches missing i18n keys (typed via `en.ts`) and the config shape.
- After prebuild, inspect `apps/gba/android/app/src/main/AndroidManifest.xml`: five `activity-alias` entries (`enabled="false"`, own MAIN/LAUNCHER filters), `.MainActivity` unchanged; variant launcher icons present under `res/mipmap-*/`.
- On device (gba): Settings → App icon shows Default + 5 swatches → pick one → checkmark moves, app stays alive → home-screen icon updates (possibly after a moment; note caption visible) → relaunching from the new icon works → back in Settings the row shows the pick → cold restart keeps the selection → Default restores the original icon.
- On device (nds/threeds, after a rebuild): no App icon row; app boots normally.
