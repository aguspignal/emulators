import { AppRoot, type AppConfig } from "@emulators/ui";
import { CONSOLES } from "@emulators/core-interface";
import { core, EmulatorView, sharedFiles } from "./modules/mgba-core";
// Each of these is one long string constant, so importing it costs a
// reference — Hermes materializes the table from bytecode on first use.
// Don't "optimize" these into require() thunks; that trades type safety for
// laziness that is already there.
import { SOURCE as GBA_COVERS } from "./assets/covers/gba";
import { SOURCE as GBC_COVERS } from "./assets/covers/gbc";
import { SOURCE as GB_COVERS } from "./assets/covers/gb";
import { LICENSE_NOTICE } from "./license";

const config: AppConfig = {
  consoles: [CONSOLES.gba, CONSOLES.gbc, CONSOLES.gb],
  core,
  EmulatorView,
  sharedFiles,
  licenseNotice: LICENSE_NOTICE,
  // Mirrors `version` in app.json — edit both together.
  version: "1.1.0",
  termsUrl: "https://sites.google.com/view/gbaemulator-terms",
  privacyUrl: "https://sites.google.com/view/emulator-privacy",
  coverIndexes: [
    { console: "gba", source: GBA_COVERS },
    { console: "gbc", source: GBC_COVERS },
    { console: "gb", source: GB_COVERS },
  ],
};

export default function App() {
  return <AppRoot config={config} />;
}
