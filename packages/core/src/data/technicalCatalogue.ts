// ─── Technical (MEP) Catalogue ───────────────────────────────────────────────
// Mechanical / Electrical / Plumbing point elements for BIM annotation.
// Each element has a canonical 2D symbol rendered in Canvas2D.

import type { TechnicalDiscipline } from '../types/ifc.js';

export interface TechnicalElementDef {
  id: string;
  discipline: TechnicalDiscipline;
  /** IFC type for this element */
  ifcType: 'IfcDistributionElement' | 'IfcFlowTerminal' | 'IfcFlowSegment' | 'IfcElectricAppliance';
  category: string;
  labelFr: string;
  labelEn: string;
  /** SVG symbol key */
  symbolKey: string;
  defaults: {
    /** Default mounting height from floor level (metres) */
    mountHeight: number;
    /** For plumbing: fluid type label EF, EC, ECS, EU, EP */
    fluidType?: string;
    /** For plumbing: nominal diameter in mm */
    diameter?: number;
    /** For electrical: amperage */
    amperage?: number;
  };
}

export const TECHNICAL_CATALOGUE: TechnicalElementDef[] = [

  // ── Électricité ─────────────────────────────────────────────────────────────
  {
    id: 'elec-prise-simple',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Prise de courant',
    labelEn: 'Power outlet',
    symbolKey: 'elec-prise-simple',
    defaults: { mountHeight: 0.30, amperage: 16 },
  },
  {
    id: 'elec-prise-double',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Double prise',
    labelEn: 'Double outlet',
    symbolKey: 'elec-prise-double',
    defaults: { mountHeight: 0.30, amperage: 16 },
  },
  {
    id: 'elec-prise-20a',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Prise 20A (cuisine)',
    labelEn: '20A outlet (kitchen)',
    symbolKey: 'elec-prise-20a',
    defaults: { mountHeight: 0.90, amperage: 20 },
  },
  {
    id: 'elec-prise-32a',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Prise 32A (four / induction)',
    labelEn: '32A outlet (oven/induction)',
    symbolKey: 'elec-prise-32a',
    defaults: { mountHeight: 0.60, amperage: 32 },
  },
  {
    id: 'elec-interrupteur',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Interrupteur simple',
    labelEn: 'Light switch',
    symbolKey: 'elec-interrupteur',
    defaults: { mountHeight: 1.10 },
  },
  {
    id: 'elec-va-vient',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Va-et-vient',
    labelEn: 'Two-way switch',
    symbolKey: 'elec-va-vient',
    defaults: { mountHeight: 1.10 },
  },
  {
    id: 'elec-variateur',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Variateur',
    labelEn: 'Dimmer switch',
    symbolKey: 'elec-variateur',
    defaults: { mountHeight: 1.10 },
  },
  {
    id: 'elec-detecteur-mouvement',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Détecteur de mouvement',
    labelEn: 'Motion sensor',
    symbolKey: 'elec-detecteur',
    defaults: { mountHeight: 2.20 },
  },
  {
    id: 'elec-tableau',
    discipline: 'electrical',
    ifcType: 'IfcDistributionElement',
    category: 'Électricité',
    labelFr: 'Tableau électrique',
    labelEn: 'Distribution board',
    symbolKey: 'elec-tableau',
    defaults: { mountHeight: 1.50 },
  },
  {
    id: 'elec-point-lumineux',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Point lumineux (plafond)',
    labelEn: 'Light point (ceiling)',
    symbolKey: 'elec-point-lumineux',
    defaults: { mountHeight: 2.70 },
  },
  {
    id: 'elec-applique',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Applique murale',
    labelEn: 'Wall light',
    symbolKey: 'elec-applique',
    defaults: { mountHeight: 1.80 },
  },
  {
    id: 'elec-sonnette',
    discipline: 'electrical',
    ifcType: 'IfcFlowTerminal',
    category: 'Électricité',
    labelFr: 'Sonnette / interphone',
    labelEn: 'Doorbell / intercom',
    symbolKey: 'elec-sonnette',
    defaults: { mountHeight: 1.20 },
  },

  // ── Plomberie (eau) ─────────────────────────────────────────────────────────
  {
    id: 'plomb-ef',
    discipline: 'plumbing',
    ifcType: 'IfcFlowTerminal',
    category: 'Plomberie',
    labelFr: 'Arrivée eau froide (EF)',
    labelEn: 'Cold water supply (CW)',
    symbolKey: 'plomb-ef',
    defaults: { mountHeight: 0.30, fluidType: 'EF', diameter: 15 },
  },
  {
    id: 'plomb-ec',
    discipline: 'plumbing',
    ifcType: 'IfcFlowTerminal',
    category: 'Plomberie',
    labelFr: 'Arrivée eau chaude (EC)',
    labelEn: 'Hot water supply (HW)',
    symbolKey: 'plomb-ec',
    defaults: { mountHeight: 0.30, fluidType: 'EC', diameter: 15 },
  },
  {
    id: 'plomb-mitigeur',
    discipline: 'plumbing',
    ifcType: 'IfcFlowTerminal',
    category: 'Plomberie',
    labelFr: 'Mitigeur / robinet mélangeur',
    labelEn: 'Mixer tap',
    symbolKey: 'plomb-mitigeur',
    defaults: { mountHeight: 0.90, fluidType: 'EF+EC', diameter: 15 },
  },
  {
    id: 'plomb-ecs',
    discipline: 'plumbing',
    ifcType: 'IfcDistributionElement',
    category: 'Plomberie',
    labelFr: 'Chauffe-eau / ECS',
    labelEn: 'Water heater (DHW)',
    symbolKey: 'plomb-ecs',
    defaults: { mountHeight: 0.30, fluidType: 'ECS', diameter: 20 },
  },
  {
    id: 'plomb-evacuation',
    discipline: 'plumbing',
    ifcType: 'IfcFlowSegment',
    category: 'Évacuations',
    labelFr: 'Évacuation EU (Ø40)',
    labelEn: 'Waste pipe EU (Ø40)',
    symbolKey: 'plomb-evacuation',
    defaults: { mountHeight: 0.00, fluidType: 'EU', diameter: 40 },
  },
  {
    id: 'plomb-evacuation-ep',
    discipline: 'plumbing',
    ifcType: 'IfcFlowSegment',
    category: 'Évacuations',
    labelFr: 'Évacuation EP (Ø100)',
    labelEn: 'Soil stack EP (Ø100)',
    symbolKey: 'plomb-evacuation-ep',
    defaults: { mountHeight: 0.00, fluidType: 'EP', diameter: 100 },
  },
  {
    id: 'plomb-siphon-sol',
    discipline: 'plumbing',
    ifcType: 'IfcFlowTerminal',
    category: 'Évacuations',
    labelFr: 'Siphon de sol (Ø50)',
    labelEn: 'Floor drain (Ø50)',
    symbolKey: 'plomb-siphon-sol',
    defaults: { mountHeight: 0.00, fluidType: 'EU', diameter: 50 },
  },
  {
    id: 'plomb-attente-lave-vaisselle',
    discipline: 'plumbing',
    ifcType: 'IfcFlowTerminal',
    category: 'Plomberie',
    labelFr: 'Attente lave-vaisselle',
    labelEn: 'Dishwasher supply/waste',
    symbolKey: 'plomb-attente-lv',
    defaults: { mountHeight: 0.30, fluidType: 'EF+EU', diameter: 15 },
  },
  {
    id: 'plomb-attente-machine-a-laver',
    discipline: 'plumbing',
    ifcType: 'IfcFlowTerminal',
    category: 'Plomberie',
    labelFr: 'Attente lave-linge',
    labelEn: 'Washing machine supply/waste',
    symbolKey: 'plomb-attente-ml',
    defaults: { mountHeight: 0.30, fluidType: 'EF+EU', diameter: 15 },
  },
  {
    id: 'plomb-vanne-arret',
    discipline: 'plumbing',
    ifcType: 'IfcFlowTerminal',
    category: 'Plomberie',
    labelFr: 'Vanne d\'arrêt',
    labelEn: 'Isolation valve',
    symbolKey: 'plomb-vanne',
    defaults: { mountHeight: 0.30, fluidType: 'EF', diameter: 15 },
  },

  // ── Chauffage / Ventilation ─────────────────────────────────────────────────
  {
    id: 'hvac-chaudiere',
    discipline: 'hvac',
    ifcType: 'IfcDistributionElement',
    category: 'Chauffage / VMC',
    labelFr: 'Chaudière',
    labelEn: 'Boiler',
    symbolKey: 'hvac-chaudiere',
    defaults: { mountHeight: 1.50 },
  },
  {
    id: 'hvac-radiateur',
    discipline: 'hvac',
    ifcType: 'IfcFlowTerminal',
    category: 'Chauffage / VMC',
    labelFr: 'Radiateur eau chaude',
    labelEn: 'Radiator',
    symbolKey: 'hvac-radiateur',
    defaults: { mountHeight: 0.10, fluidType: 'EC', diameter: 15 },
  },
  {
    id: 'hvac-plancher-chauffant',
    discipline: 'hvac',
    ifcType: 'IfcDistributionElement',
    category: 'Chauffage / VMC',
    labelFr: 'Collecteur plancher chauffant',
    labelEn: 'Underfloor heating manifold',
    symbolKey: 'hvac-plancher',
    defaults: { mountHeight: 0.30, fluidType: 'EC', diameter: 16 },
  },
  {
    id: 'hvac-bouche-soufflage',
    discipline: 'hvac',
    ifcType: 'IfcFlowTerminal',
    category: 'Chauffage / VMC',
    labelFr: 'Bouche VMC soufflage',
    labelEn: 'Supply air diffuser (HVAC)',
    symbolKey: 'hvac-bouche-soufflage',
    defaults: { mountHeight: 2.40 },
  },
  {
    id: 'hvac-bouche-extraction',
    discipline: 'hvac',
    ifcType: 'IfcFlowTerminal',
    category: 'Chauffage / VMC',
    labelFr: 'Bouche VMC extraction',
    labelEn: 'Exhaust air grille (VMC)',
    symbolKey: 'hvac-bouche-extraction',
    defaults: { mountHeight: 2.40 },
  },
  {
    id: 'hvac-clim-unité-intérieure',
    discipline: 'hvac',
    ifcType: 'IfcFlowTerminal',
    category: 'Chauffage / VMC',
    labelFr: 'Unité intérieure climatisation',
    labelEn: 'Indoor A/C unit',
    symbolKey: 'hvac-clim-int',
    defaults: { mountHeight: 2.00 },
  },
  {
    id: 'hvac-thermostat',
    discipline: 'hvac',
    ifcType: 'IfcFlowTerminal',
    category: 'Chauffage / VMC',
    labelFr: 'Thermostat / sonde',
    labelEn: 'Thermostat',
    symbolKey: 'hvac-thermostat',
    defaults: { mountHeight: 1.50 },
  },

  // ── Télécommunications / Data ───────────────────────────────────────────────
  {
    id: 'data-prise-rj45',
    discipline: 'data',
    ifcType: 'IfcFlowTerminal',
    category: 'Données / Telecom',
    labelFr: 'Prise RJ45 réseau',
    labelEn: 'RJ45 network socket',
    symbolKey: 'data-rj45',
    defaults: { mountHeight: 0.30 },
  },
  {
    id: 'data-prise-tv',
    discipline: 'data',
    ifcType: 'IfcFlowTerminal',
    category: 'Données / Telecom',
    labelFr: 'Prise TV / antenne',
    labelEn: 'TV / antenna socket',
    symbolKey: 'data-tv',
    defaults: { mountHeight: 0.30 },
  },
  {
    id: 'data-prise-telephone',
    discipline: 'data',
    ifcType: 'IfcFlowTerminal',
    category: 'Données / Telecom',
    labelFr: 'Prise téléphone / RJ11',
    labelEn: 'Telephone socket RJ11',
    symbolKey: 'data-telephone',
    defaults: { mountHeight: 0.30 },
  },
  {
    id: 'data-prise-hdmi',
    discipline: 'data',
    ifcType: 'IfcFlowTerminal',
    category: 'Données / Telecom',
    labelFr: 'Prise HDMI encastrée',
    labelEn: 'Flush HDMI socket',
    symbolKey: 'data-hdmi',
    defaults: { mountHeight: 0.30 },
  },
  {
    id: 'data-borne-wifi',
    discipline: 'data',
    ifcType: 'IfcFlowTerminal',
    category: 'Données / Telecom',
    labelFr: 'Borne WiFi encastrée',
    labelEn: 'Flush WiFi access point',
    symbolKey: 'data-wifi',
    defaults: { mountHeight: 2.40 },
  },
  {
    id: 'data-baie-reseau',
    discipline: 'data',
    ifcType: 'IfcDistributionElement',
    category: 'Données / Telecom',
    labelFr: 'Baie / coffret réseau',
    labelEn: 'Network cabinet / patch panel',
    symbolKey: 'data-baie',
    defaults: { mountHeight: 1.50 },
  },
  {
    id: 'fire-extincteur',
    discipline: 'fire',
    ifcType: 'IfcDistributionElement',
    category: 'Sécurité incendie',
    labelFr: 'Extincteur',
    labelEn: 'Fire extinguisher',
    symbolKey: 'fire-extincteur',
    defaults: { mountHeight: 0.90 },
  },
];

/** Group by category for the panel */
export function groupTechnicalByCategory(items: TechnicalElementDef[]): Record<string, TechnicalElementDef[]> {
  return items.reduce((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {} as Record<string, TechnicalElementDef[]>);
}

/** Get default colour for discipline (for 2D symbol tinting) */
export function disciplineColor(discipline: TechnicalDiscipline): string {
  switch (discipline) {
    case 'electrical': return '#f59e0b'; // amber
    case 'plumbing':   return '#3b82f6'; // blue
    case 'hvac':       return '#10b981'; // emerald
    case 'data':       return '#8b5cf6'; // violet
    case 'fire':       return '#dc2626'; // red
    default:           return '#6b7280';
  }
}
