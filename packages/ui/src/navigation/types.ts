import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: undefined;
  /**
   * `romId` is the library row; `romUri` is the ROM's `file://` URI derived
   * at navigation time via `romFileUri()` — never persisted. `romName` is the
   * library `display_name`, shown by the pause menu.
   */
  Emulator: { romId: number; romUri: string; romName: string };
  Settings: undefined;
  /** Reads its text from `AppConfig.licenseNotice`, so it takes no params. */
  License: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
