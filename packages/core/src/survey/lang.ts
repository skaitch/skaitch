import ar from './i18n/ar.js';
import de from './i18n/de.js';
import es from './i18n/es.js';
import it from './i18n/it.js';
import ja from './i18n/ja.js';
import nl from './i18n/nl.js';
import pt from './i18n/pt.js';
import ru from './i18n/ru.js';
import zh from './i18n/zh.js';

/**
 * Language of the survey texts (interface, checks, errors, hints): the same 11 languages as
 * skAItch. Texts are written in French and English at each call, tr(fr, en); the other
 * languages come from tables keyed by the English text. French remains the default.
 */
export const SURVEY_LANGUAGES = ['fr', 'en', 'de', 'es', 'pt', 'it', 'nl', 'ar', 'zh', 'ja', 'ru'] as const;
export type SurveyLang = (typeof SURVEY_LANGUAGES)[number];
/** Each language in its own words, for a language picker. */
export const SURVEY_LANGUAGE_NAMES: Record<SurveyLang, string> = {
  fr: 'Français', en: 'English', de: 'Deutsch', es: 'Español', pt: 'Português', it: 'Italiano',
  nl: 'Nederlands', ar: 'العربية', zh: '中文', ja: '日本語', ru: 'Русский',
};

const TABLES: Partial<Record<SurveyLang, Record<string, string>>> = { ar, de, es, it, ja, nl, pt, ru, zh };

let current: SurveyLang = 'fr';
let table: Record<string, string> = {};
/** Keys with values put in ({0}, {1}…), matched against the English text built by the caller. */
let patterns: { re: RegExp; text: string }[] = [];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The language of a code such as "de-AT", or English when skAItch has no such language. */
export function surveyLangOf(code: string | null | undefined): SurveyLang {
  const c = String(code ?? 'fr').toLowerCase().slice(0, 2);
  return (SURVEY_LANGUAGES as readonly string[]).includes(c) ? (c as SurveyLang) : 'en';
}

export function setSurveyLanguage(lang: string | null | undefined) {
  current = surveyLangOf(lang);
  table = TABLES[current] ?? {};
  patterns = Object.entries(table)
    .filter(([key]) => /\{\d+\}/.test(key))
    // The most specific keys first: "{0}: room not placed…" before the bare "{0}: {1}".
    .sort(([a], [b]) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length)
    .map(([key, text]) => ({ re: new RegExp(`^${escape(key).replace(/\\\{(\d+)\\\}/g, '(?<v$1>[\\s\\S]*?)')}$`), text }));
}

export function surveyLanguage(): SurveyLang {
  return current;
}

/** Picks the text for the current language; an untranslated text stays in English. */
export function tr(fr: string, en: string): string {
  if (current === 'fr') return fr;
  if (current === 'en') return en;
  const exact = table[en];
  if (exact !== undefined) return exact;
  for (const { re, text } of patterns) {
    const m = re.exec(en);
    if (m) return text.replace(/\{(\d+)\}/g, (_, i: string) => m.groups?.[`v${i}`] ?? '');
  }
  return en;
}
