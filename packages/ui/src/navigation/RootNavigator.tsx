import { Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors, fonts, spacing } from "../theme";
import { useAppConfig } from "../config";
import { HomeScreen } from "../screens/HomeScreen";
import { EmulatorScreen } from "../screens/EmulatorScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { LicenseScreen } from "../screens/LicenseScreen";
import { LanguageScreen } from "../screens/LanguageScreen";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  // Subscribes this component to language changes, so a pick in the language
  // screen retitles every header live.
  const { t } = useTranslation();
  const { consoles } = useAppConfig();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        // typography.title doesn't reach the native-stack header, so the
        // display face has to be stated here or the titles keep the default.
        headerTitleStyle: { fontFamily: fonts.display, fontWeight: "900" },
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
        // Declared here rather than through `navigation.setOptions` in the
        // screen: the gear depends on nothing the screen holds.
        options={({ navigation }) => ({
          title: t("home.title", {
            consoles: consoles.map((spec) => spec.abbreviation).join("/"),
          }),
          orientation: "portrait_up",
          headerRight: () => (
            <Pressable
              onPress={() => navigation.navigate("Settings")}
              hitSlop={spacing.sm}
              accessibilityRole="button"
              accessibilityLabel={t("settings.title")}
              style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonDimmed]}
            >
              <Ionicons name="settings-sharp" size={22} color={colors.text} />
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t("settings.title"), orientation: "portrait_up" }}
      />
      <Stack.Screen
        name="Language"
        component={LanguageScreen}
        options={{ title: t("settings.language"), orientation: "portrait_up" }}
      />
      <Stack.Screen
        name="License"
        component={LicenseScreen}
        options={{ title: t("settings.license"), orientation: "portrait_up" }}
      />
      <Stack.Screen
        name="Emulator"
        component={EmulatorScreen}
        // 'all' is a full sensor rotation: the game follows the phone into
        // landscape or portrait (EmulatorScreen lays itself out for both) even
        // when the system rotation lock is on, which players who keep that lock
        // enabled would otherwise experience as a pad frozen the wrong way up.
        options={{ headerShown: false, orientation: "all" }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  headerButton: { paddingHorizontal: spacing.sm },
  headerButtonDimmed: { opacity: 0.5 },
});
