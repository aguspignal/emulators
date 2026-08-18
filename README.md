# Emulators

Three Android apps built with Expo + React Native, each emulating Nintendo consoles with a different native core:

| App         | Consoles                                   | Core                                    |
| ----------- | ------------------------------------------ | --------------------------------------- |
| **gba**     | Game Boy, Game Boy Color, Game Boy Advance | [mGBA](https://mgba.io)                 |
| **nds**     | Nintendo DS                                | [melonDS](https://melonds.kuribo64.net) |
| **threeds** | Nintendo 3DS                               | [Azahar](https://azahar-emu.org)        |

All UI and app logic lives in shared packages, and each app only contributes its native core module and configuration.

- **`packages/core-interface`** — pure TypeScript. The `EmulatorCore` contract every native module implements plus shared constants
- **`packages/ui`** — everything the user sees: screens, React Navigation stack, theme. Each app injects an `AppConfig` and renders the shared `<AppRoot />`.
- **`apps/*`** — one Expo project per app. Each contains its emulator core as a local Expo Module (Kotlin, JNI into the C/C++ core). The core renders straight into a native view.
