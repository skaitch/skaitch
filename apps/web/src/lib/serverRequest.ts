import { auth } from './firebase';
import { BIM_BODY_LIMIT, BIM_WIRE_LIMIT } from '@skaitch/core/types/bim';

export async function serverRequest(path: string, data: unknown, signal?: AbortSignal): Promise<Response> {
  const service = path.startsWith('/api/ai') ? 'IA' : 'BIM';
  const user = auth.currentUser;
  if (!user) throw new Error(`Connectez-vous pour utiliser les traitements ${service}.`);
  const token = await user.getIdToken();
  const raw = data instanceof ArrayBuffer ? new Uint8Array(data) : new TextEncoder().encode(JSON.stringify(data));
  if (raw.byteLength > BIM_BODY_LIMIT) throw new Error(`Traitement ${service} limité à 64 Mo avant compression.`);
  let body = new Blob([raw]);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' };
  if (typeof CompressionStream !== 'undefined') {
    body = await new Response(body.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    headers['Content-Encoding'] = 'gzip';
  }
  if (body.size > BIM_WIRE_LIMIT) throw new Error(`Les données dépassent 4 Mo après compression, limite du serveur ${service}.`);
  const response = await fetch(path, {
    method: 'POST', headers, body, credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(190_000)]) : AbortSignal.timeout(190_000),
  });
  if (!response.ok) {
    const message = await response.text();
    let detail: string;
    try { detail = JSON.parse(message).error; } catch { detail = `Serveur ${service} indisponible (${response.status}).`; }
    throw new Error(detail || `Erreur ${service} (${response.status}).`);
  }
  return response;
}
