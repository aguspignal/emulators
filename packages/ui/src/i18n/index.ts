// Hermes ships no Intl.PluralRules and i18next v24+ has no non-Intl fallback;
// the polyfill self-checks, so it no-ops if the engine ever gains native
// support. Must be imported before init.
import 'intl-pluralrules';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import de from './locales/de';
import en from './locales/en';
import es from './locales/es';
import fr from './locales/fr';
import it from './locales/it';
import ja from './locales/ja';
import ko from './locales/ko';
import pt from './locales/pt';
import ru from './locales/ru';
import zh from './locales/zh';

/**
 * One catalog per language, deliberately keyed by bare language code: the
 * Spanish catalog is written in Latin American Spanish and the Portuguese one
 * in Brazilian Portuguese, and both serve every regional variant (es-ES,
 * pt-PT, …). Chinese is Simplified, serving zh-Hant devices too.
 * Endonyms are each language's own name — they belong to no catalog.
 */
export const LANGUAGES = [
  { code: 'en', endonym: 'English' },
  { code: 'es', endonym: 'Español' },
  { code: 'pt', endonym: 'Português (Brasil)' },
  { code: 'de', endonym: 'Deutsch' },
  { code: 'fr', endonym: 'Français' },
  { code: 'it', endonym: 'Italiano' },
  { code: 'ru', endonym: 'Русский' },
  { code: 'ja', endonym: '日本語' },
  { code: 'ko', endonym: '한국어' },
  { code: 'zh', endonym: '中文' },
] as const;

export type SupportedLanguage = (typeof LANGUAGES)[number]['code'];

const SUPPORTED = new Set<string>(LANGUAGES.map((language) => language.code));

export function isSupportedLanguage(code: string): code is SupportedLanguage {
  return SUPPORTED.has(code);
}

/** First supported language in the device's ordered preference list, else English. */
export function resolveDeviceLanguage(): SupportedLanguage {
  for (const { languageCode } of getLocales()) {
    if (languageCode && isSupportedLanguage(languageCode)) return languageCode;
  }
  return 'en';
}

// Module-scope, synchronous init on the default instance: catalogs are
// bundled, so `t()` works from the first render and `useTranslation()` needs
// no provider — which is what lets the class `ErrorBoundary` and the
// pre-SQLite db-error `ErrorState` translate too. The device language applies
// here; a persisted override is applied by `SettingsProvider` once SQLite is
// open, before it lets the navigation tree render.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    pt: { translation: pt },
    de: { translation: de },
    fr: { translation: fr },
    it: { translation: it },
    ru: { translation: ru },
    ja: { translation: ja },
    ko: { translation: ko },
    zh: { translation: zh },
  },
  lng: resolveDeviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React Native renders strings, not HTML
  initAsync: false, // synchronous init — t() is safe from the first render
  react: { useSuspense: false },
});

export default i18n;
