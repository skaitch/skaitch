import type { ItemsMap, IfcEntity, IfcWallEntity, IfcSpaceEntity, IfcDoorEntity, IfcWindowEntity } from '../types/ifc.js';

// ── Helper to trigger native file downloads in browser ───────────────────────
export function exportToBimJSON(items: ItemsMap, projectId: string, projectName: string) {
  // Clone items to avoid mutating live application state
  const cleanedItems = JSON.parse(JSON.stringify(items));
  for (const key in cleanedItems) {
    const item = cleanedItems[key];
    if (item && item.type === 'Storey' && item.geom) {
      delete item.geom.plan;
    }
  }

  const data = {
    generator: "SkAItch",
    format: "BIMJSON",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    project: {
      id: projectId,
      name: projectName,
    },
    items: cleanedItems
  };
  const jsonStr = JSON.stringify(data, null, 2);
  return jsonStr;
}

// ── 2. Export as DXF (.dxf) ───────────────────────────────────────────────────
export function exportToDXF(items: ItemsMap, projectName: string): string {
  const lines: string[] = [];

  // DXF Header
  lines.push("0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "0", "ENDSEC");

  // DXF Tables (Layers Definition)
  lines.push("0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "7");

  const writeLayer = (name: string, color: number) => {
    lines.push("0", "LAYER", "2", name, "70", "0", "62", String(color), "61", "0");
  };

  writeLayer("WALLS", 7);       // White / Black
  writeLayer("DOORS", 1);       // Red
  writeLayer("WINDOWS", 3);     // Green
  writeLayer("SPACES", 4);      // Cyan
  writeLayer("TECHNICAL", 5);   // Blue
  writeLayer("DIMENSIONS", 2);  // Yellow
  writeLayer("TEXT", 6);        // Magenta

  lines.push("0", "ENDTAB", "0", "ENDSEC");

  // DXF Entities
  lines.push("0", "SECTION", "2", "ENTITIES");

  const vals = Object.values(items);

  // A. Walls (as double-line outlines & centerlines)
  const walls = vals.filter(i => i.type === 'Wall') as IfcWallEntity[];
  for (const w of walls) {
    const { x1, y1, x2, y2, thickness } = w.geom;
    const name = w.name || w.Name || 'Wall';

    // Wall Centerline
    lines.push(
      "0", "LINE", "8", "WALLS",
      "10", x1.toFixed(3), "20", y1.toFixed(3), "30", "0.0",
      "11", x2.toFixed(3), "21", y2.toFixed(3), "31", "0.0"
    );

    // Draw Wall Boundary lines if thickness is available
    if (thickness > 0) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const offset = thickness / 2;

      const ox1 = x1 + nx * offset;
      const oy1 = y1 + ny * offset;
      const ox2 = x2 + nx * offset;
      const oy2 = y2 + ny * offset;

      const px1 = x1 - nx * offset;
      const py1 = y1 - ny * offset;
      const px2 = x2 - nx * offset;
      const py2 = y2 - ny * offset;

      lines.push(
        "0", "LINE", "8", "WALLS",
        "10", ox1.toFixed(3), "20", oy1.toFixed(3), "30", "0.0",
        "11", ox2.toFixed(3), "21", oy2.toFixed(3), "31", "0.0",

        "0", "LINE", "8", "WALLS",
        "10", px1.toFixed(3), "20", py1.toFixed(3), "30", "0.0",
        "11", px2.toFixed(3), "21", py2.toFixed(3), "31", "0.0"
      );
    }
  }

  // B. Spaces / Rooms (as closed boundaries)
  const spaces = vals.filter(i => i.type === 'Room') as IfcSpaceEntity[];
  for (const s of spaces) {
    const poly = s.geom.polygon || [];
    if (poly.length < 2) continue;

    const sName = s.name || s.Name || 'Room';

    // Draw polygon edges
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      lines.push(
        "0", "LINE", "8", "SPACES",
        "10", p1[0].toFixed(3), "20", p1[1].toFixed(3), "30", "0.0",
        "11", p2[0].toFixed(3), "21", p2[1].toFixed(3), "31", "0.0"
      );
    }

    // Text Label at Centroid
    if (poly.length > 0) {
      let cx = 0, cy = 0;
      poly.forEach(p => { cx += p[0]; cy += p[1]; });
      cx /= poly.length;
      cy /= poly.length;

      lines.push(
        "0", "TEXT", "8", "TEXT",
        "10", cx.toFixed(3), "20", cy.toFixed(3), "30", "0.0",
        "40", "0.35", // Height of text
        "1", sName.replace(/[\r\n]/g, ' ')
      );
    }
  }

  // C. Doors (as visual swings)
  const doors = vals.filter(i => i.type === 'Door') as IfcDoorEntity[];
  for (const d of doors) {
    const { wallId, t, width } = d.geom;
    const host = items[wallId] as IfcWallEntity | undefined;
    if (!host) continue;

    const { x1, y1, x2, y2 } = host.geom;
    const ox = x1 + (x2 - x1) * t;
    const oy = y1 + (y2 - y1) * t;

    lines.push(
      "0", "CIRCLE", "8", "DOORS",
      "10", ox.toFixed(3), "20", oy.toFixed(3), "30", "0.0",
      "40", width.toFixed(3) // Radius
    );
  }

  // D. Windows (as double-line frames)
  const windows = vals.filter(i => i.type === 'Window') as IfcWindowEntity[];
  for (const w of windows) {
    const { wallId, t, width } = w.geom;
    const host = items[wallId] as IfcWallEntity | undefined;
    if (!host) continue;

    const { x1, y1, x2, y2 } = host.geom;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const ox = x1 + dx * t;
    const oy = y1 + dy * t;

    // Draw a small line representing the window segment
    const wx1 = ox - Math.cos(angle) * (width / 2);
    const wy1 = oy - Math.sin(angle) * (width / 2);
    const wx2 = ox + Math.cos(angle) * (width / 2);
    const wy2 = oy + Math.sin(angle) * (width / 2);

    lines.push(
      "0", "LINE", "8", "WINDOWS",
      "10", wx1.toFixed(3), "20", wy1.toFixed(3), "30", "0.0",
      "11", wx2.toFixed(3), "21", wy2.toFixed(3), "31", "0.0"
    );
  }

  // E. Technical Elements (Sockets, switches, pipes etc.)
  const technicals = vals.filter(i => i.type === 'Technical') as any[];
  for (const t of technicals) {
    const { x, y } = t.geom || {};
    if (x === undefined || y === undefined) continue;
    const dName = `${t.discipline?.toUpperCase()}: ${t.category || t.name}`;

    // Draw a circle marker for the technical node
    lines.push(
      "0", "CIRCLE", "8", "TECHNICAL",
      "10", x.toFixed(3), "20", y.toFixed(3), "30", "0.0",
      "40", "0.12" // Radius
    );

    // Short labels
    lines.push(
      "0", "TEXT", "8", "TEXT",
      "10", (x + 0.15).toFixed(3), "20", (y + 0.15).toFixed(3), "30", "0.0",
      "40", "0.15",
      "1", String(t.model || t.name || 'MEP').replace(/[\r\n]/g, ' ')
    );
  }

  // F. Dimensions
  const dims = vals.filter(i => i.type === 'Dimension') as any[];
  for (const d of dims) {
    const { x1, y1, x2, y2 } = d.geom || {};
    if (x1 === undefined || y1 === undefined) continue;

    lines.push(
      "0", "LINE", "8", "DIMENSIONS",
      "10", x1.toFixed(3), "20", y1.toFixed(3), "30", "0.0",
      "11", x2.toFixed(3), "21", y2.toFixed(3), "31", "0.0"
    );
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n");
}

// ── 3. Export as DWG (.dwg) wrapped CAD format ───────────────────────────────
