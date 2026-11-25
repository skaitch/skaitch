import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18N, LANGUAGES, makeT, resolveLanguage } from '@skaitch/core/data/i18n';
import frUi from '@skaitch/core/data/locales/fr-ui.json';
import LanguageSelect from '@skaitch/ui/components/LanguageSelect';
import HelpDocPanel from '@skaitch/ui/components/panels/HelpDocPanel';
import { shortName } from '@skaitch/ui/lib/format';

describe('languages shared with MeasureIt', () => {
  it('offers the same eleven languages', () => {
    expect(LANGUAGES.map(({ code }) => code)).toEqual([
      'fr', 'en', 'de', 'es', 'pt', 'it', 'nl', 'ar', 'zh', 'ja', 'ru',
    ]);
  });

  for (const { code, name } of LANGUAGES) {
    it(`provides the dictionary and language selector in ${name}`, () => {
      const dictionary = I18N[code];
      for (const key of Object.keys(I18N.en)) {
        expect(dictionary[key], `${code}: ${key}`).toBeTruthy();
      }
      if (code !== 'fr' && code !== 'en') {
        for (const key of Object.keys(frUi)) {
          expect(dictionary[key], `${code}: ${key}`).toBeTruthy();
        }
      }
      const html = renderToStaticMarkup(createElement(LanguageSelect, { lang: code, onChange: () => {} }));
      expect(html.match(/<option /g)).toHaveLength(11);
      expect(html).toMatch(new RegExp(`value="${code}"[^>]*selected=""`));
      expect(html).toContain(`aria-label="${makeT(code)('Language')}"`);
      expect(() => renderToStaticMarkup(createElement(HelpDocPanel, {
        open: true, onClose: () => {}, lang: code, selection: [], items: {},
      }))).not.toThrow();
    });
  }

  it('restores valid saved languages and defaults invalid values to French', () => {
    for (const { code } of LANGUAGES) expect(resolveLanguage(code)).toBe(code);
    for (const invalid of [undefined, null, '', 'xx', {}, 'constructor', '__proto__']) {
      expect(resolveLanguage(invalid)).toBe('fr');
    }
    expect(makeT('xx')('wall')).toBe('Mur');
  });

  it('preserves French and English labels and handles unknown keys safely', () => {
    expect(makeT('fr')('project')).toBe('Projet');
    expect(makeT('en')('project')).toBe('Project');
    expect(makeT('fr')('New project')).toBe('Nouveau projet');
    expect(makeT('de')('wall')).toBe('Wand');
    expect(makeT('ar')('wall')).toBe('جدار');
    expect(makeT('ja')('untranslated')).toBe('untranslated');
    expect(makeT('en')('constructor')).toBe('constructor');
  });

  it('localizes model labels while preserving their dimensions', () => {
    expect(shortName({ type: 'Door', name: 'DOOR_900x2100' }, 'es')).toBe('Puerta 900×2100');
    expect(shortName({ type: 'Window', name: 'WINDOW_1200x1000' }, 'ja')).toBe('窓 1200×1000');
    expect(shortName({ type: 'Door', name: 'DOOR_900x2100' }, 'fr')).toBe('Porte 900×2100');
  });

  it('preserves interpolation placeholders in every translation', () => {
    for (const [key, french] of Object.entries(frUi)) {
      const placeholders = key.match(/\{\w+\}/g)?.sort() ?? [];
      expect(french.match(/\{\w+\}/g)?.sort() ?? [], `fr: ${key}`).toEqual(placeholders);
      for (const { code } of LANGUAGES.filter(({ code }) => code !== 'fr' && code !== 'en')) {
        expect(I18N[code][key].match(/\{\w+\}/g)?.sort() ?? [], `${code}: ${key}`).toEqual(placeholders);
      }
    }
    expect(makeT('de')('Wall transparency ({pct}%)', { pct: 35 })).toBe('Wandtransparenz (35%)');
    expect(makeT('en')('Project “{name}” will be permanently deleted.', { name: '$& <house>' }))
      .toBe('Project “$& <house>” will be permanently deleted.');
  });
});
