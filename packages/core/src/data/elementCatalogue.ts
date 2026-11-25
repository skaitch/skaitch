// ─── Element Catalogue ───────────────────────────────────────────────────────
// Defines all available door and window types with their IFC defaults.
// The SVG rendering is handled separately in ElementLibraryPanel.tsx.
// This file is pure data so it can be serialized to JSON for custom libraries.

export interface ElementDefaults {
  width: number;
  height: number;
  depth?: number;
  // Door-specific
  swing?: 'left' | 'right';
  OperationType?: string;
  // Window-specific
  sillHeight?: number;
  isBayWindow?: boolean;
}

/** Source of an element: builtin = shipped with app, user = stored in localStorage, project = stored per-project */
export type ElementSource = 'builtin' | 'user' | 'project';

export interface ElementDef {
  id: string;
  type: 'Door' | 'Window' | 'Furniture';
  category: string;
  labelFr: string;
  labelEn: string;
  defaults: ElementDefaults;
  source?: ElementSource;
  /** Optional icon key used to pick the SVG renderer. Falls back to type+OperationType inference. */
  iconKey?: string;
  /** Direction of the visible front at rotation=0, in plan radians. */
  frontAngle?: number;
  /** Meaning of the front (or reference axis for symmetric objects), exposed to AI clients. */
  frontDescription?: string;
}

// ─── Built-in Catalogue ───────────────────────────────────────────────────────

export const BUILTIN_CATALOGUE: ElementDef[] = [
  // ── Doors ──────────────────────────────────────────────────────────────────
  {
    // A passage through the wall with no leaf: the wall gets its void, nothing fills it.
    id: 'door-opening',
    type: 'Door',
    category: 'Passage',
    labelFr: 'Ouverture sans porte',
    labelEn: 'Opening without door',
    defaults: { width: 0.90, height: 2.10, OperationType: 'NONE' },
    source: 'builtin',
    iconKey: 'door-opening',
  },
  {
    id: 'door-single-left',
    type: 'Door',
    category: '1 battant',
    labelFr: '1 battant gauche',
    labelEn: 'Single swing left',
    defaults: { width: 0.90, height: 2.10, swing: 'left', OperationType: 'SINGLE_SWING_LEFT' },
    source: 'builtin',
    iconKey: 'door-single-left',
  },
  {
    id: 'door-single-right',
    type: 'Door',
    category: '1 battant',
    labelFr: '1 battant droit',
    labelEn: 'Single swing right',
    defaults: { width: 0.90, height: 2.10, swing: 'right', OperationType: 'SINGLE_SWING_RIGHT' },
    source: 'builtin',
    iconKey: 'door-single-right',
  },
  {
    id: 'door-double',
    type: 'Door',
    category: '2 battants',
    labelFr: '2 battants',
    labelEn: 'Double door',
    defaults: { width: 1.60, height: 2.10, swing: 'left', OperationType: 'DOUBLE_DOOR_SINGLE_SWING' },
    source: 'builtin',
    iconKey: 'door-double',
  },
  {
    id: 'door-sliding',
    type: 'Door',
    category: 'Coulissante',
    labelFr: 'Coulissante',
    labelEn: 'Sliding door',
    defaults: { width: 0.90, height: 2.10, swing: 'left', OperationType: 'SLIDING' },
    source: 'builtin',
    iconKey: 'door-sliding',
  },
  {
    id: 'door-folding',
    type: 'Door',
    category: 'Pliante',
    labelFr: 'Pliante',
    labelEn: 'Folding door',
    defaults: { width: 0.80, height: 2.10, swing: 'left', OperationType: 'FOLDING' },
    source: 'builtin',
    iconKey: 'door-folding',
  },
  {
    id: 'door-garage-rolling', type: 'Door', category: 'Garage',
    labelFr: 'Garage à enroulement', labelEn: 'Roll-up garage door',
    defaults: { width: 2.40, height: 2.10, OperationType: 'ROLLINGUP' },
    source: 'builtin', iconKey: 'door-garage-rolling',
  },
  {
    id: 'door-garage-sectional', type: 'Door', category: 'Garage',
    labelFr: 'Garage sectionnelle', labelEn: 'Sectional garage door',
    defaults: { width: 2.50, height: 2.10, OperationType: 'SECTIONAL' },
    source: 'builtin', iconKey: 'door-garage-sectional',
  },
  {
    id: 'door-garage-tilt-up', type: 'Door', category: 'Garage',
    labelFr: 'Garage basculante', labelEn: 'Up-and-over garage door',
    defaults: { width: 2.40, height: 2.00, OperationType: 'TILT_UP' },
    source: 'builtin', iconKey: 'door-garage-tilt-up',
  },
  // ── Windows ────────────────────────────────────────────────────────────────
  {
    id: 'win-fixed',
    type: 'Window',
    category: 'Fixe',
    labelFr: 'Fixe',
    labelEn: 'Fixed',
    defaults: { width: 1.00, height: 1.20, sillHeight: 0.90, OperationType: 'FIXED' },
    source: 'builtin',
    iconKey: 'win-fixed',
  },
  {
    id: 'win-single',
    type: 'Window',
    category: '1 vantail',
    labelFr: '1 vantail',
    labelEn: 'Single panel',
    defaults: { width: 0.80, height: 1.20, sillHeight: 0.90, OperationType: 'SINGLE_PANEL' },
    source: 'builtin',
    iconKey: 'win-single',
  },
  {
    id: 'win-double',
    type: 'Window',
    category: '2 vantaux',
    labelFr: '2 vantaux',
    labelEn: 'Double panel',
    defaults: { width: 1.20, height: 1.20, sillHeight: 0.90, OperationType: 'DOUBLE_PANEL' },
    source: 'builtin',
    iconKey: 'win-double',
  },
  {
    id: 'win-sliding',
    type: 'Window',
    category: 'Coulissante',
    labelFr: 'Coulissante',
    labelEn: 'Sliding window',
    defaults: { width: 1.40, height: 1.20, sillHeight: 0.90, OperationType: 'SLIDING' },
    source: 'builtin',
    iconKey: 'win-sliding',
  },
  {
    id: 'win-bay',
    type: 'Window',
    category: 'Baie vitrée',
    labelFr: 'Baie vitrée',
    labelEn: 'Bay window',
    defaults: { width: 2.40, height: 2.10, sillHeight: 0.10, OperationType: 'SLIDING', isBayWindow: true },
    source: 'builtin',
    iconKey: 'win-bay',
  },
  {
    id: 'win-tilt',
    type: 'Window',
    category: 'Oscillo-battante',
    labelFr: 'Oscillo-battante',
    labelEn: 'Tilt & turn',
    defaults: { width: 0.80, height: 1.20, sillHeight: 0.90, OperationType: 'TILT_AND_TURN' },
    source: 'builtin',
    iconKey: 'win-tilt',
  },
  // ── Furniture (Aménager) ──────────────────────────────────────────────────
  // Cuisine
  {
    id: 'cuisine-meuble-bas',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Cabinet doors and handles face the user; back against the wall.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Meuble bas cuisine',
    labelEn: 'Kitchen base cabinet',
    defaults: { width: 0.60, height: 0.85, depth: 0.60 },
    source: 'builtin',
    iconKey: 'cuisine-meuble-bas',
  },
  {
    id: 'cuisine-evier',
    frontAngle: -Math.PI / 2,
    frontDescription: 'User access to the sink, opposite the tap; tap side is the back.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Évier cuisine',
    labelEn: 'Kitchen sink',
    defaults: { width: 0.80, height: 0.85, depth: 0.60 },
    source: 'builtin',
    iconKey: 'cuisine-evier',
  },
  {
    id: 'cuisine-meuble-haut',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Cabinet doors face the room; back against the wall.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Meuble haut',
    labelEn: 'Wall cabinet',
    defaults: { width: 0.60, height: 0.70, depth: 0.35 },
    source: 'builtin',
    iconKey: 'cuisine-meuble-haut',
  },
  {
    id: 'cuisine-colonne',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Oven door faces the user; back against the wall.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Colonne four',
    labelEn: 'Oven column',
    defaults: { width: 0.60, height: 2.00, depth: 0.60 },
    source: 'builtin',
    iconKey: 'cuisine-colonne',
  },
  {
    id: 'cuisine-angle',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Main cabinet access faces the room; the L-shaped return also needs clearance.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Angle de cuisine',
    labelEn: 'Corner cabinet',
    defaults: { width: 0.90, height: 0.85, depth: 0.90 },
    source: 'builtin',
    iconKey: 'cuisine-angle',
  },
  {
    id: 'cuisine-ilot',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Working side faces the user; keep access around the island, do not assume a wall attachment.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Îlot central',
    labelEn: 'Kitchen island',
    defaults: { width: 1.20, height: 0.90, depth: 0.80 },
    source: 'builtin',
    iconKey: 'cuisine-ilot',
  },
  {
    id: 'cuisine-hotte',
    frontAngle: -Math.PI / 2,
    frontDescription: 'User side of the hood, opposite its wall attachment.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Hotte aspirante',
    labelEn: 'Range hood',
    defaults: { width: 0.60, height: 0.50, depth: 0.35 },
    source: 'builtin',
    iconKey: 'cuisine-hotte',
  },
  {
    id: 'cuisine-lave-vaisselle',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Dishwasher door faces the user; reserve door-opening clearance.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Lave-vaisselle',
    labelEn: 'Dishwasher',
    defaults: { width: 0.60, height: 0.85, depth: 0.60 },
    source: 'builtin',
    iconKey: 'cuisine-lave-vaisselle',
  },
  {
    id: 'cuisine-congelateur',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Freezer door faces the user; reserve door-opening clearance.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Congélateur armoire',
    labelEn: 'Upright freezer',
    defaults: { width: 0.60, height: 1.85, depth: 0.65 },
    source: 'builtin',
    iconKey: 'cuisine-congelateur',
  },
  {
    id: 'cuisine-plan-travail',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Working edge faces the user; rear edge goes against the wall.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Plan de travail',
    labelEn: 'Worktop',
    defaults: { width: 1.20, height: 0.05, depth: 0.60 },
    source: 'builtin',
    iconKey: 'cuisine-plan-travail',
  },
  {
    id: 'cuisine-meuble-haut-angle',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Cabinet doors face the room; back against the wall.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Meuble haut angle',
    labelEn: 'Corner wall cabinet',
    defaults: { width: 0.60, height: 0.70, depth: 0.35 },
    source: 'builtin',
    iconKey: 'cuisine-meuble-haut',
  },
  // Salle de bain
  {
    id: 'sdb-vasque',
    frontAngle: -Math.PI / 2,
    frontDescription: 'User access to the basin, opposite the tap; rear tap side against the wall.',
    type: 'Furniture',
    category: 'Salle de bain',
    labelFr: 'Meuble vasque',
    labelEn: 'Vanity unit',
    defaults: { width: 0.80, height: 0.85, depth: 0.50 },
    source: 'builtin',
    iconKey: 'sdb-vasque',
  },
  {
    id: 'sdb-baignoire',
    frontAngle: 0,
    frontDescription: 'Longitudinal axis from the tap end toward the opposite end; use center placement, not back for the long side wall.',
    type: 'Furniture',
    category: 'Salle de bain',
    labelFr: 'Baignoire',
    labelEn: 'Bathtub',
    defaults: { width: 1.70, height: 0.60, depth: 0.75 },
    source: 'builtin',
    iconKey: 'sdb-baignoire',
  },
  {
    id: 'sdb-douche',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Shower entry faces the room; keep entry clearance.',
    type: 'Furniture',
    category: 'Salle de bain',
    labelFr: 'Cabine de douche',
    labelEn: 'Shower cabin',
    defaults: { width: 0.90, height: 2.00, depth: 0.90 },
    source: 'builtin',
    iconKey: 'sdb-douche',
  },
  {
    id: 'sdb-wc',
    frontAngle: -Math.PI / 2,
    frontDescription: 'From cistern/wall attachment toward the bowl; rear against the wall.',
    type: 'Furniture',
    category: 'Salle de bain',
    labelFr: 'WC suspendu',
    labelEn: 'Toilet',
    defaults: { width: 0.40, height: 0.80, depth: 0.65 },
    source: 'builtin',
    iconKey: 'sdb-wc',
  },
  {
    id: 'sdb-chauffe-eau',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.', type: 'Furniture', category: 'Salle de bain',
    labelFr: 'Chauffe-eau', labelEn: 'Water heater',
    defaults: { width: 0.60, depth: 0.60, height: 1.20 },
    source: 'builtin', iconKey: 'forme-cylinder',
  },
  // Chambre
  {
    id: 'chambre-lit-double',
    frontAngle: -Math.PI / 2,
    frontDescription: 'From headboard toward feet; headboard is the back.',
    type: 'Furniture',
    category: 'Chambre',
    labelFr: 'Lit double',
    labelEn: 'Double bed',
    defaults: { width: 1.60, height: 0.50, depth: 2.00 },
    source: 'builtin',
    iconKey: 'chambre-lit-double',
  },
  {
    id: 'chambre-lit-simple',
    frontAngle: -Math.PI / 2,
    frontDescription: 'From headboard toward feet; headboard is the back.',
    type: 'Furniture',
    category: 'Chambre',
    labelFr: 'Lit simple',
    labelEn: 'Single bed',
    defaults: { width: 0.90, height: 0.50, depth: 2.00 },
    source: 'builtin',
    iconKey: 'chambre-lit-simple',
  },
  {
    id: 'chambre-chevet',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Drawer access faces the user; back against the wall.',
    type: 'Furniture',
    category: 'Chambre',
    labelFr: 'Table de chevet',
    labelEn: 'Nightstand',
    defaults: { width: 0.45, height: 0.45, depth: 0.40 },
    source: 'builtin',
    iconKey: 'chambre-chevet',
  },
  // Dressing
  {
    id: 'dressing-armoire',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Wardrobe doors face the user; reserve door-opening clearance.',
    type: 'Furniture',
    category: 'Dressing',
    labelFr: 'Armoire dressing',
    labelEn: 'Wardrobe',
    defaults: { width: 1.50, height: 2.20, depth: 0.60 },
    source: 'builtin',
    iconKey: 'dressing-armoire',
  },
  {
    id: 'dressing-commode',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Drawers face the user; reserve drawer-opening clearance.',
    type: 'Furniture',
    category: 'Dressing',
    labelFr: 'Commode',
    labelEn: 'Chest of drawers',
    defaults: { width: 0.80, height: 0.90, depth: 0.45 },
    source: 'builtin',
    iconKey: 'dressing-commode',
  },
  // Univers enfant
  {
    id: 'enfant-coffre',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Chest opening/access side faces the user; hinge side is the back.',
    type: 'Furniture',
    category: 'Univers enfant',
    labelFr: 'Coffre à jouets',
    labelEn: 'Toy chest',
    defaults: { width: 0.70, height: 0.45, depth: 0.40 },
    source: 'builtin',
    iconKey: 'enfant-coffre',
  },
  {
    id: 'enfant-lit-cabane',
    frontAngle: -Math.PI / 2,
    frontDescription: 'From head/pillow end toward feet; head end is the back.',
    type: 'Furniture',
    category: 'Univers enfant',
    labelFr: 'Lit cabane',
    labelEn: 'Cabin bed',
    defaults: { width: 0.90, height: 1.60, depth: 2.00 },
    source: 'builtin',
    iconKey: 'enfant-lit-cabane',
  },
  // Bureau
  {
    id: 'bureau-desk',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Keyboard/user side faces the seated person; chair faces the opposite direction.',
    type: 'Furniture',
    category: 'Bureau',
    labelFr: 'Bureau',
    labelEn: 'Desk',
    defaults: { width: 1.20, height: 0.75, depth: 0.60 },
    source: 'builtin',
    iconKey: 'bureau-desk',
  },
  {
    id: 'bureau-chair',
    frontAngle: -Math.PI / 2,
    frontDescription: "From backrest toward the seated person's knees; point toward the desk.",
    type: 'Furniture',
    category: 'Bureau',
    labelFr: 'Chaise ergonomique',
    labelEn: 'Office chair',
    defaults: { width: 0.60, height: 0.90, depth: 0.60 },
    source: 'builtin',
    iconKey: 'bureau-chair',
  },
  // Meubles
  {
    id: 'meuble-canape',
    frontAngle: -Math.PI / 2,
    frontDescription: "From backrest toward seated occupants' knees; point toward the TV or coffee table.",
    type: 'Furniture',
    category: 'Meubles',
    labelFr: 'Canapé convertible',
    labelEn: 'Sofa',
    defaults: { width: 2.00, height: 0.80, depth: 0.90 },
    source: 'builtin',
    iconKey: 'meuble-canape',
  },
  {
    id: 'meuble-fauteuil',
    frontAngle: -Math.PI / 2,
    frontDescription: "From backrest toward seated occupant's knees.",
    type: 'Furniture',
    category: 'Meubles',
    labelFr: 'Fauteuil club',
    labelEn: 'Armchair',
    defaults: { width: 0.85, height: 0.80, depth: 0.80 },
    source: 'builtin',
    iconKey: 'meuble-fauteuil',
  },
  {
    id: 'meuble-table-basse',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Meubles',
    labelFr: 'Table basse',
    labelEn: 'Coffee table',
    defaults: { width: 1.00, height: 0.40, depth: 0.60 },
    source: 'builtin',
    iconKey: 'meuble-table-basse',
  },
  {
    id: 'meuble-table-manger',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Meubles',
    labelFr: 'Table de repas',
    labelEn: 'Dining table',
    defaults: { width: 1.60, height: 0.75, depth: 0.90 },
    source: 'builtin',
    iconKey: 'meuble-table-manger',
  },
  // Décoration & luminaires
  {
    id: 'deco-plante',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Décoration & luminaires',
    labelFr: 'Plante verte',
    labelEn: 'Ficus plant',
    defaults: { width: 0.50, height: 1.20, depth: 0.50 },
    source: 'builtin',
    iconKey: 'deco-plante',
  },
  {
    id: 'deco-lampadaire',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Décoration & luminaires',
    labelFr: 'Lampadaire trépied',
    labelEn: 'Floor lamp',
    defaults: { width: 0.40, height: 1.80, depth: 0.40 },
    source: 'builtin',
    iconKey: 'deco-lampadaire',
  },
  // Électroménager et multimedia
  {
    id: 'electro-refri',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Refrigerator doors face the user; reserve door-opening clearance.',
    type: 'Furniture',
    category: 'Électroménager et multimedia',
    labelFr: 'Réfrigérateur combiné',
    labelEn: 'Fridge',
    defaults: { width: 0.60, height: 1.85, depth: 0.60 },
    source: 'builtin',
    iconKey: 'electro-refri',
  },
  {
    id: 'electro-lavelinge',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Loading door faces the user; reserve door-opening clearance.',
    type: 'Furniture',
    category: 'Électroménager et multimedia',
    labelFr: 'Lave-linge hublot',
    labelEn: 'Washing machine',
    defaults: { width: 0.60, height: 0.85, depth: 0.60 },
    source: 'builtin',
    iconKey: 'electro-lavelinge',
  },
  // Chauffage et électricité
  {
    id: 'elec-radiateur',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Heat-emitting face toward the room; rear against the wall.',
    type: 'Furniture',
    category: 'Chauffage et électricité',
    labelFr: 'Radiateur à inertie',
    labelEn: 'Radiator',
    defaults: { width: 0.80, height: 0.60, depth: 0.15 },
    source: 'builtin',
    iconKey: 'elec-radiateur',
  },
  // Jardin
  {
    id: 'jardin-table',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Jardin',
    labelFr: 'Table de jardin bois',
    labelEn: 'Garden table',
    defaults: { width: 1.80, height: 0.75, depth: 0.90 },
    source: 'builtin',
    iconKey: 'jardin-table',
  },
  {
    id: 'jardin-transat',
    frontAngle: -Math.PI / 2,
    frontDescription: 'From raised back/head end toward feet.',
    type: 'Furniture',
    category: 'Jardin',
    labelFr: 'Bain de soleil',
    labelEn: 'Sun lounger',
    defaults: { width: 0.65, height: 0.40, depth: 1.90 },
    source: 'builtin',
    iconKey: 'jardin-transat',
  },
  // Personnage
  {
    id: 'pers-standing',
    frontAngle: Math.PI / 2,
    frontDescription: 'Direction the person looks toward.',
    type: 'Furniture',
    category: 'Personnage',
    labelFr: 'Silhouette humaine',
    labelEn: 'Standing person',
    defaults: { width: 0.50, height: 1.75, depth: 0.30 },
    source: 'builtin',
    iconKey: 'pers-standing',
  },
  // Formes paramétrables
  {
    id: 'forme-box',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Formes paramétrables',
    labelFr: 'Bloc rectangulaire',
    labelEn: 'Parametric box',
    defaults: { width: 1.00, height: 1.00, depth: 1.00 },
    source: 'builtin',
    iconKey: 'forme-box',
  },
  {
    id: 'forme-cylinder',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Formes paramétrables',
    labelFr: 'Cylindre',
    labelEn: 'Parametric cylinder',
    defaults: { width: 1.00, height: 1.00, depth: 1.00 },
    source: 'builtin',
    iconKey: 'forme-cylinder',
  },
  // Symboles pmr
  {
    id: 'pmr-cercle',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Symboles pmr',
    labelFr: 'Aire de rotation PMR',
    labelEn: 'Turning circle',
    defaults: { width: 1.50, height: 0.02, depth: 1.50 },
    source: 'builtin',
    iconKey: 'pmr-cercle',
  },
  {
    id: 'pmr-fauteuil',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Wheelchair forward travel/access direction; preserve approach clearance.',
    type: 'Furniture',
    category: 'Symboles pmr',
    labelFr: 'Emplacement Fauteuil PMR',
    labelEn: 'Wheelchair clearance',
    defaults: { width: 0.80, height: 0.01, depth: 1.30 },
    source: 'builtin',
    iconKey: 'pmr-fauteuil',
  },
  // Expanded Cuisine
  {
    id: 'cuisine-plaques',
    frontAngle: -Math.PI / 2,
    frontDescription: 'User/control side of the cooktop.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Plaques de cuisson',
    labelEn: 'Cooktop / Hob',
    defaults: { width: 0.60, height: 0.85, depth: 0.60 },
    source: 'builtin',
    iconKey: 'cuisine-plaques',
  },
  {
    id: 'cuisine-microondes',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Microwave door faces the user; reserve access clearance.',
    type: 'Furniture',
    category: 'Cuisine',
    labelFr: 'Colonne micro-ondes',
    labelEn: 'Microwave tall column',
    defaults: { width: 0.60, height: 1.40, depth: 0.60 },
    source: 'builtin',
    iconKey: 'cuisine-microondes',
  },
  // Expanded Électroménager
  {
    id: 'electro-refri-americain',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Both refrigerator doors face the user; reserve door-opening clearance.',
    type: 'Furniture',
    category: 'Électroménager et multimedia',
    labelFr: 'Réfrigérateur américain',
    labelEn: 'Side-by-side fridge',
    defaults: { width: 0.90, height: 1.85, depth: 0.70 },
    source: 'builtin',
    iconKey: 'electro-refri-americain',
  },
  // Expanded Salle de bain
  {
    id: 'sdb-double-vasque',
    frontAngle: -Math.PI / 2,
    frontDescription: 'User access to the basins, opposite the taps.',
    type: 'Furniture',
    category: 'Salle de bain',
    labelFr: 'Meuble double vasque',
    labelEn: 'Double vanity',
    defaults: { width: 1.40, height: 0.85, depth: 0.50 },
    source: 'builtin',
    iconKey: 'sdb-double-vasque',
  },
  {
    id: 'sdb-bidet',
    frontAngle: -Math.PI / 2,
    frontDescription: 'From rear tap/wall attachment toward the bowl.',
    type: 'Furniture',
    category: 'Salle de bain',
    labelFr: 'Bidet céramique',
    labelEn: 'Bidet',
    defaults: { width: 0.38, height: 0.40, depth: 0.56 },
    source: 'builtin',
    iconKey: 'sdb-bidet',
  },
  // Expanded Chambre & Dressing
  {
    id: 'chambre-lit-king',
    frontAngle: -Math.PI / 2,
    frontDescription: 'From headboard toward feet; headboard is the back.',
    type: 'Furniture',
    category: 'Chambre',
    labelFr: 'Lit King Size',
    labelEn: 'King size bed',
    defaults: { width: 1.80, height: 0.55, depth: 2.00 },
    source: 'builtin',
    iconKey: 'chambre-lit-king',
  },
  {
    id: 'chambre-chevet-double',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Drawers face the user; reserve drawer-opening clearance.',
    type: 'Furniture',
    category: 'Chambre',
    labelFr: 'Table de chevet tiroirs',
    labelEn: 'Nightstand double drawer',
    defaults: { width: 0.60, height: 0.50, depth: 0.45 },
    source: 'builtin',
    iconKey: 'chambre-chevet-double',
  },
  {
    id: 'dressing-chiffonnier',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Drawers face the user; reserve drawer-opening clearance.',
    type: 'Furniture',
    category: 'Dressing',
    labelFr: 'Chiffonnier',
    labelEn: 'Tallboy drawer chest',
    defaults: { width: 0.50, height: 1.20, depth: 0.40 },
    source: 'builtin',
    iconKey: 'dressing-chiffonnier',
  },
  // Expanded Meubles (Living & Dining)
  {
    id: 'meuble-canape-angle',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Main seating faces away from the backrest; also check the return footprint and its clearance.',
    type: 'Furniture',
    category: 'Meubles',
    labelFr: "Canapé d'angle",
    labelEn: 'Corner sofa',
    defaults: { width: 2.60, height: 0.80, depth: 1.60 },
    source: 'builtin',
    iconKey: 'meuble-canape-angle',
  },
  {
    id: 'meuble-tv',
    frontAngle: -Math.PI / 2,
    frontDescription: 'TV screen faces viewers and seating; rear toward the wall.',
    type: 'Furniture',
    category: 'Meubles',
    labelFr: 'Banc TV design',
    labelEn: 'TV unit console',
    defaults: { width: 1.60, height: 0.45, depth: 0.40 },
    source: 'builtin',
    iconKey: 'meuble-tv',
  },
  {
    id: 'meuble-chaise',
    frontAngle: -Math.PI / 2,
    frontDescription: "From backrest toward seated occupant's knees; point toward the table.",
    type: 'Furniture',
    category: 'Meubles',
    labelFr: 'Chaise repas',
    labelEn: 'Dining chair',
    defaults: { width: 0.45, height: 0.85, depth: 0.45 },
    source: 'builtin',
    iconKey: 'meuble-chaise',
  },
  {
    id: 'meuble-bibliotheque',
    frontAngle: -Math.PI / 2,
    frontDescription: 'Open shelves face the user; rear against the wall.',
    type: 'Furniture',
    category: 'Meubles',
    labelFr: 'Bibliothèque ouverte',
    labelEn: 'Bookshelf library',
    defaults: { width: 1.00, height: 2.00, depth: 0.30 },
    source: 'builtin',
    iconKey: 'meuble-bibliotheque',
  },
  // Expanded Jardin
  {
    id: 'jardin-parasol',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Jardin',
    labelFr: 'Parasol déporté',
    labelEn: 'Garden parasol',
    defaults: { width: 2.00, height: 2.20, depth: 2.00 },
    source: 'builtin',
    iconKey: 'jardin-parasol',
  },
  {
    id: 'jardin-salon',
    frontAngle: 0,
    frontDescription: 'No unique functional front; +X is the reference width axis. Align the footprint with the plan; prefer center placement.',
    type: 'Furniture',
    category: 'Jardin',
    labelFr: 'Salon de jardin résine',
    labelEn: 'Outdoor lounge set',
    defaults: { width: 1.80, height: 0.70, depth: 0.80 },
    source: 'builtin',
    iconKey: 'jardin-salon',
  },
];

// ─── Custom library storage keys ──────────────────────────────────────────────
export const USER_LIBRARY_KEY = 'skaitch:user-element-library';

/** Parse a custom element library JSON string. Returns [] on parse error. */
export function parseCustomLibrary(json: string): ElementDef[] {
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is ElementDef =>
        e &&
        typeof e.id === 'string' &&
        (e.type === 'Door' || e.type === 'Window' || e.type === 'Furniture') &&
        typeof e.labelFr === 'string' &&
        typeof e.category === 'string' &&
        e.defaults &&
        typeof e.defaults.width === 'number' &&
        (e.frontAngle === undefined || (typeof e.frontAngle === 'number' && Number.isFinite(e.frontAngle))) &&
        (e.frontDescription === undefined || typeof e.frontDescription === 'string')
    );
  } catch {
    return [];
  }
}

/** Load user-level custom elements from localStorage */
export function loadUserLibrary(): ElementDef[] {
  try {
    const raw = localStorage.getItem(USER_LIBRARY_KEY);
    if (!raw) return [];
    return parseCustomLibrary(raw).map((e) => ({ ...e, source: 'user' as ElementSource }));
  } catch {
    return [];
  }
}

/** Save user-level custom elements to localStorage */
export function saveUserLibrary(elements: ElementDef[]): void {
  try {
    localStorage.setItem(USER_LIBRARY_KEY, JSON.stringify(elements));
  } catch {}
}

/** Merge builtin + user + project elements, deduplicating by id (project > user > builtin) */
export function mergeLibraries(
  builtin: ElementDef[],
  user: ElementDef[],
  project: ElementDef[]
): ElementDef[] {
  const map = new Map<string, ElementDef>();
  for (const e of builtin) map.set(e.id, { ...e, source: 'builtin' });
  for (const e of user) map.set(e.id, { ...e, source: 'user' });
  for (const e of project) map.set(e.id, { ...e, source: 'project' });
  return Array.from(map.values());
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Default element IDs when no catalogue selection is made */
export const DEFAULT_DOOR_ID = 'door-single-left';
export const DEFAULT_WINDOW_ID = 'win-double';
export const DEFAULT_FURNITURE_ID = 'meuble-canape';

export function getElementDef(id: string | null | undefined, catalogue: ElementDef[]): ElementDef | undefined {
  return catalogue.find((e) => e.id === id);
}

export function getElementsByType(type: 'Door' | 'Window' | 'Furniture', catalogue: ElementDef[]): ElementDef[] {
  return catalogue.filter((e) => e.type === type);
}

/** Group elements by category, preserving insertion order */
export function groupByCategory(elements: ElementDef[]): { category: string; items: ElementDef[] }[] {
  const map = new Map<string, ElementDef[]>();
  for (const el of elements) {
    if (!map.has(el.category)) map.set(el.category, []);
    map.get(el.category)!.push(el);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

/** Export a subset of the catalogue to JSON (for download) */
export function exportLibraryToJson(elements: ElementDef[]): string {
  const exportable = elements.map(({ id, type, category, labelFr, labelEn, defaults, iconKey, frontAngle, frontDescription }) => ({
    id, type, category, labelFr, labelEn, defaults, iconKey, frontAngle, frontDescription,
  }));
  return JSON.stringify(exportable, null, 2);
}
