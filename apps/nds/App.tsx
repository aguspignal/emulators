import { AppRoot, type AppConfig } from '@emulators/ui';
import { CONSOLES } from '@emulators/core-interface';
import { core, EmulatorView, sharedFiles } from './modules/melonds-core';
// One long string constant; importing it costs a reference, and Hermes
// materializes the table from bytecode on first use.
import { SOURCE as NDS_COVERS } from './assets/covers/nds';
import { LICENSE_NOTICE } from './license';

const config: AppConfig = {
  consoles: [CONSOLES.nds],
  core,
  EmulatorView,
  sharedFiles,
  licenseNotice: LICENSE_NOTICE,
  primaryColor: '#aa00ff',
  // Mirrors `version` in app.json — edit both together.
  version: '1.2.0',
  coverIndexes: [{ console: 'nds', source: NDS_COVERS }],
};

export default function App() {
  return <AppRoot config={config} />;
}
