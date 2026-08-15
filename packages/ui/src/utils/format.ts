import i18n from '../i18n';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Age of something that can happen many times a day — savestates, where
 * "Today" would be useless for telling two slots apart.
 */
export function formatRelativeTime(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  if (elapsed < MINUTE_MS) return i18n.t('time.justNow');
  if (elapsed < HOUR_MS) return i18n.t('time.minutesAgo', { count: Math.floor(elapsed / MINUTE_MS) });
  if (elapsed < DAY_MS) return i18n.t('time.hoursAgo', { count: Math.floor(elapsed / HOUR_MS) });
  const days = Math.floor(elapsed / DAY_MS);
  if (days < 7) return i18n.t('time.daysAgo', { count: days });
  return new Date(timestamp).toLocaleDateString(i18n.language);
}

export function formatLastPlayed(timestamp: number | null): string {
  if (timestamp == null) return i18n.t('time.neverPlayed');
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestamp >= startOfToday) return i18n.t('time.today');
  if (timestamp >= startOfToday - DAY_MS) return i18n.t('time.yesterday');
  const daysAgo = Math.floor((startOfToday - timestamp) / DAY_MS) + 1;
  if (daysAgo < 30) return i18n.t('time.daysAgoLong', { count: daysAgo });
  return new Date(timestamp).toLocaleDateString(i18n.language);
}
