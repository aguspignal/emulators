import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppConfigProvider, type AppConfig } from './config';
import { RootNavigator } from './navigation/RootNavigator';
import { colors } from './theme';

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    primary: colors.primary,
    border: colors.border,
  },
};

/**
 * Shared application root. Each app renders this with its own AppConfig:
 *
 *   export default function App() {
 *     return <AppRoot config={myAppConfig} />;
 *   }
 */
export function AppRoot({ config }: { config: AppConfig }) {
  return (
    <SafeAreaProvider>
      <AppConfigProvider config={config}>
        <StatusBar barStyle="light-content" />
        <NavigationContainer theme={navigationTheme}>
          <RootNavigator />
        </NavigationContainer>
      </AppConfigProvider>
    </SafeAreaProvider>
  );
}
