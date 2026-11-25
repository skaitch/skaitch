import { InputError, record } from '@skaitch/core/bim/validation';
import { renderPrompt } from '../../src/lib/renderPrompt.js';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import type { ServerAiConfig as AiConfig } from './vault.js';
import { upstreamFetch } from './upstream.js';
export function validateRenderArgs(value: unknown) {
  const args = record(value);
  if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 50_000 || args.type !== undefined && !['image','video'].includes(String(args.type))) throw new InputError('Demande de rendu invalide.');
  for (const field of ['room_id','style','time_of_day','aspect_ratio']) if (args[field] !== undefined && (typeof args[field] !== 'string' || args[field].length > 200)) throw new InputError('Paramètre de rendu invalide.');
  return args;
}
export async function renderAi(args: Record<string, unknown>, items: ItemsMap, ai?: AiConfig, signal?: AbortSignal) {
  const requestUpstream = (url: string, options: RequestInit = {}) => upstreamFetch(url, { ...options, signal }, ai?.visualizerCredentialOrigins);
  const { type, style, timeOfDay, aspect, finalPrompt } = renderPrompt(args, items);
  const provider = ai?.visualizerProvider || 'pollinations';
  const model = ai?.visualizerModel || '';
  const customKey = ai?.visualizerApiKey || '';
  const customBase = ai?.visualizerBaseUrl || '';

  let apiKey = customKey;
  let baseUrl = customBase;

  if (!apiKey && ai) {
    if (provider === ai.provider) {
      apiKey = ai.apiKey;
    }
  }
  if (!baseUrl && ai) {
    if (provider === ai.provider) {
      baseUrl = ai.baseUrl || '';
    }
  }

  try {
    if (provider === 'pollinations') {
      const encoded = encodeURIComponent(finalPrompt);
      const w = aspect === '16:9' ? 1024 : aspect === '4:3' ? 1024 : 800;
      const h = aspect === '16:9' ? 576 : aspect === '4:3' ? 768 : 800;
      const selectedModel = model || 'flux';
      const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&nologo=true&private=true&model=${selectedModel}`;
      return {
        success: true,
        type: type,
        url: imageUrl,
        prompt: finalPrompt,
        style: style || 'modern',
        time_of_day: timeOfDay || 'daylight',
        is_simulated: type === 'video',
        aspect_ratio: aspect
      };
    }

    if (provider === 'gemini') {
      if (!apiKey) throw new Error('API Key is required for Google Gemini rendering.');
      const selectedModel = model || 'imagen-3.0-generate-002';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateImages?key=${apiKey}`;
      const res = await requestUpstream(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            prompt: { text: finalPrompt }
          }],
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: aspect === '16:9' ? '16:9' : aspect === '4:3' ? '4:3' : '1:1'
        })
      });
      if (!res.ok) {
        throw new Error(`Gemini Imagen API error: ${res.status}`);
      }
      const json = await res.json();
      const imgBytes = json.generatedImages?.[0]?.image?.imageBytes;
      if (!imgBytes) throw new Error('No image bytes returned from Gemini Imagen.');
      return {
        success: true,
        type: type,
        url: `data:image/jpeg;base64,${imgBytes}`,
        prompt: finalPrompt,
        style: style || 'modern',
        time_of_day: timeOfDay || 'daylight',
        is_simulated: type === 'video',
        aspect_ratio: aspect
      };
    }

    if (provider === 'openai' || provider === 'custom') {
      const selectedModel = model || (provider === 'openai' ? 'dall-e-3' : 'custom');
      const defaultBase = provider === 'openai' ? 'https://api.openai.com' : 'http://localhost:11434';
      const base = (baseUrl || defaultBase).replace(/\/$/, '').replace(/\/v1$/, '');
      let url = `${base}/v1/images/generations`;
      if (!apiKey && provider === 'openai') throw new Error('API Key is required for OpenAI rendering.');

      const size = aspect === '16:9' ? '1792x1024' : aspect === '4:3' ? '1024x768' : '1024x1024';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await requestUpstream(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: selectedModel,
          prompt: finalPrompt,
          n: 1,
          size: size,
          response_format: 'b64_json'
        })
      });
      if (!res.ok) {
        throw new Error(`OpenAI DALL-E API error: ${res.status}`);
      }
      const json = await res.json();
      const b64 = json.data?.[0]?.b64_json;
      const urlVal = json.data?.[0]?.url;
      if (!b64 && !urlVal) throw new Error('No image URL or base64 data returned from OpenAI.');
      const finalUrl = b64 ? `data:image/png;base64,${b64}` : urlVal;
      return {
        success: true,
        type: type,
        url: finalUrl,
        prompt: finalPrompt,
        style: style || 'modern',
        time_of_day: timeOfDay || 'daylight',
        is_simulated: type === 'video',
        aspect_ratio: aspect
      };
    }

    if (provider === 'fal') {
      if (!apiKey) throw new Error('API Key is required for Fal.ai rendering.');
      const selectedModel = model || 'fal-ai/flux/schnell';
      const base = (baseUrl || 'https://queue.fal.run').replace(/\/$/, '');
      let url = `${base}/${selectedModel}`;
      const size = aspect === '16:9' ? 'landscape_hd' : aspect === '4:3' ? 'four_thirds' : 'square_hd';

      const res = await requestUpstream(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${apiKey}`
        },
        body: JSON.stringify({
          prompt: finalPrompt,
          image_size: size,
          sync_mode: true
        })
      });
      if (!res.ok) {
        throw new Error(`Fal.ai API error: ${res.status}`);
      }
      const json = await res.json();
      const mediaUrl = json.images?.[0]?.url || json.video?.url || json.url;
      if (!mediaUrl) throw new Error(`No media URL returned from Fal.ai: `);
      return {
        success: true,
        type: type,
        url: mediaUrl,
        prompt: finalPrompt,
        style: style || 'modern',
        time_of_day: timeOfDay || 'daylight',
        is_simulated: type === 'video' && !json.video,
        aspect_ratio: aspect
      };
    }

    if (provider === 'replicate') {
      if (!apiKey) throw new Error('API Key is required for Replicate rendering.');
      const selectedModel = model || 'stability-ai/sdxl';
      const base = (baseUrl || 'https://api.replicate.com').replace(/\/$/, '');
      const [modelName, versionId] = selectedModel.split(':');
      let url = versionId ? `${base}/v1/predictions` : `${base}/v1/models/${modelName}/predictions`;

      const payload: any = {
        input: {
          prompt: finalPrompt,
          aspect_ratio: aspect === '16:9' ? '16:9' : aspect === '4:3' ? '4:3' : '1:1'
        }
      };
      if (versionId) {
        payload.version = versionId;
      }

      const res = await requestUpstream(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${apiKey}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(`Replicate API error: ${res.status}`);
      }
      const json = await res.json();
      let prediction = json;
      const pollUrl = prediction.urls.get;
      if (typeof pollUrl !== 'string' || new URL(pollUrl).origin !== new URL(base).origin) throw new Error('Adresse de suivi du fournisseur invalide.');
      let attempts = 0;
      while ((prediction.status === 'starting' || prediction.status === 'processing') && attempts < 30) {
        await new Promise(r => setTimeout(r, 1500));
        const pollRes = await requestUpstream(pollUrl, {
          headers: { 'Authorization': `Token ${apiKey}` }
        });
        if (pollRes.ok) {
          prediction = await pollRes.json();
        }
        attempts++;
      }
      if (prediction.status !== 'succeeded') {
        throw new Error('Le fournisseur de rendu n’a pas terminé la génération.');
      }
      const output = prediction.output;
      const mediaUrl = Array.isArray(output) ? output[0] : output;
      if (!mediaUrl) throw new Error('No media URL in Replicate response.');
      return {
        success: true,
        type: type,
        url: mediaUrl,
        prompt: finalPrompt,
        style: style || 'modern',
        time_of_day: timeOfDay || 'daylight',
        is_simulated: type === 'video',
        aspect_ratio: aspect
      };
    }

    if (provider === 'huggingface') {
      const selectedModel = model || 'stabilityai/stable-diffusion-3-medium';
      const url = `https://api-inference.huggingface.co/models/${selectedModel}`;
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await requestUpstream(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ inputs: finalPrompt })
      });
      if (!res.ok) {
        throw new Error(`Hugging Face API error: ${res.status}`);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      const base64Data = `data:${res.headers.get('content-type') || 'image/png'};base64,${bytes.toString('base64')}`;
      return {
        success: true,
        type: type,
        url: base64Data,
        prompt: finalPrompt,
        style: style || 'modern',
        time_of_day: timeOfDay || 'daylight',
        is_simulated: type === 'video',
        aspect_ratio: aspect
      };
    }

    throw new Error(`Unsupported rendering provider: ${provider}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err)
    };
  }

}
