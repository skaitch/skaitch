import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { credentialOrigin, type AiCredentialMeta } from '@skaitch/core/lib/aiCredentialTarget';
import { InputError } from '@skaitch/core/bim/validation';

import { tr } from './lang';

const CHAT_PROVIDERS = ['gemini', 'anthropic', 'openai', 'mistral', 'deepseek', 'qwen', 'openrouter', 'huggingface', 'custom', 'ollama'];

/** Encrypts with the operating system's keychain (Electron safeStorage). */
export interface SecretCipher {
  encrypt(plain: string): Buffer;
  decrypt(sealed: Buffer): string;
}

type Stored = { provider: string; origin: string; version: number; sealed: string };

/** The same origins rule as the web vault: Hugging Face spans several official hosts. */
export function allowedOrigins(provider: string, origin: string) {
  return provider === 'huggingface' && ['https://router.huggingface.co', 'https://api-inference.huggingface.co'].includes(origin)
    ? ['https://router.huggingface.co', 'https://api-inference.huggingface.co', 'https://huggingface.co'] : [origin];
}

/**
 * Chat API keys for the desktop app. They stay in the main process: the renderer stores
 * a key once and only ever sees which provider and origin have one.
 */
export class AiKeyStore {
  private cache: Record<string, Stored> | null = null;

  constructor(private file: string, private cipher: SecretCipher) {}

  private async load() {
    if (this.cache) return this.cache;
    try { this.cache = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, Stored>; }
    catch { this.cache = {}; }
    return this.cache;
  }

  private async save(entries: Record<string, Stored>) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(entries), { mode: 0o600 });
    await rename(temporary, this.file);
    this.cache = entries;
  }

  private static id(provider: string, origin: string) {
    return createHash('sha256').update(`chat\n${provider}\n${origin}`).digest('hex');
  }

  async list(): Promise<AiCredentialMeta[]> {
    return Object.entries(await this.load()).map(([id, entry]) => ({ id, role: 'chat', provider: entry.provider, origin: entry.origin, version: entry.version }));
  }

  /** Saves (or with an empty secret, deletes) the key for this provider and endpoint. */
  async set(provider: string, baseUrl: string | undefined, secret: string): Promise<AiCredentialMeta[]> {
    if (!CHAT_PROVIDERS.includes(provider)) throw new InputError('Fournisseur IA inconnu.');
    if (secret.length > 4096 || /[\r\n]/.test(secret)) throw new InputError(tr('Clé IA invalide.', 'Invalid AI key.'));
    let origin: string;
    try { origin = credentialOrigin('chat', provider, baseUrl || undefined); }
    catch { throw new InputError('URL du fournisseur IA invalide.'); }
    const entries = { ...await this.load() };
    const id = AiKeyStore.id(provider, origin);
    if (!secret) delete entries[id];
    else entries[id] = { provider, origin, version: (entries[id]?.version ?? 0) + 1, sealed: this.cipher.encrypt(secret).toString('base64') };
    await this.save(entries);
    return this.list();
  }

  /** The key for a request, only when it targets the origin the key was saved for. */
  async resolve(provider: string, baseUrl: string | undefined): Promise<{ secret: string; origins: string[] } | null> {
    let origin: string;
    try { origin = credentialOrigin('chat', provider, baseUrl || undefined); }
    catch { return null; }
    const entry = (await this.load())[AiKeyStore.id(provider, origin)];
    if (!entry) return null;
    return { secret: this.cipher.decrypt(Buffer.from(entry.sealed, 'base64')), origins: allowedOrigins(provider, entry.origin) };
  }
}
