import { finishConversation, conversationMessages, buildConversationPrompt, conversationContext, parseIntent, propagateModifications } from '../server/ai/conversation.js';
import { getAiPreferences, saveAiPreferences } from '../server/ai/preferences.js';
import { aiCredentials, resolveAiCredentials } from '../server/ai/vault.js';
import { gzipSync } from 'node:zlib';
import { authenticateSession } from './_lib/sessionAuth.js';
import { readBody } from './_lib/boundedBody.js';
import { InputError, record, finiteData, validateItems } from '@skaitch/core/bim/validation';
import { fetchLLM } from '../server/ai/chat.js';
import { discoverModelCapabilities } from '../server/ai/capabilities.js';
import { listAiModels } from '../server/ai/models.js';
import { renderAi, validateRenderArgs } from '../server/ai/render.js';
import type { AiConfig } from '@skaitch/core/types/ifc';
import { withUsage } from './_lib/usage.js';
import { BIM_WIRE_LIMIT } from '@skaitch/core/types/bim';
import { isAiEffort } from '@skaitch/core/types/ai';

function validateConfig(value: unknown): AiConfig {
  const ai = record(value);
  if (!['gemini','anthropic','openai','mistral','deepseek','qwen','openrouter','huggingface','custom','ollama'].includes(ai.provider)) throw new InputError('Fournisseur IA inconnu.');
  for (const field of ['model','apiKey','baseUrl','visualizerProvider','visualizerModel','visualizerApiKey','visualizerBaseUrl','apiKeyRef','visualizerKeyRef']) {
    if (ai[field] !== undefined && (typeof ai[field] !== 'string' || ai[field].length > 4096 || /[\r\n]/.test(ai[field]))) throw new InputError('Configuration IA invalide.');
  }
  if (typeof ai.model !== 'string' || typeof ai.apiKey !== 'string') throw new InputError('Configuration IA incomplète.');
  if (typeof ai.temperature !== 'number' || ai.temperature < 0 || ai.temperature > 2) throw new InputError('Température IA invalide.');
  if (ai.effort !== undefined && !isAiEffort(ai.effort)) throw new InputError('Effort IA invalide.');
  return ai as AiConfig;
}
const AI_OPERATIONS = ['chat','capabilities','models','render','credentials','preferences','conversation-intent','conversation-prepare','conversation-adjust','conversation-finish'];
export default withUsage('ai', async function handler(req: any, res: any, usage) {
  res.setHeader('Cache-Control', 'private, no-store');
  const fail = (status: number, error: string) => {
    res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ error }));
  };
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(405, 'Méthode non autorisée.'); }
  try {
    const requested = new URL(req.url, 'http://ai.local').searchParams.get('operation');
    usage.operation = AI_OPERATIONS.includes(requested || '') ? requested : 'unknown';
  } catch { usage.operation = 'unknown'; }
  try {
    if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return fail(403, 'Requête intersite refusée.');
  } catch { return fail(403, 'Origine invalide.'); }
  let uid: string | null;
  try { uid = await authenticateSession(req.headers.authorization); }
  catch { return fail(503, 'Authentification IA non configurée.'); }
  if (!uid) { usage.authRejected = true; return fail(401, 'Session Firebase requise ou expirée.'); }
  usage.uid = uid;
  const controller = new AbortController();
  const timer = setTimeout(() => { usage.timedOut = true; controller.abort(); }, 170_000);
  const cancel = () => { if (!res.writableEnded) { if (!usage.timedOut) usage.outcome = 'refused'; controller.abort(); } };
  res.on('close', cancel);
  let operation: string | null = null;
  try {
    operation = new URL(req.url, 'http://ai.local').searchParams.get('operation');
    if (!AI_OPERATIONS.includes(operation || '')) throw new InputError('Opération IA inconnue.');
    let data: Record<string, any>;
    try { data = record(JSON.parse((await readBody(req)).toString('utf8'))); }
    catch (error) { if (error instanceof InputError) throw error; throw new InputError('JSON IA invalide.'); }
    finiteData(data);
    let result: unknown;
    if (operation?.startsWith('conversation-')) {
      if (operation === 'conversation-finish') {
        if (!Number.isInteger(data.round) || data.round < 0 || data.round >= 50 || !Array.isArray(data.messages) || typeof data.answer?.text !== 'string' || !Array.isArray(data.answer.toolUses)) throw new InputError('Tour de conversation invalide.');
        result = finishConversation(data.answer, conversationMessages(data.messages, data.receipts), data.round);
      } else {
        const context = conversationContext(data.context);
        if (operation === 'conversation-intent') result = parseIntent(context.finalTxt, context.items, context.focusStorey, context.lang, context.selection);
        else if (operation === 'conversation-prepare') result = { system: buildConversationPrompt(context), messages: conversationMessages(data.messages, data.receipts) };
        else {
          if (typeof data.name !== 'string' || !Array.isArray(data.remaining) || data.remaining.length > 1000 || data.remaining.some((tool: any) => !tool || typeof tool.name !== 'string' || !tool.input || typeof tool.input !== 'object')) throw new InputError('Lot IA invalide.');
          propagateModifications(data.name, record(data.args), record(data.geom), data.remaining, context.items, context.focusStorey);
          result = data.remaining;
        }
      }
      const text = JSON.stringify(result);
      if (Buffer.byteLength(text) > BIM_WIRE_LIMIT) throw new InputError('Contexte IA supérieur à 4 Mo.', 413);
      res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(text);
      return;
    }
    if (operation === 'preferences') {
      if (data.action === 'get') result = await getAiPreferences(uid);
      else if (data.action === 'set') result = await saveAiPreferences(uid, data.config, data.expectedRevision);
      else throw new InputError('Opération de préférences inconnue.');
      res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(result));
      return;
    }
    if (operation === 'credentials') {
      result = await aiCredentials(uid, data);
      res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(result));
      return;
    }
    const ai = await resolveAiCredentials(uid, validateConfig(data.ai), operation!);
    if (operation === 'chat') {
      if (data.context !== undefined) {
        data.system = buildConversationPrompt(conversationContext(data.context));
        if (!Number.isInteger(data.round) || data.round < 0 || data.round >= 50) throw new InputError('Limite de conversation atteinte.');
      }
      if (!Array.isArray(data.messages) || data.messages.length > 1000 || data.messages.some((m: any) => !m || !['user','assistant','tool'].includes(m.role) || m.content !== undefined && typeof m.content !== 'string') || typeof data.system !== 'string') throw new InputError('Messages IA invalides.');
      if (data.image != null && (typeof data.image !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(data.image))) throw new InputError('Image IA invalide.');
      if (data.context !== undefined) data.messages = conversationMessages(data.messages, data.receipts);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Accel-Buffering', 'no');
      let size = 0, failure = '';
      const send = (event: unknown) => {
        if (failure || res.destroyed) return;
        const line = JSON.stringify(event) + '\n';
        size += Buffer.byteLength(line);
        if (size > BIM_WIRE_LIMIT - 512) { failure = 'Réponse IA supérieure à 4 Mo.'; controller.abort(); return; }
        res.write(line);
      };
      try {
        const answer = await fetchLLM(data.messages, ai, data.system, data.image, (chunk, thinking) => send({ chunk, thinking }), controller.signal, typeof data.vision === 'boolean' ? data.vision : undefined);
        send({ result: data.context !== undefined ? finishConversation(answer, data.messages, data.round) : answer });
      } catch (error) { failure ||= error instanceof InputError ? error.message : 'La réponse du fournisseur IA a été interrompue ou refusée.'; }
      // The stream already sent 200: report its failure explicitly.
      if (failure && !usage.timedOut) usage.outcome ??= 'failed';
      if (!res.destroyed) res.end(failure ? JSON.stringify({ error: failure }) + '\n' : undefined);
      return;
    }
    if (operation === 'models') result = await listAiModels(ai, controller.signal);
    else if (operation === 'capabilities') result = await discoverModelCapabilities(ai.provider, ai.model, ai.apiKey, ai.baseUrl, controller.signal, ai.credentialOrigins);
    else {
      const args = validateRenderArgs(data.args);
      result = await renderAi(args, validateItems(data.items), ai, controller.signal);
    }
    const compressed = gzipSync(Buffer.from(JSON.stringify(result)));
    if (compressed.length > BIM_WIRE_LIMIT) throw new InputError('Résultat IA supérieur à 4 Mo.', 413);
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Encoding', 'gzip'); res.end(compressed);
  } catch (error) {
    if (!res.destroyed) fail(error instanceof InputError ? error.status : ['credentials','preferences'].includes(operation || '') ? 503 : 502, error instanceof InputError ? error.message : ['credentials','preferences'].includes(operation || '') ? 'Stockage des réglages IA indisponible.' : 'Fournisseur IA indisponible.');
  } finally { clearTimeout(timer); res.off('close', cancel); }
});
