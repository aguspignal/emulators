import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSQLiteContext } from 'expo-sqlite';
import {
  AUTO_SAVESTATE_SLOT,
  SAVESTATE_SLOTS,
  type ConsoleSpec,
} from '@emulators/core-interface';
import {
  deleteSaveState,
  deleteStateThumb,
  listSaveStates,
  stateThumbUri,
  type SaveStateRow,
} from '@emulators/storage';
import { useAppConfig } from '../../config';
import { colors, radius, spacing, typography } from '../../theme';
import { showErrorAlert } from '../../utils/errors';
import { formatRelativeTime } from '../../utils/format';
import { Dialog, type DialogRequest } from '../Dialog';
import { SecondaryButton } from './SecondaryButton';

export interface SlotSheetProps {
  mode: 'save' | 'load';
  romId: number;
  /** The console the core detected, which shapes the thumbnails. */
  spec: ConsoleSpec;
  /** The parent owns the core call, its failure alert, and closing the menu. */
  onPick: (slot: number) => void;
  onBack: () => void;
}

interface SlotEntry {
  slot: number;
  label: string;
  saved: SaveStateRow | null;
}

/**
 * The thumbnail's shorter side; the longer one follows the console's aspect.
 * Fixing the shorter side rather than the height is what keeps a two-screen
 * console — whose composited frame is taller than it is wide — from being
 * squeezed into a sliver beside the row's two lines of text.
 */
const THUMB_SHORT_SIDE = 48;
/** Slot 0 belongs to the automatic save; the rest are the player's. */
const USER_SLOTS = Array.from({ length: SAVESTATE_SLOTS - 1 }, (_, index) => index + 1);

/**
 * Picks a savestate slot, for saving or loading. Lives in the pause menu's
 * layer, so the gamepad below is already suspended and plain `Pressable`s work.
 */
export function SlotSheet({ mode, romId, spec, onPick, onBack }: SlotSheetProps) {
  const { t } = useTranslation();
  const { core } = useAppConfig();
  const db = useSQLiteContext();
  const [saved, setSaved] = useState<SaveStateRow[] | null>(null);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);

  const reload = useCallback(() => {
    listSaveStates(db, romId)
      .then(setSaved)
      .catch((error: unknown) => {
        // Failing to read the list must not hide the slots themselves: saving
        // still works, the rows just look empty.
        console.error('listSaveStates failed:', error);
        setSaved([]);
      });
  }, [db, romId]);

  useEffect(reload, [reload]);

  const pick = useCallback(
    (entry: SlotEntry) => {
      // Loading costs nothing, but saving destroys whatever the slot held —
      // and the rows look alike, so a mis-tap is easy.
      if (mode === 'save' && entry.saved) {
        setDialog({
          title: entry.label,
          message: t('slots.overwriteMessage', {
            time: formatRelativeTime(entry.saved.saved_at),
          }),
          buttons: [
            { label: t('common.cancel'), style: 'cancel' },
            {
              label: t('slots.overwrite'),
              style: 'destructive',
              onPress: () => onPick(entry.slot),
            },
          ],
        });
        return;
      }
      onPick(entry.slot);
    },
    [mode, onPick, t]
  );

  const confirmDelete = useCallback(
    (entry: SlotEntry) => {
      const row = entry.saved;
      if (!row) return;
      setDialog({
        title: entry.label,
        message: t('slots.deleteMessage'),
        buttons: [
          { label: t('common.cancel'), style: 'cancel' },
          {
            label: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              try {
                await core.deleteState(entry.slot);
                await deleteSaveState(db, romId, entry.slot);
              } catch (error) {
                showErrorAlert(t('slots.deleteFailed'), error);
                return;
              }
              try {
                deleteStateThumb(romId, entry.slot, row.saved_at);
              } catch (error) {
                console.error('thumbnail left behind:', error);
              }
              reload();
            },
          },
        ],
      });
    },
    [core, db, romId, reload, t]
  );

  const loaded = saved !== null;
  const bySlot = new Map((saved ?? []).map((row) => [row.slot, row]));
  const entries: SlotEntry[] = [];
  const auto = bySlot.get(AUTO_SAVESTATE_SLOT);
  // Offered to load from, never to save into: the automatic slot belongs to the
  // exit/background save, which overwrites it without asking.
  if (mode === 'load' && auto) {
    entries.push({ slot: AUTO_SAVESTATE_SLOT, label: t('slots.auto'), saved: auto });
  }
  for (const slot of USER_SLOTS) {
    entries.push({ slot, label: t('slots.slot', { number: slot }), saved: bySlot.get(slot) ?? null });
  }

  const thumb = thumbSize(spec);
  const anySaved = entries.some((entry) => entry.saved);

  return (
    <Pressable style={styles.scrim} onPress={onBack}>
      <Pressable style={styles.card} onPress={() => {}}>
        <Text style={styles.title}>{mode === 'save' ? t('slots.saveTitle') : t('slots.loadTitle')}</Text>
        <FlatList
          data={entries}
          style={styles.list}
          keyExtractor={(entry) => String(entry.slot)}
          renderItem={({ item }) => {
            // Loading an empty slot is the only impossible action; saving over
            // one is normal.
            const disabled = mode === 'load' && !item.saved;
            return (
              <Pressable
                onPress={() => pick(item)}
                onLongPress={() => confirmDelete(item)}
                disabled={disabled}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                  disabled && styles.rowDisabled,
                ]}
              >
                <View style={[styles.thumb, thumb]}>
                  {item.saved && (
                    <Image
                      source={{ uri: stateThumbUri(romId, item.slot, item.saved.saved_at) }}
                      style={styles.thumbImage}
                      resizeMode="contain"
                    />
                  )}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  <Text style={styles.rowMeta}>
                    {!loaded
                      ? ''
                      : item.saved
                        ? formatRelativeTime(item.saved.saved_at)
                        : t('slots.empty')}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
        {anySaved && <Text style={styles.hint}>{t('slots.holdToDelete')}</Text>}
        <SecondaryButton label={t('common.back')} onPress={onBack} />
        <Dialog visible={dialog !== null} request={dialog} onClose={() => setDialog(null)} />
      </Pressable>
    </Pressable>
  );
}

/** Cores draw every screen into one framebuffer, stacked top to bottom. */
function thumbSize(spec: ConsoleSpec): { width: number; height: number } {
  const width = Math.max(...spec.screens.map((screen) => screen.width));
  const height = spec.screens.reduce((total, screen) => total + screen.height, 0);
  const aspect = height > 0 ? width / height : 1;
  return aspect >= 1
    ? { width: Math.round(THUMB_SHORT_SIDE * aspect), height: THUMB_SHORT_SIDE }
    : { width: THUMB_SHORT_SIDE, height: Math.round(THUMB_SHORT_SIDE / aspect) };
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    minWidth: 300,
    maxWidth: '85%',
    // Landscape leaves little height; the list scrolls rather than overflowing.
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed: { opacity: 0.6 },
  rowDisabled: { opacity: 0.35 },
  thumb: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    // Shows through while the image loads, and stands in for a slot whose
    // thumbnail never got written.
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  rowText: { flex: 1 },
  rowLabel: { ...typography.body, fontWeight: '600', color: colors.text },
  rowMeta: { ...typography.caption, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
