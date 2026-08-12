import { useCallback, useLayoutEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import {
  deleteRomFile,
  deleteRomRow,
  pickAndImportRom,
  romFileUri,
  RomImportError,
  setFavorite,
  type RomRow,
} from '@emulators/storage';
import { useAppConfig } from '../config';
import { useRoms } from '../storage/useRoms';
import { EmptyLibrary } from '../components/EmptyLibrary';
import { RomListItem } from '../components/RomListItem';
import { colors, spacing, typography } from '../theme';
import type { RootScreenProps } from '../navigation/types';

/** The ROM library: list, import, favorite/delete, and boot-on-tap. */
export function HomeScreen({ navigation }: RootScreenProps<'Home'>) {
  const { consoles } = useAppConfig();
  const db = useSQLiteContext();
  const { roms, loading, reload } = useRoms();
  const [importing, setImporting] = useState(false);

  const importRom = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const result = await pickAndImportRom(db, consoles);
      if (result.status === 'imported') {
        await reload();
      } else if (result.status === 'duplicate') {
        Alert.alert('Already in library', `${result.displayName} is already in your library.`);
      }
    } catch (error) {
      Alert.alert(
        'Import failed',
        error instanceof RomImportError ? error.message : String(error)
      );
    } finally {
      setImporting(false);
    }
  }, [db, consoles, reload, importing]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={importRom} disabled={importing} hitSlop={spacing.sm}>
          <Text style={[styles.addButton, importing && styles.addButtonDimmed]}>+</Text>
        </Pressable>
      ),
    });
  }, [navigation, importRom, importing]);

  const openRom = useCallback(
    (rom: RomRow) => {
      // The absolute URI is derived at tap time, never persisted.
      navigation.navigate('Emulator', { romId: rom.id, romUri: romFileUri(rom.file_name) });
    },
    [navigation]
  );

  const showRomActions = useCallback(
    (rom: RomRow) => {
      Alert.alert(rom.display_name, undefined, [
        {
          text: rom.favorite === 1 ? 'Unfavorite' : 'Favorite',
          onPress: () => {
            setFavorite(db, rom.id, rom.favorite !== 1).then(reload);
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Deleting a ROM does NOT remove its battery save or savestates
            // under filesDir/mgba/{saves,states}/<sha1>.* — JS has no access
            // to the SHA-1. Resolved by the deferred RomInfo.sha1 change.
            deleteRomFile(rom.file_name);
            deleteRomRow(db, rom.id).then(reload);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [db, reload]
  );

  const consoleName = useCallback(
    (rom: RomRow) =>
      consoles.find((c) => c.id === rom.console_id)?.displayName ?? rom.console_id,
    [consoles]
  );

  return (
    <FlatList
      data={roms}
      keyExtractor={(rom) => String(rom.id)}
      renderItem={({ item }) => (
        <RomListItem
          rom={item}
          consoleName={consoleName(item)}
          onPress={() => openRom(item)}
          onLongPress={() => showRomActions(item)}
        />
      )}
      contentContainerStyle={roms.length === 0 ? styles.emptyContainer : styles.listContainer}
      ListEmptyComponent={loading ? null : <EmptyLibrary onAdd={importRom} />}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.text} />
      }
    />
  );
}

const styles = StyleSheet.create({
  listContainer: { paddingVertical: spacing.md },
  emptyContainer: { flexGrow: 1 },
  addButton: { ...typography.title, color: colors.primary, paddingHorizontal: spacing.sm },
  addButtonDimmed: { opacity: 0.4 },
});
