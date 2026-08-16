# App font plan: Tourney Black as the display face, Roboto as the reading face

Status: **implemented** (2026-08-16), on-device verification pending. The two OFL files are named `Tourney-OFL.txt` / `Roboto-OFL.txt` so both fit one folder.

## Context

The apps ship no custom typography. `packages/ui/src/theme/index.ts` defines only `fontSize`/`fontWeight`, and `fontFamily` appears **nowhere in the repo**, so every screen renders in whatever the device ships — Roboto on a Pixel, but SamsungOne on One UI, MiSans on Xiaomi. `forfutureself.md` lists `font (tourney) & playful style` as intended work.

Tourney and Roboto are already downloaded (Google Fonts drops) at `assets/fonts/Tourney` and `assets/fonts/Roboto`. Two findings shape the plan:

- **Tourney is Latin-only.** Its OS/2 Unicode ranges cover Basic Latin, Latin-1, Latin Ext-A/B and IPA — **no Cyrillic, no Greek, no CJK** (63 KB per weight, against Roboto's 156 KB, which does carry Cyrillic and Greek). The UI ships ten locales including `ru`, `ja`, `ko`, `zh-Hans`, so Tourney as the body face would render the whole Russian UI in the system font, and put the License screen's legal paragraphs in a squarish racing face at 12–14 px.
- **`typography` is already the single funnel.** All 11 styled-text consumers spread `typography.title`/`body`/`caption`; only `GamepadOverlay` uses raw `fontSize`. The display/body split can therefore be expressed once, in the theme, with almost no call-site churn.

**Product decisions:** Tourney ships in **Black (900) only** — it is the display face and is always drawn at one heavy weight · everything read in sentences is Roboto · all three apps get the same two families · fonts are embedded natively at build time, so there is no async load, no splash gate and no font flash.

## Verified facts

- `expo-font` is not a direct dependency of any app; it is present only as a transitive dep of `expo` (which is why `@expo/vector-icons` works today).
- The config plugin's `android.fonts` **object form** (`{ fontFamily, fontDefinitions: [{ path, weight, style? }] }`) is what makes `fontWeight` work with a custom family. `withFontsAndroid.js` copies the files to `res/font/`, writes an XML `<font-family>` with `app:fontWeight` per entry, and injects `ReactFontManager.getInstance().addCustomFont(this, "Tourney", R.font.xml_tourney)` into `MainApplication.onCreate`. The flat `fonts: ["./x.ttf"]` string form drops files into `assets/fonts/` with **no weight metadata**, so `fontFamily` + `fontWeight` silently renders Regular.
- Plugin paths resolve with `path.resolve(projectRoot, p)`, so `../../` out of an app dir into `packages/` works.
- React Native on Android cannot select variable-font axes. Registering `Tourney-VariableFont_wdth,wght.ttf` would pin every weight to the default instance — the `static/` files are mandatory.
- A one-entry family is self-correcting: Android resolves any requested weight to the nearest registered one, so a display style that forgets `fontWeight` still lands on Black.
- Android falls back **per glyph**, so a Cyrillic heading in Tourney renders in the system font — not as tofu boxes.
- All three apps have committed `android/` dirs. The plugin's `withMainApplication` mod is `mergeContents`-tagged (`xml-fonts-init`) and idempotent, so a plain prebuild is safe; `--clean` is not needed.

## Prerequisite: move the fonts into a tracked location

`.gitignore` line 2 is `/assets/`, so the root `assets/` tree is **untracked** — the font files exist only on the dev machine, and EAS Build (which uploads git-tracked files) would never see them. The leading slash anchors that rule to the repo root, so `packages/ui/assets/` is unaffected.

Copy three files from `assets/fonts/*/static/` into a new `packages/ui/assets/fonts/`:

```
Tourney-Black.ttf     (900)     63 KB
Roboto-Regular.ttf    (400)    155 KB
Roboto-SemiBold.ttf   (600)    156 KB
```

Copy each family's `OFL.txt` alongside them. Both are SIL Open Font License and redistribution requires the licence text to travel with the files. This is bundled font data, not vendored source, so it does **not** belong in `AppConfig.licenseNotice` — that field is specifically the emulator core's source-availability notice. The OFL files sitting beside the fonts satisfy it.

They live in `packages/ui` because the theme that names the families lives there: one copy, three apps.

## Design decisions

- **Config plugin, not `useFonts()`.** Embedding at build time leaves `AppRoot.tsx` untouched. A runtime `useFonts` gate would add a third async hold to a root that already has `SQLiteProvider`'s null render and `SettingsProvider`'s `languageLoaded` gate, and would need `expo-splash-screen` in all three apps — only gba has it today.
- **`typography.title` _becomes_ the display token.** Its 11 consumers are all genuine headings, so redefining it costs zero call-site edits.
- **Only two Roboto weights.** After the display tier moves to Tourney, the sole remaining `fontWeight: '600'` consumers are `GameMenu.tsx:170`, `SlotSheet.tsx:217` and `SlotSheet.tsx:243`. Nothing needs Roboto Bold, so it is not bundled.
- **`"Roboto"` as a custom family name deliberately shadows Android's built-in.** `ReactFontManager` checks its custom-font cache before the system typeface, which is exactly how the app beats OEM font substitution and gets one metric to design against.
- **The gamepad D-pad arrows stay on the system font.** `ARROWS` are U+25B2-block geometric shapes, outside Tourney's coverage; leaving them alone avoids a pointless per-glyph fallback in the hottest-drawn view.

## Implementation steps

1. Create `packages/ui/assets/fonts/` and copy in the three `.ttf`s plus both `OFL.txt` files (see prerequisite above).
2. `npx expo install expo-font` in `apps/gba`, `apps/nds`, `apps/threeds`; then `npm install` from root. It is only a transitive dep today, and an explicit entry is what makes the plugin reference honest.
3. Append the **same** plugin entry to the `plugins` array of all three `app.json`s:

   ```json
   [
     "expo-font",
     {
       "android": {
         "fonts": [
           {
             "fontFamily": "Tourney",
             "fontDefinitions": [
               { "path": "../../packages/ui/assets/fonts/Tourney-Black.ttf", "weight": 900 }
             ]
           },
           {
             "fontFamily": "Roboto",
             "fontDefinitions": [
               { "path": "../../packages/ui/assets/fonts/Roboto-Regular.ttf", "weight": 400 },
               { "path": "../../packages/ui/assets/fonts/Roboto-SemiBold.ttf", "weight": 600 }
             ]
           }
         ]
       }
     }
   ]
   ```

4. `packages/ui/src/theme/index.ts` — add a `fonts` export and thread `fontFamily` through `typography`:

   ```ts
   export const fonts = {
     display: "Tourney", // Black 900 only. Latin only — headings and short labels
     body: "Roboto", // Cyrillic + Greek — everything read in sentences
   } as const;

   export const typography = {
     title: { fontFamily: fonts.display, fontSize: 18, fontWeight: "900" },
     body: { fontFamily: fonts.body, fontSize: 14, fontWeight: "400" },
     caption: { fontFamily: fonts.body, fontSize: 12, fontWeight: "400" },
     button: { fontFamily: fonts.display, fontSize: 14, fontWeight: "900" },
   } as const;
   ```

   `title` moves from `700` to `900`: Tourney is registered at 900 and nothing else, so the token should say so rather than lean on nearest-weight matching. No new export line is needed — `packages/ui/src/index.ts` already re-exports the module wholesale as `export * as theme from './theme'`. This single edit moves all 11 `typography.title` consumers to Tourney and all `body`/`caption` consumers to Roboto.

5. Apply the display font at the three places `typography` does not reach:
   - `packages/ui/src/navigation/RootNavigator.tsx:24-28` — `screenOptions` sets only colors; add `headerTitleStyle: { fontFamily: fonts.display, fontWeight: "900" }`. Without it the Home/Settings/Language/License header titles keep the native-stack default.
   - `packages/ui/src/components/PrimaryButton.tsx:36` and `components/gamepad/SecondaryButton.tsx:32` — replace `{ ...typography.body, fontWeight: '600' }` with `{ ...typography.button }`.
   - `packages/ui/src/components/gamepad/GamepadOverlay.tsx:299` — add `fontFamily: fonts.display` to `label` and change its `fontWeight` from `"700"` to `"900"` (the A/B/L/R/START glyphs). **Leave `dpadArrow` on line 298 alone.**
6. Docs — `packages/ui/CLAUDE.md`: extend the `src/theme/` bullet and add a rule that `title`/`button` are the Tourney display tier while `body`/`caption` are the Roboto reading tier, that **a translated sentence must never use `fonts.display`** (no Cyrillic/Greek/CJK), and that font files live in `packages/ui/assets/fonts/` but are registered by each app's `app.json`, so adding a weight means editing all three. `CLAUDE.md`: add fonts to the "Current state" paragraph beside the translations sentence. `forfutureself.md`: drop the `font (tourney) & playful style` line.

## Build steps

Native change — Metro reload is insufficient. Font registration happens in `MainApplication.onCreate`, so a JS reload against an old binary shows the fonts silently missing.

Per app: `npx expo prebuild --platform android`, then the usual run/build (JDK 21; gba means the long mGBA native build).

## Verification

- `npm run typecheck` from root — catches any `TextStyle` mismatch from the widened `typography` tokens.
- After prebuild, inspect `apps/gba/android/app/src/main/res/font/`: `xml_tourney.xml` and `xml_roboto.xml` plus the copied `.ttf`s; and `MainApplication.kt` for the two `addCustomFont` lines. Their absence means prebuild did not pick up the plugin.
- On device (gba):
  - Home header `GBA / GBC / GB` and the `My games` / `Favourites` section headers in Tourney; ROM titles and the size/last-played meta in Roboto.
  - Settings: section headers Tourney, row labels and values Roboto. License screen: paragraphs in Roboto and comfortably readable.
  - Boot a ROM: pause-menu title in Tourney, A/B/L/R labels in Tourney, **D-pad arrows still drawn** (regression check for step 5).
  - "Add ROM" and the slot-sheet buttons in Tourney Black, with the slot rows' labels and the sheet title beside them noticeably lighter in Roboto SemiBold — that contrast is the check that the XML weight mapping resolved 600 and not Regular.
- Settings → Language → **Русский**: body text and row labels render real Cyrillic in Roboto; headers fall back to the system font, with **no tofu boxes**. Then **日本語**, confirming body text still renders through Android's Noto CJK fallback.
- `git status` — `packages/ui/assets/fonts/*.ttf` must be staged, not ignored. This is what EAS Build uploads; if they are missing, the cloud build produces an app with no fonts registered that silently falls back everywhere.

## Risks

- **~375 KB per APK** (Tourney Black 63 KB + Roboto Regular/SemiBold 311 KB). Trimmable to ~220 KB by dropping Roboto SemiBold and moving the three `fontWeight: '600'` sites to 400.
- **The `"Roboto"` family-name shadow is intentional but untested on OEM skins.** If any device renders body text wrongly, rename the family to `AppRoboto` in the three `app.json`s and in `fonts.body`; nothing else changes.
- **Tourney Black at 14 px is very heavy.** It is the only weight available by design, so if the button labels read as too dense the fix is to shrink `typography.button`'s `fontSize`, not to add a lighter Tourney.
