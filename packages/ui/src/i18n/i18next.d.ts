import type en from './locales/en';

// Feeds the English catalog's shape to t()'s types: a key typo anywhere in
// this package is a compile error. Only `en` participates — the other
// catalogs may legitimately differ in plural suffixes.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
