import type { ItemsMap, IfcEntityBase, WallGeom } from '../types/ifc.js';
import { guid } from '../data/starter.js';
import type { ImportResult } from '../types/bim.js';

const record = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Structure BIMWIQ invalide');
  return v as Record<string, any>;
};
const list = (v: unknown): any[] => {
  if (!Array.isArray(v)) throw new Error('Liste BIMWIQ invalide');
  return v;
};
const point = (v: unknown): [number, number] => {
  const p = list(v);
  if (p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error('Coordonnées BIMWIQ invalides');
  return [p[0], p[1]];
};
const positive = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

/** Partial BIMWIQ import: storeys, walls, openings and interior spaces, in metres. */
export function importBimwiq(data: unknown): ImportResult {
  const source = record(data);
  const storeys = list(source.storeys);
  const types = new Map(list(source.element_types).map(t => [record(t).ID, record(t)]));
  if (!storeys.length || typeof source.save_version !== 'string') throw new Error('Ce JSON n’est pas un projet BIMWIQ reconnu');
  const items: ItemsMap = {};
  const base = (id: string, type: string, ifcType: string, name: string, parentId: string | null): IfcEntityBase => {
    if (typeof name !== 'string') throw new Error('Nom BIMWIQ invalide');
    if (items[id]) throw new Error('Identifiant BIMWIQ dupliqué');
    return { id, type, ifcType, name, Name: name, GlobalId: guid(id), parentId };
  };
  items.bimwiq_project = {
    ...base('bimwiq_project', 'Project', 'IfcProject', source.name || 'BIMWIQ', null),
    type: 'Project', ifcType: 'IfcProject', longName: '', description: 'Import partiel BIMWIQ', phase: '',
    northAngle: 0, units: { length: 'm', area: 'm²', volume: 'm³' },
  };
  items.bimwiq_building = {
    ...base('bimwiq_building', 'Building', 'IfcBuilding', 'Bâtiment', 'bimwiq_project'),
    type: 'Building', ifcType: 'IfcBuilding', address: source.building_data?.address || '', grossArea: 0,
  };
  let elevation = 0;
  // shortcut: successive storey heights define elevation; verify BIMWIQ vertical offsets before broader support.
  for (const [index, raw] of storeys.entries()) {
    const storey = record(raw), scene = record(storey.scene);
    const id = `bimwiq_storey_${index}`;
    const height = positive(storey.slab_height, 2.7);
    items[id] = {
      ...base(id, 'Storey', 'IfcBuildingStorey', storey.name || `Niveau ${storey.storey_index ?? index}`, 'bimwiq_building'),
      type: 'Storey', ifcType: 'IfcBuildingStorey', geom: { level: storey.storey_index ?? index, elevation, thickness: 0.2 }, grossArea: 0,
    };
    const vertices = list(scene.vertices).map(point);
    const sourceWalls = list(scene.walls).map(record);
    const wallGeometry: WallGeom[] = sourceWalls.map(wall => {
      const ends = list(wall.vertices);
      if (ends.length !== 2 || ends.some(i => !Number.isInteger(i) || !vertices[i])) throw new Error('Référence de mur BIMWIQ invalide');
      const [a, b] = ends.map(i => vertices[i]);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-6) throw new Error('Mur BIMWIQ de longueur nulle');
      const def = types.get(wall.wall_type);
      const thickness = positive(def?.layers?.reduce((sum: number, layer: any) => sum + positive(layer.thickness, 0), 0), 0.2);
      if (![undefined, 0, 1].includes(wall.axis)) throw new Error('Axe de mur BIMWIQ non pris en charge');
      // BIMWIQ axis=1 is the exterior/right-face reference in this file; skAItch uses centre lines.
      const offset = -(wall.axis ?? 0) * thickness / 2;
      const ox = -(b[1] - a[1]) / length * offset, oy = (b[0] - a[0]) / length * offset;
      return { x1: a[0] + ox, y1: a[1] + oy, x2: b[0] + ox, y2: b[1] + oy, thickness, height };
    });
    // Intersect offset axes at source corners, including duplicate vertex indices.
    const axes = wallGeometry.map(g => ({ ...g }));
    for (const [wi, wall] of sourceWalls.entries()) {
      const g = axes[wi], dx = g.x2 - g.x1, dy = g.y2 - g.y1;
      for (const end of [0, 1]) {
        const original = vertices[wall.vertices[end]];
        for (const [oi, other] of sourceWalls.entries()) {
          if (oi === wi || !other.vertices.some((vi: number) => Math.hypot(vertices[vi][0] - original[0], vertices[vi][1] - original[1]) < 1e-6)) continue;
          const h = axes[oi], vx = h.x2 - h.x1, vy = h.y2 - h.y1;
          const cross = dx * vy - dy * vx;
          if (Math.abs(cross) < 1e-6) continue;
          const t = ((h.x1 - g.x1) * vy - (h.y1 - g.y1) * vx) / cross;
          const x = g.x1 + t * dx, y = g.y1 + t * dy;
          if (Math.hypot(x - original[0], y - original[1]) > 2 * Math.max(g.thickness, h.thickness)) continue;
          if (end === 0) Object.assign(wallGeometry[wi], { x1: x, y1: y });
          else Object.assign(wallGeometry[wi], { x2: x, y2: y });
          break;
        }
      }
    }
    for (const [wi, rawWall] of sourceWalls.entries()) {
      const wall = record(rawWall);
      const ends = list(wall.vertices);
      const [a, b] = ends.map(i => vertices[i]);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const def = types.get(wall.wall_type);
      const { thickness } = wallGeometry[wi];
      const wallId = `${id}_wall_${wi}`;
      items[wallId] = {
        ...base(wallId, 'Wall', 'IfcWall', def?.name || `Mur ${wi + 1}`, id), type: 'Wall', ifcType: 'IfcWall',
        IsExternal: def?.category === 'facade',
        geom: wallGeometry[wi],
      };
      for (const [oi, rawOpening] of list(wall.openings ?? []).entries()) {
        const opening = record(rawOpening);
        const openingType = types.get(opening.opening_type);
        if (!openingType || !['door', 'window'].includes(openingType.category)) throw new Error('Type d’ouverture BIMWIQ non pris en charge');
        const width = positive(opening.width, openingType.width);
        const openingHeight = positive(opening.height, openingType.height);
        const sill = opening.z === -1 || opening.z == null ? openingType.z : opening.z;
        if (![width, openingHeight, sill, opening.position].every(Number.isFinite) || width <= 0 || openingHeight <= 0 || sill < 0) throw new Error('Dimensions d’ouverture BIMWIQ invalides');
        const fromEnd = opening.wall_lock_vertex === ends[1];
        if (!ends.includes(opening.wall_lock_vertex) || opening.opening_position !== 1) throw new Error('Position d’ouverture BIMWIQ non prise en charge');
        // shortcut: position is the near jamb distance from wall_lock_vertex; other placement modes require BIMWIQ documentation.
        const distance = opening.position + width / 2;
        const sourceT = fromEnd ? 1 - distance / length : distance / length;
        const g = wallGeometry[wi];
        const vx = g.x2 - g.x1, vy = g.y2 - g.y1;
        const axisOffset = -(wall.axis ?? 0) * thickness / 2;
        const px = a[0] + (b[0] - a[0]) * sourceT - (b[1] - a[1]) / length * axisOffset;
        const py = a[1] + (b[1] - a[1]) * sourceT + (b[0] - a[0]) / length * axisOffset;
        const t = ((px - g.x1) * vx + (py - g.y1) * vy) / (vx * vx + vy * vy);
        if (opening.position < -1e-6 || opening.position + width > length + 1e-4) throw new Error('Ouverture BIMWIQ hors du mur');
        const openingId = `${wallId}_opening_${oi}`;
        const isDoor = openingType.category === 'door';
        const swing = opening.opening_start !== fromEnd ? 'left' : 'right';
        const side = (opening.opening_inside ? 1 : -1) * (fromEnd ? -1 : 1);
        const name = openingType.name || (isDoor ? (openingType.opening === 'none' ? 'Passage' : 'Porte') : 'Fenêtre');
        const geom = { wallId, t, width, height: openingHeight, swing, side };
        if (isDoor) {
          items[openingId] = {
            ...base(openingId, 'Door', 'IfcDoor', name, id), type: 'Door', ifcType: 'IfcDoor',
            PredefinedType: 'DOOR', OperationType: openingType.opening === 'none' ? 'NONE' : openingType.opening === 'sliding' ? 'SLIDING' : swing === 'left' ? 'SINGLE_SWING_LEFT' : 'SINGLE_SWING_RIGHT',
            OverallWidth: width, OverallHeight: openingHeight, Material: openingType.frame || '', material: openingType.frame || '', FireRating: '', fireRating: '',
            geom: { ...geom, swing },
          };
        } else {
          items[openingId] = {
            ...base(openingId, 'Window', 'IfcWindow', name, id), type: 'Window', ifcType: 'IfcWindow',
            OverallWidth: width, OverallHeight: openingHeight, Material: openingType.frame || '',
            OperationType: openingType.opening === 'sliding' ? 'SLIDINGHORIZONTAL' : openingType.panels === 2 ? 'DOUBLE_PANEL_VERTICAL' : 'SINGLE_PANEL',
            geom: { ...geom, swing, sillHeight: sill },
          };
        }
      }
    }
    for (const [ri, rawRoom] of list(scene.spaces).entries()) {
      const room = record(rawRoom);
      if (room.outside) continue;
      const polygon = list(record(room.inner_polygon).vertices).map(point);
      if (polygon.length < 3) throw new Error('Contour de pièce BIMWIQ invalide');
      const def = types.get(room.space_type);
      const roomId = `${id}_room_${ri}`;
      items[roomId] = {
        ...base(roomId, 'Room', 'IfcSpace', room.name || def?.space_default_name || def?.name || `Pièce ${ri + 1}`, id),
        type: 'Room', ifcType: 'IfcSpace', geom: { polygon, height: positive(room.ceiling_height, height) },
        function: def?.space_usage || '', occupancy: 0,
      };
    }
    elevation += height;
  }
  return { items, rawStructure: source };
}
