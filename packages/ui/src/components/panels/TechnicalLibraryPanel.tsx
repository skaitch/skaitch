import { makeT } from '@skaitch/core/data/i18n';
import React, { useState } from 'react';
import { TECHNICAL_DISCIPLINES, type TechnicalDiscipline, type ToolType } from '@skaitch/core/types/ifc';
import { FireExtinguisher } from 'lucide-react';
import { TECHNICAL_CATALOGUE, groupTechnicalByCategory, disciplineColor } from '../../data/technicalCatalogue';
import { renderTechnicalSymbol } from '../../data/technicalSymbols';

interface Props {
  tool: ToolType;
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  setTool: (t: any) => void;
  lang: string;
}

const DISCIPLINE_LABELS: Record<TechnicalDiscipline, { full: string; short: string }> = {
  electrical: { full: 'Electrical', short: 'Elec' },
  plumbing:   { full: 'Plumbing', short: 'Plumb' },
  hvac:       { full: 'HVAC', short: 'HVAC' },
  data:       { full: 'Data / Telecom', short: 'Data' },
  fire:       { full: 'Fire safety', short: 'Fire' },
};

export default function TechnicalLibraryPanel({ tool, selectedElementId, onSelectElement, setTool, lang }: Props) {
  const fr = lang === 'fr';
  const grouped = groupTechnicalByCategory(TECHNICAL_CATALOGUE);
  const categories = Object.keys(grouped);

  const activeItem = TECHNICAL_CATALOGUE.find(el => el.id === selectedElementId);
  const [activeDisc, setActiveDisc] = useState<TechnicalDiscipline>(activeItem?.discipline ?? 'electrical');

  // Filter to active discipline
  const visibleItems = TECHNICAL_CATALOGUE.filter(el => el.discipline === activeDisc);
  const visibleGrouped = groupTechnicalByCategory(visibleItems);

  return (
    <div style={{
      position: 'fixed',
      left: 'calc(var(--toolbox-w, 44px) + 8px)',
      top: 'calc(var(--topbar-h, 36px) + 8px)',
      width: 356,
      maxHeight: 'calc(100vh - var(--topbar-h, 36px) - 24px)',
      display: 'flex',
      flexDirection: 'column',
      background: 'color-mix(in oklch, var(--panel) 94%, transparent)',
      backdropFilter: 'blur(16px)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
      zIndex: 200,
      overflow: 'hidden',
      animation: 'el-panel-in 0.16s ease'
    }}>
      <style>{`
        @keyframes el-panel-in {
          from { opacity:0; transform:translateX(-8px) scale(0.97); }
          to { opacity:1; transform:none; }
        }
        .tech-tile {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 6px 4px 6px;
          border: 1.5px solid var(--border);
          border-radius: 8px;
          background: var(--panel);
          cursor: pointer;
          transition: all 0.15s ease;
          outline: none;
          position: relative;
        }
        .tech-tile:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06);
          background: color-mix(in oklch, var(--ink) 2%, var(--panel));
        }
        .tech-tab {
          flex: 1;
          height: 26px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-sans);
          font-size: 10px;
          font-weight: 500;
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        padding: '10px 12px',
        gap: 8,
        flexShrink: 0,
        background: 'var(--panel)',
        height: 42,
        boxSizing: 'border-box'
      }}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--accent)', flexShrink: 0 }}>
          <path d="M10 2v4M10 14v4M2 10h4m8 0h4" stroke="currentColor" strokeWidth="2.0" strokeLinecap="round"/>
          <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="2.0"/>
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
          {makeT(lang)("Technical Library")}
        </span>

        <div style={{ flex: 1 }} />

        {/* Close Button */}
        <button
          onClick={() => setTool('select')}
          title={makeT(lang)("Close")}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', display: 'flex', alignItems: 'center', padding: 2 }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Navigation tabs for disciplines */}
      <div style={{
        padding: '8px 10px',
        background: 'color-mix(in oklch, var(--accent) 3%, var(--panel))',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', borderRadius: 8, padding: 3, border: '1px solid var(--border)' }}>
          {TECHNICAL_DISCIPLINES.map(disc => {
            const color = disciplineColor(disc);
            const label = makeT(lang)(DISCIPLINE_LABELS[disc].full);
            const isActive = activeDisc === disc;
            return (
              <button
                key={disc}
                onClick={() => setActiveDisc(disc)}
                title={label}
                aria-label={label}
                aria-pressed={isActive}
                className="tech-tab"
                style={{
                  background: isActive ? color : 'transparent',
                  color: isActive ? '#ffffff' : 'var(--ink-3)',
                  boxShadow: isActive ? '0 2px 6px rgba(0,0,0,0.12)' : 'none',
                  fontWeight: isActive ? 600 : 500,
                  border: 'none',
                  outline: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <DisciplineIcon disc={disc} size={11} color={isActive ? '#ffffff' : color} />
                  <span style={{ fontSize: '9px' }}>
                    {makeT(lang)(DISCIPLINE_LABELS[disc].short)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main scrolling items list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        scrollbarWidth: 'thin'
      }}>
        {Object.entries(visibleGrouped).map(([category, items]) => (
          <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              fontSize: 9.5,
              fontWeight: 700,
              color: 'var(--ink-4)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              paddingLeft: 2,
            }}>
              {category}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
            }}>
              {items.map(el => {
                const label = fr ? el.labelFr : el.labelEn;
                const isSelected = selectedElementId === el.id;
                const color = disciplineColor(el.discipline);

                return (
                  <button
                    key={el.id}
                    onClick={() => onSelectElement(el.id)}
                    title={label}
                    className="tech-tile"
                    style={{
                      border: isSelected ? `2px solid ${color}` : '1px solid var(--border)',
                      boxShadow: isSelected ? `0 0 0 2px color-mix(in oklch, ${color} 20%, transparent)` : 'none',
                    }}
                  >
                    {/* SVG Graphic Symbol */}
                    <div style={{
                      width: '100%',
                      aspectRatio: '1',
                      background: 'var(--bg)',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      <svg width="42" height="42" viewBox="0 0 40 40" style={{ display: 'block', transform: 'scale(0.85)' }}>
                        {renderTechnicalSymbol(el.symbolKey, 40, 40, color)}
                      </svg>
                    </div>

                    {/* Technical label */}
                    <span style={{
                      fontSize: '8px',
                      fontWeight: isSelected ? 600 : 500,
                      color: isSelected ? color : 'var(--ink)',
                      textAlign: 'center',
                      width: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: 2
                    }}>
                      {label}
                    </span>

                    {/* Specific details */}
                    {el.defaults.fluidType && (
                      <span style={{
                        fontSize: '6.5px',
                        color: color,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                      }}>
                        {el.defaults.fluidType} {el.defaults.diameter ? `Ø${el.defaults.diameter}` : ''}
                      </span>
                    )}
                    {el.defaults.amperage && (
                      <span style={{
                        fontSize: '6.5px',
                        color: color,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                      }}>
                        {el.defaults.amperage}A
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Premium metadata footer */}
      {activeItem && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '10px 12px',
          background: 'var(--panel)',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink)' }}>
              {fr ? activeItem.labelFr : activeItem.labelEn}
            </span>
            <span style={{
              fontSize: '8px',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: '#ffffff',
              background: disciplineColor(activeItem.discipline),
              padding: '1px 4px',
              borderRadius: 3,
              fontFamily: 'var(--font-sans)',
            }}>
              {makeT(lang)(DISCIPLINE_LABELS[activeItem.discipline].full)}
            </span>
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
            h_pose= {activeItem.defaults.mountHeight.toFixed(2)}m
            {activeItem.defaults.diameter ? ` · Ø${activeItem.defaults.diameter}mm` : ''}
            {activeItem.defaults.amperage ? ` · ${activeItem.defaults.amperage}A` : ''}
          </div>
          <div style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 500, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            {makeT(lang)("Click on floorplan to place asset")}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Discipline icon helper ──────────────────────────────────────────────────
function DisciplineIcon({ disc, size, color }: { disc: TechnicalDiscipline; size: number; color: string }) {
  const s = size;
  if (disc === 'electrical') return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
      <path d="M11 2L5 11h6l-2 7 8-10h-6l2-8z" fill={color} />
    </svg>
  );
  if (disc === 'plumbing') return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
      <path d="M10 2C7 6 5 9 5 12a5 5 0 0010 0c0-3-2-6-5-10z" fill={color} />
    </svg>
  );
  if (disc === 'hvac') return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
      <path d="M10 4v12M4 10h12M6.5 6.5l7 7M13.5 6.5l-7 7" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
    </svg>
  );
  if (disc === 'data') return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
      <rect x="3" y="6" width="14" height="8" rx="2" stroke={color} strokeWidth="2.0"/>
      <circle cx="7" cy="10" r="1.2" fill={color}/>
      <circle cx="10" cy="10" r="1.2" fill={color}/>
      <circle cx="13" cy="10" r="1.2" fill={color}/>
    </svg>
  );
  return <FireExtinguisher size={size} color={color} />;
}
