import { AppRoot, type AppConfig } from '@emulators/ui';
import { CONSOLES } from '@emulators/core-interface';
import { core, EmulatorView } from './modules/melonds-core';

const config: AppConfig = {
  appName: 'NDS Emulator',
  consoles: [CONSOLES.nds],
  core,
  EmulatorView,
};

export default function App() {
  return <AppRoot config={config} />;
}
