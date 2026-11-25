import { aiPreferences } from '../../lib/aiPreferences';
import { findCredential, localAiEndpoint, credentialOrigin, type AiCredentialRole } from '@skaitch/core/lib/aiCredentialTarget';
import { saveAiCredential, deleteAiCredential, listAiCredentials, migrateAiCredentials, getAiPreferences, saveAiPreferences, LEGACY_AI_KEY, legacyAiRecords, legacyAiEntries } from '../../lib/aiVaultClient';
import type { Dispatch, SetStateAction } from 'react';
import AssistantConnection from '../panels/AssistantConnection';
import AdminLink from '../admin/AdminLink';
import SharedSettingsModal from '@skaitch/ui/components/SettingsModal';
import type { LangType } from '@skaitch/core/types/ifc';
import { makeT } from '@skaitch/core/data/i18n';
import { effortChoices, type AiEffort } from '@skaitch/core/types/ai';
import { discoverModelCapabilities, listAiModels } from '../../lib/aiClient';
import { useState, useEffect } from 'react';
import type { AiConfig } from '@skaitch/core/types/ifc';
import type { ProjectMeta } from '@skaitch/core/types/project';
import { useApiKeys } from '../../hooks/useApiKeys';
import { PROVIDERS, VISUALIZER_PROVIDERS } from '@skaitch/core/ai/providers';

interface Props {
  open: boolean;
  applicationOnly?: boolean;
  onClose: () => void;
  ai: AiConfig;
  setAi: Dispatch<SetStateAction<AiConfig>>;
  t: (k: string) => string;
  lang: LangType;
  onLangChange: (lang: LangType) => void;
  projects: ProjectMeta[];
  uid: string | null;
}



const AI_TOOLS = [
  { name: 'create_item', desc: 'mur, porte, fenêtre…', desc_en: 'wall, door, window…' },
  { name: 'modify_item', desc: 'dimensions, position', desc_en: 'dimensions, position' },
  { name: 'delete_item', desc: 'suppression', desc_en: 'remove items' },
  { name: 'query_items', desc: 'lister, filtrer', desc_en: 'list, filter' },
  { name: 'measure', desc: 'distances, surfaces', desc_en: 'distances, areas' },
  { name: 'validate_plan', desc: 'vérifications IFC', desc_en: 'IFC checks' },
  { name: 'suggest_layout', desc: 'agencement', desc_en: 'layout proposals' },
  { name: 'export_ifc', desc: 'export IFC', desc_en: 'IFC export' },
];

// Discover real model capabilities from API
interface ModelCapabilities {
  text: boolean;
  image: boolean;
  tools: boolean;
  thinking: boolean;
  effort?: AiEffort[];
}

const CAPABILITY_ICONS: Record<Exclude<keyof ModelCapabilities, 'effort'>, { icon: string; label: string }> = {
  text: { icon: '📝', label: 'Text' },
  image: { icon: '🖼️', label: 'Image/Vision' },
  tools: { icon: '🔧', label: 'Function Calling' },
  thinking: { icon: '🧠', label: 'Extended Thinking' },
};

// Cache to avoid duplicate API calls


export default function SettingsModal({ open, onClose, ai, setAi, t, lang, onLangChange, projects, uid, applicationOnly = false }: Props) {
  const [section, setSection] = useState<'general' | 'units' | 'ifc' | 'ai' | 'shortcuts' | 'mcp_api_keys'>(applicationOnly ? 'general' : 'ai');
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) || window.location.hostname.endsWith('.localhost');
  const [mcpConfigType, setMcpConfigType] = useState<'cloud' | 'local'>(isLocalhost ? 'local' : 'cloud');
  const { keys, loading: keysLoading, createKey, deleteKey, updatePermissions } = useApiKeys(uid);
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedOAuthField, setCopiedOAuthField] = useState<string | null>(null);
  const copyOAuthField = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedOAuthField(fieldId);
    setTimeout(() => setCopiedOAuthField(null), 2000);
  };
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  const toggleKeyVisibility = (keyId: string) => {
    setVisibleKeys(prev => ({ ...prev, [keyId]: !prev[keyId] }));
  };

  const getDisplayValue = (keyId: string) => {
    if (visibleKeys[keyId]) return keyId;
    if (keyId.startsWith('ak_')) {
      return `${keyId.substring(0, 8)}••••••••••••••••••••••••••••••••`;
    }
    return '••••••••••••••••••••••••••••••••';
  };
  
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [legacyAvailable, setLegacyAvailable] = useState(() => { try { return !!globalThis.localStorage?.getItem(LEGACY_AI_KEY); } catch { return false; } });
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, ModelCapabilities>>({});

  useEffect(() => {
    if (open && ai.model) {
      discoverModelCapabilities(ai.provider, ai.model, ai.apiKey, ai.baseUrl, ai.useCorsProxy, findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl)?.id, findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl)?.version).then(caps => {
        setModelCapabilities(prev => ({...prev, [ai.model]: caps}));
      });
    }
  }, [open, ai.model, ai.provider, ai.apiKey, ai.baseUrl, ai.useCorsProxy, ai.credentials]);

  useEffect(() => {
    let active = true;
    if (open && uid) listAiCredentials(uid).then(credentials => {
      if (active) setAi(current => ({ ...current, credentials }));
    }).catch(error => { if (active) setError(String(error.message || error)); });
    return () => { active = false; };
  }, [open, uid, setAi]);

  if (!open) return null;

  const provider = PROVIDERS.find((p) => p.id === ai.provider) || PROVIDERS[0];
  // If we have fetched models, use them. Otherwise use defaults.
  const allModels = (ai.models && ai.models.length > 0) ? ai.models : provider.models;
  const filteredModels = allModels.filter(m => m.toLowerCase().includes(modelSearch.toLowerCase()));

  const handleFetchModels = async () => {
    if (!localAiEndpoint(ai.provider, ai.baseUrl) && !findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl)) {
      setError('Enregistrez d’abord la clé pour ce compte.');
      return;
    }
    setFetching(true);
    setError(null);
    try {
      const fetched = await listAiModels(ai);

      if (fetched.length > 0) {
        const cachedModels = {...(ai.cachedModels || {}), [ai.provider]: fetched};
        setAi({...ai, models: fetched, model: fetched[0], cachedModels});
      } else {
        throw new Error('No models found');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setFetching(false);
    }
  };

  const updateKey = (key: string) => {
    const apiKeys = {...(ai.apiKeys || {}), [ai.provider]: key};
    setAi({...ai, apiKey: key, apiKeys});
  };

  const updateBaseUrl = (url: string) => {
    const baseUrls = {...(ai.baseUrls || {}), [ai.provider]: url};
    setAi({...ai, baseUrl: url, baseUrls});
  };

  const switchProvider = (id: string) => {
    const p = PROVIDERS.find(x => x.id === id) || PROVIDERS[0];
    const key = (ai.apiKeys && ai.apiKeys[id]) || '';
    const cached = (ai.cachedModels && ai.cachedModels[id]) || [];
    const baseUrl = (ai.baseUrls && ai.baseUrls[id]) || p.defaultBaseUrl || '';
    setAi({
      ...ai,
      provider: id,
      apiKey: key,
      models: cached,
      model: (cached.length > 0 ? cached[0] : (p.models[0] || '')),
      baseUrl
    });
    setModelSearch('');
  };

  let legacyTargets: string[] = [], legacyIssue = '';
  if (legacyAvailable) {
    try { legacyTargets = legacyAiEntries().entries.map(entry => `${entry.provider} (${credentialOrigin(entry.role, entry.provider, entry.baseUrl)})`); }
    catch (error) { legacyIssue = String((error as Error).message); }
  }
  const mergeCredentials = (entries: import('@skaitch/core/lib/aiCredentialTarget').AiCredentialMeta[]) => setAi(current => ({ ...current, credentials: [...(current.credentials || []).filter(old => !entries.some(entry => entry.id === old.id)), ...entries] }));
  const keyActions = (role: AiCredentialRole) => {
    const provider = role === 'chat' ? ai.provider : ai.visualizerProvider || 'pollinations';
    const baseUrl = role === 'chat' ? ai.baseUrl : ai.visualizerBaseUrl || (provider === ai.provider ? ai.baseUrl : undefined);
    const draft = role === 'chat' ? ai.apiKey : ai.visualizerApiKey || '';
    const entry = findCredential(ai.credentials, role, provider, baseUrl);
    const local = localAiEndpoint(provider, baseUrl || (role === 'render' && provider === 'custom' ? 'http://localhost:11434' : undefined));
    if (local) return <div style={{ gridColumn: '2', fontSize: 11, color: 'var(--ink-3)' }}>Clé locale utilisée en mémoire sur ce poste, sans enregistrement navigateur.
      {legacyAvailable && <button className="btn" onClick={() => {
        try {
          const records = legacyAiRecords();
          const old = records.find(value => {
            try {
              const sourceBase = role === 'chat' ? value.provider === provider ? value.baseUrl : value.baseUrls?.[provider] : value.visualizerBaseUrl;
              const sameProvider = role === 'chat' ? value.provider === provider || !!value.apiKeys?.[provider] : value.visualizerProvider === provider;
              return sameProvider && credentialOrigin(role, provider, sourceBase) === credentialOrigin(role, provider, baseUrl);
            } catch { return false; }
          });
          const secret = role === 'chat' ? old?.apiKeys?.[provider] || (old?.provider === provider ? old.apiKey : '') : old?.visualizerApiKey;
          if (!secret) throw new Error('Aucune ancienne clé locale correspondante.');
          setAi(current => role === 'chat' ? { ...current, apiKey: secret } : { ...current, visualizerApiKey: secret });
        } catch (error) { setError(String((error as Error).message)); }
      }}>Récupérer l’ancienne clé locale</button>}
    </div>;
    return <div style={{ gridColumn: '2', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11 }}>
      <span>{entry ? 'Clé enregistrée pour ce compte' : 'Aucune clé enregistrée'}</span>
      <button className="btn" disabled={keyBusy || !draft || !uid} onClick={async () => {
        if (!uid) return;
        setKeyBusy(true); setError(null);
        try {
          const saved = await saveAiCredential(uid, role, provider, baseUrl, draft, entry?.version ?? 0);
          setAi(current => {
            const credentials = [...(current.credentials || []).filter(value => value.id !== saved.id), saved];
            if (role === 'chat') {
              const apiKeys = { ...current.apiKeys };
              if (apiKeys[provider] === draft) delete apiKeys[provider];
              return { ...current, ...(current.provider === provider && current.apiKey === draft ? { apiKey: '' } : {}), apiKeys, credentials };
            }
            return { ...current, ...(role === 'render' && current.visualizerProvider === provider && current.visualizerApiKey === draft ? { visualizerApiKey: '' } : {}), credentials };
          });
        } catch (error) { setError(String((error as Error).message)); }
        finally { setKeyBusy(false); }
      }}>{entry ? 'Remplacer la clé' : 'Enregistrer la clé'}</button>
      {entry && <button className="btn" disabled={keyBusy || !uid} onClick={async () => {
        if (!uid) return;
        setKeyBusy(true); setError(null);
        try { await deleteAiCredential(uid, entry); setAi(current => ({ ...current, credentials: current.credentials?.filter(value => value.id !== entry.id) })); }
        catch (error) { setError(String((error as Error).message)); }
        finally { setKeyBusy(false); }
      }}>Supprimer la clé</button>}
    </div>;
  };

  return (
    <SharedSettingsModal open={open} onClose={onClose} ai={ai} setAi={setAi} t={t} lang={lang} onLangChange={onLangChange} applicationOnly={applicationOnly}
      aiSection={<>
                    {!applicationOnly && <AdminLink />}
                    <h2>{makeT(lang)("AI Assistant")}</h2>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                      <button className="btn" disabled={!uid || preferencesBusy || ai.preferencesRevision === undefined} onClick={async () => {
                        if (!uid || ai.preferencesRevision === undefined) return;
                        const config = aiPreferences(ai);
                        setPreferencesBusy(true); setError(null);
                        try {
                          const saved = await saveAiPreferences(uid, config, ai.preferencesRevision);
                          setAi(current => ({ ...current, preferencesRevision: saved.revision, savedPreferencesSignature: JSON.stringify(saved.config) }));
                        } catch (error) { setError(String((error as Error).message)); }
                        finally { setPreferencesBusy(false); }
                      }}>Enregistrer les préférences IA</button>
                      <button className="btn" disabled={!uid || preferencesBusy} onClick={async () => {
                        if (!uid) return;
                        setPreferencesBusy(true); setError(null);
                        try {
                          const saved = await getAiPreferences(uid);
                          setAi(current => ({ ...current, ...(saved.config ? { ...saved.config, models: current.cachedModels?.[saved.config.provider] || [], baseUrls: { ...current.baseUrls, [saved.config.provider]: saved.config.baseUrl } } : {}), apiKey: '', apiKeys: {}, visualizerApiKey: '', preferencesRevision: saved.revision, savedPreferencesSignature: saved.config ? JSON.stringify(saved.config) : '' }));
                        } catch (error) { setError(String((error as Error).message)); }
                        finally { setPreferencesBusy(false); }
                      }}>Recharger les préférences IA</button>
                      <span style={{ fontSize: 11 }}>{ai.savedPreferencesSignature === JSON.stringify(aiPreferences(ai)) ? 'Préférences enregistrées pour le MCP' : 'Préférences à enregistrer pour le MCP'}</span>
                    </div>
                    <p style={{ fontSize: 12 }}>Les rendus MCP utilisent les dernières préférences enregistrées et le modèle sauvegardé du projet.</p>
                    {!applicationOnly && <div className="lede">{makeT(lang)("Configure the smart assistant for this project.")}</div>}

                    <div style={{
                      background: 'var(--panel-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: 14,
                      marginTop: 12
                    }}>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--ink-3)',
                        marginBottom: 12
                      }}>{makeT(lang)("Service Provider")}</div>
                      
                      <select 
                        value={ai.provider} 
                        onChange={(e) => switchProvider(e.target.value)}
                        style={{width: '100%', height: 36, fontFamily: 'var(--font-sans)', fontSize: 13, marginBottom: 20}}
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>

                      <div className="kv-form" style={{gap: '14px 12px'}}>
                        {(ai.provider === 'ollama' || ai.provider === 'custom') && (
                            <>
                              <label>Base URL</label>
                              <input value={ai.baseUrl || ''} onChange={(e) => updateBaseUrl(e.target.value)}
                                     placeholder={provider.defaultBaseUrl || 'https://api.example.com'}
                                     style={{height: 32}}/>
                            </>
                        )}

                        {legacyAvailable && <div style={{ gridColumn: '1 / -1', padding: 8, fontSize: 12 }}>
                          {lang === 'fr' ? 'Anciennes clés présentes sur ce poste. Elles restent conservées jusqu’au transfert réussi.' : 'Older keys found on this device. They are kept until the transfer succeeds.'}
                          {legacyTargets.length > 0 && <div>{legacyTargets.join(', ')}</div>}
                          {legacyIssue && <div role="alert">{legacyIssue}</div>}
                          <button className="btn" disabled={keyBusy || !uid || !legacyTargets.length} onClick={async () => {
                            if (!uid) return;
                            setKeyBusy(true); setError(null);
                            try { mergeCredentials(await migrateAiCredentials(uid)); setLegacyAvailable(!!localStorage.getItem(LEGACY_AI_KEY)); }
                            catch (error) { setError(String((error as Error).message)); }
                            finally { setKeyBusy(false); }
                          }}>{lang === 'fr' ? 'Transférer les clés cloud vers ce compte' : 'Move the cloud keys to this account'}</button>
                        </div>}
                        <label>API Key</label>
                        <input type="password" autoComplete="off" value={ai.apiKey} onChange={(e) => updateKey(e.target.value)}
                               placeholder={makeT(lang)("Your secret key…")}
                               style={{height: 32}}/>
                        {keyActions('chat')}

                        <label>{makeT(lang)("Model")}</label>
                        <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                          <div style={{position: 'relative', display: 'flex', gap: 6}}>
                            <div style={{position: 'relative', flex: 1}}>
                              <input
                                  value={modelSearch}
                                  onChange={(e) => setModelSearch(e.target.value)}
                                  placeholder={makeT(lang)("Filter models…")}
                                  style={{height: 32, paddingLeft: 30, fontFamily: 'var(--font-sans)', fontSize: 12}}
                              />
                              <svg width="12" height="12" viewBox="0 0 20 20"
                                   style={{position: 'absolute', left: 10, top: 10, opacity: 0.4}}>
                                <path d="M14.5 14.5l3.5 3.5" stroke="currentColor" strokeWidth="2"
                                      strokeLinecap="round"/>
                                <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2"/>
                              </svg>
                            </div>
                            {(provider.fetchPath || ai.provider === 'custom') && (
                                <button className="btn" onClick={handleFetchModels} disabled={fetching}
                                        style={{padding: '0 10px', height: 32, fontSize: 11}}>
                                  {fetching ? '...' : (makeT(lang)("Discover"))}
                                </button>
                            )}
                          </div>
                          <select
                              value={filteredModels.includes(ai.model) ? ai.model : (ai.model ? 'custom' : '')}
                              onChange={async (e) => {
                                if (e.target.value === 'custom') {
                                  setAi({...ai, model: ''});
                                } else {
                                  setAi({...ai, model: e.target.value});
                                  // Discover capabilities
                                  const caps = await discoverModelCapabilities(ai.provider, e.target.value, ai.apiKey, ai.baseUrl, ai.useCorsProxy, findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl)?.id, findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl)?.version);
                                  setModelCapabilities(prev => ({...prev, [e.target.value]: caps}));
                                }
                              }}
                              style={{flex: 1, height: 32, fontFamily: 'var(--font-mono)'}}
                          >
                            <option value=""
                                    disabled>{makeT(lang)("Select a model…")}</option>
                            {filteredModels.map((m) => <option key={m} value={m}>{m}</option>)}
                            <option value="custom">-- {makeT(lang)("Other model…")} --</option>
                          </select>
                          {(ai.model === '' || !allModels.includes(ai.model)) && (
                              <input
                                  value={ai.model}
                                  onChange={(e) => setAi({...ai, model: e.target.value})}
                                  placeholder={makeT(lang)("Custom model name…")}
                                  style={{width: '100%', height: 32, animation: 'fadeIn 0.2s'}}
                                  autoFocus
                              />
                          )}
                          {ai.model && (
                              <div style={{
                                display: 'flex',
                                gap: 8,
                                marginTop: 4,
                                padding: '4px 0',
                                alignItems: 'center'
                              }}>
                                {modelCapabilities[ai.model] ? (
                                    (Object.keys(CAPABILITY_ICONS) as (keyof typeof CAPABILITY_ICONS)[]).map(key =>
                                            modelCapabilities[ai.model][key] && (
                                                <span
                                                    key={key}
                                                    title={CAPABILITY_ICONS[key].label}
                                                    style={{fontSize: 18, cursor: 'help'}}
                                                >
                                  {CAPABILITY_ICONS[key].icon}
                                </span>
                                            )
                                    )
                                ) : (
                                    <span style={{fontSize: 11, opacity: 0.5}}>Discovering capabilities...</span>
                                )}
                              </div>
                          )}
                        </div>
                        {error && <div style={{
                          gridColumn: '2',
                          color: 'oklch(0.55 0.18 25)',
                          fontSize: 10.5,
                          marginTop: -8
                        }}>{error}</div>}
                      </div>

                      <div style={{marginTop: 16, borderTop: '1px solid var(--border-faint)', paddingTop: 12}}>
                        <button
                            className="btn ghost"
                            onClick={() => setAdvanced(!advanced)}
                            style={{fontSize: 10.5, padding: '4px 0', height: 'auto', color: 'var(--ink-3)', gap: 4}}
                        >
                          <svg width="10" height="10" viewBox="0 0 20 20"
                               style={{transform: advanced ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s'}}>
                            <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2"
                                  strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          {makeT(lang)("Advanced options")}
                        </button>

                        {advanced && (
                            <div className="kv-form" style={{marginTop: 12, animation: 'fadeIn 0.2s'}}>
                              <label>{makeT(lang)("Creativity")}</label>
                              <div className="slider-row">
                                <input type="range" min="0" max="1" step="0.05" value={ai.temperature}
                                       onChange={(e) => setAi({...ai, temperature: parseFloat(e.target.value)})}/>
                                <span className="v" style={{fontSize: 11}}>{ai.temperature.toFixed(2)}</span>
                              </div>
                              <label>{makeT(lang)("Reasoning effort")}</label>
                              <select value={ai.effort || ''} data-testid="ai-effort"
                                      onChange={(e) => setAi({...ai, effort: e.target.value as AiConfig['effort']})}>
                                <option value="">{makeT(lang)("Model default")}</option>
                                {/* Levels the provider reports for this model, or every level when it does not say. */}
                                {effortChoices(modelCapabilities[ai.model]?.effort, ai.effort)
                                    .map(level => <option key={level} value={level}>{level}</option>)}
                              </select>
                            </div>
                        )}
                      </div>
                    </div>

                    <div style={{marginTop: 24}}>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--ink-3)',
                        marginBottom: 8
                      }}>{makeT(lang)("Assistant capabilities")}</div>
                      <div style={{display: 'flex', gap: '6px 8px', flexWrap: 'wrap'}}>
                        {AI_TOOLS.map((tt) => (
                            <div key={tt.name} className="tool-pill" style={{
                              padding: '4px 10px',
                              background: 'var(--panel-2)',
                              border: '1px solid var(--border-faint)',
                              borderRadius: 6,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6
                            }}>
                        <span className="sparkle" style={{color: 'var(--accent)'}}>
                          <svg width="10" height="10" viewBox="0 0 20 20"><path
                              d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5z" fill="currentColor"/></svg>
                        </span>
                              <span style={{fontSize: 11, fontWeight: 500, color: 'var(--ink-2)'}}>{tt.name}</span>
                            </div>
                        ))}
                        <div
                            onClick={() => setAi({...ai, mcpAlwaysValidate: !ai.mcpAlwaysValidate})}
                            className={`tool-pill${ai.mcpAlwaysValidate ? ' active' : ''}`}
                            style={{
                              padding: '4px 10px',
                              background: ai.mcpAlwaysValidate ? 'oklch(0.96 0.04 145)' : 'var(--panel-2)',
                              border: '1px solid ' + (ai.mcpAlwaysValidate ? 'oklch(0.65 0.16 145)' : 'var(--border-faint)'),
                              borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
                              cursor: 'pointer', transition: 'all 0.2s'
                            }}
                        >
                          <div style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            border: '1.5px solid ' + (ai.mcpAlwaysValidate ? 'oklch(0.65 0.16 145)' : 'var(--ink-4)'),
                            display: 'grid',
                            placeItems: 'center',
                            background: ai.mcpAlwaysValidate ? 'oklch(0.65 0.16 145)' : 'transparent'
                          }}>
                            {ai.mcpAlwaysValidate && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white"
                                                   strokeWidth="4">
                              <path d="M20 6L9 17l-5-5"/>
                            </svg>}
                          </div>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: ai.mcpAlwaysValidate ? 'oklch(0.35 0.12 145)' : 'var(--ink-2)'
                          }}>
                            {makeT(lang)("Confirm AI Actions")}
                          </span>
                        </div>

                        <div
                            onClick={() => setAi({...ai, useCorsProxy: !ai.useCorsProxy})}
                            className={`tool-pill${ai.useCorsProxy ? ' active' : ''}`}
                            style={{
                              padding: '4px 10px',
                              background: ai.useCorsProxy ? 'oklch(0.96 0.04 145)' : 'var(--panel-2)',
                              border: '1px solid ' + (ai.useCorsProxy ? 'oklch(0.65 0.16 145)' : 'var(--border-faint)'),
                              borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
                              cursor: 'pointer', transition: 'all 0.2s'
                            }}
                        >
                          <div style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            border: '1.5px solid ' + (ai.useCorsProxy ? 'oklch(0.65 0.16 145)' : 'var(--ink-4)'),
                            display: 'grid',
                            placeItems: 'center',
                            background: ai.useCorsProxy ? 'oklch(0.65 0.16 145)' : 'transparent'
                          }}>
                            {ai.useCorsProxy && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white"
                                                   strokeWidth="4">
                              <path d="M20 6L9 17l-5-5"/>
                            </svg>}
                          </div>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: ai.useCorsProxy ? 'oklch(0.35 0.12 145)' : 'var(--ink-2)'
                          }}>
                            {makeT(lang)("CORS proxy (local development)")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{
                      background: 'var(--panel-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: 14,
                      marginTop: 16
                    }}>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--ink-3)',
                        marginBottom: 12
                      }}>{makeT(lang)("Image & Video Generation (Rendering)")}</div>

                      <div className="kv-form" style={{gap: '14px 12px'}}>
                        <label>{makeT(lang)("Render Provider")}</label>
                        <select
                          value={ai.visualizerProvider || 'pollinations'}
                          onChange={(e) => {
                            const providerId = e.target.value;
                            const defaultModel = VISUALIZER_PROVIDERS.find(p => p.id === providerId)?.models[0] || '';
                            setAi({
                              ...ai,
                              visualizerProvider: providerId,
                              visualizerApiKey: '',
                              visualizerModel: defaultModel
                            });
                          }}
                          style={{width: '100%', height: 36, fontFamily: 'var(--font-sans)', fontSize: 13}}
                        >
                          {VISUALIZER_PROVIDERS.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>

                        {(ai.visualizerProvider || 'pollinations') !== 'pollinations' && (
                          <>
                            <label>{makeT(lang)("API Key")}</label>
                            <input
                              type="password"
                              autoComplete="off"
                              value={ai.visualizerApiKey || ''}
                              onChange={(e) => setAi({ ...ai, visualizerApiKey: e.target.value })}
                              placeholder={
                                ai.visualizerProvider === ai.provider 
                                  ? (makeT(lang)("Empty (uses primary key)")) 
                                  : (makeT(lang)("Secret key for rendering…"))
                              }
                              style={{height: 32}}
                            />
                            {keyActions('render')}
                          </>
                        )}

                        <label>{makeT(lang)("Render Model")}</label>
                        <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                          <select
                            value={ai.visualizerModel || ''}
                            onChange={(e) => {
                              if (e.target.value === 'custom' || e.target.value === '') {
                                setAi({ ...ai, visualizerModel: '' });
                              } else {
                                setAi({ ...ai, visualizerModel: e.target.value });
                              }
                            }}
                            style={{width: '100%', height: 32, fontFamily: 'var(--font-mono)', fontSize: 12}}
                          >
                            <option value="">-- {makeT(lang)("Enter a model…")} --</option>
                            {(VISUALIZER_PROVIDERS.find(p => p.id === (ai.visualizerProvider || 'pollinations'))?.models || []).map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                            <option value="custom">-- {makeT(lang)("Other model…")} --</option>
                          </select>
                          {(!ai.visualizerModel || !(VISUALIZER_PROVIDERS.find(p => p.id === (ai.visualizerProvider || 'pollinations'))?.models || []).includes(ai.visualizerModel)) && (
                            <input
                              value={ai.visualizerModel || ''}
                              onChange={(e) => setAi({ ...ai, visualizerModel: e.target.value })}
                              placeholder={makeT(lang)("Render model name…")}
                              style={{width: '100%', height: 32}}
                            />
                          )}
                        </div>

                        {(ai.visualizerProvider === 'custom' || ai.visualizerProvider === 'fal' || ai.visualizerProvider === 'replicate') && (
                          <>
                            <label>Base URL</label>
                            <input
                              value={ai.visualizerBaseUrl || ''}
                              onChange={(e) => setAi({ ...ai, visualizerBaseUrl: e.target.value })}
                              placeholder={
                                ai.visualizerProvider === 'fal' ? 'https://queue.fal.run' :
                                ai.visualizerProvider === 'replicate' ? 'https://api.replicate.com' :
                                'https://api.example.com'
                              }
                              style={{height: 32}}
                            />
                          </>
                        )}
                      </div>
                    </div>
      </>}
      mcpSection={<>
                  <h2>{makeT(lang)("MCP server")}</h2>
                  <div className="lede">
                    {makeT(lang)("Generate access keys to allow external agents (e.g. Claude Desktop) to connect and edit your projects via MCP.")}
                  </div>

                  <div className="mcp-overview">
                    <div>
                      <strong>{makeT(lang)(isLocalhost ? "Local Server" : "Cloud Server")}</strong>
                      <code>{window.location.origin}</code>
                    </div>
                    <label className="mcp-enable">
                      <input type="checkbox" checked={!!ai.mcpEnabled}
                        onChange={(e) => setAi({ ...ai, mcpEnabled: e.target.checked })} />
                      {makeT(lang)("Enable MCP")}
                    </label>
                  </div>
                  <p className="mcp-hint">{makeT(lang)("Keep this editor open with MCP enabled.")}</p>
                  <h3 className="mcp-step">{makeT(lang)("1. Authorize project access")}</h3>
                  <p className="mcp-hint">{makeT(lang)("Create a key, then choose which projects the assistant can read or edit. New keys have no access by default.")}</p>

                  {/* Create Key Form */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 20, background: 'var(--panel-2)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <input
                      type="text"
                      aria-label={makeT(lang)("Key name (e.g. Claude Desktop)...")}
                      placeholder={makeT(lang)("Key name (e.g. Claude Desktop)...")}
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      style={{ flex: 1, height: 32, padding: '0 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                    />
                    <button
                      className="btn"
                      disabled={!uid || !newKeyName.trim()}
                      onClick={async () => {
                        if (await createKey(newKeyName)) setNewKeyName('');
                      }}
                      style={{ padding: '0 16px', height: 32, fontSize: 12 }}
                    >
                      {makeT(lang)("Generate")}
                    </button>
                  </div>

                  {/* Keys List */}
                  {keysLoading ? (
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{makeT(lang)("Loading keys...")}</div>
                  ) : keys.length === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 20 }}>
                      {makeT(lang)("No API keys generated.")}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                      {keys.map((k) => (
                        <div key={k.id} style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-1)' }}>{k.name}</span>
                            <button
                              className="btn ghost icon"
                              onClick={() => deleteKey(k.id)}
                              style={{ color: 'oklch(0.55 0.18 25)', background: 'transparent', border: 'none', padding: 4, cursor: 'pointer' }}
                              title={makeT(lang)("Delete")}
                            >
                              <svg width="12" height="12" viewBox="0 0 20 20">
                                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>

                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                            <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                              <input
                                type="text"
                                readOnly
                                aria-label={k.name}
                                value={getDisplayValue(k.id)}
                                style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, height: 28, padding: '0 32px 0 8px' }}
                              />
                              <button
                                onClick={() => toggleKeyVisibility(k.id)}
                                style={{
                                  position: 'absolute',
                                  right: 8,
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--ink-3)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: 0
                                }}
                                title={visibleKeys[k.id] ? (makeT(lang)("Hide")) : (makeT(lang)("Show"))}
                              >
                                {visibleKeys[k.id] ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                    <line x1="1" y1="1" x2="23" y2="23" />
                                  </svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                )}
                              </button>
                            </div>
                            <button
                              className="btn"
                              onClick={() => {
                                navigator.clipboard.writeText(k.id);
                                setCopiedId(k.id);
                                setTimeout(() => setCopiedId(null), 2000);
                              }}
                              style={{ height: 28, fontSize: 11, padding: '0 10px', minWidth: 70 }}
                            >
                              {copiedId === k.id ? (makeT(lang)("Copied!")) : (makeT(lang)("Copy"))}
                            </button>
                          </div>

                          {/* Permissions Table */}
                          {!k.accountAccess && <div style={{ borderTop: '1px solid var(--border-faint)', paddingTop: 10 }}>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--ink-3)', letterSpacing: '0.05em', marginBottom: 6 }}>
                              {makeT(lang)("Project Permissions")}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {projects.map((proj) => {
                                const currentPerm = k.permissions[proj.id] || 'none';
                                return (
                                  <div key={proj.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                                    <span style={{ color: 'var(--ink-2)' }}>{proj.name}</span>
                                    <select
                                      aria-label={`${makeT(lang)("Project Permissions")} — ${proj.name}`}
                                      value={currentPerm}
                                      onChange={async (e) => {
                                        const newPerms = { ...k.permissions, [proj.id]: e.target.value as 'read' | 'write' | 'none' };
                                        await updatePermissions(k.id, newPerms);
                                      }}
                                      style={{ height: 24, fontSize: 11, padding: '0 4px', width: 140, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4 }}
                                    >
                                      <option value="none">{makeT(lang)("No Access")}</option>
                                      <option value="read">{makeT(lang)("Read Only")}</option>
                                      <option value="write">{makeT(lang)("Read / Write")}</option>
                                    </select>
                                  </div>
                                );
                              })}
                            </div>
                          </div>}
                        </div>
                      ))}
                    </div>
                  )}

                  <h3 className="mcp-step">{makeT(lang)("2. Connect your assistant")}</h3>
                  <AssistantConnection keys={keys} enabled={!!ai.mcpEnabled} lang={lang} />
                  {isLocalhost && (
                    <div className="mcp-modes" role="group" aria-label={makeT(lang)("MCP server")}>
                      {(['local', 'cloud'] as const).map(mode => (
                        <button key={mode} className="btn" aria-pressed={mcpConfigType === mode}
                          onClick={() => { setMcpConfigType(mode); setCopiedConfig(false); }}>
                          {makeT(lang)(mode === 'local' ? "Local Server" : "Cloud Server")}
                        </button>
                      ))}
                    </div>
                  )}
                  {(() => {
                    const local = isLocalhost && mcpConfigType === 'local';
                    const mcpUrl = `${window.location.origin}/api/mcp`;
                    const config = (key: string) => JSON.stringify({
                      mcpServers: local ? {
                        skaitch: {
                          command: 'node',
                          args: ['--import', '/ABSOLUTE/PATH/SkAItch/node_modules/tsx/dist/loader.mjs', '/ABSOLUTE/PATH/SkAItch/server/mcp-server.ts'],
                          env: { SKAITCH_API_KEY: key },
                        },
                      } : {
                        'skaitch-cloud': { command: 'npx', args: ['-y', 'mcp-remote', mcpUrl] },
                      },
                    }, null, 2);
                    const connectionField = (label: string, value: string, id: string) => (
                      <div className="mcp-connection-field" key={id}>
                        <span>{makeT(lang)(label)}</span>
                        <div>
                          <code>{value}</code>
                          <button className="btn" onClick={() => copyOAuthField(value, id)}
                            aria-label={`${makeT(lang)("Copy")} — ${makeT(lang)(label)}`}>
                            {makeT(lang)(copiedOAuthField === id ? "Copied!" : "Copy")}
                          </button>
                        </div>
                      </div>
                    );
                    return (
                      <div className="mcp-connection">
                        {!local && (
                          <>
                            <details>
                              <summary>{makeT(lang)("Advanced OAuth settings")}</summary>
                              {connectionField("Authorization URL", `${mcpUrl}/authorize`, 'auth_url')}
                              {connectionField("Token URL", `${mcpUrl}/token`, 'token_url')}
                            </details>
                          </>
                        )}
                        {local && <details open={local}>
                          <summary>{makeT(lang)("Claude Desktop Configuration")}</summary>
                          <p className="mcp-hint">{makeT(lang)(local
                            ? "Replace /ABSOLUTE/PATH/SkAItch with your project folder. Claude Desktop starts the local server."
                            : "Paste this configuration into Claude Desktop's configuration file. Node.js must be installed on your computer.")}</p>
                          <button className="btn" onClick={() => {
                            navigator.clipboard.writeText(config(keys[0]?.id ?? 'ak_YOUR_API_KEY'));
                            setCopiedConfig(true);
                            setTimeout(() => setCopiedConfig(false), 2000);
                          }}>
                            {makeT(lang)(copiedConfig ? "Copied!" : "Copy Config")}
                          </button>
                          <pre>{config(keys.length ? getDisplayValue(keys[0].id) : 'ak_YOUR_API_KEY')}</pre>
                        </details>}
                      </div>
                    );
                  })()}
      </>}
    />
  );
};