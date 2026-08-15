// First import on purpose: initializes i18next (device language) before
// anything in this tree renders or calls t().
import './i18n';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SQLiteProvider } from 'expo-sqlite';
import { DATABASE_NAME, migrate } from '@emulators/storage';
import { AppConfigProvider, type AppConfig } from './config';
import { SettingsProvider } from './settings/SettingsContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorState } from './components/ErrorState';
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
  const { t } = useTranslation();
  const [dbError, setDbError] = useState<unknown>(null);
  const onDbError = useCallback((error: Error) => {
    console.error('SQLite failed to open:', error);
    // SQLiteProvider invokes onError during render — defer the setState.
    queueMicrotask(() => setDbError(error));
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        {dbError != null ? (
          // Without this branch the errored provider renders null forever —
          // a permanently blank app. "Try again" remounts it, which re-runs
          // the open + migrate.
          <ErrorState
            title={t('errors.dbOpenTitle')}
            message={t('errors.dbOpenMessage')}
            actionLabel={t('common.tryAgain')}
            onAction={() => setDbError(null)}
          />
        ) : (
          /* Non-suspense SQLiteProvider renders null for the few ms the DB
             takes to open — imperceptible on the dark background, and children
             never mount before useSQLiteContext() is safe. */
          <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate} onError={onDbError}>
            <AppConfigProvider config={config}>
              <SettingsProvider>
                <NavigationContainer theme={navigationTheme}>
                  <RootNavigator />
                </NavigationContainer>
              </SettingsProvider>
            </AppConfigProvider>
          </SQLiteProvider>
        )}
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
