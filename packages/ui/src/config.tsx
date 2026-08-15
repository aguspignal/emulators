import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ConsoleSpec, EmulatorCore } from '@emulators/core-interface';
import type { CoverIndex } from '@emulators/storage';

export interface EmulatorViewProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Everything that differs between the three apps. Each app builds one of
 * these and hands it to <AppRoot />; all shared screens read it from context.
 */
export interface AppConfig {
  /**
   * Console(s) this app emulates; the first entry drives screen layout, and
   * the abbreviations compose the Home header title in array order.
   */
  consoles: ConsoleSpec[];
  /** The app's native core module, implementing the shared contract. */
  core: EmulatorCore;
  /** The app's native view the core renders video into. */
  EmulatorView: ComponentType<EmulatorViewProps>;
  /**
   * Third-party licence notice for the core this app bundles, shown in full by
   * `LicenseScreen`. Required, not optional: every app here ships a vendored
   * emulator core under a licence that obliges us to tell the user where the
   * source is, so a new app must not be able to forget one. Plain text —
   * blank lines separate paragraphs and bare URLs become links.
   */
  licenseNotice: string;
  /**
   * URLs of this app's hosted Terms of Use and Privacy Policy pages, opened
   * in the browser from Settings → Legal. Optional: until an app's pages are
   * deployed, leave them unset and the rows render inert.
   */
  termsUrl?: string;
  privacyUrl?: string;
  /**
   * Bundled MD5 -> canonical-name tables for cover lookup, one per console
   * this app ships. Optional so an app can adopt covers independently, and
   * so nothing breaks when one ships without them. Order does not matter —
   * `resolveCoverName` searches all of them, the ROM's own console first.
   */
  coverIndexes?: CoverIndex[];
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
