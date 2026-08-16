export const colors = {
  background: "#101014",
  surface: "#1c1c22",
  text: "#f2f2f5",
  textMuted: "#9a9aa5",
  primary: "#D90000",
  danger: "#ff5a52",
  border: "#2e2e38",
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

/**
 * Both families are embedded natively by each app's `expo-font` config plugin
 * entry (see the app.json files), not loaded at runtime — there is no async
 * gate and no font flash.
 */
export const fonts = {
  /** Tourney, registered at Black (900) only. Latin-only: headings and short labels. */
  display: "Tourney",
  /** Roboto 400/600. Carries Cyrillic and Greek — everything read in sentences. */
  body: "Roboto",
} as const;

export const typography = {
  title: { fontFamily: fonts.display, fontSize: 18, fontWeight: "900" },
  body: { fontFamily: fonts.body, fontSize: 14, fontWeight: "400" },
  caption: { fontFamily: fonts.body, fontSize: 12, fontWeight: "400" },
  button: { fontFamily: fonts.display, fontSize: 14, fontWeight: "900" },
} as const;
