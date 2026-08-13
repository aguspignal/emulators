import { AppRoot, type AppConfig } from "@emulators/ui";
import { CONSOLES } from "@emulators/core-interface";
import { core, EmulatorView } from "./modules/mgba-core";
// Each of these is one long string constant, so importing it costs a
// reference — Hermes materializes the table from bytecode on first use.
// Don't "optimize" these into require() thunks; that trades type safety for
// laziness that is already there.
import { SOURCE as GBA_COVERS } from "./assets/covers/gba";
import { SOURCE as GBC_COVERS } from "./assets/covers/gbc";
import { SOURCE as GB_COVERS } from "./assets/covers/gb";
import { LICENSE_NOTICE } from "./license";

const config: AppConfig = {
  appName: "GBA/GBC/GB Emulator",
  consoles: [CONSOLES.gba, CONSOLES.gbc, CONSOLES.gb],
  core,
  EmulatorView,
  licenseNotice: LICENSE_NOTICE,
  coverIndexes: [
    { console: "gba", source: GBA_COVERS },
    { console: "gbc", source: GBC_COVERS },
    { console: "gb", source: GB_COVERS },
  ],
};

export default function App() {
  return <AppRoot config={config} />;
}
