import { AppRoot, type AppConfig } from '@emulators/ui';
import { CONSOLES } from '@emulators/core-interface';
import { core, EmulatorView } from './modules/azahar-core';
// One long string constant; importing it costs a reference, and Hermes
// materializes the table from bytecode on first use.
import { SOURCE as THREEDS_COVERS } from './assets/covers/3ds';

const config: AppConfig = {
  appName: '3DS Emulator',
  consoles: [CONSOLES['3ds']],
  core,
  EmulatorView,
  coverIndexes: [{ console: '3ds', source: THREEDS_COVERS }],
};

export default function App() {
  return <AppRoot config={config} />;
}
