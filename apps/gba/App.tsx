import { AppRoot, type AppConfig } from '@emulators/ui';
import { CONSOLES } from '@emulators/core-interface';
import { core, EmulatorView } from './modules/mgba-core';

const config: AppConfig = {
  appName: 'GBA Emulator',
  consoles: [CONSOLES.gba, CONSOLES.gbc, CONSOLES.gb],
  core,
  EmulatorView,
};

export default function App() {
  return <AppRoot config={config} />;
}
