/**
 * Technical (MEP) SVG symbol renderer.
 * All symbols are drawn in a normalised 40×40 viewport.
 * The `color` parameter applies the discipline tint.
 */
import React from 'react';

/** Literal stack: these symbols are also serialized as standalone SVG, where CSS variables do not resolve. */
const SYMBOL_FONT = "'Geist Mono', ui-monospace, monospace";

export function renderTechnicalSymbol(key: string, W: number, H: number, color: string): React.ReactNode {
  const cx = W / 2, cy = H / 2;
  const s = (v: number) => v * (W / 40); // scale helper

  switch (key) {

    // ── Electrical ─────────────────────────────────────────────────────────────

    case 'elec-prise-simple':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(10)} fill="var(--bg)" />
          <line x1={cx - s(5)} y1={cy - s(5)} x2={cx - s(5)} y2={cy + s(5)} />
          <line x1={cx + s(5)} y1={cy - s(5)} x2={cx + s(5)} y2={cy + s(5)} />
          <line x1={cx} y1={cy + s(5)} x2={cx} y2={cy + s(10)} />
        </g>
      );

    case 'elec-prise-double':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          {/* Left socket */}
          <circle cx={cx - s(5)} cy={cy} r={s(7)} fill="var(--bg)" />
          <line x1={cx - s(8)} y1={cy - s(3)} x2={cx - s(8)} y2={cy + s(3)} />
          <line x1={cx - s(2)} y1={cy - s(3)} x2={cx - s(2)} y2={cy + s(3)} />
          {/* Right socket */}
          <circle cx={cx + s(5)} cy={cy} r={s(7)} fill="var(--bg)" />
          <line x1={cx + s(2)} y1={cy - s(3)} x2={cx + s(2)} y2={cy + s(3)} />
          <line x1={cx + s(8)} y1={cy - s(3)} x2={cx + s(8)} y2={cy + s(3)} />
        </g>
      );

    case 'elec-prise-20a':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(10)} fill="var(--bg)" />
          <line x1={cx - s(5)} y1={cy - s(5)} x2={cx - s(5)} y2={cy + s(5)} />
          <line x1={cx + s(5)} y1={cy - s(5)} x2={cx + s(5)} y2={cy + s(5)} />
          <line x1={cx} y1={cy + s(5)} x2={cx} y2={cy + s(10)} />
          <text x={cx} y={cy - s(2)} textAnchor="middle" fontSize={s(7)} fill={color} stroke="none" fontWeight="700" fontFamily={SYMBOL_FONT}>20A</text>
        </g>
      );

    case 'elec-prise-32a':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(10)} fill="var(--bg)" />
          <line x1={cx - s(5)} y1={cy - s(5)} x2={cx - s(5)} y2={cy + s(5)} />
          <line x1={cx + s(5)} y1={cy - s(5)} x2={cx + s(5)} y2={cy + s(5)} />
          <line x1={cx} y1={cy + s(5)} x2={cx} y2={cy + s(10)} />
          <text x={cx} y={cy - s(2)} textAnchor="middle" fontSize={s(7)} fill={color} stroke="none" fontWeight="700" fontFamily={SYMBOL_FONT}>32A</text>
        </g>
      );

    case 'elec-interrupteur':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(8)} fill="var(--bg)" />
          <line x1={cx} y1={cy} x2={cx + s(10)} y2={cy - s(8)} strokeWidth={s(2)} />
          <circle cx={cx + s(10)} cy={cy - s(8)} r={s(1.5)} fill={color} />
        </g>
      );

    case 'elec-va-vient':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(8)} fill="var(--bg)" />
          <line x1={cx} y1={cy} x2={cx + s(10)} y2={cy - s(7)} strokeWidth={s(2)} />
          <line x1={cx} y1={cy} x2={cx + s(10)} y2={cy + s(7)} strokeWidth={s(1.2)} strokeDasharray={`${s(2)} ${s(2)}`} />
          <circle cx={cx + s(10)} cy={cy - s(7)} r={s(1.5)} fill={color} />
          <circle cx={cx + s(10)} cy={cy + s(7)} r={s(1.5)} fill={color} />
        </g>
      );

    case 'elec-variateur':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(8)} fill="var(--bg)" />
          <line x1={cx} y1={cy} x2={cx + s(10)} y2={cy - s(8)} strokeWidth={s(2)} />
          <circle cx={cx + s(10)} cy={cy - s(8)} r={s(1.5)} fill={color} />
          {/* dimmer symbol: zig-zag */}
          <path d={`M${cx - s(4)} ${cy + s(4)} l${s(2)} -${s(3)} l${s(2)} ${s(3)} l${s(2)} -${s(3)}`} strokeWidth={s(1)} />
        </g>
      );

    case 'elec-detecteur':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <circle cx={cx} cy={cy} r={s(10)} fill="var(--bg)" />
          <circle cx={cx} cy={cy} r={s(4)} fill={color} fillOpacity={0.5} />
          <circle cx={cx} cy={cy} r={s(7)} strokeDasharray={`${s(2)} ${s(2)}`} />
          <text x={cx} y={cy + s(15)} textAnchor="middle" fontSize={s(6)} fill={color} stroke="none" fontWeight="700" fontFamily={SYMBOL_FONT}>DET</text>
        </g>
      );

    case 'elec-tableau':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <rect x={cx - s(12)} y={cy - s(10)} width={s(24)} height={s(20)} rx={s(2)} fill="var(--bg)" />
          <line x1={cx - s(8)} y1={cy - s(5)} x2={cx - s(8)} y2={cy + s(5)} />
          <line x1={cx - s(3)} y1={cy - s(5)} x2={cx - s(3)} y2={cy + s(5)} />
          <line x1={cx + s(2)} y1={cy - s(5)} x2={cx + s(2)} y2={cy + s(5)} />
          <line x1={cx + s(7)} y1={cy - s(5)} x2={cx + s(7)} y2={cy + s(5)} />
          <line x1={cx - s(11)} y1={cy} x2={cx + s(11)} y2={cy} />
        </g>
      );

    case 'elec-point-lumineux':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <circle cx={cx} cy={cy} r={s(8)} fill="var(--bg)" />
          <circle cx={cx} cy={cy} r={s(3)} fill={color} />
          {[0,45,90,135,180,225,270,315].map(a => {
            const r = a * Math.PI / 180;
            return <line key={a}
              x1={cx + Math.cos(r) * s(5)} y1={cy + Math.sin(r) * s(5)}
              x2={cx + Math.cos(r) * s(10)} y2={cy + Math.sin(r) * s(10)}
              strokeWidth={s(1.2)} />;
          })}
        </g>
      );

    case 'elec-applique':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(8)} y={cy - s(3)} width={s(16)} height={s(8)} rx={s(2)} fill="var(--bg)" />
          {[0,45,-45].map(a => {
            const r = a * Math.PI / 180;
            return <line key={a}
              x1={cx} y1={cy - s(3)}
              x2={cx + Math.cos(r - Math.PI/2) * s(8)} y2={cy - s(3) - Math.sin(r - Math.PI/2) * s(8)}
              strokeWidth={s(1)} />;
          })}
        </g>
      );

    case 'elec-sonnette':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <rect x={cx - s(8)} y={cy - s(8)} width={s(16)} height={s(16)} rx={s(3)} fill="var(--bg)" />
          <circle cx={cx} cy={cy} r={s(4)} fill={color} fillOpacity={0.4} />
          <text x={cx} y={cy + s(16)} textAnchor="middle" fontSize={s(5.5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>SONN</text>
        </g>
      );

    // ── Plumbing ───────────────────────────────────────────────────────────────

    case 'plomb-ef':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(10)} fill="var(--bg)" />
          <circle cx={cx} cy={cy} r={s(5)} fill={color} fillOpacity={0.25} />
          <text x={cx} y={cy + s(4)} textAnchor="middle" fontSize={s(8)} fill={color} stroke="none" fontWeight="800" fontFamily={SYMBOL_FONT}>EF</text>
        </g>
      );

    case 'plomb-ec':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(10)} fill="var(--bg)" />
          <circle cx={cx} cy={cy} r={s(5)} fill={color} fillOpacity={0.25} />
          <text x={cx} y={cy + s(4)} textAnchor="middle" fontSize={s(8)} fill={color} stroke="none" fontWeight="800" fontFamily={SYMBOL_FONT}>EC</text>
        </g>
      );

    case 'plomb-mitigeur':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(10)} fill="var(--bg)" />
          {/* tap head */}
          <path d={`M${cx - s(5)} ${cy} A ${s(5)} ${s(5)} 0 0 1 ${cx + s(5)} ${cy}`} />
          <line x1={cx} y1={cy} x2={cx} y2={cy + s(8)} />
          <text x={cx} y={cy - s(3)} textAnchor="middle" fontSize={s(6)} fill={color} stroke="none" fontWeight="700" fontFamily={SYMBOL_FONT}>MIX</text>
        </g>
      );

    case 'plomb-ecs':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(10)} y={cy - s(10)} width={s(20)} height={s(20)} rx={s(3)} fill="var(--bg)" />
          <text x={cx} y={cy + s(4)} textAnchor="middle" fontSize={s(7.5)} fill={color} stroke="none" fontWeight="800" fontFamily={SYMBOL_FONT}>ECS</text>
        </g>
      );

    case 'plomb-evacuation':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(10)} fill="var(--bg)" strokeDasharray={`${s(4)} ${s(2)}`} />
          <text x={cx} y={cy + s(4)} textAnchor="middle" fontSize={s(7)} fill={color} stroke="none" fontWeight="800" fontFamily={SYMBOL_FONT}>EU</text>
          <text x={cx} y={cy + s(15)} textAnchor="middle" fontSize={s(5.5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>Ø40</text>
        </g>
      );

    case 'plomb-evacuation-ep':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(11)} fill="var(--bg)" strokeDasharray={`${s(4)} ${s(2)}`} />
          <text x={cx} y={cy + s(4)} textAnchor="middle" fontSize={s(7)} fill={color} stroke="none" fontWeight="800" fontFamily={SYMBOL_FONT}>EP</text>
          <text x={cx} y={cy + s(15)} textAnchor="middle" fontSize={s(5.5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>Ø100</text>
        </g>
      );

    case 'plomb-siphon-sol':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(9)} y={cy - s(9)} width={s(18)} height={s(18)} rx={s(2)} fill="var(--bg)" />
          <line x1={cx - s(7)} y1={cy} x2={cx + s(7)} y2={cy} />
          <line x1={cx} y1={cy - s(7)} x2={cx} y2={cy + s(7)} />
          <circle cx={cx} cy={cy} r={s(3)} fill={color} fillOpacity={0.3} />
        </g>
      );

    case 'plomb-attente-lv':
    case 'plomb-attente-ml':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <circle cx={cx} cy={cy} r={s(9)} fill="var(--bg)" />
          <line x1={cx - s(6)} y1={cy - s(3)} x2={cx - s(6)} y2={cy + s(3)} strokeWidth={s(2)} />
          <line x1={cx + s(6)} y1={cy - s(3)} x2={cx + s(6)} y2={cy + s(3)} strokeWidth={s(1)} strokeDasharray={`${s(2)} ${s(1.5)}`} />
          <text x={cx} y={cy + s(14)} textAnchor="middle" fontSize={s(5.5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>
            {key.includes('lv') ? 'LV' : 'ML'}
          </text>
        </g>
      );

    case 'plomb-vanne':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <polygon points={`${cx},${cy - s(8)} ${cx + s(8)},${cy + s(8)} ${cx - s(8)},${cy + s(8)}`} fill="var(--bg)" />
          <polygon points={`${cx},${cy + s(8)} ${cx + s(8)},${cy - s(8)} ${cx - s(8)},${cy - s(8)}`} fill="var(--bg)" strokeWidth={s(1)} />
          <line x1={cx - s(10)} y1={cy} x2={cx + s(10)} y2={cy} />
        </g>
      );

    // ── HVAC ───────────────────────────────────────────────────────────────────

    case 'hvac-radiateur':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(12)} y={cy - s(7)} width={s(24)} height={s(14)} rx={s(1)} fill="var(--bg)" />
          {[-7,-3,1,5,9].map(ox => (
            <line key={ox} x1={cx + s(ox)} y1={cy - s(6)} x2={cx + s(ox)} y2={cy + s(6)} />
          ))}
          <line x1={cx - s(12)} y1={cy} x2={cx + s(12)} y2={cy} strokeWidth={s(0.8)} />
        </g>
      );

    case 'hvac-chaudiere':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <rect x={cx - s(9)} y={cy - s(11)} width={s(18)} height={s(22)} rx={s(2)} fill="var(--bg)" />
          <rect x={cx - s(4)} y={cy + s(2)} width={s(8)} height={s(4)} rx={s(1)} />
          <path d={`M${cx-s(4)},${cy+s(11)}v${s(3)} m${s(8)},${-s(3)}v${s(3)}`} />
        </g>
      );

    case 'hvac-plancher':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(11)} y={cy - s(9)} width={s(22)} height={s(18)} rx={s(2)} fill="var(--bg)" />
          {/* Serpentine lines */}
          <path d={`M${cx-s(8)},${cy-s(6)} Q${cx-s(2)},${cy-s(6)} ${cx},${cy-s(2)} Q${cx+s(2)},${cy+s(2)} ${cx+s(8)},${cy+s(2)}`} />
          <path d={`M${cx-s(8)},${cy+s(2)} Q${cx-s(4)},${cy+s(6)} ${cx},${cy+s(6)}`} />
        </g>
      );

    case 'hvac-bouche-soufflage':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(11)} y={cy - s(8)} width={s(22)} height={s(16)} rx={s(2)} fill="var(--bg)" />
          {/* Arrow in */}
          <path d={`M${cx} ${cy - s(4)} L${cx - s(4)} ${cy} L${cx + s(4)} ${cy} Z`} fill={color} fillOpacity={0.4} />
          <text x={cx} y={cy + s(13)} textAnchor="middle" fontSize={s(5.5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>SOUF</text>
        </g>
      );

    case 'hvac-bouche-extraction':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(11)} y={cy - s(8)} width={s(22)} height={s(16)} rx={s(2)} fill="var(--bg)" />
          {/* Arrow out */}
          <path d={`M${cx - s(4)} ${cy - s(3)} L${cx + s(4)} ${cy - s(3)} L${cx} ${cy + s(3)} Z`} fill={color} fillOpacity={0.4} />
          <text x={cx} y={cy + s(13)} textAnchor="middle" fontSize={s(5.5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>EXTR</text>
        </g>
      );

    case 'hvac-clim-int':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(13)} y={cy - s(5)} width={s(26)} height={s(11)} rx={s(2)} fill="var(--bg)" />
          <line x1={cx - s(10)} y1={cy} x2={cx + s(10)} y2={cy} />
          {[-6,-2,2,6].map(ox => (
            <path key={ox} d={`M${cx+s(ox)} ${cy-s(3)} Q${cx+s(ox+1)} ${cy} ${cx+s(ox)} ${cy+s(3)}`} strokeWidth={s(1)} />
          ))}
        </g>
      );

    case 'hvac-thermostat':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(9)} y={cy - s(9)} width={s(18)} height={s(18)} rx={s(3)} fill="var(--bg)" />
          <text x={cx} y={cy + s(4)} textAnchor="middle" fontSize={s(9)} fill={color} stroke="none" fontWeight="700" fontFamily={SYMBOL_FONT}>°</text>
          <text x={cx} y={cy + s(13)} textAnchor="middle" fontSize={s(5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>THERM</text>
        </g>
      );

    // ── Data ───────────────────────────────────────────────────────────────────

    case 'data-rj45':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(9)} y={cy - s(9)} width={s(18)} height={s(18)} rx={s(2)} fill="var(--bg)" />
          <rect x={cx - s(6)} y={cy - s(4)} width={s(12)} height={s(8)} rx={s(1)} strokeWidth={s(1)} />
          {[-4,-1.5,1,3.5].map(ox => (
            <line key={ox} x1={cx + s(ox)} y1={cy - s(4)} x2={cx + s(ox)} y2={cy - s(7)} strokeWidth={s(0.8)} />
          ))}
          <text x={cx} y={cy + s(15)} textAnchor="middle" fontSize={s(5.5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>RJ45</text>
        </g>
      );

    case 'data-tv':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(10)} y={cy - s(8)} width={s(20)} height={s(16)} rx={s(2)} fill="var(--bg)" />
          <circle cx={cx + s(7)} cy={cy - s(3)} r={s(2)} strokeWidth={s(1.2)} />
          <line x1={cx + s(7)} y1={cy - s(1)} x2={cx + s(7)} y2={cy + s(5)} />
          <text x={cx - s(2)} y={cy + s(4)} textAnchor="middle" fontSize={s(8)} fill={color} stroke="none" fontWeight="700" fontFamily={SYMBOL_FONT}>TV</text>
        </g>
      );

    case 'data-telephone':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(9)} y={cy - s(9)} width={s(18)} height={s(18)} rx={s(2)} fill="var(--bg)" />
          <path d={`M${cx-s(5)},${cy+s(5)} C${cx-s(5)},${cy-s(5)} ${cx+s(5)},${cy-s(5)} ${cx+s(5)},${cy+s(5)}`} />
          <path d={`M${cx-s(5)},${cy+s(5)} L${cx-s(7)},${cy+s(7)}`} />
          <path d={`M${cx+s(5)},${cy+s(5)} L${cx+s(7)},${cy+s(7)}`} />
        </g>
      );

    case 'data-hdmi':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(9)} y={cy - s(6)} width={s(18)} height={s(12)} rx={s(2)} fill="var(--bg)" />
          <text x={cx} y={cy + s(4)} textAnchor="middle" fontSize={s(7)} fill={color} stroke="none" fontWeight="700" fontFamily={SYMBOL_FONT}>HD</text>
          <text x={cx} y={cy + s(13)} textAnchor="middle" fontSize={s(5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>HDMI</text>
        </g>
      );

    case 'data-wifi':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <circle cx={cx} cy={cy} r={s(3)} fill={color} />
          <path d={`M${cx-s(6)},${cy+s(2)} A${s(6)},${s(6)} 0 0,1 ${cx+s(6)},${cy+s(2)}`} />
          <path d={`M${cx-s(10)},${cy+s(5)} A${s(10)},${s(10)} 0 0,1 ${cx+s(10)},${cy+s(5)}`} />
          <text x={cx} y={cy + s(15)} textAnchor="middle" fontSize={s(5.5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>WiFi</text>
        </g>
      );

    case 'data-baie':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.4)}>
          <rect x={cx - s(10)} y={cy - s(12)} width={s(20)} height={s(24)} rx={s(2)} fill="var(--bg)" />
          {[-7,-2,3,8].map(oy => (
            <rect key={oy} x={cx - s(8)} y={cy + s(oy)} width={s(16)} height={s(3)} rx={s(0.5)} strokeWidth={s(0.8)} />
          ))}
          <text x={cx} y={cy + s(18)} textAnchor="middle" fontSize={s(5.5)} fill={color} stroke="none" fontFamily={SYMBOL_FONT}>BAIE</text>
        </g>
      );

    case 'fire-extincteur':
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)} strokeLinecap="round">
          <rect x={cx - s(5)} y={cy - s(4)} width={s(10)} height={s(16)} rx={s(4)} fill="var(--bg)" />
          <path d={`M${cx},${cy-s(4)}v${-s(6)} m${-s(3)},0h${s(7)} M${cx},${cy-s(7)}q${s(9)},0 ${s(9)},${s(9)}`} />
        </g>
      );

    // ── Default fallback ───────────────────────────────────────────────────────
    default:
      return (
        <g stroke={color} fill="none" strokeWidth={s(1.6)}>
          <circle cx={cx} cy={cy} r={s(10)} fill="var(--bg)" />
          <text x={cx} y={cy + s(4)} textAnchor="middle" fontSize={s(8)} fill={color} stroke="none" fontWeight="700">?</text>
        </g>
      );
  }
}
