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
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: appName }} />
      <Stack.Screen
        name="Emulator"
        component={EmulatorScreen}
        options={{ headerShown: false, orientation: 'landscape' }}
      />
    </Stack.Navigator>
  );
}
