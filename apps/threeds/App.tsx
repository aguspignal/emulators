import { AppRoot, type AppConfig } from '@emulators/ui';
import { CONSOLES } from '@emulators/core-interface';
import { core, EmulatorView } from './modules/azahar-core';

const config: AppConfig = {
  appName: '3DS Emulator',
  consoles: [CONSOLES['3ds']],
  core,
  EmulatorView,
};

export default function App() {
  return <AppRoot config={config} />;
}
