import { describe, expect, it } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import { addPhoto, addRectangleRoom, newSurvey } from '@skaitch/core/survey/edit';
import { reconstructStorey } from '@skaitch/core/survey/reconstruct';
import { readMcpModel } from '@skaitch/core/bim/mcpRead';
import { mcpToolResult } from '@skaitch/core/lib/mcpToolResult';
import { MCP_READ_TOOLS } from '@skaitch/core/types/bim';

const IMG = 'data:image/jpeg;base64,' + '/9j/'.padEnd(2000, 'A');

function project() {
  let s = newSurvey('Maison');
  const a = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3);
  s = addPhoto(a.survey, a.roomId, { kind: 'wall', wallId: `${a.roomId}_w1` }, { id: 'pw', width: 10, height: 10 });
  const photo = s.levels[0].rooms[0].photos![0];
  photo.annotations = [
    { id: 'n1', type: 'note', p: [0.2, 0.3], text: 'Fissure au-dessus de la porte', createdAt: '' },
    { id: 'm1', type: 'measure', p1: [0.1, 0.5], p2: [0.6, 0.5], value_m: 1.12, source: 'laser', createdAt: '' },
  ];
  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')! as any;
  storey.survey = { surveyId: s.id, surveyName: 'Maison', importedAt: '2026-11-22', level: s.levels[0], photos: { pw: IMG } };
  return { items: reconstructStorey(items, storey.id).items, storeyId: storey.id as string };
}

const read = (name: string, args: object, items: any) => readMcpModel(name, args as any, items, []) as any;

describe('AI survey read tools (ADR 0017)', () => {
  it('are read tools', () => {
    expect(MCP_READ_TOOLS).toContain('get_survey');
    expect(MCP_READ_TOOLS).toContain('get_survey_photo');
  });

  it('get_survey gives rooms, measures, reliability and photo annotations as text, without images', () => {
    const { items, storeyId } = project();
    const out = read('get_survey', { storey_id: storeyId }, items);
    expect(out.survey.name).toBe('Maison');
    const salon = out.rooms[0];
    expect(salon.walls).toHaveLength(4);
    expect(salon.walls[0]).toMatchObject({ source: expect.any(String), thickness_status: expect.any(String), reliability: expect.any(String) });
    expect(salon.walls[0].bim[0].type).toBe('Wall');
    expect(salon.photos[0].annotations).toEqual([
      { type: 'note', at: [0.2, 0.3], text: 'Fissure au-dessus de la porte' },
      { type: 'measure', from: [0.1, 0.5], to: [0.6, 0.5], value_m: 1.12, source: 'laser' },
    ]);
    expect(JSON.stringify(out)).not.toContain('base64');
  });

  it('get_survey_photo returns the image as an MCP image block with its annotations', () => {
    const { items } = project();
    const out = read('get_survey_photo', { photo_id: 'pw' }, items);
    expect(out.room.name).toBe('Salon');
    expect(out.annotations).toHaveLength(2);
    const mcp = mcpToolResult(out);
    expect(mcp.content.map((c: any) => c.type)).toEqual(['text', 'image']);
    expect(mcp.content[0].text).not.toContain('base64');
    expect(read('get_survey_photo', { photo_id: 'nope' }, items).error).toBeTruthy();
  });

  it('get_element_properties no longer returns the raw survey or photos', () => {
    const { items, storeyId } = project();
    const storey = read('get_element_properties', { id: storeyId }, items);
    expect(JSON.stringify(storey)).not.toContain('base64');
    expect(storey.survey.note).toContain('get_survey');
    const wall = Object.values(items).find((i: any) => i.type === 'Wall' && i.surveyRef?.wallId?.endsWith('_w1'))!;
    const props = read('get_element_properties', { id: wall.id }, items);
    expect(props.survey_reliability).toBeTruthy();
    expect(props.survey_photo_ids).toEqual(['pw']);
  });
});
