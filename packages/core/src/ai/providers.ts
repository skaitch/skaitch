/** AI providers offered in the settings of every host (web, desktop). */
export const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', short: 'Gem', live: true, models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'], fetchPath: 'https://generativelanguage.googleapis.com/v1beta/models' },
  { id: 'anthropic', name: 'Anthropic', short: 'C', live: true, models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'] },
  { id: 'openai', name: 'OpenAI', short: 'AI', live: true, models: ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o1-mini'], fetchPath: '/v1/models', defaultBaseUrl: 'https://api.openai.com' },
  { id: 'qwen', name: 'Qwen (DashScope)', short: 'Q', live: true, models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-coder-turbo'], fetchPath: '/v1/models', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode' },
  { id: 'openrouter', name: 'OpenRouter', short: 'OR', live: true, models: ['openai/gpt-4o', 'openai/gpt-4-turbo', 'anthropic/claude-3-5-sonnet', 'mistralai/mistral-large'], fetchPath: '/v1/models', defaultBaseUrl: 'https://openrouter.ai/api' },
  { id: 'mistral', name: 'Mistral', short: 'M', live: true, models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'], fetchPath: '/v1/models', defaultBaseUrl: 'https://api.mistral.ai' },
  { id: 'deepseek', name: 'DeepSeek', short: 'DS', live: true, models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-vl2'], fetchPath: '/v1/models', defaultBaseUrl: 'https://api.deepseek.com' },
  { id: 'huggingface', name: 'Hugging Face', short: 'HF', live: true,
    models: [
      'meta-llama/Llama-3.3-70B-Instruct',
      'meta-llama/Llama-3.1-8B-Instruct',
      'mistralai/Mistral-7B-Instruct-v0.3',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'microsoft/Phi-4-mini-instruct',
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-R1',
      'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
      'HuggingFaceH4/zephyr-7b-beta',
    ],
    fetchPath: '/api/models', defaultBaseUrl: 'https://huggingface.co',
  },
  { id: 'ollama', name: 'Ollama', short: '○', live: true, models: ['llama3', 'qwen2.5-coder', 'mistral', 'codellama'], fetchPath: '/api/tags', defaultBaseUrl: 'http://localhost:11434' },
  { id: 'custom', name: 'OpenAI Compatible', short: '?', live: true, models: [], fetchPath: '/v1/models' },
];

export const VISUALIZER_PROVIDERS = [
  { id: 'pollinations', name: 'Pollinations.ai (Free)', models: ['flux', 'flux-realism', 'any-dark', 'turbo'] },
  { id: 'gemini', name: 'Google Gemini (Imagen)', models: ['imagen-3.0-generate-002', 'imagen-3.0-capability-preview-0930'] },
  { id: 'openai', name: 'OpenAI (DALL-E)', models: ['dall-e-3', 'dall-e-2'] },
  { id: 'fal', name: 'Fal.ai', models: ['fal-ai/flux/schnell', 'fal-ai/flux/dev', 'fal-ai/luma-dream-machine', 'fal-ai/kling-video'] },
  { id: 'replicate', name: 'Replicate', models: ['stability-ai/sdxl', 'bytedance/sdxl-lightning', 'lucataco/luma-dream-machine'] },
  { id: 'huggingface', name: 'Hugging Face', models: ['stabilityai/stable-diffusion-3-medium', 'black-forest-labs/FLUX.1-schnell'] },
  { id: 'custom', name: 'Custom OpenAI-Compatible', models: [] }
];
