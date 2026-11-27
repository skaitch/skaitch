import { downloadCodexPlugin } from '@skaitch/ui/lib/codexPlugin';
import { useState } from 'react';
import type { ApiKey } from '../../hooks/useApiKeys';
import { makeT } from '@skaitch/core/data/i18n';
import { triggerFileDownload } from '@skaitch/ui/lib/exportFormats';
import { assistantConfig, testMcpConnection, type AssistantClient, type ConnectionAuth } from '@skaitch/ui/lib/mcpConnection';

export default function AssistantConnection({ keys, enabled, lang }: { keys: ApiKey[]; enabled: boolean; lang: string }) {
  const t = makeT(lang);
  const [client, setClient] = useState<AssistantClient>('claude');
  const [auth, setAuth] = useState<ConnectionAuth>('oauth');
  const [keyId, setKeyId] = useState('0');
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState('');
  const url = `${window.location.origin}/api/mcp`;
  const selectedKey = keys[Number(keyId)] ?? keys[0];
  const config = assistantConfig(client, auth, url);
  const instructions = client === 'claude'
    ? 'In Claude settings, add a custom connector with the MCP URL and OAuth. For Claude Desktop configuration, merge the downloaded mcpServers entry into claude_desktop_config.json; Node.js is required.'
    : client === 'chatgpt'
      ? 'In ChatGPT, add an app with this MCP URL, sign in, and choose which projects to access.'
      : 'Merge the downloaded mcpServers entry into ~/.gemini/settings.json without replacing existing servers. In Gemini CLI, run /mcp auth skaitch for OAuth. This configuration is for Gemini CLI, not the Gemini website.';
  const tokenInstructions = client === 'gemini'
    ? 'For API key access, set SKAITCH_API_KEY in your environment before launching Gemini CLI.'
    : 'For API key access in Claude Desktop, replace REPLACE_WITH_YOUR_API_KEY in the downloaded configuration with your key.';
  const docs = client === 'claude'
    ? 'https://support.claude.com/en/articles/11175166-use-connectors-to-extend-claude-s-capabilities'
    : client === 'chatgpt'
      ? 'https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt'
      : 'https://geminicli.com/docs/tools/mcp-server/';

  return <section className="mcp-connection" aria-label={t('Connect my AI assistant')}>
    <h4>{t('Connect my AI assistant')}</h4>
    <button className="btn" type="button" onClick={() => downloadCodexPlugin(url, 'web')}>{lang === 'fr' ? 'Télécharger le plugin skaitch-web' : 'Download the skaitch-web plugin'}</button>
    <p className="mcp-hint">{lang === 'fr' ? 'Importez le fichier ZIP depuis les paramètres de plugins de Codex, puis lancez « codex mcp login skaitch-web » pour ouvrir la connexion OAuth et choisir les projets autorisés.' : 'Import the ZIP from the Codex plugin settings, then run "codex mcp login skaitch-web" to open the OAuth sign-in and choose which projects to authorize.'}</p>
    <div className="mcp-modes" role="group" aria-label={t('Choose an assistant')}>
      {(['claude', 'chatgpt', 'gemini'] as const).map(value => <button key={value} className="btn"
        aria-pressed={client === value} disabled={testing} onClick={() => { setClient(value); setAuth('oauth'); setStatus(''); }}>
        {{ claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini CLI' }[value]}
      </button>)}
    </div>
    {client !== 'chatgpt' && <label>{t('Authentication')}{' '}
      <select value={auth} disabled={testing} onChange={e => { setAuth(e.target.value as ConnectionAuth); setStatus(''); }}>
        <option value="oauth">{t('OAuth (recommended)')}</option>
        <option value="token">{t('API key')}</option>
      </select>
    </label>}
    <p className="mcp-hint">{t(instructions)}</p>
    {auth === 'token' && <p className="mcp-hint">{t(tokenInstructions)}</p>}
    {client !== 'chatgpt' && <p className="mcp-hint">{t('For OAuth, choose project access on the authorization page. For API keys, set project permissions above.')}</p>}
    <pre style={{ overflowX: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{config}</pre>
    <div className="mcp-modes">
      <button className="btn" onClick={async () => {
        try { await navigator.clipboard.writeText(config); setStatus(t('Copied!')); }
        catch { setStatus(t('Copy failed. Download the configuration instead.')); }
      }}>{t(client === 'chatgpt' ? 'Copy MCP URL' : 'Copy Config')}</button>
      <button className="btn" onClick={() => {
        const guide = [t(instructions), auth === 'token' ? t(tokenInstructions) : '', url, docs].filter(Boolean).join('\n\n');
        triggerFileDownload(client === 'chatgpt' ? guide : config,
          `skaitch-${client}-${auth}.${client === 'chatgpt' ? 'txt' : 'json'}`,
          client === 'chatgpt' ? 'text/plain' : 'application/json');
      }}>{t(client === 'chatgpt' ? 'Download guide' : 'Download configuration')}</button>
      <a href={docs} target="_blank" rel="noreferrer">{t('Installation guide')}</a>
    </div>
    {client !== 'chatgpt' && <><h4>{t('3. Test the connection')}</h4>
    <p className="mcp-hint">{t('This checks the server and editor with a selected API key. Complete OAuth separately in your assistant. Keep this editor open with MCP enabled.')}</p>
    <label>{t('Key to test')}{' '}
      <select disabled={testing || !keys.length} value={keys.length ? keyId : ''} onChange={e => { setKeyId(e.target.value); setStatus(''); }}>
        {!keys.length && <option value="">{t('Create an API key above to test the connection.')}</option>}
        {keys.map((key, index) => <option key={key.id} value={index}>{key.name}</option>)}
      </select>
    </label>{' '}
    <button className="btn" disabled={testing || !enabled || !selectedKey} onClick={async () => {
      setTesting(true);
      setStatus(t('Checking authentication and project access…'));
      try {
        const count = await testMcpConnection(url, selectedKey.id);
        setStatus(t('Connection verified. Accessible projects: {count}', { count }));
      } catch (error) {
        setStatus(error instanceof Error && error.name !== 'AbortError'
          ? t(error.message) : t('The connection timed out. Keep the editor open and retry.'));
      } finally { setTesting(false); }
    }}>{t(testing ? 'Testing…' : 'Test connection')}</button>
    <p role="status" aria-live="polite">{status}</p></>}
    {client === 'chatgpt' && <p role="status" aria-live="polite">{status}</p>}
  </section>;
}
