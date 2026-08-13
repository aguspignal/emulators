import { spacing } from '../theme';

export interface PosterGridLayout {
  columns: number;
  /** Fixed pixel width per tile — see the note on flex below. */
  tileWidth: number;
  /** Horizontal space between tiles in a row. */
  gap: number;
  /** Vertical space between rows — wider than `gap`, so the bordered cards
   * read as a grid of separate objects rather than columns of stacked ones. */
  rowGap: number;
  padding: number;
}

/** Tile width to aim for. A ~390dp phone lands on three columns. */
const TARGET_TILE_WIDTH = 120;

/**
 * Splits the window into a poster grid. Pure, like the gamepad's `layout.ts`
 * — the screen measures nothing itself.
 *
 * Tiles get a fixed pixel width rather than `flex: 1`, because a final row
 * holding one of three items would otherwise stretch that tile across the
 * whole screen. The usual fix is padding the data with nulls, which infects
 * `keyExtractor` and `renderItem` with a case that isn't real; a fixed width
 * just left-aligns the last row, which is what you want anyway.
 */
export function posterGridLayout(windowWidth: number): PosterGridLayout {
  const gap = spacing.sm;
  const padding = spacing.md;
  const usable = windowWidth - padding * 2;
  const columns = Math.max(2, Math.floor((usable + gap) / (TARGET_TILE_WIDTH + gap)));
  // Floor leaves at most a couple of pixels of slack at the trailing edge.
  const tileWidth = Math.floor((usable - gap * (columns - 1)) / columns);
  return { columns, tileWidth, gap, rowGap: spacing.lg, padding };
}

/**
 * Slices a flat list into rows of `columns`. The library is a SectionList of
 * rows rather than a `numColumns` FlatList, because favourites and the rest
 * are separate sections and `numColumns` can't span them.
 */
export function chunkRows<T>(items: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}
