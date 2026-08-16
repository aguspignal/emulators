import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSQLiteContext } from "expo-sqlite";
import {
  acceptedExtensions,
  deleteCoversForRom,
  deleteRomFile,
  deleteRomRow,
  deleteSaveStatesForRom,
  deleteStateThumbsForRom,
  importRomFromUri,
  pickAndImportFolder,
  pickAndImportRom,
  resetRomCover,
  retryFailedCovers,
  romFileUri,
  setFavorite,
  type FolderImportProgress,
  type RomRow,
} from "@emulators/storage";
import { useAppConfig } from "../config";
import { useRoms } from "../storage/useRoms";
import { useCoverSweep } from "../storage/useCoverSweep";
import { useOpenedRom } from "../storage/useOpenedRom";
import { EmptyLibrary } from "../components/EmptyLibrary";
import { ErrorState } from "../components/ErrorState";
import { ImportProgress } from "../components/ImportProgress";
import { PrimaryButton } from "../components/PrimaryButton";
import { RomTile } from "../components/RomTile";
import { chunkRows, posterGridLayout } from "../components/posterGrid";
import { colors, spacing, typography } from "../theme";
import { formatBytes, formatLastPlayed } from "../utils/format";
import { showErrorAlert } from "../utils/errors";
import type { RootScreenProps } from "../navigation/types";

/**
 * ROMs whose cover file failed to load this session. One reset attempt each
 * is enough — a second would mean the re-fetch also produced a bad file, and
 * retrying that in a loop is worse than a blank tile.
 */
const selfHealed = new Set<number>();

/** The ROM library: list, import, favorite/delete, and boot-on-tap. */
export function HomeScreen({ navigation }: RootScreenProps<"Home">) {
  const { t } = useTranslation();
  const { consoles, core } = useAppConfig();
  const db = useSQLiteContext();
  const { roms, loading, error, reload } = useRoms();
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<FolderImportProgress | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const grid = posterGridLayout(width);
  const sweepCovers = useCoverSweep(reload);

  // Favourites get their own section once there is one to show; "My games"
  // is always titled, favourites or not.
  const sections = useMemo<{ title: string; data: RomRow[][] }[]>(() => {
    // No sections at all rather than one empty section: SectionList counts a
    // section's header and footer as items, so an empty section would keep
    // `ListEmptyComponent` from ever rendering.
    if (roms.length === 0) return [];
    const favorites = roms.filter((rom) => rom.favorite === 1);
    const rest = roms.filter((rom) => rom.favorite !== 1);
    return [
      ...(favorites.length > 0
        ? [{ title: t("home.favorites"), data: chunkRows(favorites, grid.columns) }]
        : []),
      ...(rest.length > 0
        ? [{ title: t("home.myGames"), data: chunkRows(rest, grid.columns) }]
        : []),
    ];
    // t's identity changes with the language — exactly the invalidation wanted.
  }, [roms, grid.columns, t]);

  const importOneRom = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const result = await pickAndImportRom(db, consoles);
      if (result.status === "imported") {
        await reload();
        // Deliberately here rather than inside pickAndImportRom: that
        // function's thrown errors are user-facing copy, and awaiting a
        // network call in it would hang the import behind a captive portal.
        sweepCovers();
      } else if (result.status === "duplicate") {
        Alert.alert(
          t("home.duplicateTitle"),
          t("home.duplicateMessage", { name: result.displayName }),
        );
      }
    } catch (error) {
      showErrorAlert(t("home.importFailed"), error);
    } finally {
      setImporting(false);
    }
  }, [db, consoles, reload, importing, sweepCovers, t]);

  const importFolder = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const result = await pickAndImportFolder(db, consoles, setProgress);
      if (result.status !== "done") return;

      await reload();
      sweepCovers();

      const { imported, duplicates, skipped, failed } = result;
      // Nothing in the folder was a ROM for this app — "12 files skipped"
      // would leave the user guessing what it wanted instead.
      if (imported + duplicates + failed === 0) {
        Alert.alert(
          t("home.importDoneTitle"),
          t("home.importNoneFound", { extensions: acceptedExtensions(consoles) }),
        );
        return;
      }
      // Only the counts that actually happened, so a clean run reads as one
      // line rather than three zeroes.
      const lines = [
        imported > 0 ? t("home.importedCount", { count: imported }) : null,
        duplicates > 0 ? t("home.importDuplicateCount", { count: duplicates }) : null,
        skipped > 0 ? t("home.importSkippedCount", { count: skipped }) : null,
        failed > 0 ? t("home.importFailedCount", { count: failed }) : null,
      ].filter((line): line is string => line !== null);
      Alert.alert(t("home.importDoneTitle"), lines.join("\n"));
    } catch (error) {
      showErrorAlert(t("home.importFailed"), error);
    } finally {
      setProgress(null);
      setImporting(false);
    }
  }, [db, consoles, reload, importing, sweepCovers, t]);

  // Both entry points stay: picking one game out of Downloads shouldn't mean
  // granting access to the whole folder.
  const startImport = useCallback(() => {
    if (importing) return;
    Alert.alert(t("home.importChooseTitle"), t("home.importChooseMessage"), [
      { text: t("home.importPickFile"), onPress: () => void importOneRom() },
      { text: t("home.importPickFolder"), onPress: () => void importFolder() },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }, [importing, importOneRom, importFolder, t]);

  const openRom = useCallback(
    (rom: RomRow) => {
      try {
        // The absolute URI is derived at tap time, never persisted.
        navigation.navigate("Emulator", {
          romId: rom.id,
          romUri: romFileUri(rom.file_name),
          romName: rom.display_name,
        });
      } catch (error) {
        showErrorAlert(t("home.openFailed"), error);
      }
    },
    [navigation, t],
  );

  // A ROM the system handed us: a file manager's "open with". Import it the
  // same way the picker would, then boot it — a duplicate is not an error
  // here, it just means the library already has the row to boot.
  useOpenedRom(
    useCallback(
      async (uri: string) => {
        setImporting(true);
        try {
          const result = await importRomFromUri(db, consoles, uri);
          if (result.status === "imported") {
            await reload();
            sweepCovers();
          }
          openRom(result.rom);
        } catch (error) {
          showErrorAlert(t("home.importFailed"), error);
        } finally {
          setImporting(false);
        }
      },
      [db, consoles, reload, sweepCovers, openRom, t],
    ),
  );

  // Size and last-played lost their place in the move from row to tile, so
  // the long-press alert — which passed no message before — carries them now.
  const showRomActions = useCallback(
    (rom: RomRow) => {
      const subtitle = [
        consoles.find((c) => c.id === rom.console_id)?.displayName ?? rom.console_id,
        formatBytes(rom.size),
        formatLastPlayed(rom.last_played_at),
      ].join(" · ");
      Alert.alert(rom.display_name, subtitle, [
        {
          text: rom.favorite === 1 ? t("home.unfavorite") : t("home.favorite"),
          onPress: () => {
            setFavorite(db, rom.id, rom.favorite !== 1)
              .then(() => reload())
              .catch((error: unknown) => showErrorAlert(t("home.updateFavoriteFailed"), error));
          },
        },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteRomRow(db, rom.id);
            } catch (error) {
              showErrorAlert(t("home.deleteFailed"), error);
              return;
            }
            // Row first, then everything it owned: failing below leaves only
            // orphan files on disk, never a library entry pointing at a
            // missing ROM. `sha1` is null only for a ROM that was never
            // played since the upgrade that added the column — which is also
            // a ROM that has no saves.
            try {
              deleteRomFile(rom.file_name);
              await deleteSaveStatesForRom(db, rom.id);
              deleteStateThumbsForRom(rom.id);
              deleteCoversForRom(rom.id);
              if (rom.sha1) await core.deleteSaveData(rom.sha1);
            } catch (error) {
              console.error("leftovers from deleted ROM:", error);
            }
            void reload();
          },
        },
        { text: t("common.cancel"), style: "cancel" },
      ]);
    },
    [db, core, reload, t],
  );

  const handleCoverMissing = useCallback(
    (romId: number) => {
      if (selfHealed.has(romId)) return;
      selfHealed.add(romId);
      // Deliberately no reload(): that re-renders the image, which fails
      // again, which calls this again. The next sweep picks the row up.
      resetRomCover(db, romId).catch((error: unknown) =>
        console.warn("could not reset a broken cover:", error),
      );
    },
    [db],
  );

  return (
    <>
      <SectionList
        sections={sections}
        // One item is a whole row of tiles, so the id of its first ROM
        // identifies it and shifts with the row when the library changes.
        keyExtractor={(row) => `row-${row[0]?.id ?? "empty"}`}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        // Tiles take their cover's own shape, so a row's items differ in
        // height; top-aligning keeps the posters on one line rather than
        // centring each against the tallest.
        renderItem={({ item: row }) => (
          <View style={[styles.row, { gap: grid.gap, marginBottom: grid.rowGap }]}>
            {row.map((rom) => (
              <RomTile
                key={rom.id}
                rom={rom}
                width={grid.tileWidth}
                onPress={() => openRom(rom)}
                onLongPress={() => showRomActions(rom)}
                onCoverMissing={handleCoverMissing}
              />
            ))}
          </View>
        )}
        contentContainerStyle={
          roms.length === 0 ? styles.emptyContainer : { padding: grid.padding }
        }
        // Only above a library that has something in it: the empty state carries
        // its own add button, and SectionList renders both header and empty
        // component, which would show two.
        ListHeaderComponent={
          roms.length === 0 ? null : (
            <View style={styles.listHeader}>
              <PrimaryButton label={t("home.addRom")} onPress={startImport} disabled={importing} />
            </View>
          )
        }
        ListEmptyComponent={
          loading ? null : error != null ? (
            <ErrorState
              title={t("home.loadFailedTitle")}
              message={t("home.loadFailedMessage")}
              actionLabel={t("common.retry")}
              onAction={() => void reload()}
            />
          ) : (
            <EmptyLibrary onAdd={startImport} />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              // Clears the backoff first, so a pull is also "try the covers
              // that failed while I was offline, now".
              await retryFailedCovers(db).catch((error: unknown) =>
                console.warn("could not clear cover backoff:", error),
              );
              await reload();
              setRefreshing(false);
              sweepCovers();
            }}
            tintColor={colors.text}
          />
        }
      />
      <ImportProgress
        visible={progress !== null}
        done={progress?.done ?? 0}
        total={progress?.total ?? 0}
        currentName={progress?.currentName ?? ""}
      />
    </>
  );
}

const styles = StyleSheet.create({
  emptyContainer: { flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "flex-start" },
  sectionHeader: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.md,
  },
  listHeader: { marginBottom: spacing.md },
});
