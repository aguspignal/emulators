import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ConsoleSpec, EmulatorCore } from '@emulators/core-interface';
import type { CoverIndex } from '@emulators/storage';
import { colors } from './theme';

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
   * The app's user-facing version, shown at the foot of Settings. Required so
   * a new app can't ship a blank one. It mirrors `version` in the app's
   * `app.json` — the two are separate strings and must be edited together;
   * `app.json` can't be imported here (the base tsconfig has no
   * `resolveJsonModule`) and `expo-constants`, which would read it at runtime,
   * is not installed in any app.
   */
  version: string;
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
  /**
   * Accent colour for this app, overriding `theme.colors.primary`. Optional —
   * an app that omits it gets the shared default. Anything rendering inside
   * <AppRoot /> must read it through `usePrimaryColor()`, not `colors.primary`.
   */
  primaryColor?: string;
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

/**
 * This app's accent colour: its `AppConfig.primaryColor`, or the shared
 * default. Because it is a hook, styles that use it must be built during
 * render rather than in a module-level StyleSheet.
 */
export function usePrimaryColor(): string {
  return useAppConfig().primaryColor ?? colors.primary;
}

export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext);
  if (!config) {
    throw new Error('useAppConfig must be used inside <AppRoot />');
  }
  return config;
}
