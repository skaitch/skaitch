import { useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { makeT } from '@skaitch/core/data/i18n';
import { clampImageCrop, cropPlanImage, imageCropFromPoints, type ImageCrop } from '../../lib/planImageCrop';
import { DXF_UNIT_MM, type DxfDrawing, type DxfUnit } from '@skaitch/core/cad/dxf';
import {
  initialVectorPlacement, normalizeDxf, vectorCompressedBytes, vectorEntityCount,
  VECTOR_ENTITY_WARNING, VECTOR_MAX_COMPRESSED_BYTES, type VectorPlanData,
} from '@skaitch/core/cad/vectorPlan';
import { rasterizeVectorPlan, readDxfFile, VECTOR_PREVIEW_MAX_SIDE } from '../../lib/vectorPlanRaster';
import type { ItemsMap } from '@skaitch/core/types/ifc';

/** What the dialog produces: an image, or a vector plan already placed at true scale. */
export interface PlanImport {
  url: string;
  w: number;
  h: number;
  kind?: 'vector';
  vector?: VectorPlanData;
  scale?: number;
  x?: number;
  y?: number;
  rotation?: number;
}

/** A storey whose vector plan can lend its origin offset, so plans from one file stay superposed. */
export interface VectorOriginSource {
  storeyId: string;
  name: string;
  origin: [number, number];
  unit: DxfUnit;
  x: number;
  y: number;
  rotation: number;
}

/** Storeys other than `storeyId` that hold a vector plan. */
export function vectorOriginSources(items: ItemsMap, storeyId: string): VectorOriginSource[] {
  const out: VectorOriginSource[] = [];
  for (const item of Object.values(items)) {
    const plan = (item as any)?.type === 'Storey' && item.id !== storeyId ? (item as any).geom?.plan : null;
    if (plan?.kind !== 'vector' || !plan.vector) continue;
    out.push({ storeyId: item.id, name: item.name, origin: plan.vector.origin, unit: plan.vector.unit, x: plan.x, y: plan.y, rotation: plan.rotation ?? 0 });
  }
  return out;
}

const UNITS: DxfUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];
const isDxf = (file: File) => /\.dxf$/i.test(file.name) || file.type === 'image/vnd.dxf' || file.type === 'application/dxf';

interface Props {
  hasPlan: boolean;
  lang: string;
  onApply: (plan: PlanImport) => void;
  /** Vector plans of other storeys, offered as a shared origin. */
  vectorOrigins?: VectorOriginSource[];
  /** File provided externally (e.g. dropped on the canvas); opens the crop dialog directly. */
  initialFile?: File | null;
  /** Hide the upload button (dialog-only usage). */
  hideTrigger?: boolean;
  /** Called when the crop dialog closes (applied, cancelled or failed). */
  onDone?: () => void;
}
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag = { mode: 'draw' | 'move' | Corner; start: [number, number]; crop: ImageCrop };

export default function PlanImageUpload({ hasPlan, lang, onApply, initialFile, hideTrigger, onDone, vectorOrigins = [] }: Props) {
  const tr = (fr: string, en: string) => lang === 'fr' ? fr : en;
  const [source, setSource] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  const [crop, setCrop] = useState<ImageCrop>({ x: 0, y: 0, width: 1, height: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dxf, setDxf] = useState<DxfDrawing | null>(null);
  const [unit, setUnit] = useState<DxfUnit>('mm');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [originFrom, setOriginFrom] = useState('');
  const request = useRef(0);
  const drag = useRef<Drag | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const instructionsId = useId();
  const width = source?.image.naturalWidth ?? 1;
  const height = source?.image.naturalHeight ?? 1;

  useEffect(() => () => { request.current++; }, []);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);
  useEffect(() => {
    if (!initialFile) return;
    void openImage(initialFile).then(ok => { if (!ok) onDone?.(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  async function openImage(file: File): Promise<boolean> {
    if (isDxf(file)) return openDxf(file);
    setDxf(null);
    const id = ++request.current;
    const url = URL.createObjectURL(file);
    setBusy(true);
    setError('');
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (request.current !== id) { URL.revokeObjectURL(url); return false; }
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image');
      setCrop({ x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight });
      setSource({ url, image });
      return true;
    } catch {
      URL.revokeObjectURL(url);
      if (request.current === id) setError(tr('Impossible de lire cette image. Le fond existant est conservé.', 'Unable to read this image. The existing plan is unchanged.'));
      return false;
    } finally {
      if (request.current === id) setBusy(false);
    }
  }

  async function openDxf(file: File): Promise<boolean> {
    const id = ++request.current;
    setBusy(true);
    setError('');
    try {
      const drawing = await readDxfFile(file);
      if (request.current !== id) return false;
      if (!drawing.bounds) throw new Error('empty');
      // The preview is the whole drawing at its own proportions; the crop is drawn on it.
      const full = normalizeDxf(drawing, { unit: 'mm' });
      const place = initialVectorPlacement(full, VECTOR_PREVIEW_MAX_SIDE);
      const url = rasterizeVectorPlan({ ...full, layers: full.layers.map(l => ({ ...l, visible: true })) }, place.w, place.h);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (request.current !== id) return false;
      setDxf(drawing);
      setUnit(drawing.unit ?? 'mm');
      setExcluded(new Set());
      setOriginFrom('');
      setCrop({ x: 0, y: 0, width: place.w, height: place.h });
      setSource({ url, image });
      return true;
    } catch (e) {
      if (request.current === id) {
        const detail = e instanceof Error && e.message && e.message !== 'empty' ? ` (${e.message})` : '';
        setError(tr(`Impossible de lire ce fichier DXF${detail}. Le fond existant est conservé.`, `Unable to read this DXF file${detail}. The existing plan is unchanged.`));
      }
      return false;
    } finally {
      if (request.current === id) setBusy(false);
    }
  }

  /** Crop in the drawing's own coordinates; undefined for the whole drawing. */
  function dxfCrop(drawing: DxfDrawing) {
    const b = drawing.bounds!;
    if (crop.x === 0 && crop.y === 0 && crop.width === width && crop.height === height) return undefined;
    const sx = (b.maxX - b.minX) / width, sy = (b.maxY - b.minY) / height;
    return { minX: b.minX + crop.x * sx, maxX: b.minX + (crop.x + crop.width) * sx, minY: b.maxY - (crop.y + crop.height) * sy, maxY: b.maxY - crop.y * sy };
  }

  function buildVector(): VectorPlanData | null {
    if (!dxf) return null;
    const source = vectorOrigins.find(o => o.storeyId === originFrom);
    const drawing = { ...dxf,
      layers: dxf.layers.filter(l => !excluded.has(l.name)),
      polylines: dxf.polylines.filter(p => !excluded.has(p.layer)),
      texts: dxf.texts.filter(t => !excluded.has(t.layer)),
      centers: dxf.centers.filter(c => !excluded.has(c.layer)),
    };
    // A shared origin is stored in metres: convert it if the other plan used another unit.
    const origin = source ? source.origin.map(v => v * DXF_UNIT_MM[unit] / DXF_UNIT_MM[source.unit]) as [number, number] : undefined;
    return normalizeDxf(drawing, { unit, crop: dxfCrop(dxf), origin });
  }

  function point(e: React.PointerEvent<SVGSVGElement>): [number, number] {
    const matrix = e.currentTarget.getScreenCTM();
    if (!matrix) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return [p.x, p.y];
  }

  function updateDrag(e: React.PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current) return;
    const p = point(e);
    const initial = current.crop;
    if (current.mode === 'move') {
      setCrop({ ...initial,
        x: Math.max(0, Math.min(width - initial.width, Math.round(initial.x + p[0] - current.start[0]))),
        y: Math.max(0, Math.min(height - initial.height, Math.round(initial.y + p[1] - current.start[1]))),
      });
    } else {
      const anchor: [number, number] = current.mode === 'draw' ? current.start : [
        current.mode.endsWith('w') ? initial.x + initial.width : initial.x,
        current.mode.startsWith('n') ? initial.y + initial.height : initial.y,
      ];
      setCrop(imageCropFromPoints(anchor, p, width, height));
    }
  }

  function apply() {
    if (!source) return;
    if (dxf) {
      try {
        const vector = buildVector()!;
        if (vectorCompressedBytes(vector) > VECTOR_MAX_COMPRESSED_BYTES) {
          setError(tr('Ce plan est trop lourd pour être enregistré. Sélectionnez une zone plus petite ou excluez des calques.', 'This plan is too heavy to be saved. Select a smaller area or exclude layers.'));
          return;
        }
        const place = initialVectorPlacement(vector, VECTOR_PREVIEW_MAX_SIDE);
        const shared = vectorOrigins.find(o => o.storeyId === originFrom);
        onApply({
          kind: 'vector', vector, url: rasterizeVectorPlan(vector, place.w, place.h), w: place.w, h: place.h, scale: place.scale,
          x: shared?.x ?? 0, y: shared?.y ?? 0, rotation: shared?.rotation ?? 0,
        });
        setSource(null);
        setDxf(null);
        setError('');
        onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    try {
      onApply(cropPlanImage(source.image, crop));
      setSource(null);
      setError('');
      onDone?.();
    } catch {
      setError(tr('Impossible de recadrer cette image. Essayez une portion plus petite. Le fond existant est conservé.', 'Unable to crop this image. Try a smaller area. The existing plan is unchanged.'));
    }
  }

  function dxfOptions() {
    if (!dxf) return null;
    const b = dxf.bounds!;
    const c = dxfCrop(dxf) ?? b;
    const metres = (v: number) => (v * DXF_UNIT_MM[unit] / 1000).toLocaleString(lang, { maximumFractionDigits: 2 });
    const kept = dxf.polylines.filter(p => !excluded.has(p.layer)).length + dxf.texts.filter(t => !excluded.has(t.layer)).length;
    const compatible = vectorOrigins;
    return <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <label>{tr('Unité du dessin', 'Drawing unit')}{' '}
          <select value={unit} onChange={e => setUnit(e.target.value as DxfUnit)}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {dxf.unit ? tr(`Unité déclarée : ${dxf.unit}`, `Declared unit: ${dxf.unit}`) : tr('Aucune unité déclarée : millimètres par défaut', 'No declared unit: millimetres by default')}
        </span>
        <strong data-testid="dxf-extent">{tr('Emprise', 'Extent')} : {metres(c.maxX - c.minX)} × {metres(c.maxY - c.minY)} m</strong>
      </div>
      {compatible.length > 0 && <label>{tr('Origine', 'Origin')}{' '}
        <select value={originFrom} onChange={e => setOriginFrom(e.target.value)}>
          <option value="">{tr('Recentrer sur la sélection', 'Recentre on the selection')}</option>
          {compatible.map(o => <option key={o.storeyId} value={o.storeyId}>{tr(`Même origine que « ${o.name} »`, `Same origin as “${o.name}”`)}</option>)}
        </select>
      </label>}
      <details>
        <summary>{tr(`Calques à importer (${dxf.layers.length - excluded.size}/${dxf.layers.length})`, `Layers to import (${dxf.layers.length - excluded.size}/${dxf.layers.length})`)}</summary>
        <div style={{ maxHeight: 160, overflow: 'auto', columns: '3 160px', fontSize: 12, marginTop: 6 }}>
          {dxf.layers.map(l => <label key={l.name} style={{ display: 'block' }}>
            <input type="checkbox" checked={!excluded.has(l.name)} onChange={e => {
              const next = new Set(excluded);
              if (e.target.checked) next.delete(l.name); else next.add(l.name);
              setExcluded(next);
            }} />{' '}<span style={{ display: 'inline-block', width: 8, height: 8, background: l.color, border: '1px solid var(--border)' }} />{' '}
            {l.name}{!l.visible && <em style={{ color: 'var(--ink-3)' }}> {tr('(masqué)', '(hidden)')}</em>}
          </label>)}
        </div>
      </details>
      {kept > VECTOR_ENTITY_WARNING && <p role="status" style={{ color: 'var(--warn, #c77700)', margin: 0 }}>
        {tr(`Ce dessin compte ${kept.toLocaleString(lang)} entités : excluez des calques ou réduisez la zone pour garder un plan fluide.`, `This drawing has ${kept.toLocaleString(lang)} entities: exclude layers or reduce the area to keep the plan responsive.`)}
      </p>}
    </div>;
  }

  const corners: [Corner, number, number][] = [
    ['nw', crop.x, crop.y], ['ne', crop.x + crop.width, crop.y],
    ['sw', crop.x, crop.y + crop.height], ['se', crop.x + crop.width, crop.y + crop.height],
  ];
  return <>
    {hideTrigger ? (error && !source && <p role="alert" onClick={() => setError('')} style={{ cursor: 'pointer', position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'var(--panel)', padding: 8, borderRadius: 8, zIndex: 10000 }}>{error}</p>) : <div style={{ flex: 1 }}>
      <button ref={trigger} type="button" disabled={busy} onClick={() => upload.current?.click()} className="btn ghost" style={{ width: '100%', fontSize: 11 }}>
        {busy ? tr('Lecture…', 'Loading…') : makeT(lang)(hasPlan ? 'Change' : 'Upload')}
      </button>
        <input ref={upload} type="file" hidden accept="image/*,.dxf" disabled={busy} onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void openImage(file);
        }} />
      {error && !source && <p role="alert">{error}</p>}
    </div>}
    <Dialog.Root open={!!source} onOpenChange={open => { if (!open) { setSource(null); setDxf(null); drag.current = null; onDone?.(); } }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: '#0009', zIndex: 10000 }} />
        <Dialog.Content aria-describedby={instructionsId} onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus(); }}
          style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(960px, calc(100vw - 24px))', maxHeight: 'calc(100dvh - 24px)', overflow: 'auto', padding: 20, boxSizing: 'border-box', background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 12, zIndex: 10001 }}>
          <Dialog.Title style={{ margin: '0 0 8px' }}>{tr('Sélectionner le plan de cet étage', 'Select the plan for this storey')}</Dialog.Title>
          <Dialog.Description id={instructionsId}>
            {tr('Tracez un rectangle, déplacez la sélection ou ajustez ses coins. Au clavier : flèches pour déplacer, Maj + flèches pour redimensionner.', 'Draw a rectangle, move the selection or drag its corners. Keyboard: arrows to move, Shift + arrows to resize.')}
          </Dialog.Description>
          {source && <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" tabIndex={0} role="group"
            aria-label={tr('Zone de recadrage', 'Crop area')} aria-describedby={instructionsId}
            style={{ display: 'block', width: '100%', height: 'min(55vh, 600px)', background: dxf ? '#f4f4f1' : '#222', touchAction: 'none', cursor: 'crosshair' }}
            onKeyDown={e => {
              const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              const dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
              if (!dx && !dy) return;
              e.preventDefault();
              setCrop(e.shiftKey ? clampImageCrop({ ...crop, width: crop.width + dx, height: crop.height + dy }, width, height)
                : { ...crop, x: Math.max(0, Math.min(width - crop.width, crop.x + dx)), y: Math.max(0, Math.min(height - crop.height, crop.y + dy)) });
            }}
            onPointerDown={e => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.focus();
              const start = point(e);
              let mode = (e.target as SVGElement).getAttribute('data-crop-handle') as Drag['mode'] | null;
              if (mode === 'move' && crop.width === width && crop.height === height) mode = null;
              drag.current = { mode: mode ?? 'draw', start, crop };
              e.currentTarget.setPointerCapture(e.pointerId);
              if (!mode) setCrop(imageCropFromPoints(start, start, width, height));
            }}
            onPointerMove={updateDrag}
            onPointerUp={e => { updateDrag(e); drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
            onPointerCancel={() => { if (drag.current) setCrop(drag.current.crop); drag.current = null; }}
            onLostPointerCapture={() => { drag.current = null; }}>
            <image href={source.url} width={width} height={height} />
            <path d={`M0 0H${width}V${height}H0Z M${crop.x} ${crop.y}h${crop.width}v${crop.height}h${-crop.width}Z`} fill="#0009" fillRule="evenodd" pointerEvents="none" />
            <rect data-crop-handle="move" x={crop.x} y={crop.y} width={crop.width} height={crop.height} fill="transparent" stroke="#42b9ff" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: 'move' }} />
            {corners.map(([corner, x, y]) => <circle key={corner} data-crop-handle={corner} cx={x} cy={y} r={Math.max(width, height) / 80} fill="white" stroke="#1674ac" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: `${corner}-resize` }} />)}
          </svg>}
          {dxf && dxfOptions()}
          {!dxf && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key} style={{ flex: '1 1 100px' }}>
              {{ x: 'X', y: 'Y', width: tr('Largeur', 'Width'), height: tr('Hauteur', 'Height') }[key]} (px)
              <input type="number" max={key === 'x' ? width - 1 : key === 'y' ? height - 1 : key === 'width' ? width - crop.x : height - crop.y} min={key === 'x' || key === 'y' ? 0 : 1} step={1} value={crop[key]} style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}
                onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) setCrop(clampImageCrop({ ...crop, [key]: e.target.valueAsNumber }, width, height)); }} />
            </label>)}
          </div>}
          {error && <p role="alert">{error}</p>}
          {!dxf && <p>{tr('Calibrez ensuite la portion sélectionnée avec l’outil de calibration.', 'Calibrate the selected area afterwards using the calibration tool.')}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost" onClick={() => setCrop({ x: 0, y: 0, width, height })}>{dxf ? tr('Dessin entier', 'Whole drawing') : tr('Image entière', 'Whole image')}</button>
            <Dialog.Close asChild><button className="btn ghost">{tr('Annuler', 'Cancel')}</button></Dialog.Close>
            <button className="btn" onClick={apply}>{tr('Utiliser cette portion', 'Use this area')}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
