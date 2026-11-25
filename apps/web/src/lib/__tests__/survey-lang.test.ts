import { afterEach, describe, expect, it } from 'vitest';
import { surveyChecks } from '@skaitch/core/survey/checks';
import { addRectangleRoom, newSurvey, setWallLength } from '@skaitch/core/survey/edit';
import { setSurveyLanguage } from '@skaitch/core/survey/lang';

function survey() {
  let s = newSurvey('House');
  const a = addRectangleRoom(s, s.levels[0].id, 'Living', 0, 0, 4, 3);
  s = a.survey;
  [4, 3, 4, 3].forEach((l, i) => { s = setWallLength(s, a.roomId, `${a.roomId}_w${i + 1}`, l, 'laser'); });
  // A second room that is not connected to the first one.
  return addRectangleRoom(s, s.levels[0].id, 'Bath', 5, 0, 2, 2).survey;
}

describe('survey messages follow the interface language', () => {
  afterEach(() => setSurveyLanguage('fr'));

  it('speaks French by default', () => {
    const messages = surveyChecks(survey()).map(c => c.message).join('\n');
    expect(messages).toContain('pièce non positionnée');
    expect(messages).toContain('mur(s) sans cote mesurée');
  });

  it('speaks English for an English interface', () => {
    setSurveyLanguage('en-US');
    const messages = surveyChecks(survey()).map(c => c.message).join('\n');
    expect(messages).toContain('Bath: room not placed relative to the reference room');
    expect(messages).toContain('wall(s) without a measured dimension');
    expect(messages).not.toMatch(/[éèàùçêîôû«»]/);
  });

  it('translates into the other languages of skAItch, values included', () => {
    setSurveyLanguage('de');
    expect(() => setWallLength(survey(), 'missing', 'w', 1)).toThrow('Raum nicht gefunden: missing');
    setSurveyLanguage('ja');
    expect(surveyChecks(survey()).map(c => c.message).join('\n')).toContain('基準の部屋に対して配置されていません');
  });

  it('uses English for a language skAItch has not got', () => {
    setSurveyLanguage('sv');
    expect(() => setWallLength(survey(), 'missing', 'w', 1)).toThrow('Room not found: missing');
  });
});
