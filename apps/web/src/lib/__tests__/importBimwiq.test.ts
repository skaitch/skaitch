import { describe, it, expect } from 'vitest';
import { importBimwiq } from '@skaitch/core/bim/importBimwiq';
import fixture from './fixtures/bimwiq.json';

describe('partial BIMWIQ import', () => {
  it('imports the supplied house geometry and hierarchy without the outside space', () => {
    const { items, rawIfcBuffer } = importBimwiq(fixture);
    const all = Object.values(items);
    expect(all.filter(i => i.type === 'Storey')).toHaveLength(1);
    const walls = all.filter(i => i.type === 'Wall');
    expect(walls).toHaveLength(40);
    expect(walls[0].geom).toMatchObject({ height: 2.72 });
    expect(walls[0].geom.thickness).toBeCloseTo(0.32);
    const rooms = all.filter(i => i.type === 'Room');
    expect(rooms).toHaveLength(8);
    expect(rooms.filter(r => r.name === 'Chambre')).toHaveLength(3);
    expect(rooms[0].geom.height).toBe(2.5);
    expect(all.filter(i => i.parentId).every(i => items[i.parentId!])).toBe(true);
    expect(rawIfcBuffer).toBeUndefined();
  });

  it('places exterior wall bodies inside the BIMWIQ face so partitions meet them', () => {
    const { items } = importBimwiq(fixture);
    const facade = items.bimwiq_storey_0_wall_7;
    const partition = items.bimwiq_storey_0_wall_10;
    if (facade.type !== 'Wall' || partition.type !== 'Wall') throw new Error('Missing walls');
    const g = facade.geom, p = partition.geom;
    const length = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    const distance = Math.abs((p.x1 - g.x1) * -(g.y2 - g.y1) + (p.y1 - g.y1) * (g.x2 - g.x1)) / length;
    expect(distance).toBeCloseTo(g.thickness / 2);
    // Interior partition axes and room contours are already in world coordinates.
    expect([p.x1, p.y1]).toEqual(fixture.storeys[0].scene.vertices[36]);
  });

  it('imports all 16 openings using inherited dimensions and wall-relative centers', () => {
    const items = importBimwiq(fixture).items;
    const doors = Object.values(items).filter(i => i.type === 'Door');
    const windows = Object.values(items).filter(i => i.type === 'Window');
    expect(doors).toHaveLength(8);
    expect(windows).toHaveLength(8);
    const window = windows[0];
    const wall = items[window.geom.wallId];
    if (wall.type !== 'Wall') throw new Error('Missing host wall');
    const length = Math.hypot(wall.geom.x2 - wall.geom.x1, wall.geom.y2 - wall.geom.y1);
    expect(window.geom.width).toBe(2.4);
    expect(window.geom.height).toBe(2.15);
    expect(window.geom.sillHeight).toBe(0);
    const [a, b] = fixture.storeys[0].scene.walls[1].vertices.map(i => fixture.storeys[0].scene.vertices[i]);
    const rawLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / rawLength, uy = (b[1] - a[1]) / rawLength;
    const distance = 1.0517766951513672 + 1.2;
    expect(wall.geom.x1 + (wall.geom.x2 - wall.geom.x1) * window.geom.t).toBeCloseTo(a[0] + ux * distance + uy * 0.16);
    expect(wall.geom.y1 + (wall.geom.y2 - wall.geom.y1) * window.geom.t).toBeCloseTo(a[1] + uy * distance - ux * 0.16);
    expect(windows[2].geom.sillHeight).toBe(0.7);
    expect(doors.filter(d => d.OperationType === 'NONE')).toHaveLength(1);
    for (const opening of [...doors, ...windows]) {
      expect(items[opening.geom.wallId].type).toBe('Wall');
      expect(opening.geom.t).toBeGreaterThan(0);
      expect(opening.geom.t).toBeLessThan(1);
    }
  });

  it('handles explicit dimensions, zero sill and a reference at the wall end', () => {
    const input = structuredClone(fixture);
    const wall = input.storeys[0].scene.walls[1];
    const opening = wall.openings[0];
    Object.assign(opening, { width: 1, height: 1.5, z: 0, position: 0.2, wall_lock_vertex: wall.vertices[1] });
    const items = importBimwiq(input).items;
    const window = items.bimwiq_storey_0_wall_1_opening_0;
    expect(window).toMatchObject({ type: 'Window', geom: { width: 1, height: 1.5, sillHeight: 0 } });
    const [a, b] = wall.vertices.map(i => input.storeys[0].scene.vertices[i]);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (window.type !== 'Window') throw new Error('Missing window');
    const host = items[window.geom.wallId];
    if (host.type !== 'Wall') throw new Error('Missing host wall');
    expect(host.geom.x1 + (host.geom.x2 - host.geom.x1) * window.geom.t).toBeCloseTo(b[0] - (b[0] - a[0]) / length * 0.7 + (b[1] - a[1]) / length * 0.16);
    expect(host.geom.y1 + (host.geom.y2 - host.geom.y1) * window.geom.t).toBeCloseTo(b[1] - (b[1] - a[1]) / length * 0.7 - (b[0] - a[0]) / length * 0.16);
    opening.position = length;
    expect(() => importBimwiq(input)).toThrow('hors du mur');
  });

  it('rejects unrelated JSON and invalid geometry before replacing any project', () => {
    expect(() => importBimwiq({})).toThrow();
    const invalid = structuredClone(fixture);
    invalid.storeys[0].scene.walls[0].vertices[0] = 9999;
    expect(() => importBimwiq(invalid)).toThrow('Référence de mur');
    const badPoint = structuredClone(fixture);
    badPoint.storeys[0].scene.vertices[0][0] = Infinity;
    expect(() => importBimwiq(badPoint)).toThrow('Coordonnées');
  });
});
