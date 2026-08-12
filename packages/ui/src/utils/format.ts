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

export function formatLastPlayed(timestamp: number | null): string {
  if (timestamp == null) return 'Never played';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestamp >= startOfToday) return 'Today';
  if (timestamp >= startOfToday - DAY_MS) return 'Yesterday';
  const daysAgo = Math.floor((startOfToday - timestamp) / DAY_MS) + 1;
  if (daysAgo < 30) return `${daysAgo} days ago`;
  return new Date(timestamp).toLocaleDateString();
}
