import React from 'react';

const WALL_T = 7;
const DC = 'var(--c-door, #e05a2b)';
const WC = 'var(--c-window, #3b82f6)';

function arc(cx: number, cy: number, r: number, a1: number, a2: number, sw = 1) {
  const d = (a: number) => (a * Math.PI) / 180;
  const x1 = cx + r * Math.cos(d(a1)), y1 = cy + r * Math.sin(d(a1));
  const x2 = cx + r * Math.cos(d(a2)), y2 = cy + r * Math.sin(d(a2));
  return `M${x1},${y1} A${r},${r} 0 0,${sw} ${x2},${y2}`;
}

function Wall({ W, gW, gX }: { W: number; gW: number; gX: number }) {
  return <>
    <rect x={0} y={0} width={gX} height={WALL_T} fill="var(--ink)" />
    <rect x={gX + gW} y={0} width={W - gX - gW} height={WALL_T} fill="var(--ink)" />
  </>;
}

export function renderElementSvg(iconKey: string | undefined, W: number, H: number): React.ReactNode {
  const gX = 4, gW = W - 8, hy = WALL_T;
  const leaf = Math.min(H * 0.7, gW);

  switch (iconKey) {
    case 'door-opening':
      // Wall gap with its two jambs, no leaf.
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <line x1={gX} y1={hy - 4} x2={gX} y2={hy + 4} stroke={DC} strokeWidth={2} />
        <line x1={gX + gW} y1={hy - 4} x2={gX + gW} y2={hy + 4} stroke={DC} strokeWidth={2} />
      </>;
    case 'door-single-left':
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <line x1={gX} y1={hy} x2={gX + leaf} y2={hy} stroke={DC} strokeWidth={2} />
        <path d={arc(gX, hy, leaf, 0, -90, 0)} fill="none" stroke={DC} strokeWidth={1} strokeDasharray="3 2" />
        <circle cx={gX} cy={hy} r={2.5} fill={DC} />
      </>;
    case 'door-single-right':
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <line x1={gX + gW} y1={hy} x2={gX + gW - leaf} y2={hy} stroke={DC} strokeWidth={2} />
        <path d={arc(gX + gW, hy, leaf, 180, -90, 1)} fill="none" stroke={DC} strokeWidth={1} strokeDasharray="3 2" />
        <circle cx={gX + gW} cy={hy} r={2.5} fill={DC} />
      </>;
    case 'door-double': {
      const h = gW / 2;
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <line x1={gX} y1={hy} x2={gX + h} y2={hy} stroke={DC} strokeWidth={2} />
        <path d={arc(gX, hy, h, 0, -90, 0)} fill="none" stroke={DC} strokeWidth={1} strokeDasharray="3 2" />
        <circle cx={gX} cy={hy} r={2.5} fill={DC} />
        <line x1={gX + gW} y1={hy} x2={gX + gW - h} y2={hy} stroke={DC} strokeWidth={2} />
        <path d={arc(gX + gW, hy, h, 180, -90, 1)} fill="none" stroke={DC} strokeWidth={1} strokeDasharray="3 2" />
        <circle cx={gX + gW} cy={hy} r={2.5} fill={DC} />
      </>;
    }
    case 'door-garage-rolling':
    case 'door-garage-sectional':
    case 'door-garage-tilt-up':
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <rect x={gX} y={1} width={gW} height={WALL_T - 2} fill={DC} fillOpacity={0.2} stroke={DC} />
        {[2, 4, 6].map(y => <line key={y} x1={gX} y1={y} x2={gX+gW} y2={y} stroke={DC} strokeWidth={0.6} />)}
      </>;
    case 'door-sliding':
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <rect x={gX} y={1} width={gW * 0.6} height={WALL_T - 2} fill={DC} fillOpacity={0.25} stroke={DC} strokeWidth={1.5} />
        <line x1={gX + gW * 0.6 + 1} y1={WALL_T / 2} x2={gX + gW * 0.6 + 8} y2={WALL_T / 2} stroke={DC} strokeWidth={1.2} />
        <path d={`M${gX + gW * 0.6 + 6},${WALL_T / 2 - 2.5}l2.5,2.5-2.5,2.5`} fill="none" stroke={DC} strokeWidth={1.2} />
      </>;
    case 'door-folding': {
      const s = gW / 4;
      const fy = hy + Math.min(H * 0.4, s * 0.9);
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <line x1={gX} y1={hy} x2={gX + s} y2={fy} stroke={DC} strokeWidth={2} />
        <line x1={gX + s} y1={fy} x2={gX + gW / 2} y2={hy} stroke={DC} strokeWidth={2} />
        <line x1={gX + gW / 2} y1={hy} x2={gX + gW / 2 + s} y2={fy} stroke={DC} strokeWidth={2} />
        <line x1={gX + gW / 2 + s} y1={fy} x2={gX + gW} y2={hy} stroke={DC} strokeWidth={2} />
      </>;
    }
    case 'win-fixed':
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <rect x={gX} y={1} width={gW} height={WALL_T - 2} fill={WC} fillOpacity={0.3} stroke={WC} strokeWidth={1.5} />
        <line x1={gX + gW * 0.3} y1={1} x2={gX + gW * 0.7} y2={WALL_T - 1} stroke={WC} strokeWidth={1} />
        <line x1={gX + gW * 0.7} y1={1} x2={gX + gW * 0.3} y2={WALL_T - 1} stroke={WC} strokeWidth={1} />
      </>;
    case 'win-single':
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <rect x={gX} y={1} width={gW} height={WALL_T - 2} fill={WC} fillOpacity={0.3} stroke={WC} strokeWidth={1.5} />
        <line x1={gX} y1={WALL_T - 1} x2={gX + gW} y2={1} stroke={WC} strokeWidth={1} />
      </>;
    case 'win-double': {
      const mid = gX + gW / 2;
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <rect x={gX} y={1} width={gW / 2} height={WALL_T - 2} fill={WC} fillOpacity={0.3} stroke={WC} strokeWidth={1.5} />
        <rect x={mid} y={1} width={gW / 2} height={WALL_T - 2} fill={WC} fillOpacity={0.3} stroke={WC} strokeWidth={1.5} />
        <line x1={gX} y1={WALL_T - 1} x2={mid} y2={1} stroke={WC} strokeWidth={1} />
        <line x1={gX + gW} y1={WALL_T - 1} x2={mid} y2={1} stroke={WC} strokeWidth={1} />
      </>;
    }
    case 'win-sliding':
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <rect x={gX} y={1} width={gW} height={WALL_T - 2} fill={WC} fillOpacity={0.15} stroke={WC} strokeWidth={1} strokeDasharray="3 2" />
        <rect x={gX + gW * 0.2} y={0} width={gW / 2} height={WALL_T} fill={WC} fillOpacity={0.35} stroke={WC} strokeWidth={1.5} />
      </>;
    case 'win-bay': {
      const t = gW / 3;
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        {[0, 1, 2].map((i) => <rect key={i} x={gX + i * t} y={1} width={t} height={WALL_T - 2} fill={WC} fillOpacity={0.3} stroke={WC} strokeWidth={1.5} />)}
        <line x1={gX + t * 0.1} y1={WALL_T - 1} x2={gX + t * 0.9} y2={1} stroke={WC} strokeWidth={1} />
        <line x1={gX + t * 2.1} y1={WALL_T - 1} x2={gX + t * 2.9} y2={1} stroke={WC} strokeWidth={1} />
      </>;
    }
    case 'win-tilt': {
      const mid2 = gX + gW / 2;
      return <>
        <Wall W={W} gW={gW} gX={gX} />
        <rect x={gX} y={1} width={gW} height={WALL_T - 2} fill={WC} fillOpacity={0.3} stroke={WC} strokeWidth={1.5} />
        <line x1={mid2} y1={1} x2={gX} y2={WALL_T - 1} stroke={WC} strokeWidth={1} />
        <line x1={mid2} y1={1} x2={gX + gW} y2={WALL_T - 1} stroke={WC} strokeWidth={1} />
      </>;
    }
    // ── Furniture Icons (Aménager) ───────────────────────────────────────────
    case 'cuisine-meuble-bas':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={2} fill="var(--bg)" />
          <line x1={2} y1={10} x2={34} y2={10} strokeWidth={1} />
          <circle cx={18} cy={6} r={1.5} fill="var(--accent)" />
        </g>
      );
    case 'cuisine-evier':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 20}, ${H/2 - 15})`}>
          <rect x={2} y={2} width={36} height={26} rx={2} fill="var(--bg)" />
          <rect x={6} y={6} width={18} height={18} rx={2} strokeWidth={1} />
          <rect x={26} y={8} width={8} height={14} rx={1} strokeWidth={1} strokeDasharray="2 1" />
          <circle cx={15} cy={3} r={1} fill="var(--accent)" />
        </g>
      );
    case 'cuisine-meuble-haut':
      return (
        <g stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="3 2" fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={2} fill="var(--bg)" fillOpacity={0.1} />
          <line x1={2} y1={34} x2={34} y2={2} strokeWidth={0.8} />
        </g>
      );
    case 'cuisine-colonne':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={2} fill="var(--bg)" />
          {/* Oven window */}
          <rect x={6} y={8} width={20} height={12} rx={1} strokeWidth={1.2} />
          {/* Microwave window */}
          <rect x={6} y={22} width={20} height={8} rx={1} strokeWidth={1} />
          <circle cx={28} cy={12} r={1} fill="var(--accent)" />
          <circle cx={28} cy={26} r={1} fill="var(--accent)" />
        </g>
      );
    case 'cuisine-angle':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 24}, ${H/2 - 24})`}>
          {/* L-shape corner cabinet footprint */}
          <path d="M 2,2 L 46,2 L 46,22 L 22,22 L 22,46 L 2,46 Z" fill="var(--bg)" />
          {/* Corner arc cut */}
          <path d="M 22,22 Q 26,26 22,22" strokeWidth={0.8} />
          {/* Counter lines */}
          <line x1={2} y1={8} x2={46} y2={8} strokeWidth={0.8} />
          <line x1={8} y1={22} x2={8} y2={46} strokeWidth={0.8} />
        </g>
      );
    case 'cuisine-ilot':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 28}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={52} height={32} rx={3} fill="var(--bg)" />
          {/* Worktop texture lines */}
          <line x1={2} y1={10} x2={54} y2={10} strokeWidth={0.8} />
          <line x1={2} y1={24} x2={54} y2={24} strokeWidth={0.8} />
          {/* Centre marker */}
          <circle cx={28} cy={17} r={3} strokeWidth={1} />
        </g>
      );
    case 'cuisine-hotte':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 20}, ${H/2 - 12})`}>
          <rect x={2} y={2} width={36} height={20} rx={2} fill="var(--bg)" />
          {/* Filter slats */}
          <line x1={8} y1={2} x2={8} y2={22} strokeWidth={1} />
          <line x1={14} y1={2} x2={14} y2={22} strokeWidth={1} />
          <line x1={20} y1={2} x2={20} y2={22} strokeWidth={1} />
          <line x1={26} y1={2} x2={26} y2={22} strokeWidth={1} />
          <line x1={32} y1={2} x2={32} y2={22} strokeWidth={1} />
          {/* Fan indicator */}
          <circle cx={19} cy={12} r={4} strokeWidth={1.2} />
        </g>
      );
    case 'cuisine-lave-vaisselle':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={2} fill="var(--bg)" />
          {/* Control panel top */}
          <rect x={4} y={4} width={28} height={5} rx={1} strokeWidth={1} />
          {/* Spray arm */}
          <circle cx={18} cy={18} r={8} strokeWidth={1} />
          <line x1={10} y1={18} x2={26} y2={18} strokeWidth={1.5} />
          <line x1={18} y1={10} x2={18} y2={26} strokeWidth={1.5} />
          <circle cx={18} cy={18} r={1.5} fill="var(--accent)" />
        </g>
      );
    case 'cuisine-congelateur':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 16}, ${H/2 - 20})`}>
          <rect x={2} y={2} width={28} height={36} rx={2} fill="var(--bg)" />
          {/* Snowflake symbol */}
          <line x1={16} y1={10} x2={16} y2={24} strokeWidth={1.5} />
          <line x1={9} y1={17} x2={23} y2={17} strokeWidth={1.5} />
          <line x1={11} y1={12} x2={21} y2={22} strokeWidth={1} />
          <line x1={21} y1={12} x2={11} y2={22} strokeWidth={1} />
          <circle cx={16} cy={17} r={2} fill="var(--accent)" />
          {/* Handle */}
          <rect x={24} y={14} width={3} height={6} rx={1} strokeWidth={1} />
        </g>
      );
    case 'cuisine-plan-travail':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 28}, ${H/2 - 8})`}>
          <rect x={2} y={2} width={52} height={12} rx={1} fill="var(--bg)" />
          {/* Texture grain lines */}
          <line x1={10} y1={2} x2={10} y2={14} strokeWidth={0.6} />
          <line x1={20} y1={2} x2={20} y2={14} strokeWidth={0.6} />
          <line x1={30} y1={2} x2={30} y2={14} strokeWidth={0.6} />
          <line x1={40} y1={2} x2={40} y2={14} strokeWidth={0.6} />
          <line x1={50} y1={2} x2={50} y2={14} strokeWidth={0.6} />
        </g>
      );
    case 'sdb-vasque':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 20}, ${H/2 - 15})`}>
          <rect x={2} y={2} width={36} height={26} rx={3} fill="var(--bg)" />
          <ellipse cx={20} cy={15} rx={12} ry={7} strokeWidth={1.2} />
          <circle cx={20} cy={6} r={1.5} fill="var(--accent)" />
        </g>
      );
    case 'sdb-baignoire':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 32}, ${H/2 - 16})`}>
          <rect x={2} y={2} width={60} height={28} rx={4} fill="var(--bg)" />
          <rect x={6} y={6} width={52} height={20} rx={8} strokeWidth={1} />
          <circle cx={10} cy={16} r={1.5} fill="var(--accent)" />
        </g>
      );
    case 'sdb-douche':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={3} fill="var(--bg)" />
          <line x1={2} y1={2} x2={34} y2={34} strokeWidth={0.8} strokeDasharray="2 2" />
          <line x1={34} y1={2} x2={2} y2={34} strokeWidth={0.8} strokeDasharray="2 2" />
          <circle cx={18} cy={18} r={4} strokeWidth={1} />
        </g>
      );
    case 'sdb-wc':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none">
          <rect x={0} y={0} width={W} height={H * 0.2} rx={1} fill="var(--bg)" />
          <path d={`M ${W*0.1},${H*0.2} L ${W*0.1},${H*0.65} C ${W*0.1},${H*1.1} ${W*0.9},${H*1.1} ${W*0.9},${H*0.65} L ${W*0.9},${H*0.2}`} />
          <ellipse cx={W/2} cy={H*0.58} rx={W*0.28} ry={H*0.28} strokeWidth={1} />
        </g>
      );
    case 'chambre-lit-double':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 24}, ${H/2 - 24})`}>
          <rect x={2} y={2} width={44} height={44} rx={2} fill="var(--bg)" />
          {/* Headboard */}
          <line x1={2} y1={6} x2={46} y2={6} strokeWidth={2} />
          {/* Pillows */}
          <rect x={6} y={10} width={14} height={8} rx={1} strokeWidth={1} />
          <rect x={26} y={10} width={14} height={8} rx={1} strokeWidth={1} />
          {/* Cover fold */}
          <line x1={2} y1={22} x2={46} y2={22} strokeWidth={1} strokeDasharray="2 2" />
        </g>
      );
    case 'chambre-lit-simple':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 15}, ${H/2 - 24})`}>
          <rect x={2} y={2} width={26} height={44} rx={2} fill="var(--bg)" />
          {/* Headboard */}
          <line x1={2} y1={6} x2={28} y2={6} strokeWidth={2} />
          {/* Pillow */}
          <rect x={6} y={10} width={14} height={8} rx={1} strokeWidth={1} />
          {/* Cover fold */}
          <line x1={2} y1={22} x2={28} y2={22} strokeWidth={1} strokeDasharray="2 2" />
        </g>
      );
    case 'chambre-chevet':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 12}, ${H/2 - 12})`}>
          <rect x={2} y={2} width={20} height={20} rx={2} fill="var(--bg)" />
          <circle cx={12} cy={12} r={1.5} fill="var(--accent)" />
          <line x1={2} y1={6} x2={22} y2={6} strokeWidth={1} />
        </g>
      );
    case 'dressing-armoire':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 30}, ${H/2 - 15})`}>
          <rect x={2} y={2} width={56} height={26} rx={2} fill="var(--bg)" />
          <line x1={20} y1={2} x2={20} y2={28} strokeWidth={1} />
          <line x1={38} y1={2} x2={38} y2={28} strokeWidth={1} />
          {/* Dotted hanger indicators */}
          <path d="M 6,15 C 8,11 12,11 14,15" strokeWidth={1} strokeDasharray="2 1" />
          <path d="M 24,15 C 26,11 30,11 32,15" strokeWidth={1} strokeDasharray="2 1" />
          <path d="M 42,15 C 44,11 48,11 50,15" strokeWidth={1} strokeDasharray="2 1" />
        </g>
      );
    case 'dressing-commode':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 20}, ${H/2 - 12})`}>
          <rect x={2} y={2} width={36} height={20} rx={2} fill="var(--bg)" />
          <line x1={2} y1={12} x2={38} y2={12} strokeWidth={1} />
          <circle cx={13} cy={7} r={1} fill="var(--accent)" />
          <circle cx={27} cy={7} r={1} fill="var(--accent)" />
          <circle cx={13} cy={16} r={1} fill="var(--accent)" />
          <circle cx={27} cy={16} r={1} fill="var(--accent)" />
        </g>
      );
    case 'enfant-coffre':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 12})`}>
          <rect x={2} y={2} width={32} height={20} rx={2} fill="var(--bg)" />
          <rect x={14} y={0} width={4} height={4} rx={1} strokeWidth={1} fill="var(--bg)" />
          <line x1={2} y1={10} x2={34} y2={10} strokeWidth={1} strokeDasharray="3 2" />
        </g>
      );
    case 'enfant-lit-cabane':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 15}, ${H/2 - 24})`}>
          <rect x={2} y={2} width={26} height={44} rx={2} fill="var(--bg)" />
          <rect x={6} y={10} width={14} height={8} rx={1} strokeWidth={1} />
          {/* Post/Roof outline */}
          <line x1={2} y1={2} x2={15} y2={12} strokeWidth={1} strokeDasharray="2 1" />
          <line x1={28} y1={2} x2={15} y2={12} strokeWidth={1} strokeDasharray="2 1" />
          <line x1={2} y1={46} x2={15} y2={12} strokeWidth={1} strokeDasharray="2 1" />
          <line x1={28} y1={46} x2={15} y2={12} strokeWidth={1} strokeDasharray="2 1" />
        </g>
      );
    case 'bureau-desk':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 24}, ${H/2 - 15})`}>
          <rect x={2} y={2} width={44} height={26} rx={2} fill="var(--bg)" />
          {/* Keyboard & Mouse area */}
          <rect x={12} y={18} width={20} height={6} rx={1} strokeWidth={1} />
          {/* Drawers */}
          <rect x={4} y={4} width={6} height={6} rx={1} strokeWidth={0.8} />
          <rect x={38} y={4} width={6} height={6} rx={1} strokeWidth={0.8} />
        </g>
      );
    case 'bureau-chair':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 15}, ${H/2 - 15})`}>
          <circle cx={15} cy={15} r={10} fill="var(--bg)" />
          <path d="M 6,9 C 10,4 20,4 24,9" strokeWidth={2} />
          <path d="M 10,21 L 20,21" strokeWidth={1.5} />
        </g>
      );
    case 'meuble-canape':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 32}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={60} height={32} rx={3} fill="var(--bg)" />
          {/* Backrest cushion */}
          <rect x={4} y={4} width={56} height={8} rx={1} strokeWidth={1} />
          {/* Armrests */}
          <rect x={2} y={4} width={6} height={28} rx={1.5} strokeWidth={1} fill="var(--bg)" />
          <rect x={56} y={4} width={6} height={28} rx={1.5} strokeWidth={1} fill="var(--bg)" />
          {/* Cushions */}
          <line x1={20} y1={12} x2={20} y2={34} strokeWidth={1} />
          <line x1={44} y1={12} x2={44} y2={34} strokeWidth={1} />
        </g>
      );
    case 'meuble-fauteuil':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={3} fill="var(--bg)" />
          {/* Backrest */}
          <rect x={4} y={4} width={28} height={6} rx={1} strokeWidth={1} />
          {/* Armrests */}
          <rect x={2} y={4} width={6} height={28} rx={1.5} strokeWidth={1} fill="var(--bg)" />
          <rect x={28} y={4} width={6} height={28} rx={1.5} strokeWidth={1} fill="var(--bg)" />
        </g>
      );
    case 'meuble-table-basse':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 20}, ${H/2 - 15})`}>
          <rect x={2} y={2} width={36} height={26} rx={1} fill="var(--bg)" />
          <line x1={6} y1={6} x2={30} y2={20} strokeWidth={0.8} strokeDasharray="2 1" />
          <line x1={30} y1={6} x2={6} y2={20} strokeWidth={0.8} strokeDasharray="2 1" />
        </g>
      );
    case 'meuble-table-manger':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 28}, ${H/2 - 18})`}>
          <rect x={6} y={6} width={44} height={24} rx={2} fill="var(--bg)" />
          {/* Chairs */}
          <rect x={12} y={1} width={8} height={4} rx={0.5} strokeWidth={1} />
          <rect x={24} y={1} width={8} height={4} rx={0.5} strokeWidth={1} />
          <rect x={36} y={1} width={8} height={4} rx={0.5} strokeWidth={1} />
          <rect x={12} y={31} width={8} height={4} rx={0.5} strokeWidth={1} />
          <rect x={24} y={31} width={8} height={4} rx={0.5} strokeWidth={1} />
          <rect x={36} y={31} width={8} height={4} rx={0.5} strokeWidth={1} />
        </g>
      );
    case 'deco-plante':
      return (
        <g stroke="var(--accent)" strokeWidth={1.2} fill="none" transform={`translate(${W/2 - 12}, ${H/2 - 12})`}>
          <circle cx={12} cy={12} r={5} strokeWidth={1.5} fill="var(--bg)" />
          {/* Leaf lines */}
          <path d="M 12,12 Q 18,6 22,2" strokeWidth={1} />
          <path d="M 12,12 Q 6,18 2,22" strokeWidth={1} />
          <path d="M 12,12 Q 6,6 2,2" strokeWidth={1} />
          <path d="M 12,12 Q 18,18 22,22" strokeWidth={1} />
          <path d="M 12,12 Q 20,12 24,12" strokeWidth={1} />
          <path d="M 12,12 Q 4,12 0,12" strokeWidth={1} />
        </g>
      );
    case 'deco-lampadaire':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 10}, ${H/2 - 10})`}>
          <circle cx={10} cy={10} r={4} fill="var(--bg)" strokeWidth={2} />
          <circle cx={10} cy={10} r={9} strokeWidth={1} strokeDasharray="3 2" />
        </g>
      );
    case 'electro-refri':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={2} fill="var(--bg)" />
          <line x1={2} y1={30} x2={34} y2={30} strokeWidth={1.2} />
          <circle cx={6} cy={16} r={1.5} fill="var(--accent)" />
        </g>
      );
    case 'electro-lavelinge':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={2} fill="var(--bg)" />
          <circle cx={18} cy={18} r={10} strokeWidth={1.5} />
          <circle cx={18} cy={18} r={7} strokeWidth={1} strokeDasharray="3 1" />
          <circle cx={6} cy={6} r={1} fill="var(--accent)" />
          <circle cx={10} cy={6} r={1} fill="var(--accent)" />
        </g>
      );
    case 'elec-radiateur':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 20}, ${H/2 - 8})`}>
          <rect x={2} y={2} width={36} height={12} rx={1} fill="var(--bg)" />
          <line x1={8} y1={2} x2={8} y2={14} strokeWidth={1} />
          <line x1={14} y1={2} x2={14} y2={14} strokeWidth={1} />
          <line x1={20} y1={2} x2={20} y2={14} strokeWidth={1} />
          <line x1={26} y1={2} x2={26} y2={14} strokeWidth={1} />
          <line x1={32} y1={2} x2={32} y2={14} strokeWidth={1} />
        </g>
      );
    case 'jardin-table':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 28}, ${H/2 - 16})`}>
          <rect x={4} y={4} width={48} height={24} rx={1} fill="var(--bg)" />
          {/* Wood planks layout */}
          <line x1={4} y1={10} x2={52} y2={10} strokeWidth={0.8} />
          <line x1={4} y1={16} x2={52} y2={16} strokeWidth={0.8} />
          <line x1={4} y1={22} x2={52} y2={22} strokeWidth={0.8} />
        </g>
      );
    case 'jardin-transat':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 12}, ${H/2 - 28})`}>
          <rect x={2} y={2} width={20} height={52} rx={2} fill="var(--bg)" />
          <line x1={2} y1={14} x2={22} y2={14} strokeWidth={1.5} />
          {/* Slat lines */}
          <line x1={2} y1={20} x2={22} y2={20} strokeWidth={0.8} strokeDasharray="2 2" />
          <line x1={2} y1={28} x2={22} y2={28} strokeWidth={0.8} strokeDasharray="2 2" />
          <line x1={2} y1={36} x2={22} y2={36} strokeWidth={0.8} strokeDasharray="2 2" />
          <line x1={2} y1={44} x2={22} y2={44} strokeWidth={0.8} strokeDasharray="2 2" />
        </g>
      );
    case 'pers-standing':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 12}, ${H/2 - 12})`}>
          {/* Head */}
          <circle cx={12} cy={12} r={4.5} fill="var(--bg)" strokeWidth={1.5} />
          {/* Shoulders */}
          <path d="M 3,18 C 3,14 21,14 21,18" strokeWidth={1.8} />
        </g>
      );
    case 'forme-box':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={1} fill="var(--bg)" />
          <rect x={6} y={6} width={24} height={24} strokeWidth={0.8} strokeDasharray="2 1" />
        </g>
      );
    case 'sdb-chauffe-eau':
    case 'forme-cylinder':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <circle cx={18} cy={18} r={16} fill="var(--bg)" />
          <circle cx={18} cy={18} r={12} strokeWidth={0.8} strokeDasharray="2 1" />
        </g>
      );
    case 'pmr-cercle':
      return (
        <g stroke="var(--accent)" strokeWidth={1.2} fill="none" transform={`translate(${W/2 - 20}, ${H/2 - 20})`}>
          <circle cx={20} cy={20} r={18} strokeDasharray="3 2" />
          {/* Simplified Wheelchair Icon */}
          <circle cx={20} cy={14} r={2} fill="var(--accent)" />
          <path d="M 18,20 A 4,4 0 1,0 24,24" strokeWidth={1.5} />
          <path d="M 20,16 L 20,20 L 23,20" strokeWidth={1.2} />
        </g>
      );
    case 'pmr-fauteuil':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 16}, ${H/2 - 26})`}>
          <rect x={2} y={2} width={28} height={48} rx={2} strokeDasharray="3 3" />
          <circle cx={16} cy={16} r={3} fill="var(--accent)" />
          <path d="M 12,24 A 6,6 0 1,0 20,30" strokeWidth={2} />
          <path d="M 16,19 L 16,24 L 21,24" strokeWidth={1.5} />
        </g>
      );
    case 'cuisine-plaques':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={2} fill="var(--bg)" />
          {/* 4 hob elements */}
          <circle cx={10} cy={10} r={4.5} strokeWidth={1.2} />
          <circle cx={24} cy={10} r={5.5} strokeWidth={1.2} />
          <circle cx={10} cy={24} r={5.5} strokeWidth={1.2} />
          <circle cx={24} cy={24} r={4.5} strokeWidth={1.2} />
        </g>
      );
    case 'cuisine-microondes':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 18})`}>
          <rect x={2} y={2} width={32} height={32} rx={2} fill="var(--bg)" />
          <rect x={6} y={10} width={20} height={12} rx={1} strokeWidth={1.2} />
          <line x1={2} y1={28} x2={34} y2={28} strokeWidth={0.8} />
        </g>
      );
    case 'electro-refri-americain':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 24}, ${H/2 - 20})`}>
          <rect x={2} y={2} width={44} height={36} rx={2} fill="var(--bg)" />
          <line x1={24} y1={2} x2={24} y2={38} strokeWidth={1.5} />
          <circle cx={21} cy={18} r={1.5} fill="var(--accent)" />
          <circle cx={27} cy={18} r={1.5} fill="var(--accent)" />
        </g>
      );
    case 'sdb-double-vasque':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 36}, ${H/2 - 15})`}>
          <rect x={2} y={2} width={70} height={26} rx={2} fill="var(--bg)" />
          {/* Sink 1 */}
          <rect x={8} y={6} width={20} height={14} rx={2} strokeWidth={1.2} />
          <circle cx={18} cy={4} r={1} fill="var(--accent)" />
          {/* Sink 2 */}
          <rect x={42} y={6} width={20} height={14} rx={2} strokeWidth={1.2} />
          <circle cx={52} cy={4} r={1} fill="var(--accent)" />
        </g>
      );
    case 'sdb-bidet':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 12}, ${H/2 - 18})`}>
          <path d="M 4,2 Q 4,14 8,30 L 16,30 Q 20,14 20,2 Z" fill="var(--bg)" />
          <ellipse cx={12} cy={10} rx={5} ry={7} strokeWidth={1.2} />
          <circle cx={12} cy={4} r={1.5} fill="var(--accent)" />
        </g>
      );
    case 'chambre-lit-king':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 32}, ${H/2 - 36})`}>
          <rect x={2} y={2} width={60} height={68} rx={2} fill="var(--bg)" />
          {/* Headboard */}
          <rect x={2} y={2} width={60} height={4} fill="var(--accent)" opacity="0.3" />
          {/* Pillows */}
          <rect x={6} y={10} width={20} height={10} rx={1} strokeWidth={1.2} />
          <rect x={34} y={10} width={20} height={10} rx={1} strokeWidth={1.2} />
          {/* Fold */}
          <line x1={2} y1={26} x2={62} y2={26} strokeWidth={1.2} strokeDasharray="3 1" />
        </g>
      );
    case 'chambre-chevet-double':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 18}, ${H/2 - 14})`}>
          <rect x={2} y={2} width={32} height={24} rx={2} fill="var(--bg)" />
          <line x1={2} y1={12} x2={34} y2={12} strokeWidth={1} />
          <circle cx={18} cy={7} r={1.2} fill="var(--accent)" />
          <circle cx={18} cy={17} r={1.2} fill="var(--accent)" />
        </g>
      );
    case 'dressing-chiffonnier':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 15}, ${H/2 - 12})`}>
          <rect x={2} y={2} width={26} height={20} rx={2} fill="var(--bg)" />
          <line x1={2} y1={10} x2={28} y2={10} strokeWidth={1} />
          <circle cx={9} cy={6} r={1} fill="var(--accent)" />
          <circle cx={21} cy={6} r={1} fill="var(--accent)" />
          <circle cx={9} cy={15} r={1} fill="var(--accent)" />
          <circle cx={21} cy={15} r={1} fill="var(--accent)" />
        </g>
      );
    case 'meuble-canape-angle':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 36}, ${H/2 - 24})`}>
          {/* L shape couch */}
          <path d="M 2,2 L 70,2 L 70,46 L 50,46 L 50,20 L 2,20 Z" fill="var(--bg)" />
          {/* Armrests */}
          <rect x={2} y={2} width={4} height={18} strokeWidth={1.2} />
          <rect x={64} y={2} width={6} height={4} strokeWidth={1.2} />
          <rect x={50} y={42} width={20} height={4} strokeWidth={1.2} />
        </g>
      );
    case 'meuble-tv':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 36}, ${H/2 - 10})`}>
          <rect x={2} y={2} width={70} height={16} rx={2} fill="var(--bg)" />
          {/* TV stand base */}
          <rect x={15} y={5} width={40} height={6} rx={0.5} strokeWidth={1} />
          {/* TV Screen profile */}
          <line x1={8} y1={8} x2={62} y2={8} strokeWidth={2.5} />
        </g>
      );
    case 'meuble-chaise':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 10}, ${H/2 - 10})`}>
          <rect x={2} y={2} width={16} height={16} rx={1} fill="var(--bg)" />
          {/* Back rest */}
          <rect x={2} y={2} width={16} height={2} fill="var(--accent)" />
        </g>
      );
    case 'meuble-bibliotheque':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 20}, ${H/2 - 8})`}>
          <rect x={2} y={2} width={36} height={12} rx={1} fill="var(--bg)" />
          {/* Shelves */}
          <line x1={14} y1={2} x2={14} y2={14} strokeWidth={1.2} />
          <line x1={26} y1={2} x2={26} y2={14} strokeWidth={1.2} />
        </g>
      );
    case 'jardin-parasol':
      return (
        <g stroke="var(--accent)" strokeWidth={1.2} fill="none" transform={`translate(${W/2 - 24}, ${H/2 - 24})`}>
          <circle cx={24} cy={24} r={22} fill="var(--bg)" strokeWidth={1.5} />
          <circle cx={24} cy={24} r={2} fill="var(--accent)" />
          {/* Octagon ribs */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
            const rad = angle * Math.PI / 180;
            return <line key={angle} x1={24} y1={24} x2={24 + Math.cos(rad) * 22} y2={24 + Math.sin(rad) * 22} strokeWidth={0.8} />;
          })}
        </g>
      );
    case 'jardin-salon':
      return (
        <g stroke="var(--accent)" strokeWidth={1.5} fill="none" transform={`translate(${W/2 - 24}, ${H/2 - 16})`}>
          {/* Table */}
          <rect x={12} y={4} width={24} height={24} rx={4} fill="var(--bg)" />
          {/* Armchair Left */}
          <rect x={2} y={10} width={8} height={12} rx={1} strokeWidth={1} />
          <line x1={6} y1={10} x2={6} y2={22} strokeWidth={0.8} />
          {/* Armchair Right */}
          <rect x={38} y={10} width={8} height={12} rx={1} strokeWidth={1} />
          <line x1={42} y1={10} x2={42} y2={22} strokeWidth={0.8} />
        </g>
      );
    // Survey structure models (columns, chimneys).
    case 'structure-column':
      return <rect x={W / 2 - H * 0.3} y={H * 0.2} width={H * 0.6} height={H * 0.6} fill="#9a9a9a" stroke="#333" strokeWidth={1.5} />;
    case 'structure-column-round':
      return <circle cx={W / 2} cy={H / 2} r={H * 0.3} fill="#9a9a9a" stroke="#333" strokeWidth={1.5} />;
    case 'structure-chimney':
      return <>
        <rect x={W / 2 - H * 0.35} y={H * 0.15} width={H * 0.7} height={H * 0.7} fill="none" stroke="#7a4a3a" strokeWidth={2} />
        <path d={`M${W / 2 - H * 0.35} ${H * 0.15}L${W / 2 + H * 0.35} ${H * 0.85}M${W / 2 + H * 0.35} ${H * 0.15}L${W / 2 - H * 0.35} ${H * 0.85}`} stroke="#7a4a3a" strokeWidth={1} />
      </>;
    case 'structure-stove':
      return <>
        <rect x={W / 2 - H * 0.4} y={H * 0.15} width={H * 0.8} height={H * 0.7} rx={3} fill="#3a3a3a" fillOpacity={0.25} stroke="#333" strokeWidth={2} />
        <circle cx={W / 2} cy={H / 2} r={H * 0.15} fill="none" stroke="#7a4a3a" strokeWidth={2} />
      </>;
    case 'structure-fireplace':
      return <>
        <rect x={gX} y={H * 0.2} width={gW} height={H * 0.6} fill="#c9a89a" fillOpacity={0.4} stroke="#7a4a3a" strokeWidth={2} />
        <rect x={W / 2 - gW * 0.2} y={H * 0.2} width={gW * 0.4} height={H * 0.3} fill="none" stroke="#7a4a3a" strokeWidth={1.5} />
      </>;
    default:
      return <Wall W={W} gW={gW} gX={gX} />;
  }
}
