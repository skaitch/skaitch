// Settings modal + AI Assistant chat panel

const { Icon, polyArea, wallLength } = window.AS_UI;

// ============ SETTINGS MODAL ============
const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', short: 'Gem', live: true,
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash-exp'] },
  { id: 'anthropic', name: 'Anthropic', short: 'C', live: true,
    models: ['claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4'] },
  { id: 'openai', name: 'OpenAI', short: 'AI', live: false,
    models: ['gpt-5', 'gpt-4.1', 'o3-pro'] },
  { id: 'mistral', name: 'Mistral', short: 'M', live: false,
    models: ['mistral-large', 'codestral-2'] },
  { id: 'ollama', name: 'Ollama (local)', short: '○', live: false,
    models: ['llama-4', 'qwen-3', 'devstral'] },
  { id: 'azure', name: 'Azure OpenAI', short: 'AZ', live: false,
    models: ['gpt-4o-azure', 'gpt-4-turbo-azure'] },
];

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

function SettingsModal({ open, onClose, ai, setAi, lang, t }) {
  const [section, setSection] = React.useState('ai');
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target.classList.contains('scrim')) onClose(); }}>
      <div className="modal settings-modal">
        <div className="modal-head">
          <div>
            <h3>{t('settings')}</h3>
            <div className="sub">{lang === 'fr' ? 'Configuration globale du projet' : 'Global project configuration'}</div>
          </div>
          <button className="btn ghost icon close" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="settings-layout">
          <div className="settings-nav">
            <button className={section === 'general' ? 'on' : ''} onClick={() => setSection('general')}><Icon name="settings" size={13} />{lang === 'fr' ? 'Général' : 'General'}</button>
            <button className={section === 'units' ? 'on' : ''} onClick={() => setSection('units')}><Icon name="measure" size={13} />{lang === 'fr' ? 'Unités' : 'Units'}</button>
            <button className={section === 'ifc' ? 'on' : ''} onClick={() => setSection('ifc')}><Icon name="folder" size={13} />IFC</button>
            <button className={section === 'ai' ? 'on' : ''} onClick={() => setSection('ai')}><span className="sparkle"><Icon name="sparkle" size={13} /></span>{lang === 'fr' ? 'Intelligence Artificielle' : 'AI'}</button>
            <button className={section === 'shortcuts' ? 'on' : ''} onClick={() => setSection('shortcuts')}><Icon name="code" size={13} />{lang === 'fr' ? 'Raccourcis' : 'Shortcuts'}</button>
          </div>
          <div className="settings-body">
            {section === 'ai' && <AISettings ai={ai} setAi={setAi} lang={lang} />}
            {section === 'general' && <GeneralSettings lang={lang} />}
            {section === 'units' && <UnitsSettings lang={lang} />}
            {section === 'ifc' && <IfcSettings lang={lang} />}
            {section === 'shortcuts' && <ShortcutsSettings lang={lang} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function AISettings({ ai, setAi, lang }) {
  const provider = PROVIDERS.find(p => p.id === ai.provider) || PROVIDERS[0];
  return (
    <>
      <h2>{lang === 'fr' ? 'Intelligence Artificielle' : 'AI Configuration'}</h2>
      <div className="lede">
        {lang === 'fr' ? 'Choisissez le fournisseur, le modèle et les paramètres pour l\'assistant intégré.'
                       : 'Pick a provider, model, and parameters for the embedded assistant.'}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 8 }}>{lang === 'fr' ? 'Fournisseur' : 'Provider'}</div>
      <div className="provider-grid">
        {PROVIDERS.map(p => (
          <div key={p.id} className={`provider-card${ai.provider === p.id ? ' on' : ''}`} onClick={() => setAi({ ...ai, provider: p.id, model: p.models[0] })}>
            <div className="ic" style={{ background: ai.provider === p.id ? 'var(--ink)' : 'var(--bg)', color: ai.provider === p.id ? 'var(--bg)' : 'var(--ink)' }}>{p.short}</div>
            <div className="nm">{p.name}</div>
            <div className="st">{p.live ? <span className="live">● ACTIVE</span> : <span>● Standby</span>}</div>
            <span className="check"><Icon name="check" size={14} /></span>
          </div>
        ))}
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)', marginTop: 18, marginBottom: 8 }}>{lang === 'fr' ? 'Modèle & clé' : 'Model & key'}</div>
      <div className="kv-form">
        <label>{lang === 'fr' ? 'Modèle' : 'Model'}</label>
        <select value={ai.model} onChange={e => setAi({ ...ai, model: e.target.value })}>
          {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <label>API Key</label>
        <input type="password" value={ai.apiKey} onChange={e => setAi({ ...ai, apiKey: e.target.value })} placeholder={lang === 'fr' ? 'Coller votre clé…' : 'Paste your key…'} />

        <label>{lang === 'fr' ? 'Créativité' : 'Creativity'}</label>
        <div className="slider-row">
          <input type="range" min="0" max="1" step="0.05" value={ai.temperature} onChange={e => setAi({ ...ai, temperature: parseFloat(e.target.value) })} />
          <span className="v">{ai.temperature < 0.33 ? (lang === 'fr' ? 'précis' : 'precise') : ai.temperature < 0.66 ? (lang === 'fr' ? 'équilibré' : 'balanced') : (lang === 'fr' ? 'créatif' : 'creative')}</span>
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)', marginTop: 18, marginBottom: 4 }}>
        {lang === 'fr' ? 'Tools disponibles' : 'Available tools'}
      </div>
      <div style={{ color: 'var(--ink-3)', fontSize: 11.5, marginBottom: 6 }}>
        {lang === 'fr' ? 'L\'assistant peut appeler les outils suivants pour modifier le plan.' : 'The assistant can call these tools to modify the plan.'}
      </div>
      <div className="tools-list">
        {AI_TOOLS.map(tt => (
          <div key={tt.name} className="tool-pill">
            <span className="ic"><Icon name="sparkle" size={11} /></span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="nm">{tt.name}</span>
              <span className="desc">{lang === 'fr' ? tt.desc : tt.desc_en}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function GeneralSettings({ lang }) {
  return (
    <>
      <h2>{lang === 'fr' ? 'Général' : 'General'}</h2>
      <div className="lede">{lang === 'fr' ? 'Préférences globales du projet.' : 'Global project preferences.'}</div>
      <div className="kv-form">
        <label>{lang === 'fr' ? 'Nom du projet' : 'Project name'}</label>
        <input defaultValue="Résidence Les Tilleuls" />
        <label>{lang === 'fr' ? 'Auteur' : 'Author'}</label>
        <input defaultValue="Atelier Saint-Marc" />
        <label>{lang === 'fr' ? 'Phase BIM' : 'BIM phase'}</label>
        <select defaultValue="EXE"><option>APS</option><option>APD</option><option>PRO</option><option>EXE</option></select>
        <label>{lang === 'fr' ? 'Système de référence' : 'Coordinate system'}</label>
        <select defaultValue="lambert93"><option value="lambert93">Lambert-93</option><option value="wgs84">WGS84</option><option value="local">Local</option></select>
      </div>
    </>
  );
}
function UnitsSettings({ lang }) {
  return (
    <>
      <h2>{lang === 'fr' ? 'Unités' : 'Units'}</h2>
      <div className="lede">{lang === 'fr' ? 'Le projet est stocké en SI ; affichage configurable.' : 'Project stored in SI; display is configurable.'}</div>
      <div className="kv-form">
        <label>{lang === 'fr' ? 'Longueur' : 'Length'}</label>
        <select defaultValue="m"><option>m</option><option>cm</option><option>mm</option></select>
        <label>{lang === 'fr' ? 'Surface' : 'Area'}</label>
        <select defaultValue="m²"><option>m²</option><option>cm²</option></select>
        <label>{lang === 'fr' ? 'Volume' : 'Volume'}</label>
        <select defaultValue="m³"><option>m³</option><option>L</option></select>
        <label>{lang === 'fr' ? 'Angle' : 'Angle'}</label>
        <select defaultValue="deg"><option>deg</option><option>rad</option><option>grad</option></select>
        <label>{lang === 'fr' ? 'Précision' : 'Precision'}</label>
        <select defaultValue="3"><option>1</option><option>2</option><option>3</option><option>4</option></select>
      </div>
    </>
  );
}
function IfcSettings({ lang }) {
  return (
    <>
      <h2>IFC</h2>
      <div className="lede">{lang === 'fr' ? 'Schéma et options d\'export.' : 'Schema and export options.'}</div>
      <div className="kv-form">
        <label>{lang === 'fr' ? 'Version' : 'Version'}</label>
        <select defaultValue="IFC4"><option>IFC2x3</option><option>IFC4</option><option>IFC4.3</option></select>
        <label>MVD</label>
        <select defaultValue="ReferenceView"><option>CoordinationView</option><option>ReferenceView</option><option>DesignTransferView</option></select>
        <label>{lang === 'fr' ? 'Inclure PSets' : 'Include PSets'}</label>
        <select defaultValue="all"><option value="all">{lang === 'fr' ? 'Tous' : 'All'}</option><option value="common">Pset_*Common</option><option value="custom">{lang === 'fr' ? 'Personnalisés' : 'Custom only'}</option></select>
        <label>{lang === 'fr' ? 'Géométrie' : 'Geometry'}</label>
        <select defaultValue="brep"><option value="brep">Brep</option><option value="extruded">Extruded</option><option value="bbox">Bounding boxes</option></select>
      </div>
    </>
  );
}
function ShortcutsSettings({ lang }) {
  const shortcuts = [
    ['V', lang === 'fr' ? 'Sélection' : 'Select'],
    ['W', lang === 'fr' ? 'Mur' : 'Wall'],
    ['D', lang === 'fr' ? 'Porte' : 'Door'],
    ['F', lang === 'fr' ? 'Fenêtre' : 'Window'],
    ['R', lang === 'fr' ? 'Pièce' : 'Room'],
    ['M', lang === 'fr' ? 'Meuble' : 'Furniture'],
    ['Suppr', lang === 'fr' ? 'Supprimer la sélection' : 'Delete selection'],
    ['Alt + drag', lang === 'fr' ? 'Pan' : 'Pan'],
    ['Wheel', 'Zoom'],
    ['Shift + click', lang === 'fr' ? 'Sélection multiple' : 'Multi-select'],
    ['Cmd / Ctrl + A', lang === 'fr' ? 'Tout sélectionner' : 'Select all'],
    ['Cmd / Ctrl + Z', 'Undo'],
    ['G', lang === 'fr' ? 'Toggle grille' : 'Toggle grid'],
  ];
  return (
    <>
      <h2>{lang === 'fr' ? 'Raccourcis' : 'Shortcuts'}</h2>
      <div className="lede">{lang === 'fr' ? 'Liste de raccourcis clavier.' : 'Keyboard shortcuts.'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 12 }}>
        {shortcuts.map(([k, label]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-faint)' }}>
            <span style={{ color: 'var(--ink-2)' }}>{label}</span>
            <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>{k}</kbd>
          </div>
        ))}
      </div>
    </>
  );
}

window.AS_SettingsModal = SettingsModal;

// ============ CHAT ASSISTANT ============
function ChatPanel({ open, onClose, items, ai, selection, setSelection, addItem, updateItem, deleteItems, focusStorey, lang, t }) {
  const [messages, setMessages] = React.useState([
    {
      role: 'assistant',
      content: lang === 'fr'
        ? "Bonjour 👋 Je suis votre assistant BIM. Je peux interroger, mesurer et modifier votre plan via 8 tools (create_item, modify_item, delete_item, query_items, measure, validate_plan, suggest_layout, export_ifc).\n\nQue voulez-vous faire ?"
        : "Hi 👋 I'm your BIM assistant. I can query, measure, and edit your plan through 8 tools (create_item, modify_item, delete_item, query_items, measure, validate_plan, suggest_layout, export_ifc).\n\nWhat would you like to do?"
    },
  ]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const bodyRef = React.useRef(null);

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  if (!open) return null;

  const ctx = (() => {
    const stats = {};
    for (const it of Object.values(items)) stats[it.type] = (stats[it.type] || 0) + 1;
    return stats;
  })();

  const send = async (txt) => {
    if (!txt.trim()) return;
    setMessages(m => [...m, { role: 'user', content: txt }]);
    setInput('');
    setBusy(true);

    // Determine if this query maps to a tool. We'll do simple intent matching
    // and demonstrate calls that actually modify the plan.
    const lower = txt.toLowerCase();
    let toolCalls = [];

    // Heuristic intent detection (works without network)
    if (/(combien|how many|count|nombre)/.test(lower)) {
      let target = null;
      if (/mur|wall/.test(lower)) target = 'Wall';
      else if (/porte|door/.test(lower)) target = 'Door';
      else if (/fenê|fenetre|window/.test(lower)) target = 'Window';
      else if (/pièce|piece|room/.test(lower)) target = 'Room';
      else if (/meuble|furn/.test(lower)) target = 'Furniture';
      const all = target ? Object.values(items).filter(i => i.type === target) : Object.values(items);
      toolCalls.push({
        name: 'query_items',
        args: { type: target || 'any' },
        result: `${all.length} ${target || 'items'} found`,
      });
    }

    if (/surface|area|m²/.test(lower)) {
      const total = Object.values(items).filter(i => i.type === 'Room').reduce((s, r) => s + polyArea(r.geom.polygon), 0);
      toolCalls.push({
        name: 'measure',
        args: { metric: 'total_floor_area', scope: 'project' },
        result: `${total.toFixed(2)} m²`,
      });
    }

    if (/(valid|conform|check|verif|vérif)/.test(lower)) {
      const issues = [];
      const walls = Object.values(items).filter(i => i.type === 'Wall');
      const externalCount = walls.filter(w => w.isExternal).length;
      if (externalCount < 4) issues.push('Bâtiment B: contour extérieur incomplet');
      issues.push('Pset_WallCommon.ThermalTransmittance manquant pour 3 murs');
      issues.push('R+1: hauteur sous plafond < RT2020 sur 1 chambre');
      toolCalls.push({
        name: 'validate_plan',
        args: { schema: 'IFC4', mvd: 'ReferenceView' },
        result: `${issues.length} issue(s)`,
        details: issues,
      });
    }

    if (/export/.test(lower)) {
      toolCalls.push({
        name: 'export_ifc',
        args: { schema: 'IFC4', mvd: 'ReferenceView' },
        result: 'Generated residence_tilleuls_v3.ifc — 84.2 KB',
      });
    }

    if (/(ajout|add|crée|create|cree)/.test(lower) && /(mur|wall)/.test(lower)) {
      // create a wall — find numbers in text
      const m = lower.match(/(\d+(?:\.\d+)?)\s*m/);
      const len = m ? parseFloat(m[1]) : 4;
      const id = 'w_ai_' + Date.now();
      const newWall = {
        id, type: 'Wall', name: lang === 'fr' ? `Mur (IA) — ${len}m` : `AI wall — ${len}m`,
        parentId: focusStorey,
        ifcGUID: window.AS_DATA.guid(id),
        geom: { x1: 1, y1: 9, x2: 1 + len, y2: 9, thickness: 0.20, height: 2.70 },
        material: 'Brique 200mm', fireRating: 'EI 60', loadBearing: false, isExternal: false,
      };
      addItem(newWall);
      setSelection([id]);
      toolCalls.push({
        name: 'create_item',
        args: { type: 'Wall', length: len, parentStoreyId: focusStorey },
        result: `Created ${id}`,
      });
    }

    if (/suggest|propose|propos|agencement|layout/.test(lower)) {
      toolCalls.push({
        name: 'suggest_layout',
        args: { room: 'Séjour', style: 'open-plan' },
        result: '3 layouts proposed: A) bibliothèque mur Nord, B) banquette baie Sud, C) îlot central',
      });
    }

    if (/supprim|delete/.test(lower) && selection.length > 0) {
      toolCalls.push({
        name: 'delete_item',
        args: { ids: selection },
        result: `${selection.length} item(s) deleted`,
      });
      const deleted = [...selection];
      setTimeout(() => deleteItems(deleted), 300);
    }

    // Produce reply text — try to use claude.complete if available
    let replyText = '';
    try {
      const ctxText = `Contexte du plan: ${JSON.stringify(ctx)}. Storey actif: ${focusStorey}. Sélection: ${selection.length} items. Tools appelés: ${JSON.stringify(toolCalls.map(c => c.name))}.`;
      const sysPrompt = lang === 'fr'
        ? "Tu es un assistant BIM expert IFC qui aide à modifier un plan d'architecture. Réponds très brièvement (1-3 phrases). Quand des tools sont appelés, commente leurs résultats. Utilise le français."
        : "You are an expert IFC BIM assistant helping edit an architectural plan. Reply briefly (1-3 sentences). Comment on tool results when relevant. Use English.";
      const prompt = `${sysPrompt}\n\n${ctxText}\n\nUser: ${txt}\n\nReply:`;
      const r = await window.claude.complete(prompt);
      replyText = (r || '').trim();
    } catch (e) {
      replyText = lang === 'fr'
        ? "J'ai exécuté votre demande. Vous pouvez poursuivre — la sélection a été synchronisée avec le plan."
        : "Done. Selection has been synced with the plan.";
    }

    // Append messages: tool calls first, then reply
    setMessages(m => {
      const next = [...m];
      for (const tc of toolCalls) next.push({ role: 'tool', tool: tc });
      if (replyText) next.push({ role: 'assistant', content: replyText });
      return next;
    });
    setBusy(false);
  };

  const suggested = lang === 'fr' ? [
    'Combien de murs porteurs ?',
    'Surface totale du projet ?',
    'Valide le plan IFC',
    'Ajoute un mur de 4m au RDC',
    'Propose un agencement pour le séjour',
  ] : [
    'How many load-bearing walls?',
    'Total project area?',
    'Validate IFC plan',
    'Add a 4m wall on ground floor',
    'Suggest a layout for the living room',
  ];

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <div className="av">AI</div>
        <div className="who">
          <div className="nm">{lang === 'fr' ? 'Assistant ArchAI' : 'ArchAI Assistant'}</div>
          <div className="st"><b>● Live</b> · {ai.provider} · {ai.model}</div>
        </div>
        <div className="actions">
          <button className="icon-btn" onClick={() => setMessages([messages[0]])} title={lang === 'fr' ? 'Nouvelle conversation' : 'New conversation'}><Icon name="history" size={13} /></button>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="x" size={13} /></button>
        </div>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {messages.map((m, i) => {
          if (m.role === 'tool') {
            return (
              <div key={i} className="msg assistant">
                <div className="tool-call">
                  <div className="head">
                    <Icon name="sparkle" size={11} />
                    <span className="nm">{m.tool.name}</span>
                    <span className="st">✓ ok</span>
                  </div>
                  <div className="args">{Object.entries(m.tool.args).map(([k, v], j) => (
                    <span key={k}>{k}=<span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>{j < Object.entries(m.tool.args).length - 1 ? ', ' : ''}</span>
                  ))}</div>
                  <div className="res">→ {m.tool.result}</div>
                  {m.tool.details && (
                    <div className="res" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)' }}>
                      {m.tool.details.map((d, j) => <div key={j}>· {d}</div>)}
                    </div>
                  )}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className={`msg ${m.role}`}>
              <div className="bubble">{m.content.split('\n').map((line, j) => <div key={j}>{line || '\u00A0'}</div>)}</div>
            </div>
          );
        })}
        {busy && (
          <div className="msg assistant">
            <div className="bubble" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span className="dot1" style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--ink-3)', animation: 'pulse1 1.2s infinite' }} />
              <span className="dot1" style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--ink-3)', animation: 'pulse1 1.2s infinite 0.2s' }} />
              <span className="dot1" style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--ink-3)', animation: 'pulse1 1.2s infinite 0.4s' }} />
            </div>
          </div>
        )}
        {messages.length <= 1 && (
          <div className="suggested-prompts">
            {suggested.map((s, i) => <button key={i} onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
      </div>
      <div className="chat-input">
        {selection.length > 0 && (
          <span className="ctx-chip">@{selection.length} {t('selected')}</span>
        )}
        <textarea
          placeholder={lang === 'fr' ? 'Décrivez votre demande… (ex: "Ajoute une porte sur le mur Nord")' : 'Describe what you want… (e.g., "Add a door to the north wall")'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows="2"
        />
        <div className="row">
          <span className="hint"><kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', border: '1px solid var(--border)', padding: '0 4px', borderRadius: 3, fontSize: 9 }}>↵</kbd> {lang === 'fr' ? 'envoyer' : 'send'}</span>
          <span className="hint">·</span>
          <span className="hint">{ai.model}</span>
          <button className="btn primary send" disabled={!input.trim() || busy} onClick={() => send(input)}>
            <Icon name="arrow_right" size={12} /> {lang === 'fr' ? 'Envoyer' : 'Send'}
          </button>
        </div>
      </div>
      <style>{`@keyframes pulse1 { 0%, 100% { opacity: 0.3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }`}</style>
    </div>
  );
}

window.AS_ChatPanel = ChatPanel;
