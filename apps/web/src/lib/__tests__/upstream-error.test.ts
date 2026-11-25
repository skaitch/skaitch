import { describe, expect, it } from 'vitest';
import { upstreamError } from '../../../server/ai/upstream';

describe('provider errors keep the provider reason', () => {
  it('reads error.message from a Google-style body and hides the key', async () => {
    const res = new Response(JSON.stringify({ error: { code: 404, message: 'models/gemini-1.5-pro is not found for API version v1beta. key=abc123 sk-secret' } }), { status: 404 });
    const error = await upstreamError('Gemini API', res, 'sk-secret');
    expect(error.message).toBe('Gemini API 404: models/gemini-1.5-pro is not found for API version v1beta. key=abc123 ***');
  });

  it('scrubs key query parameters and falls back to the status alone', async () => {
    expect((await upstreamError('HTTP', new Response('bad ?key=XYZ here', { status: 400 }))).message).toBe('HTTP 400: bad ?key=*** here');
    expect((await upstreamError('HTTP', new Response('', { status: 503 }))).message).toBe('HTTP 503');
  });
});
