export const colors = {
  background: '#101014',
  surface: '#1c1c22',
  text: '#f2f2f5',
  textMuted: '#9a9aa5',
  primary: '#e60012',
  danger: '#ff5a52',
  border: '#2e2e38',
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 16, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '400' },
} as const;
