import { downloadCodexPlugin } from '@skaitch/ui/lib/codexPlugin';
import { useEffect, useState, type ReactNode } from 'react';
import type { SettingsSlotProps } from '@skaitch/ui/platform';
import type { AiConfig } from '@skaitch/core/types/ifc';
import SettingsModal from '@skaitch/ui/components/SettingsModal';
import type { DesktopMcpStatus } from './desktop';
import { PROVIDERS } from '@skaitch/core/ai/providers';
import { findCredential, localAiEndpoint } from '@skaitch/core/lib/aiCredentialTarget';
import { publicAi } from './aiService';
import { effortChoices, type ModelCapabilities } from '@skaitch/core/types/ai';

function useMcpStatus(open: boolean) {
  const [status, setStatus] = useState<DesktopMcpStatus | null>(null);
  useEffect(() => {
    const mcp = window.skaitchDesktop?.mcp;
    if (!open || !mcp) return;
    let active = true;
    mcp.status().then(next => { if (active) setStatus(next); }).catch(() => {});
    const stop = mcp.onStatus(next => { if (active) setStatus(next); });
    return () => { active = false; stop(); };
  }, [open]);
  return status;
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint: string }) {
  return (
    <label className="desktop-settings-toggle">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span><strong>{label}</strong><small>{hint}</small></span>
    </label>
  );
}

function Snippet({ title, code, copyLabel, copiedLabel }: { title: string; code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="desktop-settings-snippet">
      <div><strong>{title}</strong>
        <button className="btn ghost" type="button" onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
        }}>{copied ? copiedLabel : copyLabel}</button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

function Section({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return <><h2>{title}</h2><div className="lede">{lede}</div><div className="desktop-settings-section">{children}</div></>;
}

/** Desktop settings: the shared settings window, with the desktop's own AI and MCP sections. */
export default function DesktopSettings(props: SettingsSlotProps) {
  const { open, ai, setAi, lang } = props;
  const status = useMcpStatus(open);
  const fr = lang === 'fr';
  const enabled = ai.mcpEnabled !== false;
  const url = status?.url ?? '';
  const copy = fr ? 'Copier' : 'Copy', copied = fr ? 'Copié' : 'Copied';
  const state = !status ? (fr ? 'Lecture de l’état…' : 'Reading status…')
    : !status.listening ? (fr ? 'Serveur arrêté : le port est peut-être déjà utilisé (voir SKAITCH_MCP_PORT).' : 'Server stopped: the port may already be in use (see SKAITCH_MCP_PORT).')
    : !enabled ? (fr ? 'Désactivé : les clients MCP sont refusés.' : 'Disabled: MCP clients are refused.')
    : status.connected ? (fr ? 'Un client MCP est connecté.' : 'An MCP client is connected.')
    : (fr ? 'En écoute, aucun client récent.' : 'Listening, no recent client.');

  const mcpSection = (
    <Section title={fr ? 'Serveur MCP' : 'MCP server'} lede={fr
      ? 'Serveur local : les agents (Claude, ChatGPT, Codex) configurés avec cette URL secrète peuvent lire et modifier vos projets. Ne la partagez pas.'
      : 'Local server: agents (Claude, ChatGPT, Codex) configured with this secret URL can read and change your projects. Do not share it.'}>
      <p className="desktop-settings-status" data-on={enabled && !!status?.listening}><span /> {state}</p>
      {status?.remote && <p className="desktop-settings-warning">{fr
        ? 'Accès distant ouvert (SKAITCH_MCP_REMOTE_HOST) : toute personne qui a l’URL secrète peut lire vos projets.'
        : 'Remote access is open (SKAITCH_MCP_REMOTE_HOST): anyone with the secret URL can read your projects.'}</p>}
      <Toggle checked={enabled} onChange={value => setAi(previous => ({ ...previous, mcpEnabled: value }))}
        label={fr ? 'Autoriser les clients MCP' : 'Allow MCP clients'}
        hint={fr ? 'Décoché, le serveur refuse tous les appels.' : 'When off, the server refuses every call.'} />
      <Toggle checked={ai.mcpAlwaysValidate ?? false} onChange={value => setAi(previous => ({ ...previous, mcpAlwaysValidate: value }))}
        label={fr ? 'Confirmer chaque modification' : 'Confirm every change'}
        hint={fr ? 'Recommandé. Décoché, les modifications s’appliquent sans demander.' : 'Recommended. When off, changes apply without asking.'} />
      <div className="desktop-settings-plugin">
        <div>
          <strong>{fr ? 'Installation dans Codex' : 'Codex setup'}</strong>
          <p className="desktop-settings-note">{fr ? 'Décompressez le ZIP et installez le plugin « SkAItch Desktop » depuis un catalogue local Codex. Aucune connexion n’est nécessaire, mais gardez skAItch Desktop ouvert. Le ZIP contient votre URL secrète.' : 'Extract the ZIP and install the "SkAItch Desktop" plugin from a local Codex marketplace. No sign-in is needed, but keep skAItch Desktop open. The ZIP contains your secret URL.'}</p>
        </div>
        <button className="btn" type="button" disabled={!url} onClick={() => downloadCodexPlugin(url, 'desktop')}>
          {fr ? 'Télécharger le plugin skaitch-desktop' : 'Download the skaitch-desktop plugin'}
        </button>
      </div>
      <details>
        <summary>{fr ? 'Configuration avancée' : 'Advanced configuration'}</summary>
        <div className="desktop-settings-section">
          <label className="desktop-settings-row"><span>URL</span><input className="mono" readOnly value={url} onFocus={event => event.target.select()} /></label>
          <Snippet title="Claude Code" code={`claude mcp add --transport http skaitch-desktop ${url}`} copyLabel={copy} copiedLabel={copied} />
          <Snippet title="ChatGPT desktop / Codex (~/.codex/config.toml)"
            code={`[mcp_servers.skaitch-desktop]\nurl = "${url}"\ntool_timeout_sec = 130`} copyLabel={copy} copiedLabel={copied} />
          <Snippet title="Claude Desktop (claude_desktop_config.json)"
            code={JSON.stringify({ mcpServers: { 'skaitch-desktop': { command: 'npx', args: ['-y', 'mcp-remote', url] } } }, null, 2)} copyLabel={copy} copiedLabel={copied} />
        </div>
      </details>
    </Section>
  );

  const aiSection = <AiSection {...props} />;

  return <SettingsModal {...props} aiSection={aiSection} mcpSection={mcpSection} />;
}

type KeyStorage = 'keychain' | 'basic_text' | 'unavailable';

/** Provider, model and key for the built-in chat. The key goes straight to the main process. */
function AiSection({ open, ai, setAi, lang }: SettingsSlotProps) {
  const fr = lang === 'fr';
  const [storage, setStorage] = useState<KeyStorage | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const provider = PROVIDERS.find(p => p.id === ai.provider) ?? PROVIDERS[0];
  const local = localAiEndpoint(ai.provider, ai.baseUrl);
  const saved = findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl);

  useEffect(() => {
    if (!open) return;
    let active = true;
    window.skaitchDesktop.ai.keys().then(({ keys, storage: next }) => {
      if (!active) return;
      setStorage(next);
      setAi(previous => ({ ...previous, credentials: keys }));
    }).catch(() => {});
    return () => { active = false; };
  }, [open, setAi]);

  const run = async (task: () => Promise<string>) => {
    setBusy(true); setMessage(null);
    try { setMessage({ ok: true, text: await task() }); }
    catch (error) { setMessage({ ok: false, text: (error as Error).message }); }
    finally { setBusy(false); }
  };
  const fetchModels = async (config = ai) => {
    const list = await window.skaitchDesktop.ai.request<string[]>('models', { ai: publicAi({ ...config, model: config.model || 'list' }) });
    setModels(list);
    adoptListedModel(list);
    return list;
  };
  // A provider without a default model (e.g. OpenAI Compatible) starts with an empty model; the
  // select then shows the first listed entry without it being chosen, so pick it explicitly.
  const adoptListedModel = (list: string[]) => {
    if (list.length) setAi(previous => previous.model && list.includes(previous.model) ? previous : { ...previous, model: list[0] });
  };
  const saveKey = (secret: string) => run(async () => {
    const keys = await window.skaitchDesktop.ai.setKey(ai.provider, ai.baseUrl, secret);
    setAi(previous => ({ ...previous, credentials: keys }));
    setDraftKey('');
    if (!secret) { setModels([]); return fr ? 'Clé supprimée.' : 'Key deleted.'; }
    // A new key unlocks the provider's model list: refresh it right away.
    const list = await fetchModels({ ...ai, credentials: keys }).catch(() => null);
    return list ? (fr ? `Clé enregistrée, ${list.length} modèles disponibles.` : `Key saved, ${list.length} models available.`) : (fr ? 'Clé enregistrée.' : 'Key saved.');
  });
  const [testId, setTestId] = useState<string | null>(null);
  const cancelTest = () => { if (testId) void window.skaitchDesktop.ai.abort(testId); };
  const testModel = () => run(async () => {
    const id = `test-${Date.now()}`;
    setTestId(id);
    const r = await window.skaitchDesktop.ai.request<{ ms: number; reply: string; image: boolean; tools: boolean }>('test', { ai: publicAi(ai) }, id)
      .finally(() => setTestId(null));
    const seconds = (r.ms / 1000).toFixed(1);
    const sees = r.image ? (fr ? 'lit les images' : 'reads images') : (fr ? 'ne lit pas les images (plans impossibles)' : 'does not read images (cannot read plans)');
    return fr ? `${ai.model} répond en ${seconds} s (« ${r.reply} »), ${sees}.` : `${ai.model} answered in ${seconds} s (“${r.reply}”), ${sees}.`;
  });
  // Capabilities of the selected model, shown under it (vision is needed to read plans).
  const [caps, setCaps] = useState<ModelCapabilities | null>(null);
  useEffect(() => {
    setCaps(null);
    if (!open || !ai.model || (!saved && !local)) return;
    let active = true;
    const timer = setTimeout(() => {
      window.skaitchDesktop.ai.request<typeof caps>('capabilities', { ai: publicAi(ai) })
        .then(next => { if (active) setCaps(next); }).catch(() => {});
    }, 300);
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ai.provider, ai.baseUrl, ai.model, Boolean(saved)]);
  const listModels = () => run(async () => {
    const list = await fetchModels();
    return fr ? `${list.length} modèles trouvés.` : `${list.length} models found.`;
  });
  // Opening the panel, or switching to a provider that has a key, loads its models.
  useEffect(() => {
    if (!open || (!saved && !local)) return;
    let active = true;
    window.skaitchDesktop.ai.request<string[]>('models', { ai: publicAi({ ...ai, model: ai.model || 'list' }) })
      .then(list => { if (active) { setModels(list); if (!ai.model) adoptListedModel(list); } }).catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ai.provider, ai.baseUrl, Boolean(saved)]);
  const switchProvider = (id: string) => {
    const next = PROVIDERS.find(p => p.id === id) ?? PROVIDERS[0];
    setModels([]); setMessage(null);
    setAi(previous => ({ ...previous, provider: next.id as AiConfig['provider'], model: next.models[0] ?? '', baseUrl: (next as { defaultBaseUrl?: string }).defaultBaseUrl ?? '' }));
  };

  return (
    <Section title={fr ? 'Assistant IA' : 'AI Assistant'} lede={fr
      ? 'Le chat intégré appelle le fournisseur choisi depuis l’application. La clé reste sur cette machine, chiffrée par le trousseau du système.'
      : 'The built-in chat calls the chosen provider from the app. The key stays on this machine, encrypted by the system keychain.'}>
      <label className="desktop-settings-row"><span>{fr ? 'Fournisseur' : 'Provider'}</span>
        <select value={provider.id} onChange={event => switchProvider(event.target.value)}>
          {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {(['custom', 'ollama', 'openai', 'qwen', 'openrouter', 'mistral', 'deepseek', 'huggingface'].includes(provider.id)) &&
        <label className="desktop-settings-row"><span>URL</span>
          <input value={ai.baseUrl ?? ''} placeholder={(provider as { defaultBaseUrl?: string }).defaultBaseUrl ?? 'http://localhost:11434'}
            onChange={event => setAi(previous => ({ ...previous, baseUrl: event.target.value }))} />
        </label>}
      <label className="desktop-settings-row"><span>{fr ? 'Clé API' : 'API key'}</span>
        <input type="password" autoComplete="off" value={draftKey} onChange={event => setDraftKey(event.target.value)}
          placeholder={saved ? (fr ? 'Clé enregistrée — saisir pour remplacer' : 'Key saved — type to replace') : local ? (fr ? 'Facultative pour un modèle local' : 'Optional for a local model') : (fr ? 'Collez votre clé' : 'Paste your key')} />
        <button className="btn" type="button" disabled={busy || !draftKey.trim()} onClick={() => saveKey(draftKey.trim())}>{fr ? 'Enregistrer' : 'Save'}</button>
        {saved && <button className="btn ghost" type="button" disabled={busy} onClick={() => saveKey('')}>{fr ? 'Supprimer' : 'Delete'}</button>}
      </label>
      <label className="desktop-settings-row"><span>{fr ? 'Modèle' : 'Model'}</span>
        {models.length
          // Once listed, every model of the provider is shown, whatever the current text.
          ? <select value={ai.model} onChange={event => setAi(previous => ({ ...previous, model: event.target.value }))}>
              {[...new Set([ai.model, ...models, ...provider.models].filter(Boolean))].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          : <>
              <input list="desktop-ai-models" value={ai.model} onChange={event => setAi(previous => ({ ...previous, model: event.target.value }))} />
              <datalist id="desktop-ai-models">{provider.models.map(m => <option key={m} value={m} />)}</datalist>
            </>}
        <button className="btn" type="button" disabled={busy} onClick={listModels}>{fr ? 'Lister' : 'List'}</button>
      </label>
      {caps && <p className="desktop-settings-note" data-testid="model-capabilities">
        {fr ? 'Capacités : ' : 'Capabilities: '}
        {([['text', fr ? 'texte' : 'text'], ['image', fr ? 'images (lecture de plans)' : 'images (reads plans)'], ['tools', fr ? 'outils (modifie le modèle)' : 'tools (edits the model)'], ['thinking', fr ? 'raisonnement' : 'reasoning']] as const)
          .map(([key, label]) => `${caps[key] ? '✓' : '✗'} ${label}`).join(' · ')}
        {local && (fr ? ' — modèle local, capacités non détectées' : ' — local model, capabilities not detected')}
      </p>}
      <label className="desktop-settings-row"><span>{fr ? 'Température' : 'Temperature'}</span>
        <input type="number" min={0} max={2} step={0.1} value={ai.temperature ?? 0}
          onChange={event => setAi(previous => ({ ...previous, temperature: Math.min(2, Math.max(0, Number(event.target.value) || 0)) }))} />
      </label>
      <label className="desktop-settings-row"><span>{fr ? 'Effort de raisonnement' : 'Reasoning effort'}</span>
        <select value={ai.effort || ''} data-testid="ai-effort"
          onChange={event => setAi(previous => ({ ...previous, effort: event.target.value as AiConfig['effort'] }))}>
          <option value="">{fr ? 'Défaut du modèle' : 'Model default'}</option>
          {effortChoices(caps?.effort, ai.effort).map(level => <option key={level} value={level}>{level}</option>)}
        </select>
      </label>
      {storage === 'basic_text' && <p className="desktop-settings-warning">{fr
        ? 'Aucun trousseau système détecté (GNOME Keyring, KWallet…) : la clé est seulement masquée, pas vraiment chiffrée.'
        : 'No system keychain found (GNOME Keyring, KWallet…): the key is only obfuscated, not truly encrypted.'}</p>}
      {storage === 'unavailable' && <p className="desktop-settings-warning">{fr
        ? 'Le trousseau système est indisponible : les clés cloud ne peuvent pas être enregistrées. Un modèle local reste utilisable.'
        : 'The system keychain is unavailable: cloud keys cannot be saved. A local model still works.'}</p>}
      <div className="desktop-settings-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" type="button" disabled={testId ? false : busy || !ai.model || (!saved && !local)} onClick={testId ? cancelTest : testModel}
          title={fr ? 'Envoie un court message au modèle avec la clé enregistrée' : 'Sends a short message to the model with the saved key'}>{testId ? (fr ? 'Abandonner le test' : 'Cancel test') : (fr ? 'Tester' : 'Test')}</button>
      </div>
      {message && <p className={message.ok ? 'desktop-settings-note' : 'desktop-settings-warning'}>{message.text}</p>}
      <DiagnosticLogs fr={fr} open={open} />
    </Section>
  );
}

/** Optional journal of AI requests and stops, written to a file (see electron/diagnosticLog.ts). */
function DiagnosticLogs({ fr, open }: { fr: boolean; open: boolean }) {
  const [logs, setLogs] = useState<{ enabled: boolean; dir: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    window.skaitchDesktop.logs.get().then(setLogs).catch(() => {});
  }, [open]);
  if (!logs) return null;
  return (
    <div className="desktop-settings-logs">
      <Toggle checked={logs.enabled}
        onChange={value => { window.skaitchDesktop.logs.set(value).then(setLogs).catch(() => {}); }}
        label={fr ? 'Journal de diagnostic' : 'Diagnostic log'}
        hint={fr ? 'Écrit les requêtes IA et les arrêts dans un fichier. Les clés API n’y figurent jamais.' : 'Writes AI requests and stops to a file. API keys are never written.'} />
      {logs.enabled && <div className="desktop-settings-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" type="button" onClick={() => { window.skaitchDesktop.logs.open().catch(() => {}); }}
          title={logs.dir}>{fr ? 'Ouvrir le dossier des journaux' : 'Open the logs folder'}</button>
      </div>}
    </div>
  );
}
