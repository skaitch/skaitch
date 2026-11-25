import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DiagnosticLog } from '../diagnosticLog';

const wait = () => new Promise(resolve => setTimeout(resolve, 50));

it('writes nothing until the setting is on, then one JSON line per event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skaitch-log-'));
  const log = new DiagnosticLog(dir);
  expect(await log.isEnabled()).toBe(false);
  log.write('ai.test', { ok: true });
  await wait();
  await expect(readdir(join(dir, 'logs'))).rejects.toThrow();

  await log.setEnabled(true);
  log.write('ai.test', { ok: false, error: 'Gemini API 400' });
  await wait();
  const [file] = await readdir(join(dir, 'logs'));
  const lines = (await readFile(join(dir, 'logs', file), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(lines.at(-1)).toMatchObject({ event: 'ai.test', ok: false, error: 'Gemini API 400' });

  const reopened = new DiagnosticLog(dir);
  expect(await reopened.isEnabled()).toBe(true);
});
