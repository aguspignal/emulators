import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: undefined;
  /**
   * `romId` is the library row; `romUri` is the ROM's `file://` URI derived
   * at navigation time via `romFileUri()` — never persisted.
   */
  Emulator: { romId: number; romUri: string };
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
