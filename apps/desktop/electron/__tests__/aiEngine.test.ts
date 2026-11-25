import { expect, it, vi } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import { chat, runAiOperation, type AiEngineDeps } from '../aiEngine';

const context = { items: buildEmpty(), focusStorey: 'sty_A0', lang: 'fr', selection: [], finalTxt: 'Dessine un mur' };
const answer = { text: 'Je crée le mur.', toolUses: [{ id: 't1', name: 'create_wall', input: { start_point: [0, 0], end_point: [4, 0] } }] };

function deps(secret: string | null): AiEngineDeps & { fetchLLM: any; localLlm: any; capabilities: any } {
  return {
    keys: { resolve: vi.fn(async () => secret ? { secret, origins: ['https://api.anthropic.com'] } : null) },
    fetchLLM: vi.fn(async (_m: any, _ai: any, _s: any, _i: any, onChunk: any) => { onChunk('Je crée', false); return answer; }),
    localLlm: vi.fn(async () => answer),
    capabilities: vi.fn(async () => ({ text: true, image: true, tools: true, thinking: false })),
  };
}

it('runs a cloud round with the stored key, streams it, and returns the tool calls', async () => {
  const d = deps('sk-ant');
  const chunks: string[] = [];
  const result = await chat({ ai: { provider: 'anthropic', model: 'claude', temperature: 0 }, messages: [{ role: 'user', content: 'Dessine un mur' }], context, round: 0 }, d, chunk => chunks.push(chunk));
  expect(chunks).toEqual(['Je crée']);
  expect(result.toolUses).toMatchObject([{ name: 'create_wall' }]);
  const [, ai, system] = d.fetchLLM.mock.calls[0];
  expect(ai).toMatchObject({ apiKey: 'sk-ant', credentialOrigins: ['https://api.anthropic.com'] });
  expect(system).toContain('IFC');
  expect(d.localLlm).not.toHaveBeenCalled();
});

it('asks for a key before calling a cloud provider', async () => {
  const d = deps(null);
  await expect(chat({ ai: { provider: 'anthropic', model: 'claude', temperature: 0 }, messages: [], context, round: 0 }, d, () => {})).rejects.toThrow(/Enregistrez une clé/);
  expect(d.fetchLLM).not.toHaveBeenCalled();
});

it('sends local models (Ollama) to the local client, without a key', async () => {
  const d = deps(null);
  await chat({ ai: { provider: 'ollama', model: 'llama3', baseUrl: 'http://127.0.0.1:11434', temperature: 0 }, messages: [{ role: 'user', content: 'x' }], context, round: 0 }, d, () => {});
  expect(d.localLlm).toHaveBeenCalledOnce();
  expect(d.fetchLLM).not.toHaveBeenCalled();
});

it('never accepts a raw key or a stray field from the window', async () => {
  const d = deps(null);
  await chat({ ai: { provider: 'ollama', model: 'm', apiKey: 'from-window', credentialOrigins: ['https://evil.example'], temperature: 0 }, messages: [], context, round: 0 }, d, () => {});
  expect(d.localLlm.mock.calls[0][1]).toMatchObject({ apiKey: '' });
  expect(d.localLlm.mock.calls[0][1].credentialOrigins).toBeUndefined();
});

it('enforces the conversation limit and rejects unknown operations', async () => {
  await expect(chat({ ai: { provider: 'ollama', model: 'm', temperature: 0 }, messages: [], context, round: 50 }, deps(null), () => {})).rejects.toThrow(/Limite/);
  await expect(runAiOperation('render', {}, deps(null))).rejects.toThrow(/inconnue/);
});

it('reads simple intents without calling a model', async () => {
  expect(await runAiOperation('conversation-intent', { context: { ...context, finalTxt: 'exporte en IFC' } }, deps(null))).toEqual({ name: 'export_ifc', args: {} });
});

it('the model test sends a tiny prompt with the saved key and reports the delay', async () => {
  const d = deps('sk-ant-test');
  const result = await runAiOperation('test', { ai: { provider: 'anthropic', model: 'claude-test' } }, d) as { ms: number; reply: string };
  expect(d.fetchLLM).toHaveBeenCalledTimes(1);
  const [messages, ai] = d.fetchLLM.mock.calls[0];
  expect(messages).toEqual([{ role: 'user', content: 'Reply with the single word OK.' }]);
  expect(ai.apiKey).toBe('sk-ant-test');
  expect(result.ms).toBeGreaterThanOrEqual(0);
  expect(typeof result.reply).toBe('string');
  expect((result as unknown as { image: boolean }).image).toBe(true);
});

it('the model test needs a saved key for a cloud provider', async () => {
  await expect(runAiOperation('test', { ai: { provider: 'anthropic', model: 'claude-test' } }, deps(null))).rejects.toThrow();
});
