import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useState } from 'react';
import type { AiConfig, LangType } from '@skaitch/core/types/ifc';
import { makeT } from '@skaitch/core/data/i18n';
import LanguageSelect from './LanguageSelect';
import { APP_THEMES, setAppTheme, useAppTheme, type AppThemeId } from '../lib/appTheme';

export type SettingsSection = 'general' | 'units' | 'ifc' | 'ai' | 'shortcuts' | 'mcp_api_keys';

export interface SettingsModalProps {
  open: boolean;
  applicationOnly?: boolean;
  onClose: () => void;
  ai: AiConfig;
  setAi: Dispatch<SetStateAction<AiConfig>>;
  t: (k: string) => string;
  lang: LangType;
  onLangChange: (lang: LangType) => void;
  /** Host-specific sections: each host has its own AI settings and MCP connection. */
  aiSection: ReactNode;
  mcpSection: ReactNode;
}

const SHORTCUTS = (lang: string) => [
  ['V', makeT(lang)("Select")],
  ['W', makeT(lang)("Wall")],
  ['D', makeT(lang)("Door")],
  ['F', makeT(lang)("Window")],
  ['R', makeT(lang)("Room")],
  ['M', makeT(lang)("Furniture")],
  ['Suppr', makeT(lang)("Delete selection")],
  ['Alt + drag', 'Pan'],
  ['Wheel', 'Zoom'],
  ['Shift + click', makeT(lang)("Multi-select")],
  ['Cmd / Ctrl + A', makeT(lang)("Select all")],
  ['Cmd / Ctrl + Z', 'Undo'],
  ['G', makeT(lang)("Toggle grid")],
];

/** The settings window shared by the web and desktop apps (same sections, same layout). */
export default function SettingsModal({ open, onClose, t, lang, onLangChange, applicationOnly = false, aiSection, mcpSection }: SettingsModalProps) {
  const [section, setSection] = useState<SettingsSection>(applicationOnly ? 'general' : 'ai');
  if (!open) return null;

  return (
      <div className="scrim" onMouseDown={(e) => {
        if ((e.target as HTMLElement).classList.contains('scrim')) onClose();
      }}>
        <div role="dialog" aria-modal="true" aria-label={t('settings')} className={`modal settings-modal${section === 'mcp_api_keys' ? ' mcp-settings-modal' : ''}`}>
          <div className="modal-head">
            <div>
              <h3>{t('settings')}</h3>
              <div
                  className="sub">{applicationOnly ? makeT(lang)('General') : makeT(lang)("Global project configuration")}</div>
            </div>
            <button className="btn ghost icon close" aria-label={makeT(lang)('Close')} onClick={onClose} style={{marginLeft: 'auto'}}>
              <svg width="14" height="14" viewBox="0 0 20 20">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          <div className="settings-layout">
            <div className="settings-nav">
              {([
                ['general', makeT(lang)("General"), 'settings'],
                ['units', makeT(lang)("Units"), 'measure'],
                ['ifc', 'IFC', 'folder'],
                ['ai', makeT(lang)("AI"), 'sparkle'],
                ['mcp_api_keys', makeT(lang)("MCP server"), 'key'],
                ['shortcuts', makeT(lang)("Shortcuts"), 'code'],
              ] as const).filter(([key]) => !applicationOnly || (key !== 'units' && key !== 'ifc')).map(([key, label, icon]) => (
                  <button key={key} className={section === key ? 'on' : ''} onClick={() => setSection(key as any)}>
                    {icon === 'sparkle' ? (
                        <span className="sparkle">
                    <svg width="13" height="13" viewBox="0 0 20 20"><path
                        d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5zM15.5 13l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"
                        fill="currentColor"/></svg>
                  </span>
                    ) : (
                    <svg width="13" height="13" viewBox={(icon === 'settings' || icon === 'key') ? "0 0 24 24" : "0 0 20 20"}>
                      {icon === 'settings' && (
                        <>
                          <path d="M12.22 2h-0.44a2 2 0 0 0-2 2v0.18a2 2 0 0 1-1 1.73l-0.43.25a2 2 0 0 1-2 0l-0.15-0.08a2 2 0 0 0-2.73.73l-0.22.38a2 2 0 0 0 .73 2.73l0.15.1a2 2 0 0 1 1 1.72v0.51a2 2 0 0 1-1 1.74l-0.15.09a2 2 0 0 0-.73 2.73l0.22.38a2 2 0 0 0 2.73.73l0.15-0.08a2 2 0 0 1 2 0l0.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h0.44a2 2 0 0 0 2-2v-0.18a2 2 0 0 1 1-1.73l0.43-.25a2 2 0 0 1 2 0l0.15.08a2 2 0 0 0 2.73-.73l0.22-.39a2 2 0 0 0-.73-2.73l-0.15-.08a2 2 0 0 1-1-1.74v-0.5a2 2 0 0 1 1-1.74l0.15-.09a2 2 0 0 0 .73-2.73l-0.22-.38a2 2 0 0 0-2.73-.73l-0.15.08a2 2 0 0 1-2 0l-0.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
                        </>
                      )}
                      {icon === 'key' && (
                        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      )}
                      {icon === 'measure' && (
                        <path d="M2 12l10-10 6 6L8 18z" fill="none" stroke="currentColor" strokeWidth="1.4" />
                      )}
                      {icon === 'folder' && (
                        <path d="M3 6a1 1 0 011-1h4l1.5 1.5H16a1 1 0 011 1V15a1 1 0 01-1 1H4a1 1 0 01-1-1z" fill="none" stroke="currentColor" strokeWidth="1.4" />
                      )}
                      {icon === 'code' && (
                        <path d="M7 5l-5 5 5 5M13 5l5 5-5 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      )}
                    </svg>
                    )}
                    {label}
                  </button>
              ))}
            </div>

            <div className="settings-body">
              {section === 'ai' && aiSection}

              {section === 'general' && (
                  <>
                    <h2>{makeT(lang)("General")}</h2>
                    {!applicationOnly && <div className="lede">{makeT(lang)("Global project preferences.")}</div>}
                    <div className="kv-form">
                      <label>{makeT(lang)('Language')}</label>
                      <LanguageSelect lang={lang} onChange={onLangChange} />
                      <label>{lang === 'fr' ? 'Thème' : 'Theme'}</label>
                      <ThemePicker lang={lang} />
                      {!applicationOnly && <>
                      <label>{makeT(lang)("Project name")}</label>
                      <input defaultValue="Résidence Les Tilleuls"/>
                      <label>{makeT(lang)("Author")}</label>
                      <input defaultValue="Atelier Saint-Marc"/>
                      <label>{makeT(lang)("BIM phase")}</label>
                      <select defaultValue="EXE">
                        <option>APS</option>
                        <option>APD</option>
                        <option>PRO</option>
                        <option>EXE</option>
                      </select>
                      <label>{makeT(lang)("Coordinate system")}</label>
                      <select defaultValue="lambert93">
                        <option value="lambert93">Lambert-93</option>
                        <option value="wgs84">WGS84</option>
                        <option value="local">Local</option>
                      </select>
                      </>}
                    </div>
                  </>
              )}

              {section === 'units' && (
                  <>
                    <h2>{makeT(lang)("Units")}</h2>
                    <div
                        className="lede">{makeT(lang)("Project stored in SI; display is configurable.")}</div>
                    <div className="kv-form">
                      <label>{makeT(lang)("Length")}</label>
                      <select defaultValue="m">
                        <option>m</option>
                        <option>cm</option>
                        <option>mm</option>
                      </select>
                      <label>{makeT(lang)("Area")}</label>
                      <select defaultValue="m²">
                        <option>m²</option>
                        <option>cm²</option>
                      </select>
                      <label>{makeT(lang)("Volume")}</label>
                      <select defaultValue="m³">
                        <option>m³</option>
                        <option>L</option>
                      </select>
                      <label>{makeT(lang)("Angle")}</label>
                      <select defaultValue="deg">
                        <option>deg</option>
                        <option>rad</option>
                        <option>grad</option>
                      </select>
                    </div>
                  </>
              )}

              {section === 'ifc' && (
                  <>
                    <h2>IFC</h2>
                    <div
                        className="lede">{makeT(lang)("Schema and export options.")}</div>
                    <div className="kv-form">
                      <label>{makeT(lang)("Version")}</label>
                      <select defaultValue="IFC4">
                        <option>IFC2x3</option>
                        <option>IFC4</option>
                        <option>IFC4.3</option>
                      </select>
                      <label>MVD</label>
                      <select defaultValue="ReferenceView">
                        <option>CoordinationView</option>
                        <option>ReferenceView</option>
                        <option>DesignTransferView</option>
                      </select>
                      <label>{makeT(lang)("Include PSets")}</label>
                      <select defaultValue="all">
                        <option value="all">{makeT(lang)("All")}</option>
                        <option value="common">Pset_*Common</option>
                      </select>
                      <label>{makeT(lang)("Geometry")}</label>
                      <select defaultValue="brep">
                        <option value="brep">Brep</option>
                        <option value="extruded">Extruded</option>
                        <option value="bbox">Bounding boxes</option>
                      </select>
                    </div>
                  </>
              )}

              {section === 'shortcuts' && (
                  <>
                    <h2>{makeT(lang)("Shortcuts")}</h2>
                    <div className="lede">{makeT(lang)("Keyboard shortcuts.")}</div>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 12}}>
                      {SHORTCUTS(lang).map(([k, label]) => (
                          <div key={k} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '6px 0',
                            borderBottom: '1px solid var(--border-faint)'
                          }}>
                            <span style={{color: 'var(--ink-2)'}}>{label}</span>
                            <kbd style={{
                              fontFamily: 'var(--font-mono)',
                              background: 'var(--panel-2)',
                              border: '1px solid var(--border)',
                              padding: '1px 6px',
                              borderRadius: 3,
                              fontSize: 11
                            }}>{k}</kbd>
                          </div>
                      ))}
                    </div>
                  </>
              )}

              {section === 'mcp_api_keys' && mcpSection}
            </div>
          </div>
        </div>
      </div>
  )
}

/** Colour theme, the same three as skAItch Survey (green by default). */
function ThemePicker({ lang }: { lang: LangType }) {
  const theme = useAppTheme();
  return (
    <div className="theme-choices" role="radiogroup">
      {(Object.keys(APP_THEMES) as AppThemeId[]).map(id => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} className={`theme-choice${theme === id ? ' active' : ''}`} onClick={() => setAppTheme(id)}>
          <span className="theme-swatch" style={{ background: APP_THEMES[id].swatch, color: id === 'or' ? '#1a1a1a' : '#fff' }}>
            {theme === id && <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </span>
          {lang === 'fr' ? APP_THEMES[id].fr : APP_THEMES[id].en}
        </button>
      ))}
    </div>
  );
}
