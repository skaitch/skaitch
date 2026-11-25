export type AiCredentialRole = 'chat' | 'render';
export interface AiCredentialMeta { id: string; role: AiCredentialRole; provider: string; origin: string; version: number }
const chatBases: Record<string, string> = {
  gemini: 'https://generativelanguage.googleapis.com', anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com',
  mistral: 'https://api.mistral.ai', deepseek: 'https://api.deepseek.com', qwen: 'https://dashscope.aliyuncs.com',
  openrouter: 'https://openrouter.ai', huggingface: 'https://router.huggingface.co', ollama: 'http://localhost:11434',
};
const renderBases: Record<string, string> = { gemini: chatBases.gemini, openai: chatBases.openai, fal: 'https://queue.fal.run', replicate: 'https://api.replicate.com', huggingface: 'https://api-inference.huggingface.co', custom: 'http://localhost:11434' };
export function credentialOrigin(role: AiCredentialRole, provider: string, baseUrl?: string) {
  const fixed = role === 'chat' ? ['gemini','openrouter','huggingface'] : ['gemini','huggingface'];
  const base = fixed.includes(provider) ? (role === 'chat' ? chatBases : renderBases)[provider] : baseUrl || (role === 'chat' ? chatBases : renderBases)[provider];
  return new URL(base || '').origin;
}
export function findCredential(entries: AiCredentialMeta[] | undefined, role: AiCredentialRole, provider: string, baseUrl?: string) {
  try { const origin = credentialOrigin(role, provider, baseUrl); return entries?.find(entry => entry.role === role && entry.provider === provider && entry.origin === origin); }
  catch { return undefined; }
}
export function localAiEndpoint(provider: string, baseUrl?: string) {
  if (!['ollama', 'custom'].includes(provider)) return false;
  if (!baseUrl) return provider === 'ollama';
  try {
    const host = new URL(baseUrl).hostname;
    return /^(localhost|127(?:\.\d+){3}|\[::1\]|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})$/.test(host) || host.endsWith('.local');
  } catch { return false; }
}
