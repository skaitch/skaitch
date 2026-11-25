// SkAItch — Data model (IFC-inspired, simplified)
// World units: meters. 2D coordinates in meters; storeys at z = level * 3.

const TYPES = {
  Project: { ifc: 'IfcProject', label: { fr: 'Projet', en: 'Project' } },
  Building: { ifc: 'IfcBuilding', label: { fr: 'Bâtiment', en: 'Building' } },
  Storey: { ifc: 'IfcBuildingStorey', label: { fr: 'Dalle / Niveau', en: 'Storey / Slab' } },
  Room: { ifc: 'IfcSpace', label: { fr: 'Pièce', en: 'Room' } },
  Wall: { ifc: 'IfcWallStandardCase', label: { fr: 'Mur', en: 'Wall' } },
  Door: { ifc: 'IfcDoor', label: { fr: 'Porte', en: 'Door' } },
  Window: { ifc: 'IfcWindow', label: { fr: 'Fenêtre', en: 'Window' } },
  Furniture: { ifc: 'IfcFurnishingElement', label: { fr: 'Meuble', en: 'Furniture' } },
};

// Faux IFC GUID — 22 chars base64-ish
function guid(seed) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  let s = '';
  for (let i = 0; i < 22; i++) {
    h = (h * 1103515245 + 12345 + i * 7) | 0;
    s += chars[Math.abs(h) % 64];
  }
  return s;
}

// ----- Builder helpers -----
function W(id, x1, y1, x2, y2, opts = {}) {
  return {
    id, type: 'Wall',
    name: opts.name || `Mur ${id.slice(-3)}`,
    parentId: opts.parentId,
    ifcGUID: guid('w' + id),
    geom: { x1, y1, x2, y2, thickness: opts.thickness ?? 0.20, height: opts.height ?? 2.70 },
    material: opts.material ?? 'Brique 200mm',
    fireRating: opts.fireRating ?? 'EI 60',
    loadBearing: opts.loadBearing ?? false,
    isExternal: opts.isExternal ?? false,
    psets: opts.psets || {}
  };
}
function D(id, wallId, t, opts = {}) {
  return {
    id, type: 'Door',
    name: opts.name || `Porte ${id.slice(-3)}`,
    parentId: opts.parentId,
    ifcGUID: guid('d' + id),
    geom: { wallId, t, width: opts.width ?? 0.90, height: opts.height ?? 2.10, swing: opts.swing ?? 'left', side: opts.side ?? 1 },
    material: opts.material ?? 'Bois — chêne',
    fireRating: opts.fireRating ?? 'EI 30',
  };
}
function Wn(id, wallId, t, opts = {}) {
  return {
    id, type: 'Window',
    name: opts.name || `Fenêtre ${id.slice(-3)}`,
    parentId: opts.parentId,
    ifcGUID: guid('wn' + id),
    geom: { wallId, t, width: opts.width ?? 1.20, height: opts.height ?? 1.20, sillHeight: opts.sillHeight ?? 0.90 },
    material: opts.material ?? 'Aluminium — double vitrage',
    uValue: opts.uValue ?? 1.4,
  };
}
function R(id, name, polygon, opts = {}) {
  return {
    id, type: 'Room',
    name,
    parentId: opts.parentId,
    ifcGUID: guid('r' + id),
    geom: { polygon, height: opts.height ?? 2.70 },
    function: opts.function ?? 'Habitation',
    occupancy: opts.occupancy ?? 2,
  };
}
function S(id, name, level, opts = {}) {
  return {
    id, type: 'Storey', name,
    parentId: opts.parentId,
    ifcGUID: guid('s' + id),
    geom: { level, elevation: level * 3.0, thickness: opts.thickness ?? 0.20 },
    grossArea: opts.grossArea ?? 0,
  };
}
function B(id, name, opts = {}) {
  return {
    id, type: 'Building', name,
    parentId: opts.parentId,
    ifcGUID: guid('b' + id),
    address: opts.address ?? '12 rue des Tilleuls, 75011 Paris',
    grossArea: opts.grossArea ?? 0,
  };
}
function F(id, name, x, y, w, d, opts = {}) {
  return {
    id, type: 'Furniture', name,
    parentId: opts.parentId,
    ifcGUID: guid('f' + id),
    geom: { x, y, w, d, h: opts.h ?? 0.75, rotation: opts.rotation ?? 0 },
    category: opts.category ?? 'Mobilier',
    model: opts.model ?? '—',
  };
}

// ============================================================================
//  STARTER PROJECT — petit immeuble, 2 bâtiments, plusieurs dalles
// ============================================================================

function buildStarter() {
  const items = {};
  const add = (it) => { items[it.id] = it; return it; };

  // ----- PROJECT -----
  const proj = add({
    id: 'proj_main',
    type: 'Project',
    name: 'Résidence Les Tilleuls',
    longName: 'Résidence Les Tilleuls — Lot 4B',
    ifcGUID: guid('proj'),
    description: 'Petit immeuble collectif, 2 bâtiments R+1.',
    phase: 'EXE',
    northAngle: 0,
    parentId: null,
    units: { length: 'm', area: 'm²', volume: 'm³' },
  });

  // ----- BUILDING A -----
  const bA = add(B('bld_A', 'Bâtiment A', { parentId: proj.id, address: '12 rue des Tilleuls', grossArea: 184 }));
  // Storeys
  const sA0 = add(S('sty_A0', 'RDC — Bâtiment A', 0, { parentId: bA.id, grossArea: 92 }));
  const sA1 = add(S('sty_A1', 'R+1 — Bâtiment A', 1, { parentId: bA.id, grossArea: 92 }));

  // Rooms (RDC A) — rectangular building 12x8
  add(R('rm_A0_living', 'Séjour', [[0,0],[7,0],[7,5],[0,5]], { parentId: sA0.id, function: 'Séjour', occupancy: 4 }));
  add(R('rm_A0_kitchen', 'Cuisine', [[7,0],[12,0],[12,4],[7,4]], { parentId: sA0.id, function: 'Cuisine', occupancy: 2 }));
  add(R('rm_A0_hall', 'Hall d\'entrée', [[7,4],[12,4],[12,8],[9,8]], { parentId: sA0.id, function: 'Circulation', occupancy: 0 }));
  add(R('rm_A0_wc', 'WC', [[0,5],[3,5],[3,8],[0,8]], { parentId: sA0.id, function: 'Sanitaires', occupancy: 1 }));
  add(R('rm_A0_office', 'Bureau', [[3,5],[9,5],[9,8],[3,8]], { parentId: sA0.id, function: 'Bureau', occupancy: 2 }));

  // Walls (RDC A) — perimeter + inner partitions
  // External
  add(W('w_A0_e1', 0, 0, 12, 0, { parentId: sA0.id, isExternal: true, name: 'Façade Sud' }));
  add(W('w_A0_e2', 12, 0, 12, 8, { parentId: sA0.id, isExternal: true, name: 'Façade Est' }));
  add(W('w_A0_e3', 12, 8, 0, 8, { parentId: sA0.id, isExternal: true, name: 'Façade Nord' }));
  add(W('w_A0_e4', 0, 8, 0, 0, { parentId: sA0.id, isExternal: true, name: 'Façade Ouest' }));
  // Internal
  add(W('w_A0_i1', 7, 0, 7, 5, { parentId: sA0.id, thickness: 0.10, name: 'Cloison séjour/cuisine' }));
  add(W('w_A0_i2', 0, 5, 9, 5, { parentId: sA0.id, thickness: 0.10, name: 'Cloison médiane' }));
  add(W('w_A0_i3', 3, 5, 3, 8, { parentId: sA0.id, thickness: 0.10, name: 'Cloison WC' }));
  add(W('w_A0_i4', 9, 5, 9, 8, { parentId: sA0.id, thickness: 0.10, name: 'Cloison hall' }));
  add(W('w_A0_i5', 7, 4, 12, 4, { parentId: sA0.id, thickness: 0.10, name: 'Cloison cuisine/hall' }));

  // Doors (RDC A)
  add(D('d_A0_main', 'w_A0_e3', 0.85, { parentId: sA0.id, width: 1.0, name: 'Porte d\'entrée', material: 'Acier — sécurisée' }));
  add(D('d_A0_kit', 'w_A0_i1', 0.55, { parentId: sA0.id, width: 0.90, name: 'Porte cuisine' }));
  add(D('d_A0_off', 'w_A0_i2', 0.65, { parentId: sA0.id, width: 0.80, name: 'Porte bureau' }));
  add(D('d_A0_wc', 'w_A0_i3', 0.5, { parentId: sA0.id, width: 0.70, name: 'Porte WC' }));

  // Windows (RDC A)
  add(Wn('wn_A0_s1', 'w_A0_e1', 0.20, { parentId: sA0.id, width: 1.6, name: 'Baie séjour' }));
  add(Wn('wn_A0_s2', 'w_A0_e1', 0.65, { parentId: sA0.id, width: 1.4, name: 'Fenêtre cuisine' }));
  add(Wn('wn_A0_e1', 'w_A0_e2', 0.30, { parentId: sA0.id, width: 1.2, name: 'Fenêtre Est cuisine' }));
  add(Wn('wn_A0_e2', 'w_A0_e2', 0.75, { parentId: sA0.id, width: 1.0, name: 'Fenêtre Est hall' }));
  add(Wn('wn_A0_w1', 'w_A0_e4', 0.35, { parentId: sA0.id, width: 1.2, name: 'Fenêtre Ouest' }));

  // Furniture (RDC A)
  add(F('fur_A0_sofa', 'Canapé 3 places', 1.0, 0.4, 2.4, 0.9, { parentId: sA0.id, category: 'Salon', model: 'KIVIK' }));
  add(F('fur_A0_table', 'Table à manger', 4.0, 1.5, 1.8, 0.9, { parentId: sA0.id, category: 'Salon', model: 'STORNÄS' }));
  add(F('fur_A0_kitch', 'Bloc cuisine', 7.4, 0.5, 4.4, 0.65, { parentId: sA0.id, category: 'Cuisine', model: 'METOD' }));
  add(F('fur_A0_desk', 'Bureau', 4.5, 5.5, 1.5, 0.7, { parentId: sA0.id, category: 'Bureau', model: 'BEKANT' }));
  add(F('fur_A0_bed', 'Fauteuil bureau', 5.8, 6.8, 0.65, 0.65, { parentId: sA0.id, category: 'Bureau', model: 'MARKUS' }));

  // ----- R+1 A — bedrooms -----
  add(R('rm_A1_bed1', 'Chambre 1', [[0,0],[6,0],[6,5],[0,5]], { parentId: sA1.id, function: 'Chambre', occupancy: 2 }));
  add(R('rm_A1_bed2', 'Chambre 2', [[6,0],[12,0],[12,5],[6,5]], { parentId: sA1.id, function: 'Chambre', occupancy: 1 }));
  add(R('rm_A1_bath', 'Salle de bain', [[0,5],[5,5],[5,8],[0,8]], { parentId: sA1.id, function: 'Sanitaires', occupancy: 1 }));
  add(R('rm_A1_corr', 'Couloir', [[5,5],[12,5],[12,8],[5,8]], { parentId: sA1.id, function: 'Circulation', occupancy: 0 }));
  // walls
  add(W('w_A1_e1', 0, 0, 12, 0, { parentId: sA1.id, isExternal: true, name: 'Façade Sud R+1' }));
  add(W('w_A1_e2', 12, 0, 12, 8, { parentId: sA1.id, isExternal: true, name: 'Façade Est R+1' }));
  add(W('w_A1_e3', 12, 8, 0, 8, { parentId: sA1.id, isExternal: true, name: 'Façade Nord R+1' }));
  add(W('w_A1_e4', 0, 8, 0, 0, { parentId: sA1.id, isExternal: true, name: 'Façade Ouest R+1' }));
  add(W('w_A1_i1', 6, 0, 6, 5, { parentId: sA1.id, thickness: 0.10, name: 'Cloison chambres' }));
  add(W('w_A1_i2', 0, 5, 12, 5, { parentId: sA1.id, thickness: 0.10, name: 'Cloison médiane' }));
  add(W('w_A1_i3', 5, 5, 5, 8, { parentId: sA1.id, thickness: 0.10, name: 'Cloison SDB' }));
  add(D('d_A1_b1', 'w_A1_i2', 0.20, { parentId: sA1.id, name: 'Porte Chambre 1' }));
  add(D('d_A1_b2', 'w_A1_i2', 0.65, { parentId: sA1.id, name: 'Porte Chambre 2' }));
  add(D('d_A1_bath', 'w_A1_i3', 0.5, { parentId: sA1.id, name: 'Porte SDB' }));
  add(Wn('wn_A1_s1', 'w_A1_e1', 0.20, { parentId: sA1.id, width: 1.4 }));
  add(Wn('wn_A1_s2', 'w_A1_e1', 0.70, { parentId: sA1.id, width: 1.4 }));
  add(Wn('wn_A1_e1', 'w_A1_e2', 0.50, { parentId: sA1.id, width: 1.0 }));
  add(Wn('wn_A1_w1', 'w_A1_e4', 0.30, { parentId: sA1.id, width: 1.2 }));
  add(F('fur_A1_bed1', 'Lit double', 1.8, 1.2, 1.6, 2.0, { parentId: sA1.id, category: 'Chambre' }));
  add(F('fur_A1_bed2', 'Lit simple', 7.2, 1.4, 1.0, 2.0, { parentId: sA1.id, category: 'Chambre' }));
  add(F('fur_A1_war1', 'Armoire', 0.4, 4.4, 2.0, 0.6, { parentId: sA1.id, category: 'Chambre' }));

  // ----- BUILDING B (smaller annex) -----
  const bB = add(B('bld_B', 'Bâtiment B — Annexe', { parentId: proj.id, address: '14 rue des Tilleuls', grossArea: 64 }));
  const sB0 = add(S('sty_B0', 'RDC — Annexe', 0, { parentId: bB.id, grossArea: 64 }));
  add(R('rm_B0_studio', 'Studio', [[0,0],[8,0],[8,6],[0,6]], { parentId: sB0.id, function: 'Habitation' }));
  add(R('rm_B0_sdb', 'SDB', [[8,0],[10,0],[10,3],[8,3]], { parentId: sB0.id, function: 'Sanitaires' }));
  add(R('rm_B0_tech', 'Local technique', [[8,3],[10,3],[10,6],[8,6]], { parentId: sB0.id, function: 'Technique' }));
  add(W('w_B0_e1', 0, 0, 10, 0, { parentId: sB0.id, isExternal: true, name: 'Façade Sud B' }));
  add(W('w_B0_e2', 10, 0, 10, 6, { parentId: sB0.id, isExternal: true, name: 'Façade Est B' }));
  add(W('w_B0_e3', 10, 6, 0, 6, { parentId: sB0.id, isExternal: true, name: 'Façade Nord B' }));
  add(W('w_B0_e4', 0, 6, 0, 0, { parentId: sB0.id, isExternal: true, name: 'Façade Ouest B' }));
  add(W('w_B0_i1', 8, 0, 8, 6, { parentId: sB0.id, thickness: 0.10, name: 'Cloison annexe' }));
  add(W('w_B0_i2', 8, 3, 10, 3, { parentId: sB0.id, thickness: 0.10, name: 'Cloison SDB/tech' }));
  add(D('d_B0_main', 'w_B0_e3', 0.5, { parentId: sB0.id, name: 'Porte annexe' }));
  add(D('d_B0_sdb', 'w_B0_i1', 0.20, { parentId: sB0.id, name: 'Porte SDB' }));
  add(Wn('wn_B0_s1', 'w_B0_e1', 0.30, { parentId: sB0.id, width: 1.6 }));
  add(Wn('wn_B0_s2', 'w_B0_e1', 0.65, { parentId: sB0.id, width: 1.0 }));
  add(F('fur_B0_bed', 'Lit', 1.0, 4.0, 1.4, 1.9, { parentId: sB0.id }));
  add(F('fur_B0_kit', 'Kitchenette', 5.5, 0.4, 2.0, 0.6, { parentId: sB0.id }));
  add(F('fur_B0_desk', 'Bureau', 0.4, 0.4, 1.4, 0.7, { parentId: sB0.id }));

  return items;
}

window.AS_DATA = { TYPES, buildStarter, guid };
