/**
 * Interface language: Turkish in a Turkish browser, English everywhere else. Follows the browser's
 * own language, as extension stores expect; each text sits next to its translation.
 */
export type Lang = 'tr' | 'en';

const uiLanguage = (): string => {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    // Unit tests run outside the browser and check the Turkish texts.
    return 'tr';
  }
};

export const LANG: Lang = uiLanguage().toLowerCase().startsWith('tr') ? 'tr' : 'en';

/** The text for the current language. Works for strings and JSX alike. */
export function L<T>(tr: T, en: T): T {
  return LANG === 'tr' ? tr : en;
}

/** Locale for numbers and dates. */
export const LOCALE = L('tr-TR', 'en-US');
