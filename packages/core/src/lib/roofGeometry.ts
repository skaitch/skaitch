// Shared roof geometry: used by the 3D viewer and the IFC exporters so the
// rendered roof and the exported IfcRoof are the same solid.
//
// Model: every edge of the footprint is either an EAVE (a roof plane rises
// from it at its own pitch) or a GABLE (vertical end, no plane). The roof is
// the weighted straight skeleton of the footprint: the outline shrinks inward
// as height increases, each eave edge moving at 1/tan(pitch) and gable edges
// standing still. Ridges, hips and valleys are the traces left by the
// shrinking outline, so any footprint (L, T, U…) gets one ridge per wing.
// The classic roof types are presets of the per-edge settings.

export type RoofType = 'flat' | 'shed' | 'gable' | 'hip' | 'custom';

export interface RoofEdge {
  /** true = gable end (vertical), false = eave (sloped plane) */
  gable: boolean;
  /** Slope in degrees (ignored on gable edges) */
  pitch: number;
}

export interface RoofGeom {
  polygon: [number, number][];
  /** Slab thickness of the roof (m) */
  thickness: number;
  /** Eave height above the storey level (m) */
  elevation: number;
  roofType: RoofType;
  /** Default slope in degrees */
  pitch: number;
  /** Horizontal overhang beyond the footprint (m) */
  overhang: number;
  /** Presets only: rotate the ridge by 90° */
  ridgeSwap?: boolean;
  /** Per-edge settings (edge i runs polygon[i] → polygon[i+1]); used when roofType is 'custom' */
  edges?: RoofEdge[];
  _placementWorld?: [number, number];
}

export const ROOF_TYPES: RoofType[] = ['flat', 'shed', 'gable', 'hip', 'custom'];

export const ROOF_DEFAULTS = { thickness: 0.25, elevation: 2.7, roofType: 'gable' as RoofType, pitch: 30, overhang: 0.3 };

export const roofPredefinedType = (roofType: unknown): string =>
  ({ flat: 'FLAT_ROOF', shed: 'SHED_ROOF', gable: 'GABLE_ROOF', hip: 'HIP_ROOF', custom: 'FREEFORM' } as Record<string, string>)[String(roofType)] ?? 'NOTDEFINED';

type P2 = [number, number];
type P3 = [number, number, number];
/** One planar face: vertices in plan + height of each vertex above the eave */
export interface RoofFace { pts: P2[]; z: number[]; edge?: number }
export interface RoofSolid {
  /** Sloped (or flat) top faces, z = eave-relative height */
  top: RoofFace[];
  /** Vertical closing strips along eaves and gable ends (top edge a→b, outward direction) */
  bands: { a: P3; b: P3; out: P2 }[];
  /** Ridge / hip / valley lines in plan */
  creases: [P2, P2][];
  /** Footprint including overhang */
  outline: { pts: P2[] };
  thickness: number;
  /** Eave elevation relative to storey */
  elevation: number;
  ridgeHeight: number;
  /** true when the skeleton could not be computed and a flat roof was substituted */
  approximate?: boolean;
}

const EPS = 1e-6;

const signedArea = (p: P2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function norm(v: P2): P2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}
function distSeg(p: P2, a: P2, b: P2) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

/** Miter offset of a simple polygon by d (positive = outward). */
export function offsetPolygon(poly: P2[], d: number): P2[] {
  if (!d || poly.length < 3) return poly.map((p) => [p[0], p[1]] as P2);
  const ccw = signedArea(poly) > 0;
  const n = poly.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const e1 = norm([p1[0] - p0[0], p1[1] - p0[1]]);
    const e2 = norm([p2[0] - p1[0], p2[1] - p1[1]]);
    const n1: P2 = ccw ? [e1[1], -e1[0]] : [-e1[1], e1[0]];
    const n2: P2 = ccw ? [e2[1], -e2[0]] : [-e2[1], e2[0]];
    const b = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const cos = b[0] * n1[0] + b[1] * n1[1];
    const k = d / Math.max(cos, 0.25); // clamp sharp spikes
    out.push([p1[0] + b[0] * k, p1[1] + b[1] * k]);
  }
  return out;
}

// ── Weighted straight skeleton ───────────────────────────────────────────────

interface SkEdge { id: number; n: P2; d: P2; c: number; w: number; gable: boolean; a: P2 }
interface SkNode { e: SkEdge; fix: P2; s?: { t: number; a: P2; b: P2 } }
interface SkResult { top: RoofFace[]; bands: RoofSolid['bands']; creases: [P2, P2][] }

/** poly must be counter-clockwise; specs[i] describes edge poly[i] → poly[i+1]. */
function skeleton(poly: P2[], specs: RoofEdge[]): SkResult {
  const top: RoofFace[] = [], bands: RoofSolid['bands'] = [], creases: [P2, P2][] = [];
  const creaseKeys = new Set<string>();
  const key = (p: P2) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const addCrease = (a: P2, b: P2) => {
    if (dist(a, b) < EPS) return;
    const k1 = key(a) + '|' + key(b), k2 = key(b) + '|' + key(a);
    if (creaseKeys.has(k1) || creaseKeys.has(k2)) return;
    creaseKeys.add(k1);
    creases.push([a, b]);
  };
  const addBand = (a: P2, za: number, b: P2, zb: number, out: P2) => {
    if (dist(a, b) > EPS) bands.push({ a: [a[0], a[1], za], b: [b[0], b[1], zb], out });
  };

  const n = poly.length;
  let loops: SkNode[][] = [poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const d = norm([q[0] - p[0], q[1] - p[1]]);
    const nn: P2 = [-d[1], d[0]]; // inward for CCW
    const sp = specs[i];
    const pitch = Math.max(1, Math.min(80, Number(sp.pitch) || ROOF_DEFAULTS.pitch));
    const e: SkEdge = { id: i, n: nn, d, c: nn[0] * p[0] + nn[1] * p[1], w: sp.gable ? 0 : 1 / Math.tan((pitch * Math.PI) / 180), gable: sp.gable, a: p };
    return { e, fix: p } as SkNode;
  })];

  const pos = (loop: SkNode[], t: number): P2[] => loop.map((node, k) => {
    const p = loop[(k - 1 + loop.length) % loop.length].e, e = node.e;
    const det = p.n[0] * e.n[1] - p.n[1] * e.n[0];
    if (Math.abs(det) < 1e-9) return node.fix;
    const r1 = p.c + p.w * t, r2 = e.c + e.w * t;
    return [(r1 * e.n[1] - r2 * p.n[1]) / det, (p.n[0] * r2 - e.n[0] * r1) / det] as P2;
  });

  const flush = (node: SkNode, t: number, a: P2, b: P2) => {
    const s = node.s;
    node.s = undefined;
    if (!s || node.e.gable) return;
    const raw: [P2, number][] = [[s.a, s.t], [s.b, s.t], [b, t], [a, t]];
    const pts = raw.filter((p, i) => dist(p[0], raw[(i + 1) % raw.length][0]) > EPS || Math.abs(p[1] - raw[(i + 1) % raw.length][1]) > EPS);
    if (pts.length < 3 || Math.abs(signedArea(pts.map((p) => p[0]))) < 1e-9) return;
    top.push({ pts: pts.map((p) => p[0]), z: pts.map((p) => p[1]), edge: node.e.id });
  };

  // A loop that has shrunk to a line: ridges where two eaves meet, a closing
  // strip where an eave runs into a gable end.
  const closeDead = (loop: SkNode[], P: P2[], t: number) => {
    loop.forEach((node, k) => {
      if (node.e.gable) return;
      const a = P[k], b = P[(k + 1) % loop.length];
      if (dist(a, b) < EPS) return;
      const m: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const facing = loop.some((o, q) => q !== k && !o.e.gable && distSeg(m, P[q], P[(q + 1) % loop.length]) < 1e-5);
      if (facing) addCrease(a, b); else addBand(a, t, b, t, node.e.n);
    });
  };

  // Fix the topology of a loop at time t: drop collapsed edges, split where it pinches.
  const settle = (loop: SkNode[], t: number): SkNode[][] => {
    for (let guard = 0; guard < 1000; guard++) {
      const P = pos(loop, t);
      const m = loop.length;
      let k = -1;
      for (let i = 0; i < m && k < 0; i++) {
        const prev = loop[(i - 1 + m) % m].e, e = loop[i].e;
        // collapsed edge, or two pieces of the same roof plane meeting again
        if (m > 1 && dist(P[i], P[(i + 1) % m]) < EPS) k = i;
        else if (m > 2 && prev !== e && Math.abs(prev.w - e.w) < 1e-12 && prev.n[0] * e.n[0] + prev.n[1] * e.n[1] > 1 - 1e-9
          && Math.abs(prev.c - e.c) < EPS) k = i;
      }
      if (k < 0) break;
      const pt = P[k];
      loop.splice(k, 1);
      if (loop.length) loop[k % loop.length].fix = pt;
      if (loop.length < 2) return [];
    }
    const P = pos(loop, t);
    const m = loop.length;
    if (m < 3 || Math.abs(signedArea(P)) < 1e-7) { closeDead(loop, P, t); return []; }
    const range = (from: number, to: number) => { // nodes from..to inclusive, cyclic
      const out: SkNode[] = [];
      for (let i = from; ; i = (i + 1) % m) { out.push(loop[i]); if (i === to) break; }
      return out;
    };
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        if (j === i || j === (i - 1 + m) % m) continue;
        const j1 = (j + 1) % m;
        if (j1 === i) continue;
        if (distSeg(P[i], P[j], P[j1]) > EPS) continue;
        let A: SkNode[], B: SkNode[];
        if (dist(P[i], P[j]) < EPS) {
          A = range(i, (j - 1 + m) % m); B = range(j, (i - 1 + m) % m);
        } else if (dist(P[i], P[j1]) < EPS) {
          continue; // found again as a vertex–vertex pinch with j1
        } else {
          A = range(i, j);
          B = [{ e: loop[j].e, fix: P[i] }, ...(j1 === i ? [] : range(j1, (i - 1 + m) % m))];
        }
        A[0].fix = P[i]; B[0].fix = P[i];
        return [...settle(A, t), ...settle(B, t)];
      }
    }
    return [loop];
  };

  const nextEvent = (loop: SkNode[], t: number): number => {
    const P0 = pos(loop, t), P1 = pos(loop, t + 1), m = loop.length;
    let best = Infinity;
    const lerp = (a: P2, b: P2, u: number): P2 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m, d = loop[k].e.d;
      const l0 = (P0[k1][0] - P0[k][0]) * d[0] + (P0[k1][1] - P0[k][1]) * d[1];
      const l1 = (P1[k1][0] - P1[k][0]) * d[0] + (P1[k1][1] - P1[k][1]) * d[1];
      if (l1 < l0 - 1e-12) { const u = l0 / (l0 - l1); if (u > 1e-9) best = Math.min(best, u); }
    }
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      if (j === i || j1 === i) continue;
      const e = loop[j].e;
      const f0 = e.n[0] * P0[i][0] + e.n[1] * P0[i][1] - (e.c + e.w * t);
      const f1 = e.n[0] * P1[i][0] + e.n[1] * P1[i][1] - (e.c + e.w * (t + 1));
      if (f0 < EPS || f1 >= f0) continue;
      const u = f0 / (f0 - f1);
      if (u < 1e-9 || u >= best) continue;
      const V = lerp(P0[i], P1[i], u), A = lerp(P0[j], P1[j], u), B = lerp(P0[j1], P1[j1], u);
      const s = (V[0] - A[0]) * e.d[0] + (V[1] - A[1]) * e.d[1];
      const len = (B[0] - A[0]) * e.d[0] + (B[1] - A[1]) * e.d[1];
      if (s > -EPS && s < len + EPS) best = u;
    }
    return t + best;
  };

  // Eave strips at t = 0
  {
    const P = pos(loops[0], 0);
    loops[0].forEach((node, k) => {
      const a = P[k], b = P[(k + 1) % n];
      node.s = { t: 0, a, b };
      if (!node.e.gable) addBand(a, 0, b, 0, [-node.e.n[0], -node.e.n[1]]);
    });
  }

  let t = 0;
  for (let iter = 0; iter < 2000 && loops.length; iter++) {
    let tNext = Infinity;
    for (const loop of loops) tNext = Math.min(tNext, nextEvent(loop, t));
    if (!Number.isFinite(tNext)) break;
    const nextLoops: SkNode[][] = [];
    for (const loop of loops) {
      const m = loop.length;
      const P0 = pos(loop, t), P1 = pos(loop, tNext);
      const snap = new Map<SkNode, { prev: SkNode; next: SkNode; a: P2; b: P2 }>();
      loop.forEach((node, k) => {
        const prev = loop[(k - 1 + m) % m];
        snap.set(node, { prev, next: loop[(k + 1) % m], a: P1[k], b: P1[(k + 1) % m] });
        // Trace of the vertex between prev.e and node.e
        if (dist(P0[k], P1[k]) < EPS) return;
        if (!prev.e.gable && !node.e.gable) addCrease(P0[k], P1[k]);
        else if (prev.e.gable !== node.e.gable) {
          const g = prev.e.gable ? prev.e : node.e;
          addBand(P0[k], t, P1[k], tNext, [-g.n[0], -g.n[1]]);
        }
      });
      const result = settle(loop.slice(), tNext);
      const alive = new Map<SkNode, { prev: SkNode; next: SkNode }>();
      for (const r of result) r.forEach((node, k) => alive.set(node, { prev: r[(k - 1 + r.length) % r.length], next: r[(k + 1) % r.length] }));
      for (const node of loop) {
        const was = snap.get(node)!, now = alive.get(node);
        if (!now || now.prev !== was.prev || now.next !== was.next) flush(node, tNext, was.a, was.b);
      }
      for (const r of result) {
        const P = pos(r, tNext);
        r.forEach((node, k) => { if (!node.s) node.s = { t: tNext, a: P[k], b: P[(k + 1) % r.length] }; });
        nextLoops.push(r);
      }
    }
    loops = nextLoops;
    t = tNext;
  }

  // Whatever is left can't shrink any further (only gable ends around it): flat cap.
  for (const loop of loops) {
    const P = pos(loop, t), m = loop.length;
    loop.forEach((node, k) => {
      flush(node, t, P[k], P[(k + 1) % m]);
      addBand(P[k], t, P[(k + 1) % m], t, [-node.e.n[0], -node.e.n[1]]);
    });
    if (Math.abs(signedArea(P)) > 1e-7) top.push({ pts: P, z: P.map(() => t) });
  }
  return { top, bands, creases };
}

// ── Edge settings ────────────────────────────────────────────────────────────

/** Drop vertices sitting on a straight line; the merged edge keeps the first edge's settings. */
function mergeCollinear(poly: P2[], specs: RoofEdge[]): { poly: P2[]; specs: RoofEdge[] } {
  const outP: P2[] = [], outS: RoofEdge[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const d1 = norm([p1[0] - p0[0], p1[1] - p0[1]]), d2 = norm([p2[0] - p1[0], p2[1] - p1[1]]);
    if (dist(p0, p1) < EPS) continue;
    if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-7 && d1[0] * d2[0] + d1[1] * d2[1] > 0) continue;
    outP.push(p1); outS.push(specs[i]);
  }
  return { poly: outP, specs: outS };
}

/** Ridge direction u / cross direction v from the longest edge and the bounding box. */
function frame(poly: P2[], swap?: boolean) {
  let best = 0, dir: P2 = [1, 0];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const l = dist(a, b);
    if (l > best + 1e-9) { best = l; dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }
  }
  let u: P2 = dir, v: P2 = [-dir[1], dir[0]];
  const proj = (d: P2) => {
    let mn = Infinity, mx = -Infinity;
    for (const p of poly) { const t = p[0] * d[0] + p[1] * d[1]; mn = Math.min(mn, t); mx = Math.max(mx, t); }
    return [mn, mx] as const;
  };
  let [umin, umax] = proj(u), [vmin, vmax] = proj(v);
  if ((umax - umin < vmax - vmin) !== !!swap) {
    [u, v] = [v, u];
    [umin, umax, vmin, vmax] = [vmin, vmax, umin, umax];
  }
  return { u, v, vmin, vmax };
}

/** Per-edge settings for a counter-clockwise polygon. */
function specsFor(g: RoofGeom, poly: P2[], custom: RoofEdge[] | null): RoofEdge[] {
  const n = poly.length;
  const pitch = Number(g.pitch) || ROOF_DEFAULTS.pitch;
  const all = (gable: boolean): RoofEdge[] => poly.map(() => ({ gable, pitch }));
  const type = g.roofType || 'gable';
  if (type === 'flat') return all(true);
  if (type === 'custom') return custom ?? all(false);
  if (type === 'hip') return all(false);
  const along = (i: number, u: P2) => {
    const a = poly[i], b = poly[(i + 1) % n], d = norm([b[0] - a[0], b[1] - a[1]]);
    return Math.abs(d[0] * u[0] + d[1] * u[1]) > 0.7071;
  };
  if (type === 'shed') {
    const { u, v, vmin, vmax } = frame(poly, g.ridgeSwap);
    const specs = poly.map((a, i) => {
      const b = poly[(i + 1) % n];
      const mid = ((a[0] + b[0]) * v[0] + (a[1] + b[1]) * v[1]) / 2;
      return { gable: !(along(i, u) && mid < (vmin + vmax) / 2), pitch };
    });
    return specs.some((s) => !s.gable) ? specs : all(false);
  }
  // gable
  if (g.ridgeSwap) {
    const { u } = frame(poly, true);
    const specs = poly.map((_, i) => ({ gable: !along(i, u), pitch }));
    return specs.some((s) => !s.gable) ? specs : all(false);
  }
  // Hip roof first; every end whose hip face is a plain triangle becomes a gable.
  const merged = mergeCollinear(poly, all(false).map((s, i) => ({ ...s, pitch: i }))); // pitch carries the index
  const idx = merged.specs.map((s) => s.pitch);
  const sk = skeleton(merged.poly, merged.poly.map(() => ({ gable: false, pitch })));
  const faces = new Map<number, RoofFace[]>();
  for (const f of sk.top) if (f.edge !== undefined) faces.set(f.edge, [...(faces.get(f.edge) ?? []), f]);
  const specs = all(false);
  let eaves = n;
  faces.forEach((fs, e) => {
    if (fs.length === 1 && fs[0].pts.length === 3 && eaves > 2) { specs[idx[e]].gable = true; eaves--; }
  });
  // collinear pieces follow the edge they were merged into
  for (let i = 0; i < n; i++) if (!idx.includes(i)) {
    let j = i; while (!idx.includes(j)) j = (j - 1 + n) % n;
    specs[i] = { ...specs[j] };
  }
  return specs;
}

function prepare(geom: Partial<RoofGeom> & { polygon: P2[] }) {
  const input = geom.polygon || [];
  if (input.some(p => !Number.isFinite(p?.[0]) || !Number.isFinite(p?.[1]))) return null;
  // Keep outgoing edge settings when discarding zero-length edges.
  const indices = input.map((_, i) => i).filter(i => dist(input[i], input[(i + 1) % input.length]) > 1e-8);
  const raw = indices.map(i => input[i]);
  if (raw.length < 3 || Math.abs(signedArea(raw)) < 1e-6) return null;
  const g = { ...ROOF_DEFAULTS, ...geom, edges: geom.edges?.length === input.length ? indices.map(i => geom.edges![i]) : geom.edges } as RoofGeom;
  const n = raw.length;
  const reversed = signedArea(raw) < 0;
  // index of the original edge behind edge k of the counter-clockwise polygon
  const orig = (k: number) => (reversed ? (2 * n - 2 - k) % n : k);
  const ccw = reversed ? raw.slice().reverse() : raw;
  const valid = Array.isArray(g.edges) && g.edges.length === n;
  const custom = valid
    ? ccw.map((_, k) => ({ gable: !!g.edges![orig(k)]?.gable, pitch: Number(g.edges![orig(k)]?.pitch) || Number(g.pitch) || ROOF_DEFAULTS.pitch }))
    : null;
  const specs = specsFor(g, ccw, custom);
  return { g, ccw, specs, orig, n };
}

/** Effective settings of every footprint edge (edge i runs polygon[i] → polygon[i+1]). */
export function roofEdges(geom: Partial<RoofGeom> & { polygon: P2[] }): RoofEdge[] {
  const p = prepare(geom);
  if (!p) return [];
  const out: RoofEdge[] = new Array(p.n);
  p.specs.forEach((s, k) => { out[p.orig(k)] = { gable: s.gable, pitch: s.pitch }; });
  return out;
}

/** Build the roof solid in plan coordinates. Returns null for invalid input. */
export function buildRoof(geom: Partial<RoofGeom> & { polygon: P2[] }): RoofSolid | null {
  const p = prepare(geom);
  if (!p) return null;
  const { g } = p;
  const outline = offsetPolygon(p.ccw, Math.max(0, Number(g.overhang) || 0));
  const area = Math.abs(signedArea(outline));
  const merged = mergeCollinear(outline, p.specs);
  let sk: SkResult | null = null;
  if (merged.poly.length >= 3) {
    try {
      sk = skeleton(merged.poly, merged.specs);
      const covered = sk.top.reduce((s, f) => s + Math.abs(signedArea(f.pts)), 0);
      if (!(Math.abs(covered - area) < 0.01 * area + 1e-6)) sk = null;
    } catch { sk = null; }
  }
  const approximate = !sk;
  if (!sk) sk = skeleton(outline, outline.map(() => ({ gable: true, pitch: 0 })));
  let ridge = 0;
  for (const f of sk.top) for (const z of f.z) ridge = Math.max(ridge, z);
  return {
    ...sk,
    outline: { pts: outline },
    thickness: Math.max(0.01, Number(g.thickness) || ROOF_DEFAULTS.thickness),
    elevation: Number.isFinite(Number(g.elevation)) ? Number(g.elevation) : ROOF_DEFAULTS.elevation,
    ridgeHeight: ridge,
    ...(approximate ? { approximate } : {}),
  };
}

const newell = (f: P3[]): P3 => {
  const n: P3 = [0, 0, 0];
  for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
};

/**
 * Closed polyhedron of the roof: list of polygonal faces with 3D points
 * (plan x, plan y, z above storey level), oriented outward.
 */
export function roofFaces(solid: RoofSolid): P3[][] {
  const { top, bands, thickness: t, elevation: e } = solid;
  const faces: P3[][] = [];
  for (const f of top) {
    let up = f.pts.map((p, i) => [p[0], p[1], e + f.z[i]] as P3);
    if (newell(up)[2] < 0) up = up.reverse();
    faces.push(up);
    faces.push(up.map((p) => [p[0], p[1], p[2] - t] as P3).reverse());
  }
  for (const b of bands) {
    let q: P3[] = [
      [b.a[0], b.a[1], e + b.a[2] - t], [b.b[0], b.b[1], e + b.b[2] - t],
      [b.b[0], b.b[1], e + b.b[2]], [b.a[0], b.a[1], e + b.a[2]],
    ];
    const nn = newell(q);
    if (nn[0] * b.out[0] + nn[1] * b.out[1] < 0) q = q.reverse();
    faces.push(q);
  }
  return faces;
}

/** Ridge / hip / valley lines in plan, for 2D display. */
export function roofCreases(solid: RoofSolid): [P2, P2][] {
  return solid.creases;
}

/** Height of the top surface above the eave at a plan point, or null outside the roof. */
export function roofHeightAt(solid: RoofSolid, p: P2): number | null {
  for (const f of solid.top) {
    let inside = false;
    for (let i = 0, j = f.pts.length - 1; i < f.pts.length; j = i++) {
      const [xi, yi] = f.pts[i], [xj, yj] = f.pts[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    // Wall endpoints and ridges often lie exactly on a face boundary.
    const onEdge = f.pts.some((a, i) => {
      const b = f.pts[(i + 1) % f.pts.length];
      return distSeg(p, a, b) < 1e-7;
    });
    if (!inside && !onEdge) continue;
    // plane through the face
    const P = f.pts.map((q, i) => [q[0], q[1], f.z[i]] as P3);
    const nn = newell(P);
    if (Math.abs(nn[2]) < 1e-12) continue;
    return P[0][2] - (nn[0] * (p[0] - P[0][0]) + nn[1] * (p[1] - P[0][1])) / nn[2];
  }
  return null;
}

/** Fill missing roof fields with defaults. */
export function normalizeRoofGeom(g: any): RoofGeom {
  const polygon = g?.polygon || [];
  const edges = Array.isArray(g?.edges) && g.edges.length === polygon.length
    ? g.edges.map((e: any) => ({ gable: !!e?.gable, pitch: Number(e?.pitch ?? g?.pitch ?? ROOF_DEFAULTS.pitch) }))
    : undefined;
  return {
    ...g,
    polygon,
    thickness: Number(g?.thickness ?? ROOF_DEFAULTS.thickness),
    elevation: Number(g?.elevation ?? ROOF_DEFAULTS.elevation),
    roofType: edges && !g?.roofType ? 'custom' : ROOF_TYPES.includes(g?.roofType) ? g.roofType : ROOF_DEFAULTS.roofType,
    pitch: Number(g?.pitch ?? ROOF_DEFAULTS.pitch),
    overhang: Number(g?.overhang ?? ROOF_DEFAULTS.overhang),
    ...(edges ? { edges } : {}),
  };
}
