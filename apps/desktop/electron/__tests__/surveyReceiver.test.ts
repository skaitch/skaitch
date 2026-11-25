import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { newSurvey, addRectangleRoom } from '@skaitch/core/survey/edit';
import { readSurveyFile, writeSurveyFile } from '@skaitch/core/survey/surveyFile';
import { startSurveyReceiver, surveyInboxOps, type SurveyReceiver } from '../surveyReceiver';

let receiver: SurveyReceiver | null = null, dir = '';
afterEach(async () => { await receiver?.close(); receiver = null; if (dir) await rm(dir, { recursive: true, force: true }); });

describe('survey receiver on the local network', () => {
  it('pairs by QR payload, receives a survey sent like the phone does, and reads it back', async () => {
    dir = await mkdtemp(join(tmpdir(), 'survey-rx-'));
    receiver = await startSurveyReceiver(dir, 39240 + Math.floor(Math.random() * 50));
    const ops = surveyInboxOps(receiver);
    const key = await ops.createKey('Phone');
    const uri = new URL(key.pairingUri!.replace('skaitch-survey:pair', 'http://x/pair'));
    expect(uri.searchParams.get('key')).toBe(key.key);
    const server = `http://127.0.0.1:${receiver.port}`;
    const call = (op: string, q: Record<string, string> = {}, body?: Uint8Array, auth = key.key) => fetch(`${server}/api/survey?${new URLSearchParams({ operation: op, ...q })}`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth}`, Origin: 'https://localhost' }, body: body as BodyInit | undefined,
    });

    expect((await call('hello')).status).toBe(200);
    expect((await call('hello', {}, undefined, 'sv_local_' + '0'.repeat(40))).status).toBe(401);

    let s = newSurvey('Maison', new Date('2026-01-01'));
    s = addRectangleRoom(s, s.levels[0].id, 'Cuisine', 0, 0, 4, 3).survey;
    const file = writeSurveyFile(s, 'test');
    const upload = createHash('sha256').update(file).digest('hex');
    expect(await (await call('upload-status', { upload })).json()).toEqual({ received: [], done: false });
    const put = await call('upload-chunk', { upload, index: '0', count: '1' }, file);
    expect(put.status).toBe(200);
    const done = await (await call('upload-finish', { upload })).json();
    expect(done.revision).toBe(1);

    const [received] = await ops.list();
    expect(received.name).toBe('Maison');
    const back = await ops.readChunk(received.id, 0);
    expect(readSurveyFile(back).levels[0].rooms[0].name).toBe('Cuisine');
  });
});
