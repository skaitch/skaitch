// IFC4 TypeScript interfaces for SkAItch

export interface IfcEntityBase {
  id: string;
  GlobalId: string;
  ifcType: string;
  type: string;
  Name: string;
  name: string;
  parentId: string | null;
  description?: string;
}

export interface IfcProjectEntity extends IfcEntityBase {
  ifcType: 'IfcProject';
  type: 'Project';
  longName: string;
  description: string;
  phase: string;
  northAngle: number;
  units: { length: string; area: string; volume: string };
  /** WGS84 latitude in decimal degrees (positive = North) */
  lat?: number;
  /** WGS84 longitude in decimal degrees (positive = East) */
  lon?: number;
  /** Site elevation above sea level in metres */
  siteElevation?: number;
  /** Site postal address */
  siteAddress?: string;
}

export interface IfcBuildingEntity extends IfcEntityBase {
  ifcType: 'IfcBuilding';
  type: 'Building';
  address: string;
  grossArea: number;
}

export interface IfcStoreyEntity extends IfcEntityBase {
  ifcType: 'IfcBuildingStorey';
  type: 'Storey';
  geom: { 
    level: number; 
    elevation: number; 
    thickness: number;
    plan?: {
      /** Absent for image background plans (projects before vector plans). */
      kind?: 'image' | 'vector';
      /** Image, or for a vector plan the raster preview of its visible layers. */
      url: string;
      w: number;
      h: number;
      opacity: number;
      scale: number;
      x: number;
      y: number;
      rotation?: number;
      calibrationPoints?: [number, number][];
      /** Normalized CAD geometry of a vector background plan (ADR 0014). */
      vector?: import('../cad/vectorPlan.js').VectorPlanData;
      /** Snapping to a vector plan; on unless set to false. */
      snap?: boolean;
    }
  };
  grossArea: number;
  /** Relevé associated with this storey (fichier relevé import, ADR 0006). */
  survey?: import('../survey/surveyFile.js').StoreySurvey;
}

export interface IfcSpaceEntity extends IfcEntityBase {
  ifcType: 'IfcSpace';
  type: 'Room';
  geom: { polygon: [number, number][]; height: number; _placementWorld?: [number, number] };
  function: string;
  occupancy: number;
}

export interface WallGeom {
  roofId?: string;
  roofIds?: string[];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  height: number;
}

export interface IfcWallEntity extends IfcEntityBase {
  ifcType: 'IfcWall' | 'IfcCurtainWall' | 'IfcWallStandardCase';
  type: 'Wall';
  Tag?: string;
  PredefinedType?: 'STANDARD' | 'PARTITIONING' | 'SOLIDWALL';
  IsExternal?: boolean;
  LoadBearing?: boolean;
  FireRating?: string;
  ThermalTransmittance?: number;
  Material?: string;
  geom: WallGeom;
  // compat aliases
  material?: string;
  fireRating?: string;
  loadBearing?: boolean;
  isExternal?: boolean;
}

export interface IfcOpeningEntity extends IfcEntityBase {
  ifcType: 'IfcOpeningElement';
  type: 'Opening';
  PredefinedType: 'OPENING';
  HostWall: string;
  OffsetAlongWall: number;
  OverallWidth: number;
  OverallHeight: number;
  SillHeight?: number;
}

export interface DoorGeom {
  wallId: string;
  t: number;
  width: number;
  height: number;
  swing: 'left' | 'right';
  side: number;
  _placementWorld?: [number, number];
  /** expressID of the IFCOPENINGELEMENT (wall void) hosting this door */
  openingExpId?: number;
  /** Position along the host wall when imported; an in-place move shifts the opening by the change. */
  _openingT?: number;
}

export interface IfcDoorEntity extends IfcEntityBase {
  ifcType: 'IfcDoor';
  type: 'Door';
  PredefinedType: 'DOOR';
  OperationType: 'NONE' | 'SINGLE_SWING_LEFT' | 'SINGLE_SWING_RIGHT' | 'DOUBLE_DOOR_SINGLE_SWING' | 'SLIDING' | 'FOLDING' | 'ROLLINGUP' | 'SECTIONAL' | 'TILT_UP';
  OverallHeight: number;
  OverallWidth: number;
  FireRating: string;
  Material: string;
  FillsOpening?: string;
  geom: DoorGeom;
  // compat aliases
  material: string;
  fireRating: string;
}

export interface WindowGeom {
  wallId: string;
  t: number;
  width: number;
  height: number;
  sillHeight: number;
  swing?: 'left' | 'right';
  side?: number;
  catalogueId?: string;
  _placementWorld?: [number, number];
  /** expressID of the IFCOPENINGELEMENT (wall void) hosting this window */
  openingExpId?: number;
  /** Position along the host wall when imported; an in-place move shifts the opening by the change. */
  _openingT?: number;
}

export interface IfcWindowEntity extends IfcEntityBase {
  ifcType: 'IfcWindow';
  type: 'Window';
  PredefinedType?: 'WINDOW';
  OverallHeight?: number;
  OverallWidth?: number;
  ThermalTransmittance?: number;
  Material?: string;
  FillsOpening?: string;
  OperationType?: string;
  geom: WindowGeom;
  // compat aliases
  material?: string;
  uValue?: number;
}

export interface FurnitureGeom {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  rotation: number;
  footprint?: [number, number][];
  _placementWorld?: [number, number];
}

export interface IfcFurnitureEntity extends IfcEntityBase {
  ifcType: 'IfcFurnishingElement';
  type: 'Furniture';
  geom: FurnitureGeom;
  category: string;
  model: string;
}

export interface IfcAnnotationEntity extends IfcEntityBase {
  ifcType: 'IfcAnnotation';
  type: 'Dimension' | 'Marker' | 'Section';
  /** `value`: for a cote, the length measured on site, shown instead of the drawn length. */
  geom: { x1: number; y1: number; x2: number; y2: number; value?: number; origin?: [number, number, number]; normal?: [number, number, number]; depth?: number } | { x: number; y: number };
}

export interface IfcSlabEntity extends IfcEntityBase {
  ifcType: 'IfcSlab';
  type: 'Slab';
  geom: { polygon: [number, number][]; thickness: number; _placementWorld?: [number, number] };
}

export interface IfcRoofEntity extends IfcEntityBase {
  ifcType: 'IfcRoof';
  type: 'Roof';
  PredefinedType?: 'FLAT_ROOF' | 'SHED_ROOF' | 'GABLE_ROOF' | 'HIP_ROOF' | 'FREEFORM' | 'NOTDEFINED';
  geom: import('../lib/roofGeometry.js').RoofGeom;
}

export interface GenericEntityGeom {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  rotation: number;
  footprint?: [number, number][];
  _placementWorld?: [number, number];
}

export interface IfcGenericEntity extends IfcEntityBase {
  ifcType: string;
  type: 'GenericElement';
  expressID: number;
  geom: GenericEntityGeom;
  category: string;
  isGenericIfcElement: true;
}

export interface IfcRelAggregatesEntity extends IfcEntityBase {
  ifcType: 'IfcRelAggregates';
  type: '_Rel';
  RelatingObject: string;
  RelatedObjects: string[];
  parentId: null;
}

export interface IfcRelContainedEntity extends IfcEntityBase {
  ifcType: 'IfcRelContainedInSpatialStructure';
  type: '_Rel';
  RelatingStructure: string;
  RelatedElements: string[];
  parentId: null;
}

export const TECHNICAL_DISCIPLINES = ['electrical', 'plumbing', 'hvac', 'data', 'fire'] as const;
export type TechnicalDiscipline = (typeof TECHNICAL_DISCIPLINES)[number];

export interface TechnicalGeom {
  x: number;
  y: number;
  rotation: number;
  /** Mounting height from floor in metres (default 0.30 for outlets, 1.10 for switches) */
  mountHeight?: number;
  _placementWorld?: [number, number];
}

export interface IfcTechnicalEntity extends IfcEntityBase {
  ifcType: 'IfcDistributionElement' | 'IfcFlowTerminal' | 'IfcFlowSegment' | 'IfcElectricAppliance';
  type: 'Technical';
  geom: TechnicalGeom;
  discipline: TechnicalDiscipline;
  /** Catalogue element id (e.g. 'elec-prise-simple') */
  model: string;
  /** Category label (e.g. 'Électricité') */
  category: string;
  /** Circuit / pipe reference label */
  circuitRef?: string;
  /** Pipe/cable diameter in mm */
  diameter?: number;
  /** Fluid type for plumbing (EF, EC, ECS, EU, EP) */
  fluidType?: string;
}

export type ColumnShape = 'rect' | 'circle';
/** x/y: footprint centre; for a circular column `w` = `d` = diameter. */
export interface ColumnGeom { x: number; y: number; rotation: number; shape: ColumnShape; w: number; d: number; h: number }
export interface IfcColumnEntity extends IfcEntityBase { type: 'Column'; ifcType: 'IfcColumn'; geom: ColumnGeom; Material?: string }

/** `flue`: a single shaft; `fireplace`: hearth block with a flue on top; `stove`: stove body with a round flue pipe (see lib/structuralElements). */
export type ChimneyKind = 'flue' | 'fireplace' | 'stove';
export interface ChimneyGeom { x: number; y: number; rotation: number; w: number; d: number; h: number; flueW: number; flueD: number; hearthH: number }
export interface IfcChimneyEntity extends IfcEntityBase { type: 'Chimney'; ifcType: 'IfcChimney'; kind: ChimneyKind; geom: ChimneyGeom; Material?: string }

export interface IfcStairEntity extends IfcEntityBase { type: 'Stair'; ifcType: 'IfcStair'; geom: import('../lib/stairGeometry.js').StairGeom; }

export type IfcEntity =
  | IfcStairEntity
  | IfcProjectEntity
  | IfcBuildingEntity
  | IfcStoreyEntity
  | IfcSpaceEntity
  | IfcWallEntity
  | IfcOpeningEntity
  | IfcDoorEntity
  | IfcWindowEntity
  | IfcFurnitureEntity
  | IfcAnnotationEntity
  | IfcSlabEntity
  | IfcRoofEntity
  | IfcGenericEntity
  | IfcTechnicalEntity
  | IfcColumnEntity
  | IfcChimneyEntity
  | IfcRelAggregatesEntity
  | IfcRelContainedEntity
  | import('../drawing/sheet.js').SheetEntity;

export type ItemsMap = Record<string, IfcEntity>;

export type ToolType = 'select' | 'Wall' | 'Door' | 'Window' | 'Room' | 'Slab' | 'Roof' | 'Stair' | 'Furniture' | 'Technical' | 'Column' | 'Chimney' | 'calibrate' | 'alignPlan' | 'Measure' | 'Dimension' | 'Marker' | 'Section';
export type ViewType = '2d' | '3d' | 'section' | 'sheets';
export type LangType = (typeof import('../data/i18n.js').LANGUAGES)[number]['code'];

export interface ViewState2D { scale: number; ox: number; oy: number }

export interface AiConfig {
  preferencesRevision?: number;
  savedPreferencesSignature?: string;
  credentials?: import('../lib/aiCredentialTarget.js').AiCredentialMeta[];
  apiKeyRef?: string;
  visualizerKeyRef?: string;
  provider: string;
  model: string;
  apiKey: string;
  temperature: number;
  /** Reasoning effort sent to the provider; empty or absent keeps the model's default. */
  effort?: import('./ai.js').AiEffort | '';
  baseUrl?: string;
  models?: string[]; // Currently displayed models
  apiKeys?: Record<string, string>; // Keys per provider
  cachedModels?: Record<string, string[]>; // Fetched models per provider
  baseUrls?: Record<string, string>; // Base URLs per provider
  mcpEnabled?: boolean;
  mcpAlwaysValidate?: boolean;
  useCorsProxy?: boolean;
  visualizerProvider?: string;
  visualizerModel?: string;
  visualizerApiKey?: string;
  visualizerBaseUrl?: string;
}

export interface TweakValues {
  theme: 'light' | 'dark';
  density: 'comfort' | 'compact';
  showGrid: boolean;
  snap: boolean;
  snapSize: number;
  panelsLayout: 'left' | 'right';
  /** Wall fill opacity in 2D canvas: 0 = fully transparent, 1 = fully opaque. Default 0.92 */
  wallOpacity?: number;
  showBgImage?: boolean;
  showLabels?: boolean;
  showDimensions?: boolean;
  /** Reliability view mode (ADR 0016): survey elements coloured by their survey reliability. */
  showReliability?: boolean;
}
