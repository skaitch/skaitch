import type { SurveyRoom } from './surveyFile.js';
import { tr } from './lang.js';

/**
 * Geometric solver of a room (ADR 0009): builds the inner-face polygon from the measured
 * lengths only — locked wall lengths, diagonals and angles — by triangulation. Sketched
 * (unlocked) lengths and the right-angle hypothesis of a drawn rectangle are never used:
 * a room is resolved only by measurements. The drawing only decides on which side of a
 * line each vertex lies, and where the room sits on the plan.
 */

export const DEFAULT_TOLERANCE_M = 0.01;

type Pt = [number, number];

export type SolveResult =
  | { status: 'resolved'; polygon: Pt[]; residual: number }
  | { status: 'underconstrained'; placed: number; hint: string }
  | { status: 'inconsistent'; residual: number; message: string; conflicting: Measure[] };

/** A measurement of the room: a locked wall, a diagonal or an angle. */
export interface Measure { id: string; label: string }

const P = (i: number) => `P${i + 1}`;
const key = (i: number, j: number) => (i < j ? `${i}|${j}` : `${j}|${i}`);
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rotate = ([x, y]: Pt, rad: number): Pt => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)];

const m2 = (v: number) => `${v.toFixed(2).replace('.', ',')} m`;

/** Measured constraints of a room, with what to call them in a message. */
function constraints(room: SurveyRoom) {
  const lengths = new Map<string, number>();
  const measures = new Map<string, Measure>();
  // A deduced length relies on right angles; once an angle is typed at every corner, it is exact.
  const anglesConfirmed = room.polygon.every((_, i) => (room.angles ?? []).some(a => a.vertex === i));
  for (const w of room.walls) if (w.locked || (anglesConfirmed && w.source === 'computed')) {
    lengths.set(key(w.from, w.to), w.length_m);
    measures.set(key(w.from, w.to), { id: w.id, label: tr(`mur ${P(w.from)}–${P(w.to)} (${m2(w.length_m)})`, `wall ${P(w.from)}–${P(w.to)} (${m2(w.length_m)})`) });
  }
  for (const d of room.diagonals ?? []) {
    lengths.set(key(d.from, d.to), d.length_m);
    measures.set(key(d.from, d.to), { id: d.id, label: `diagonale ${P(d.from)}–${P(d.to)} (${m2(d.length_m)})` });
  }
  const angles = new Map<number, number>();
  for (const a of room.angles ?? []) {
    angles.set(a.vertex, (a.deg * Math.PI) / 180);
    measures.set(`a${a.vertex}`, { id: a.id, label: `angle en ${P(a.vertex)} (${a.deg}°)` });
  }
  return { lengths, angles, measures };
}

/**
 * `directions`: plan direction (radians) of walls whose linked face belongs to a room already
 * placed by measurements (ADR 0012). One direction only orients the room; from two on, the
 * angles between them constrain its shape like measured angles.
 */
export function solveRoom(room: SurveyRoom, tolerance = DEFAULT_TOLERANCE_M, directions?: Map<string, number>): SolveResult {
  const n = room.polygon.length;
  const sketch = room.polygon;
  const { lengths, angles, measures } = constraints(room);
  // Direction of each edge i→j, when known: wall from→to, or its reverse.
  const dirs = new Map<string, number>();
  if (directions && directions.size >= 2) for (const w of room.walls) {
    const d = directions.get(w.id);
    if (d === undefined) continue;
    dirs.set(`${w.from}>${w.to}`, d).set(`${w.to}>${w.from}`, d + Math.PI);
    measures.set(`d${w.from}|${w.to}`, { id: w.id, label: tr(`direction du mur ${P(w.from)}–${P(w.to)} (pièce voisine)`, `direction of wall ${P(w.from)}–${P(w.to)} (neighbouring room)`) });
  }
  // Which measurements placed each vertex: a contradiction names them along with the measure that disagrees.
  const basis = new Map<number, string[]>();
  const used = (...keys: string[]) => keys.flatMap(k => [k, ...(k.includes('|') ? k.split('|').flatMap(v => basis.get(Number(v)) ?? []) : [])]);
  const named = (keys: string[]) => [...new Set(keys)].map(k => measures.get(k)!).filter(Boolean);
  const listed = (ms: Measure[]) => ms.map(m => m.label).join(', ');
  const len = (i: number, j: number) => lengths.get(key(i, j));
  const placed = new Map<number, Pt>();

  // Seed: a measured wall, kept where it is drawn, in its known direction if any, else as drawn.
  const seed = room.walls.find(w => w.locked && dirs.has(`${w.from}>${w.to}`)) ?? room.walls.find(w => w.locked);
  if (!seed) return { status: 'underconstrained', placed: 0, hint: tr(`Géométrie non résolue : mesurez un mur (${Math.min(lengths.size + angles.size, 2 * n - 3)} mesures sur ${2 * n - 3} nécessaires).`, `Geometry not resolved: measure a wall (${Math.min(lengths.size + angles.size, 2 * n - 3)} of the ${2 * n - 3} measurements needed).`) };
  const oriented = dirs.has(`${seed.from}>${seed.to}`);
  const dir: Pt = oriented ? [Math.cos(dirs.get(`${seed.from}>${seed.to}`)!), Math.sin(dirs.get(`${seed.from}>${seed.to}`)!)] : sub(sketch[seed.to], sketch[seed.from]);
  const dl = Math.hypot(...dir) || 1;
  placed.set(seed.from, sketch[seed.from]);
  basis.set(seed.to, [key(seed.from, seed.to)]);
  placed.set(seed.to, [sketch[seed.from][0] + (dir[0] / dl) * seed.length_m, sketch[seed.from][1] + (dir[1] / dl) * seed.length_m]);

  const prev = (i: number) => (i - 1 + n) % n, next = (i: number) => (i + 1) % n;
  let progress = true;
  while (progress && placed.size < n) {
    progress = false;
    for (let k = 0; k < n && !progress; k++) {
      if (placed.has(k)) continue;
      // Two measured distances to placed vertices: intersection of two circles.
      const known = [...placed.keys()].filter(i => len(i, k) !== undefined);
      for (let x = 0; x < known.length && !progress; x++) for (let y = x + 1; y < known.length && !progress; y++) {
        const [a, b] = [known[x], known[y]];
        const [pa, pb] = [placed.get(a)!, placed.get(b)!];
        const [ra, rb] = [len(a, k)!, len(b, k)!];
        const d = dist(pa, pb);
        if (d < 1e-9) continue;
        const along = (ra * ra - rb * rb + d * d) / (2 * d);
        const h2 = ra * ra - along * along;
        if (h2 < -(2 * tolerance * Math.max(ra, rb))) {
          // No triangle has these sides: the two distances to P(k) and what fixed P(a)–P(b).
          const conflicting = named(used(key(a, k), key(b, k), ...(basis.get(a) ?? []), ...(basis.get(b) ?? [])));
          return { status: 'inconsistent', residual: Math.abs(Math.sqrt(-h2)), conflicting,
            message: `Mesures incompatibles autour de ${P(k)} : ${listed(conflicting)} ne peuvent pas former un triangle.` };
        }
        const h = Math.sqrt(Math.max(0, h2));
        const u: Pt = [(pb[0] - pa[0]) / d, (pb[1] - pa[1]) / d];
        const base: Pt = [pa[0] + u[0] * along, pa[1] + u[1] * along];
        const c1: Pt = [base[0] - u[1] * h, base[1] + u[0] * h], c2: Pt = [base[0] + u[1] * h, base[1] - u[0] * h];
        // The drawing tells on which side of a–b the vertex lies.
        const side = Math.sign(cross(sub(sketch[b], sketch[a]), sub(sketch[k], sketch[a]))) || 1;
        placed.set(k, Math.sign(cross(sub(pb, pa), sub(c1, pa))) === side ? c1 : c2);
        basis.set(k, used(key(a, k), key(b, k)));
        progress = true;
      }
      if (progress) break;
      // A measured angle at a placed neighbour, its other neighbour placed, and the distance to k.
      for (const v of [prev(k), next(k)]) {
        if (!placed.has(v) || !angles.has(v) || len(v, k) === undefined) continue;
        const other = k === next(v) ? prev(v) : next(v);
        if (!placed.has(other)) continue;
        const toOther = sub(placed.get(other)!, placed.get(v)!);
        const unit: Pt = [toOther[0] / Math.hypot(...toOther), toOther[1] / Math.hypot(...toOther)];
        // Counter-clockwise room: turning v→next counter-clockwise by the interior angle gives v→prev.
        const dirK = k === next(v) ? rotate(unit, -angles.get(v)!) : rotate(unit, angles.get(v)!);
        const pv = placed.get(v)!, l = len(v, k)!;
        placed.set(k, [pv[0] + dirK[0] * l, pv[1] + dirK[1] * l]);
        basis.set(k, [...used(key(v, k), key(v, other)), `a${v}`]);
        progress = true;
        break;
      }
      // A wall of known direction and measured length from a placed neighbour (room oriented by the seed).
      if (!progress && oriented) for (const v of [prev(k), next(k)]) {
        const d = dirs.get(`${v}>${k}`);
        if (!placed.has(v) || d === undefined || len(v, k) === undefined) continue;
        const pv = placed.get(v)!, l = len(v, k)!;
        placed.set(k, [pv[0] + Math.cos(d) * l, pv[1] + Math.sin(d) * l]);
        basis.set(k, [...used(key(v, k)), `d${Math.min(v, k)}|${Math.max(v, k)}`]);
        progress = true;
        break;
      }
    }
  }

  if (placed.size < n) {
    // The next corner to place, next to one already placed; ask first for a wall reaching it
    // (cheaper on site than a diagonal), else a diagonal or an angle.
    const unplaced = [...Array(n).keys()].filter(i => !placed.has(i));
    const k = unplaced.find(i => placed.has(prev(i)) || placed.has(next(i))) ?? unplaced[0];
    const wallFrom = [prev(k), next(k)].find(v => placed.has(v) && len(v, k) === undefined);
    const from = [...placed.keys()].find(i => i !== prev(k) && i !== next(k));
    const ask = wallFrom !== undefined
      ? tr(`mesurez le mur ${P(Math.min(wallFrom, k) === wallFrom && !(wallFrom === n - 1 && k === 0) ? wallFrom : k)}–${P(Math.min(wallFrom, k) === wallFrom && !(wallFrom === n - 1 && k === 0) ? k : wallFrom)}`, `measure wall ${P(Math.min(wallFrom, k) === wallFrom && !(wallFrom === n - 1 && k === 0) ? wallFrom : k)}–${P(Math.min(wallFrom, k) === wallFrom && !(wallFrom === n - 1 && k === 0) ? k : wallFrom)}`)
      : from !== undefined ? tr(`mesurez un angle en ${P(prev(k))} ou ${P(next(k))} ou, à défaut, la diagonale ${P(from)}–${P(k)}`, `measure an angle at ${P(prev(k))} or ${P(next(k))} or, failing that, the diagonal ${P(from)}–${P(k)}`)
      : tr(`mesurez les murs arrivant à ${P(k)}`, `measure the walls meeting at ${P(k)}`);
    // A room of n corners needs 2n − 3 independent measurements (an angle counts as one).
    const have = lengths.size + angles.size;
    const hint = tr(`Géométrie non résolue : ${ask} (${Math.min(have, 2 * n - 3)} mesures sur ${2 * n - 3} nécessaires).`, `Geometry not resolved: ${ask} (${Math.min(have, 2 * n - 3)} of the ${2 * n - 3} measurements needed).`);
    return { status: 'underconstrained', placed: placed.size, hint };
  }

  const polygon = [...Array(n).keys()].map(i => placed.get(i)!);
  // Every measurement, including those not used to build the shape, must agree within tolerance.
  let residual = 0, worst = '', worstKeys: string[] = [];
  for (const [k2, l] of lengths) {
    const [i, j] = k2.split('|').map(Number);
    const r = Math.abs(dist(polygon[i], polygon[j]) - l);
    if (r > residual) {
      residual = r; worstKeys = [k2, ...used(...(basis.get(i) ?? []), ...(basis.get(j) ?? []))];
      worst = tr(`${P(i)}–${P(j)} mesuré ${l.toFixed(3)} m, ${dist(polygon[i], polygon[j]).toFixed(3)} m d'après les autres mesures`, `${P(i)}–${P(j)} measured ${l.toFixed(3)} m, ${dist(polygon[i], polygon[j]).toFixed(3)} m from the other measurements`);
    }
  }
  for (const [v, rad] of angles) {
    const a = sub(polygon[next(v)], polygon[v]), b = sub(polygon[prev(v)], polygon[v]);
    let got = Math.atan2(cross(a, b), a[0] * b[0] + a[1] * b[1]);
    if (got < 0) got += 2 * Math.PI;
    // Angle error expressed as a distance at the shorter adjacent wall.
    const r = Math.abs(got - rad) * Math.min(Math.hypot(...a), Math.hypot(...b));
    if (r > residual) { residual = r; worstKeys = [`a${v}`, ...used(...(basis.get(v) ?? []), ...(basis.get(next(v)) ?? []), ...(basis.get(prev(v)) ?? []))]; worst = tr(`angle en ${P(v)} mesuré ${((rad * 180) / Math.PI).toFixed(1)}°, ${((got * 180) / Math.PI).toFixed(1)}° d'après les autres mesures`, `angle at ${P(v)} measured ${((rad * 180) / Math.PI).toFixed(1)}°, ${((got * 180) / Math.PI).toFixed(1)}° from the other measurements`); }
  }
  for (const [e, rad] of dirs) {
    const [i, j] = e.split('>').map(Number);
    if (i > j && !(i === n - 1 && j === 0)) continue; // each wall once
    const v = sub(polygon[j], polygon[i]);
    const diff = Math.abs(Math.atan2(Math.sin(Math.atan2(v[1], v[0]) - rad), Math.cos(Math.atan2(v[1], v[0]) - rad)));
    const r = diff * Math.hypot(...v);
    if (r > residual) { residual = r; worstKeys = [`d${Math.min(i, j)}|${Math.max(i, j)}`]; worst = tr(`le mur ${P(i)}–${P(j)} ne suit pas la direction de la pièce voisine`, `wall ${P(i)}–${P(j)} does not follow the neighbouring room's direction`); }
  }
  const area = polygon.reduce((s, p, i) => s + cross(p, polygon[next(i)]), 0);
  if (area <= 0) return { status: 'inconsistent', residual, conflicting: named([...lengths.keys()]), message: tr('Les mesures donnent un contour retourné : vérifiez les diagonales.', 'The measurements give a flipped outline: check the diagonals.') };
  if (residual > tolerance) {
    // The disagreeing measure first, then those it contradicts.
    const conflicting = named(worstKeys);
    return { status: 'inconsistent', residual, conflicting,
      message: tr(`Mesures incompatibles : ${worst} (écart ${residual.toFixed(3)} m). En cause : ${listed(conflicting)}. Aucune valeur n'a été modifiée.`, `Incompatible measurements: ${worst} (gap ${residual.toFixed(3)} m). Involved: ${listed(conflicting)}. No value was changed.`) };
  }
  return { status: 'resolved', polygon: polygon.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)] as Pt), residual };
}
