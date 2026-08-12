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
  setFavorite,
  type RomRow,
} from '@emulators/storage';
import { useAppConfig } from '../config';
import { useRoms } from '../storage/useRoms';
import { EmptyLibrary } from '../components/EmptyLibrary';
import { ErrorState } from '../components/ErrorState';
import { RomListItem } from '../components/RomListItem';
import { colors, spacing, typography } from '../theme';
import { showErrorAlert } from '../utils/errors';
import type { RootScreenProps } from '../navigation/types';

/** The ROM library: list, import, favorite/delete, and boot-on-tap. */
export function HomeScreen({ navigation }: RootScreenProps<'Home'>) {
  const { consoles } = useAppConfig();
  const db = useSQLiteContext();
  const { roms, loading, error, reload } = useRoms();
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
      showErrorAlert('Import failed', error);
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
      try {
        // The absolute URI is derived at tap time, never persisted.
        navigation.navigate('Emulator', { romId: rom.id, romUri: romFileUri(rom.file_name) });
      } catch (error) {
        showErrorAlert("Couldn't open game", error);
      }
    },
    [navigation]
  );

  const showRomActions = useCallback(
    (rom: RomRow) => {
      Alert.alert(rom.display_name, undefined, [
        {
          text: rom.favorite === 1 ? 'Unfavorite' : 'Favorite',
          onPress: () => {
            setFavorite(db, rom.id, rom.favorite !== 1)
              .then(() => reload())
              .catch((error: unknown) => showErrorAlert("Couldn't update favorite", error));
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Deleting a ROM does NOT remove its battery save or savestates
            // under filesDir/mgba/{saves,states}/<sha1>.* — JS has no access
            // to the SHA-1. Resolved by the deferred RomInfo.sha1 change.
            try {
              await deleteRomRow(db, rom.id);
            } catch (error) {
              showErrorAlert("Couldn't delete game", error);
              return;
            }
            // Row first, then file: failing here leaves only an orphan file
            // on disk, never a library entry pointing at a missing ROM.
            try {
              deleteRomFile(rom.file_name);
            } catch (error) {
              console.error('ROM file left behind:', error);
            }
            void reload();
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
      ListEmptyComponent={
        loading ? null : error != null ? (
          <ErrorState
            title="Couldn't load your library"
            message="Something went wrong reading your games."
            actionLabel="Retry"
            onAction={() => void reload()}
          />
        ) : (
          <EmptyLibrary onAdd={importRom} />
        )
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await reload();
            setRefreshing(false);
          }}
          tintColor={colors.text}
        />
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
