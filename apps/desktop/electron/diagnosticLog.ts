import { existsSync } from 'node:fs';
import { mkdir, readFile, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Optional diagnostic journal, switched on in Settings. When off, nothing is written.
 * Lines are JSON, one event per line, in `<userData>/logs/skaitch-YYYY-MM-DD.log`.
 * Callers must never pass secrets (API keys): only operations, providers, models, timings and
 * provider messages that have already been scrubbed.
 */
export class DiagnosticLog {
  private enabled = false;
  private loaded: Promise<void>;

  constructor(private readonly userDataDir: string) {
    this.loaded = readFile(this.settingsFile, 'utf8')
      .then(text => { this.enabled = JSON.parse(text)?.diagnosticLogs === true; })
      .catch(() => { this.enabled = false; });
  }

  get dir() { return join(this.userDataDir, 'logs'); }
  private get settingsFile() { return join(this.userDataDir, 'settings.json'); }

  async isEnabled() { await this.loaded; return this.enabled; }

  async setEnabled(value: boolean) {
    await this.loaded;
    this.enabled = value === true;
    await writeFile(this.settingsFile, JSON.stringify({ diagnosticLogs: this.enabled }, null, 2));
    if (this.enabled) await mkdir(this.dir, { recursive: true });
    this.write('log', { enabled: this.enabled });
    return this.enabled;
  }

  /** Records one event; a failed write never breaks the app. */
  write(event: string, fields: Record<string, unknown> = {}) {
    if (!this.enabled) return;
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const line = JSON.stringify({ time: now.toISOString(), event, ...fields }) + '\n';
    void (async () => {
      if (!existsSync(this.dir)) await mkdir(this.dir, { recursive: true });
      await appendFile(join(this.dir, `skaitch-${day}.log`), line);
    })().catch(() => {});
  }
}
