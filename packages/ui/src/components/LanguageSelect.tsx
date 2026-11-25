import { LANGUAGES, makeT } from '@skaitch/core/data/i18n';
import type { LangType } from '@skaitch/core/types/ifc';

export default function LanguageSelect({ lang, onChange }: {
  lang: LangType;
  onChange: (lang: LangType) => void;
}) {
  return (
    <select
      aria-label={makeT(lang)('Language')}
      value={lang}
      onChange={(event) => onChange(event.target.value as LangType)}
      style={{ maxWidth: '100%', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--panel)', color: 'var(--ink)', font: 'inherit' }}
    >
      {LANGUAGES.map(({ code, name }) => <option key={code} value={code} lang={code}>{name}</option>)}
    </select>
  );
}
