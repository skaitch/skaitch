import type { ToolType } from '@skaitch/core/types/ifc';
import { makeT } from '@skaitch/core/data/i18n';

export default function ToolHint({ tool, lang, onSelect, drawing = false }: {
  tool: ToolType; lang: string; onSelect: () => void; drawing?: boolean;
}) {
  if (tool === 'select') return null;
  const t = makeT(lang);
  const instruction = tool === 'Wall'
    ? drawing ? 'Click to finish the wall segment. Escape to stop.' : 'Click to start a wall.'
    : tool === 'Door' || tool === 'Window' ? 'Click a wall to place the opening.'
    : tool === 'alignPlan' ? drawing ? 'Click the matching point on the reference storey.' : 'Click a point on the background plan.'
    : 'Active tool';
  return <div className="tool-hint" onMouseDown={e => e.stopPropagation()}
    onMouseUp={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
    onTouchStart={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
    <span><strong>{t(tool)}</strong> · {t(instruction)}</span>
    <button className="btn" onClick={onSelect}>{t('select')} <kbd>V</kbd></button>
  </div>;
}
