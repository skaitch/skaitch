/**
 * DXF reader for vector background plans (ADR 0014).
 *
 * Reads the model space of an ASCII DXF and flattens it into 2D polylines and texts, in the
 * drawing's own units and world coordinates: blocks are exploded, arcs, circles, ellipses,
 * splines and polyline bulges are split into segments, dimensions are read through their
 * graphic block. Hatches, solids, 3D entities, images and paper space are ignored.
 */

export type DxfUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** Millimetres per drawing unit. */
export const DXF_UNIT_MM: Record<DxfUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

const INSUNITS: Record<number, DxfUnit> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };

export interface DxfLayer {
  name: string;
  /** '#rrggbb' */
  color: string;
  /** False when the layer is frozen or off in the file. */
  visible: boolean;
}

export interface DxfText {
  layer: string;
  color: string;
  x: number;
  y: number;
  /** Text height, drawing units. */
  h: number;
  /** Rotation, degrees counter-clockwise. */
  rot: number;
  s: string;
}

export interface DxfPolyline {
  layer: string;
  color: string;
  /** Flat [x0, y0, x1, y1, …], drawing units. */
  pts: number[];
}

export interface DxfBounds { minX: number; minY: number; maxX: number; maxY: number }

export interface DxfDrawing {
  /** Unit declared by $INSUNITS, undefined when absent or unitless. */
  unit?: DxfUnit;
  layers: DxfLayer[];
  polylines: DxfPolyline[];
  texts: DxfText[];
  /** Centres of circles and arcs, snap targets. */
  centers: { layer: string; x: number; y: number }[];
  bounds: DxfBounds | null;
}

export class DxfError extends Error {}

// ── Tokenizer ────────────────────────────────────────────────────────────────

type Pair = [number, string];

/** Decodes the file: UTF-8 from AutoCAD 2007 (AC1021), the declared ANSI code page before. */
export function decodeDxf(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64_000)));
  if (head.startsWith('AutoCAD Binary DXF')) throw new DxfError('Binary DXF is not supported; save the drawing as ASCII DXF.');
  const version = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)/.exec(head)?.[1];
  if (version && version >= 'AC1021') return new TextDecoder('utf-8').decode(bytes);
  const page = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/.exec(head)?.[1];
  try {
    return new TextDecoder(page ? `windows-${page}` : 'windows-1252').decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) throw new DxfError(`Invalid DXF group code at line ${i + 1}.`);
    pairs.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return pairs;
}

// ── Raw entities ─────────────────────────────────────────────────────────────

interface RawEntity {
  type: string;
  /** All group pairs of the entity, in file order (repeated codes matter). */
  g: Pair[];
  /** VERTEX / ATTRIB children of POLYLINE and INSERT. */
  children?: RawEntity[];
}

function num(e: RawEntity, code: number, fallback = 0): number {
  for (const [c, v] of e.g) if (c === code) { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; }
  return fallback;
}
function str(e: RawEntity, code: number, fallback = ''): string {
  for (const [c, v] of e.g) if (c === code) return v;
  return fallback;
}
function nums(e: RawEntity, code: number): number[] {
  const out: number[] = [];
  for (const [c, v] of e.g) if (c === code) out.push(parseFloat(v));
  return out;
}

/** Splits a run of pairs (starting at a 0 code) into entities, attaching VERTEX/ATTRIB to their parent. */
function readEntities(pairs: Pair[], start: number, stop: (p: Pair) => boolean): { entities: RawEntity[]; end: number } {
  const entities: RawEntity[] = [];
  let parent: RawEntity | null = null;
  let i = start;
  while (i < pairs.length && !stop(pairs[i])) {
    const type = pairs[i][1];
    const g: Pair[] = [];
    i++;
    while (i < pairs.length && pairs[i][0] !== 0) g.push(pairs[i++]);
    const e: RawEntity = { type, g };
    if (type === 'VERTEX' || type === 'ATTRIB') {
      if (parent) (parent.children ??= []).push(e);
    } else if (type === 'SEQEND') {
      parent = null;
    } else {
      parent = type === 'POLYLINE' || (type === 'INSERT' && num(e, 66) === 1) ? e : null;
      entities.push(e);
    }
  }
  return { entities, end: i };
}

interface RawFile {
  unit?: DxfUnit;
  layers: Map<string, { color: number; trueColor?: number; frozen: boolean; off: boolean }>;
  blocks: Map<string, { base: [number, number]; entities: RawEntity[] }>;
  entities: RawEntity[];
}

function readFile(pairs: Pair[]): RawFile {
  const file: RawFile = { layers: new Map(), blocks: new Map(), entities: [] };
  let i = 0;
  while (i < pairs.length) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1];
      i += 2;
      if (name === 'HEADER') {
        for (; i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC'); i++) {
          if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') file.unit = INSUNITS[parseInt(pairs[i + 1]?.[1] ?? '0', 10)];
        }
      } else if (name === 'TABLES') {
        for (; i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC'); i++) {
          if (pairs[i][0] !== 0 || pairs[i][1] !== 'LAYER') continue;
          let layerName = '', color = 7, trueColor: number | undefined, flags = 0;
          for (i++; i < pairs.length && pairs[i][0] !== 0; i++) {
            const [c, v] = pairs[i];
            if (c === 2) layerName = v;
            else if (c === 62) color = parseInt(v, 10);
            else if (c === 420) trueColor = parseInt(v, 10);
            else if (c === 70) flags = parseInt(v, 10);
          }
          i--;
          if (layerName) file.layers.set(layerName, { color: Math.abs(color) || 7, trueColor, frozen: (flags & 1) === 1, off: color < 0 });
        }
      } else if (name === 'BLOCKS') {
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
          if (pairs[i][0] === 0 && pairs[i][1] === 'BLOCK') {
            const header: RawEntity = { type: 'BLOCK', g: [] };
            for (i++; i < pairs.length && pairs[i][0] !== 0; i++) header.g.push(pairs[i]);
            const { entities, end } = readEntities(pairs, i, p => p[0] === 0 && p[1] === 'ENDBLK');
            file.blocks.set(str(header, 2), { base: [num(header, 10), num(header, 20)], entities });
            i = end + 1;
            while (i < pairs.length && pairs[i][0] !== 0) i++;
          } else i++;
        }
      } else if (name === 'ENTITIES') {
        const { entities, end } = readEntities(pairs, i, p => p[0] === 0 && p[1] === 'ENDSEC');
        file.entities = entities;
        i = end;
      } else {
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) i++;
      }
    }
    i++;
  }
  return file;
}

// ── Colours ──────────────────────────────────────────────────────────────────

const ACI_BASE = ['#000000', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff', '#808080', '#c0c0c0'];

/** AutoCAD Color Index to '#rrggbb' (1-9 exact, 10-249 hue wheel, 250-255 greys). */
export function aciToHex(aci: number): string {
  if (aci >= 0 && aci <= 9) return ACI_BASE[aci];
  if (aci >= 250 && aci <= 255) {
    const v = Math.round(51 + (aci - 250) * 40.8).toString(16).padStart(2, '0');
    return `#${v}${v}${v}`;
  }
  if (aci < 10 || aci > 249) return '#ffffff';
  const hue = Math.floor((aci - 10) / 10) * 15;
  const step = (aci - 10) % 10;
  const value = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][step >> 0];
  const sat = step % 2 === 0 ? 1 : 0.5;
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    const c = value - value * sat * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

const trueToHex = (rgb: number) => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');

// ── Geometry helpers ─────────────────────────────────────────────────────────

/** 2D affine [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
const rotate = (deg: number): Mat => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
const scale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];
/** Object coordinate system with extrusion (0, 0, -1): OCS x maps to world -x. */
const ocs = (e: RawEntity): Mat => num(e, 230, 1) < 0 ? [-1, 0, 0, 1, 0, 0] : IDENTITY;
const det = (m: Mat) => m[0] * m[3] - m[1] * m[2];

const ARC_STEP = Math.PI / 36;

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): number[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(2, Math.ceil(sweep / ARC_STEP));
  const pts: number[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + sweep * k / n;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return pts;
}

/** Vertices with bulges (LWPOLYLINE / POLYLINE) to a flat point list. */
function bulgePoints(vs: { x: number; y: number; b: number }[], closed: boolean): number[] {
  const pts: number[] = [];
  const n = vs.length;
  for (let k = 0; k < n; k++) {
    const p = vs[k];
    const last = k === n - 1;
    if (last && !closed) { pts.push(p.x, p.y); break; }
    const q = vs[(k + 1) % n];
    if (Math.abs(p.b) < 1e-9) { pts.push(p.x, p.y); continue; }
    const theta = 4 * Math.atan(p.b);
    const chord = Math.hypot(q.x - p.x, q.y - p.y);
    if (chord < 1e-12) { pts.push(p.x, p.y); continue; }
    // Centre = chord midpoint + left normal × chord·(1 − b²)/(4b); the arc turns by θ from p.
    const off = chord * (1 - p.b * p.b) / (4 * p.b);
    const cx = (p.x + q.x) / 2 - (q.y - p.y) / chord * off;
    const cy = (p.y + q.y) / 2 + (q.x - p.x) / chord * off;
    const r = Math.hypot(p.x - cx, p.y - cy);
    const a0 = Math.atan2(p.y - cy, p.x - cx);
    const steps = Math.max(2, Math.ceil(Math.abs(theta) / ARC_STEP));
    for (let s = 0; s < steps; s++) {
      const a = a0 + theta * s / steps;
      pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
  }
  if (closed && n > 0) pts.push(vs[0].x, vs[0].y);
  return pts;
}

function splinePoints(e: RawEntity): number[] {
  const degree = num(e, 71, 3);
  const knots = nums(e, 40);
  const xs = nums(e, 10), ys = nums(e, 20);
  const weights = nums(e, 41);
  const n = xs.length;
  if (n < 2 || knots.length !== n + degree + 1) {
    const fx = nums(e, 11), fy = nums(e, 21);
    if (fx.length >= 2) return fx.flatMap((x, k) => [x, fy[k]]);
    return xs.flatMap((x, k) => [x, ys[k]]);
  }
  const w = (k: number) => weights.length === n ? weights[k] : 1;
  const lo = knots[degree], hi = knots[n];
  const samples = Math.max(16, n * 8);
  const pts: number[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? hi - 1e-10 * (hi - lo) : lo + (hi - lo) * s / samples;
    let span = degree;
    while (span < n - 1 && t >= knots[span + 1]) span++;
    const d: [number, number, number][] = [];
    for (let j = 0; j <= degree; j++) {
      const k = span - degree + j;
      d.push([xs[k] * w(k), ys[k] * w(k), w(k)]);
    }
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const k = span - degree + j;
        const den = knots[k + degree - r + 1] - knots[k];
        const a = den === 0 ? 0 : (t - knots[k]) / den;
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
      }
    }
    pts.push(d[degree][0] / d[degree][2], d[degree][1] / d[degree][2]);
  }
  return pts;
}

/** Removes MTEXT formatting codes and decodes \U+XXXX escapes. */
export function plainText(s: string): string {
  return s
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\P/g, '\n')
    .replace(/\\[ACcFfHhQqTtWw][^;\\{}]*;/g, '')
    .replace(/\\S([^;]*)[\^#/]([^;]*);/g, '$1/$2')
    .replace(/\\[LlOoKkNn]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/\\([\\{}])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '')
    .trim();
}

// ── Flattening ───────────────────────────────────────────────────────────────

const MAX_DEPTH = 16;

export function parseDxf(input: string | Uint8Array): DxfDrawing {
  const text = typeof input === 'string' ? input : decodeDxf(input);
  const file = readFile(tokenize(text));
  if (!file.entities.length && !file.blocks.size) throw new DxfError('No drawing found in this DXF file.');

  const layerColor = (name: string) => {
    const l = file.layers.get(name);
    return l ? (l.trueColor !== undefined ? trueToHex(l.trueColor) : aciToHex(l.color)) : '#ffffff';
  };
  const used = new Set<string>();
  const polylines: DxfPolyline[] = [];
  const texts: DxfText[] = [];
  const centers: DxfDrawing['centers'] = [];
  const center = (m: Mat, layer: string, x: number, y: number) =>
    centers.push({ layer, x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };

  interface Ctx { m: Mat; layer: string; color: string; depth: number }

  const resolve = (e: RawEntity, ctx: Ctx) => {
    const own = str(e, 8, '0');
    const layer = own === '0' && ctx.depth > 0 ? ctx.layer : own;
    const tc = e.g.find(p => p[0] === 420);
    const aci = parseInt(str(e, 62, '256'), 10);
    const color = tc ? trueToHex(parseInt(tc[1], 10))
      : aci === 256 ? layerColor(layer)
      : aci === 0 ? ctx.color
      : aciToHex(Math.abs(aci));
    return { layer, color };
  };

  const emit = (pts: number[], m: Mat, layer: string, color: string) => {
    if (pts.length < 4) return;
    const out = new Array<number>(pts.length);
    for (let k = 0; k < pts.length; k += 2) {
      const x = m[0] * pts[k] + m[2] * pts[k + 1] + m[4];
      const y = m[1] * pts[k] + m[3] * pts[k + 1] + m[5];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      out[k] = x; out[k + 1] = y;
      grow(x, y);
    }
    used.add(layer);
    polylines.push({ layer, color, pts: out });
  };

  const emitText = (m: Mat, layer: string, color: string, raw: string, x: number, y: number, h: number, rot: number) => {
    const s = plainText(raw);
    if (!s) return;
    const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5];
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    const c = Math.cos(rot * Math.PI / 180), sn = Math.sin(rot * Math.PI / 180);
    const dirX = m[0] * c + m[2] * sn, dirY = m[1] * c + m[3] * sn;
    // Height follows the scale perpendicular to the text direction.
    const hScale = Math.abs(det(m)) / (Math.hypot(dirX, dirY) || 1);
    grow(px, py);
    used.add(layer);
    texts.push({ layer, color, x: px, y: py, h: h * hScale, rot: Math.atan2(dirY, dirX) * 180 / Math.PI, s });
  };

  const walk = (entities: RawEntity[], ctx: Ctx) => {
    for (const e of entities) {
      if (num(e, 67) === 1) continue; // paper space
      const { layer, color } = resolve(e, ctx);
      const m = mul(ctx.m, ocs(e));
      switch (e.type) {
        case 'LINE':
          emit([num(e, 10), num(e, 20), num(e, 11), num(e, 21)], ctx.m, layer, color);
          break;
        case 'LWPOLYLINE': {
          const xs = nums(e, 10), ys = nums(e, 20);
          const vs: { x: number; y: number; b: number }[] = [];
          let current: { x: number; y: number; b: number } | null = null;
          let xi = 0, yi = 0;
          for (const [c, v] of e.g) {
            if (c === 10) { current = { x: xs[xi++], y: 0, b: 0 }; vs.push(current); }
            else if (c === 20 && current) current.y = ys[yi++];
            else if (c === 42 && current) current.b = parseFloat(v) || 0;
          }
          emit(bulgePoints(vs, (num(e, 70) & 1) === 1), m, layer, color);
          break;
        }
        case 'POLYLINE': {
          const flags = num(e, 70);
          if (flags & (16 | 64)) break; // polygon / polyface meshes
          const vs = (e.children ?? []).filter(v => v.type === 'VERTEX' && !(num(v, 70) & 16))
            .map(v => ({ x: num(v, 10), y: num(v, 20), b: num(v, 42) }));
          emit(bulgePoints(vs, (flags & 1) === 1), flags & 8 ? ctx.m : m, layer, color);
          break;
        }
        case 'CIRCLE':
          center(m, layer, num(e, 10), num(e, 20));
          emit(arcPoints(num(e, 10), num(e, 20), num(e, 40), 0, Math.PI * 2), m, layer, color);
          break;
        case 'ARC':
          center(m, layer, num(e, 10), num(e, 20));
          emit(arcPoints(num(e, 10), num(e, 20), num(e, 40), num(e, 50) * Math.PI / 180, num(e, 51) * Math.PI / 180), m, layer, color);
          break;
        case 'ELLIPSE': {
          const cx = num(e, 10), cy = num(e, 20), ax = num(e, 11), ay = num(e, 21), ratio = num(e, 40, 1);
          let t0 = num(e, 41, 0), t1 = num(e, 42, Math.PI * 2);
          while (t1 <= t0) t1 += Math.PI * 2;
          const n = Math.max(8, Math.ceil((t1 - t0) / ARC_STEP));
          const pts: number[] = [];
          for (let k = 0; k <= n; k++) {
            const t = t0 + (t1 - t0) * k / n, c = Math.cos(t), s = Math.sin(t);
            pts.push(cx + ax * c - ay * ratio * s, cy + ay * c + ax * ratio * s);
          }
          emit(pts, num(e, 230, 1) < 0 ? mul(ctx.m, [-1, 0, 0, 1, 0, 0]) : ctx.m, layer, color);
          break;
        }
        case 'SPLINE':
          emit(splinePoints(e), ctx.m, layer, color);
          break;
        case 'TEXT':
        case 'ATTRIB': {
          if (e.type === 'ATTRIB' && (num(e, 70) & 1)) break; // invisible attribute
          const aligned = num(e, 72) !== 0 || num(e, 73) !== 0 || num(e, 74) !== 0;
          emitText(m, layer, color, str(e, 1),
            aligned ? num(e, 11) : num(e, 10), aligned ? num(e, 21) : num(e, 20), num(e, 40, 1), num(e, 50));
          break;
        }
        case 'MTEXT': {
          const raw = e.g.filter(p => p[0] === 3).map(p => p[1]).join('') + str(e, 1);
          const dx = num(e, 11, NaN), dy = num(e, 21, NaN);
          const rot = Number.isFinite(dx) && Number.isFinite(dy) ? Math.atan2(dy, dx) * 180 / Math.PI : num(e, 50);
          emitText(ctx.m, layer, color, raw, num(e, 10), num(e, 20), num(e, 40, 1), rot);
          break;
        }
        case 'DIMENSION':
        case 'INSERT': {
          if (ctx.depth >= MAX_DEPTH) break;
          const block = file.blocks.get(str(e, 2));
          if (!block) break;
          if (e.type === 'DIMENSION') {
            walk(block.entities, { m: ctx.m, layer, color, depth: ctx.depth + 1 });
            break;
          }
          const sx = num(e, 41, 1), sy = num(e, 42, 1), rot = num(e, 50);
          const cols = Math.max(1, num(e, 70, 1)), rows = Math.max(1, num(e, 71, 1));
          const dc = num(e, 44), dr = num(e, 45);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const local = mul(mul(mul(translate(num(e, 10), num(e, 20)), rotate(rot)), translate(c * dc, r * dr)),
                mul(scale(sx, sy), translate(-block.base[0], -block.base[1])));
              walk(block.entities, { m: mul(m, local), layer, color, depth: ctx.depth + 1 });
            }
          }
          if (e.children) walk(e.children, { ...ctx });
          break;
        }
        default:
          break; // HATCH, SOLID, 3DFACE, POINT, IMAGE, VIEWPORT…
      }
    }
  };

  walk(file.entities, { m: IDENTITY, layer: '0', color: '#ffffff', depth: 0 });

  const names = new Set<string>([...file.layers.keys()].filter(n => used.has(n)));
  for (const n of used) names.add(n);
  const layers: DxfLayer[] = [...names].map(name => {
    const l = file.layers.get(name);
    return { name, color: layerColor(name), visible: !l || (!l.frozen && !l.off) };
  });

  return {
    unit: file.unit,
    layers,
    polylines,
    texts,
    centers,
    bounds: Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null,
  };
}
