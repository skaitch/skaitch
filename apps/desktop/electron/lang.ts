/**
 * Language of the main process's messages (AI errors, key storage…): the interface language,
 * reported by the preload whenever the page's `lang` changes. Until then, the system language.
 * Only French and English messages exist: every other language gets English.
 */
let fr = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('fr');

export function setUiLanguage(lang: unknown) {
  if (typeof lang === 'string' && lang) fr = lang.toLowerCase().startsWith('fr');
}

export const tr = (french: string, english: string) => (fr ? french : english);
