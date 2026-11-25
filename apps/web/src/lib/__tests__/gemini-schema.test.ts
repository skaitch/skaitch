import { describe, expect, it } from 'vitest';
import { geminiSchema } from '../../../server/ai/chat';
import { getToolSchema, TOOL_HINTS } from '../aiTools';

describe('Gemini tool schemas', () => {
  it('drops additionalProperties and turns enums into strings', () => {
    expect(geminiSchema({ type: 'object', additionalProperties: false, properties: { n: { type: 'number', exclusiveMinimum: 0, enum: [1, 2] }, s: { type: 'string', enum: ['a'] } } }))
      .toEqual({ type: 'object', properties: { n: { type: 'string', enum: ['1', '2'] }, s: { type: 'string', enum: ['a'] } } });
  });

  it('leaves no unsupported key in any skAItch tool', () => {
    const text = JSON.stringify(TOOL_HINTS.map(h => geminiSchema(getToolSchema(h.name))));
    expect(text).not.toMatch(/additionalProperties|exclusiveM|\$schema|"const"|"default"/);
  });
});
