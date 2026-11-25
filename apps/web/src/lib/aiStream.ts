/**
 * The reason a provider gives for an error, made safe to show: one line, at most 300
 * characters, with the API key and any `key=` URL parameter masked.
 */
export function providerReason(value: unknown, secret?: string): string {
  const json = value as any;
  let reason: unknown = typeof json === 'string' ? json
    : json?.error?.message ?? json?.message ?? json?.detail ?? (typeof json?.error === 'string' ? json.error : '');
  reason = String(reason ?? '').replace(/\s+/g, ' ').trim();
  let text = reason as string;
  if (secret) text = text.split(secret).join('***');
  return text.replace(/([?&]key=)[^&\s]+/g, '$1***').slice(0, 300);
}

/** Reads a failed response's body and turns it into a short, safe error. */
export async function providerHttpError(label: string, res: Response, secret?: string): Promise<Error> {
  let body: unknown = '';
  try { const text = await res.text(); try { body = JSON.parse(text); } catch { body = text; } } catch { /* no body */ }
  const reason = providerReason(body, secret);
  return new Error(reason ? `${label} : HTTP ${res.status} — ${reason}` : `${label} : HTTP ${res.status}`);
}

/** Parse SSE events across UTF-8 chunks, including multiline data and an unterminated final event. */
export async function readSSE(res: Response, onEvent: (data: string) => void, secret?: string): Promise<void> {
  if (!res.body) throw new Error('Flux IA vide.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', data: string[] = [];
  const flush = () => {
    if (!data.length) return;
    const event = data.join('\n'); data = [];
    let parsed: any;
    try { parsed = JSON.parse(event); } catch {}
    if (parsed?.error) {
      const reason = providerReason(parsed, secret);
      throw new Error(reason ? `Le fournisseur IA a refusé la requête : ${reason}` : 'Le fournisseur IA a refusé la requête.');
    }
    onEvent(event);
  };
  const line = (value: string) => {
    value = value.replace(/\r$/, '');
    if (!value) flush();
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      lines.forEach(line);
      if (done) break;
    }
    if (buffer) line(buffer);
    flush();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
