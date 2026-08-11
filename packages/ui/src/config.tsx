import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ConsoleSpec, EmulatorCore } from '@emulators/core-interface';

export interface EmulatorViewProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Everything that differs between the three apps. Each app builds one of
 * these and hands it to <AppRoot />; all shared screens read it from context.
 */
export interface AppConfig {
  /** Display name shown in headers, e.g. "GBA Emulator". */
  appName: string;
  /** Console(s) this app emulates; the first entry drives screen layout. */
  consoles: ConsoleSpec[];
  /** The app's native core module, implementing the shared contract. */
  core: EmulatorCore;
  /** The app's native view the core renders video into. */
  EmulatorView: ComponentType<EmulatorViewProps>;
}

const AppConfigContext = createContext<AppConfig | null>(null);

export function AppConfigProvider({
  config,
  children,
}: {
  config: AppConfig;
  children: ReactNode;
}) {
  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext);
  if (!config) {
    throw new Error('useAppConfig must be used inside <AppRoot />');
  }
  return config;
}
