import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme';
import { useAppConfig } from '../config';
import { HomeScreen } from '../screens/HomeScreen';
import { EmulatorScreen } from '../screens/EmulatorScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { appName } = useAppConfig();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {/*
        Stated rather than inherited from app.json: react-native-screens resets
        the activity to "unspecified" — not to the manifest value — once a
        screen that set an orientation pops, so exiting a game held sideways
        would otherwise drop a portrait-only library screen into landscape.
      */}
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: appName, orientation: 'portrait_up' }}
      />
      <Stack.Screen
        name="Emulator"
        component={EmulatorScreen}
        // 'all' is a full sensor rotation: the game follows the phone into
        // landscape or portrait (EmulatorScreen lays itself out for both) even
        // when the system rotation lock is on, which players who keep that lock
        // enabled would otherwise experience as a pad frozen the wrong way up.
        options={{ headerShown: false, orientation: 'all' }}
      />
    </Stack.Navigator>
  );
}
