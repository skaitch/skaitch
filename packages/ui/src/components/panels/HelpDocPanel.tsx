import { makeT } from '@skaitch/core/data/i18n';
import React, { useState, useEffect, useRef, useCallback } from 'react';

interface HelpDocPanelProps {
  open: boolean;
  onClose: () => void;
  lang: string;
  selection: string[];
  items: Record<string, any>;
}

interface DocChapter {
  id: string;
  title: { fr: string; en: string };
  icon: React.ReactNode;
  content: {
    fr: string[];
    en: string[];
  };
}

export default function HelpDocPanel({ open, onClose, lang, selection, items }: HelpDocPanelProps) {
  // shortcut: help chapters exist in French and English, translate chapters before extending this lookup.
  const docLang = lang === 'fr' ? 'fr' : 'en';

  const [searchQuery, setSearchQuery] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [activeSection, setActiveSection] = useState('overview');

  const contentContainerRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);

  // Core documentation chapters
  const chapters: DocChapter[] = [
    {
      id: 'overview',
      title: { fr: 'Présentation & Arborescence', en: 'Overview & Project Tree' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
      content: {
        fr: [
          "SkAItch est un outil de conception BIM (Building Information Modeling) avancé. Il combine l'édition 2D en temps réel, la modélisation 3D interactive et une intégration IA poussée via le protocole IFC4.",
          "L'Arborescence projet (panneau de gauche) montre la structure hiérarchique : Projet ➔ Bâtiment ➔ Niveau (Dalle) ➔ Éléments. Vous pouvez cliquer sur n'importe quel élément pour l'inspecter et le renommer.",
          "Double-cliquez sur un niveau (Storey) pour focaliser la vue 2D et 3D sur ce niveau spécifique."
        ],
        en: [
          "SkAItch is an advanced BIM (Building Information Modeling) design tool. It combines real-time 2D drafting, interactive 3D modeling, and advanced AI integration under the IFC4 standard.",
          "The Project Tree (left panel) displays the structural hierarchy: Project ➔ Building ➔ Storey (Slab) ➔ Elements. You can click any element to inspect, highlight, or rename it.",
          "Double-click a storey to focus both the 2D canvas and 3D viewport on that specific level."
        ]
      }
    },
    {
      id: '2d_drawing',
      title: { fr: 'Dessin 2D & Outils', en: '2D Drawing & Tools' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      ),
      content: {
        fr: [
          "L'éditeur 2D est votre espace principal de dessin. Utilisez le menu de gauche pour choisir vos outils de tracé.",
          "Raccourcis clavier majeurs : Sélectionnez (V), Mesurez (L), Ajoutez des cotations (C) pour marquer les distances réelles, ou insérez un Jalon d'ancrage (J) pour calibrer le repère du plan.",
          "Grille & Magnétisme (Snap) : Activez le magnétisme via le bouton d'aimantation en haut pour dessiner avec une précision de 5cm, 10cm ou 50cm."
        ],
        en: [
          "The 2D editor is your primary drafting space. Use the toolbox on the left to select drawing and modeling tools.",
          "Major Keyboard Shortcuts: Select tool (V), Measure tape (L), Dimension lines (C) to annotate real-world sizes, or Calibration Marker (J) to align and scale import layouts.",
          "Grid & Snapping: Toggle the grid layout (G) and enable snap controls in the toolbar to lock mouse positions to 5cm, 10cm, or 50cm increments."
        ]
      }
    },
    {
      id: '3d_view',
      title: { fr: 'Visualisation 3D', en: '3D Viewport' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      ),
      content: {
        fr: [
          "L'onglet Vue 3D affiche votre maquette numérique sous forme tridimensionnelle. Propulsé par Three.js, il régénère la maquette en temps réel.",
          "Contrôles de la caméra : Clic gauche maintenu pour pivoter (orbite), clic droit maintenu pour effectuer un panoramique (translation), molette de la souris pour zoomer.",
          "Les ouvertures dans les murs (portes, fenêtres) sont automatiquement découpées grâce aux opérations booléennes CSG appliquées sur la géométrie 3D."
        ],
        en: [
          "The 3D View tab renders your project as a fully interactive three-dimensional digital twin. Powered by Three.js, it translates geometric data in real-time.",
          "Camera Controls: Drag with left click to orbit, drag with right click to pan, and roll the mouse scroll wheel to zoom.",
          "Wall cutouts (doors, windows) are calculated automatically using solid constructive geometry (CSG) subtraction operations directly on the 3D meshes."
        ]
      }
    },
    {
      id: 'walls',
      title: { fr: 'Murs (IfcWall)', en: 'Walls (IfcWall)' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="14" width="20" height="8" rx="1" />
          <rect x="2" y="2" width="20" height="8" rx="1" />
        </svg>
      ),
      content: {
        fr: [
          "Les murs (`IfcWall`) constituent l'ossature de votre bâtiment. Ils sont dessinés en cliquant sur deux points du plan (début et fin).",
          "Propriétés personnalisables : Dans le panneau de droite, vous pouvez modifier l'épaisseur (ex. 0.20m), la hauteur sous plafond (ex. 2.80m), le matériau, et des attributs structurels comme 'Porteur' (Load Bearing) ou 'Extérieur' (Is External).",
          "Jonctions automatiques : Les connexions d'angle entre murs s'adaptent géométriquement pour éviter les superpositions visuelles."
        ],
        en: [
          "Walls (`IfcWall`) act as the backbone of your building skeleton. Draw them in the 2D canvas by clicking the starting and ending points.",
          "Customizable Properties: Through the right property panel, customize thickness (e.g., 0.20m), wall height (e.g., 2.80m), material definitions, and structural flags like 'Load Bearing' or 'External'.",
          "Automatic Wall Joins: Wall intersections adjust automatically to clean up joints and eliminate overlapping 2D/3D polygons."
        ]
      }
    },
    {
      id: 'doors_windows',
      title: { fr: 'Portes & Fenêtres', en: 'Doors & Windows' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3h18v18H3z" />
          <path d="M9 3v18" />
        </svg>
      ),
      content: {
        fr: [
          "Les Portes (`IfcDoor`) et Fenêtres (`IfcWindow`) s'insèrent obligatoirement sur un mur existant. L'application gère leur liaison automatique.",
          "Paramètres géométriques : Ajustez le décalage relatif `t` le long du mur (valeur de 0 à 1), la hauteur, la largeur, le sens d'ouverture (pour les portes) ou la hauteur d'allège (sillHeight, pour les fenêtres).",
          "Synchronisation 3D : Chaque porte ou fenêtre crée dynamiquement un `IfcOpeningElement` dans le fichier IFC pour percer précisément l'enveloppe du mur."
        ],
        en: [
          "Doors (`IfcDoor`) and windows (`IfcWindow`) can only be placed on an existing wall. The application automatically snaps and binds them to the wall segment.",
          "Geometric Properties: Modify the relative offset `t` along the wall (0 to 1), width, height, swing direction (left/right for doors), or sill height (for windows).",
          "3D Synchronization: Placing an item dynamically creates an `IfcOpeningElement` in the IFC model, cutting an accurate opening in the hosting wall mesh."
        ]
      }
    },
    {
      id: 'slabs',
      title: { fr: 'Dalles (IfcSlab)', en: 'Slabs (IfcSlab)' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      ),
      content: {
        fr: [
          "Les dalles (`IfcSlab`) représentent les planchers, plafonds ou fondations horizontales d'un niveau.",
          "Tracé polygonal : Dessinez une dalle en fermant un contour de plusieurs points. Vous pouvez ensuite éditer l'épaisseur globale de la dalle (ex. 0.25m) et modifier son altitude relative dans les propriétés.",
          "La dalle sert également de support visuel principal dans le visualiseur 3D."
        ],
        en: [
          "Slabs (`IfcSlab`) represent floor plates, ceilings, or structural foundations for each building storey.",
          "Polygonal Boundary: Draw a slab by placing points to form a closed loop. You can adjust the overall slab thickness (e.g., 0.25m) and relative vertical elevation in the property pane.",
          "The slab boundary acts as the primary layout reference in the 3D rendering view."
        ]
      }
    },
    {
      id: 'rooms',
      title: { fr: 'Pièces & Espaces', en: 'Rooms & Spaces' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      ),
      content: {
        fr: [
          "Les pièces (`IfcSpace`) modélisent les espaces habitables ou fonctionnels d'un bâtiment (ex. Salon, Cuisine, Bureau).",
          "Calculs automatiques : En traçant le contour fermé de la pièce, l'application calcule automatiquement la surface au sol ($m^2$), le volume ($m^3$) et le périmètre total.",
          "Affectez un type d'occupation (privé, public) et une fonction spécifique dans les propriétés pour enrichir les métadonnées BIM."
        ],
        en: [
          "Rooms (`IfcSpace`) model functional indoor volumes (e.g., Living Room, Kitchen, Office).",
          "Automatic Calculations: By tracing the room's closed boundary, the app automatically computes the floor area ($m^2$), total volume ($m^3$), and outer perimeter.",
          "Assign occupancy levels and specific space functions in the properties panel to enrich your BIM metadata export."
        ]
      }
    },
    {
      id: 'furniture',
      title: { fr: 'Meubles & Mobilier', en: 'Furniture Catalogue' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 18v3M20 18v3M12 4v14M4 12h16M4 8h16" />
        </svg>
      ),
      content: {
        fr: [
          "Le mobilier (`IfcFurnishingElement`) permet d'aménager l'espace intérieur du projet.",
          "Catalogue intégré : Activez l'outil Meuble pour faire apparaître le catalogue d'objets (lits, tables, bureaux, rangements). Faites glisser et déposez l'élément désiré sur votre plan.",
          "Transformations : Vous pouvez modifier la largeur, la profondeur, la hauteur et la rotation de l'objet dans le panneau Propriétés pour qu'il s'ajuste parfaitement à votre aménagement."
        ],
        en: [
          "Furniture (`IfcFurnishingElement`) lets you dress and layout indoor rooms for spatial studies.",
          "Integrated Catalog: Selecting the Furniture tool displays a catalog of standard objects (beds, tables, desks, seating). Click to select and click on your canvas to place the item.",
          "Transformations: Resize individual object widths, depths, heights, and rotations through the property editor to match exact specifications."
        ]
      }
    },
    {
      id: 'technical',
      title: { fr: 'Éléments Techniques', en: 'Technical Fittings' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      ),
      content: {
        fr: [
          "Les installations techniques (`IfcDistributionElement`) comprennent la plomberie, l'électricité, le CVC (HVAC) et la domotique.",
          "Plomberie & Électricité : Placez des prises, interrupteurs, points d'eau ou radiateurs. Vous pouvez définir la hauteur de pose (mountHeight) par rapport au sol fini.",
          "Spécifiez la référence de circuit électrique ou le type de fluide (EF: eau froide, EC: eau chaude, EU: eaux usées) pour les canalisations."
        ],
        en: [
          "Technical fittings (`IfcDistributionElement`) cover MEP disciplines: electrical networks, plumbing systems, HVAC, and data lines.",
          "Plumbing & Power: Insert outlets, switches, water connectors, or HVAC vents. Define mounting heights (mountHeight) relative to the finished floor level.",
          "Specify electrical circuit references or plumbing fluid types (Cold Water, Hot Water, Drainage) for advanced engineering calculations."
        ]
      }
    },
    {
      id: 'ifc_sync',
      title: { fr: 'Exportation & Vérification', en: 'Export & Verification' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      ),
      content: {
        fr: [
          "Format d'Exportation multiple : En haut à droite, le menu Exporter permet de générer des plans sous format IFC4 (BIM), DXF/DWG (dessins vectoriels AutoCAD), JSON (base de données), PDF vectoriel (prêt à imprimer) ou PNG HD.",
          "Vérification de la maquette (Round-trip) : Cliquez sur le bouton 'Vérifier' pour contrôler la parfaite conformité géométrique et sémantique entre le plan 2D interactif et le fichier d'origine.",
          "Si des anomalies surviennent après une modification, le bouton 🪄 Corriger (AutoFix) répare chirurgicalement la structure géométrique."
        ],
        en: [
          "Multi-Format Export: Use the Export dropdown to download drawings as IFC4 (BIM model), DXF/DWG (AutoCAD vector format), JSON database structure, vector PDF (printable sheet), or High-Res PNG images.",
          "Round-trip Verification: Click the 'Verify' button to validate geometric and semantic integrity between your interactive 2D layout and the underlying IFC binary file.",
          "If inconsistencies appear after complex modifications, the 🪄 Correct (AutoFix) feature surgically repairs geometric properties."
        ]
      }
    },
    {
      id: 'ai_mcp',
      title: { fr: 'Assistant IA & MCP', en: 'AI Assistant & MCP' },
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      ),
      content: {
        fr: [
          "L'Assistant IA (panneau Sparkle à droite) permet de piloter l'application en langage naturel.",
          "Fonctionnement : Tapez ou énoncez votre demande (ex. 'allonge le mur w1 de 2 mètres', 'ajoute une porte sur le mur ouest'). L'IA traduit cela en commandes géométriques.",
          "Pont MCP (Model Context Protocol) : Lorsque le témoin vert 'MCP' est allumé dans la barre supérieure, des modèles d'IA externes comme Claude Desktop peuvent directement inspecter et manipuler votre plan en temps réel."
        ],
        en: [
          "The AI Assistant (Sparkle panel on the right) lets you control and edit your digital mockups using natural language.",
          "Usage: Type or voice instructions (e.g., 'lengthen wall w1 by 2 meters', 'insert a single swing door on the west wall'). The AI parses and applies these changes.",
          "MCP Bridge (Model Context Protocol): When the green 'MCP' indicator is active in the top bar, external AI systems like Claude Desktop can read, write, and execute spatial design actions autonomously."
        ]
      }
    }
  ];

  // Auto-scrolling based on selection
  useEffect(() => {
    if (!open || !syncEnabled || selection.length === 0) return;
    const selectedId = selection[0];
    const item = items[selectedId];
    if (!item) return;

    let targetSection: string | null = null;
    const type = item.type;

    if (type === 'Wall') targetSection = 'walls';
    else if (type === 'Door' || type === 'Window') targetSection = 'doors_windows';
    else if (type === 'Slab') targetSection = 'slabs';
    else if (type === 'Room') targetSection = 'rooms';
    else if (type === 'Furniture' || type === 'GenericElement') targetSection = 'furniture';
    else if (type === 'Technical') targetSection = 'technical';
    else if (type === 'Dimension' || type === 'Marker') targetSection = '2d_drawing';
    else if (type === 'Project' || type === 'Building' || type === 'Storey') targetSection = 'overview';

    if (targetSection) {
      isScrollingRef.current = true;
      setActiveSection(targetSection);
      const element = contentContainerRef.current?.querySelector(`#doc-sec-${targetSection}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Release scroll lock shortly after scrolling
      setTimeout(() => {
        isScrollingRef.current = false;
      }, 800);
    }
  }, [selection, items, open, syncEnabled]);

  // Scrollspy: update active chip based on scroll position
  const handleScroll = useCallback(() => {
    if (isScrollingRef.current || !contentContainerRef.current) return;
    const container = contentContainerRef.current;
    const scrollPos = container.scrollTop + 80;

    let currentChapter = chapters[0].id;
    for (const ch of chapters) {
      const el = container.querySelector(`#doc-sec-${ch.id}`) as HTMLElement;
      if (el && el.offsetTop <= scrollPos) {
        currentChapter = ch.id;
      }
    }
    setActiveSection(currentChapter);
  }, [chapters]);

  const scrollToChapter = (chapterId: string) => {
    isScrollingRef.current = true;
    setActiveSection(chapterId);
    const element = contentContainerRef.current?.querySelector(`#doc-sec-${chapterId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setTimeout(() => {
      isScrollingRef.current = false;
    }, 800);
  };

  // Helper to highlight matching queries
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <mark
              key={i}
              style={{
                backgroundColor: 'oklch(0.85 0.16 85)',
                color: '#0e0e10',
                borderRadius: '3px',
                padding: '0 2px',
                fontWeight: 'bold',
              }}
            >
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  // Filter chapters and paragraphs based on search query
  const filteredChapters = chapters
    .map((ch) => {
      const titleText = ch.title[docLang];
      const matchedParagraphs = ch.content[docLang].filter((p) =>
        p.toLowerCase().includes(searchQuery.toLowerCase())
      );
      const titleMatches = titleText.toLowerCase().includes(searchQuery.toLowerCase());

      if (titleMatches || matchedParagraphs.length > 0) {
        return {
          ...ch,
          matchedParagraphs: matchedParagraphs.length > 0 ? matchedParagraphs : ch.content[docLang],
        };
      }
      return null;
    })
    .filter(Boolean) as (DocChapter & { matchedParagraphs: string[] })[];

  if (!open) return null;

  return (
    <div
      className="help-doc-panel"
      style={{
        position: 'fixed',
        top: 60,
        right: 14,
        width: 420,
        height: 'calc(100vh - 100px)',
        maxHeight: 760,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 85,
        overflow: 'hidden',
        animation: 'slidein 0.22s cubic-bezier(.2,.8,.2,1)',
      }}
    >
      {/* HEADER */}
      <div
        className="help-doc-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 'var(--pad-3) var(--pad-4)',
          borderBottom: '1px solid var(--border-faint)',
          background: 'var(--bg)',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
            Documentation
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase' }}>
            {makeT(lang)("Interactive Guide")}
          </div>
        </div>
        <button
          className="btn icon ghost"
          onClick={onClose}
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* TOOLBAR CONTROLS */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-faint)',
          background: 'var(--bg)',
        }}
      >
        {/* SEARCH BAR */}
        <div
          className="search"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '0 8px',
            height: 30,
            margin: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--ink-3)' }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={makeT(lang)("Search tools, IFC...")}
            style={{
              flex: 1,
              border: 0,
              background: 'transparent',
              outline: 'none',
              fontSize: 12,
              color: 'var(--ink)',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                background: 'none',
                border: 0,
                color: 'var(--ink-3)',
                cursor: 'pointer',
                fontSize: 10,
                padding: '2px',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* SYNC SELECTION TOGGLE */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={() => setSyncEnabled(!syncEnabled)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'transparent',
              border: 0,
              padding: '4px 2px',
              fontSize: 11,
              fontWeight: 500,
              color: syncEnabled ? 'var(--ink)' : 'var(--ink-3)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: syncEnabled ? 'oklch(0.65 0.16 145)' : 'var(--ink-4)',
                boxShadow: syncEnabled ? '0 0 6px oklch(0.65 0.16 145)' : 'none',
                display: 'inline-block',
                transition: 'all 0.2s',
              }}
            />
            {makeT(lang)("Sync selection")}
          </button>
          {syncEnabled && selection.length > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9.5,
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                padding: '2px 6px',
                borderRadius: 4,
              }}
            >
              {items[selection[0]]?.type || 'Element'}
            </span>
          )}
        </div>
      </div>

      {/* TABLE OF CONTENTS (HORIZONTAL CHIPS) */}
      <div
        className="doc-toc-scroll"
        style={{
          background: 'var(--panel-2)',
          borderBottom: '1px solid var(--border-faint)',
          padding: '6px 12px',
          overflowX: 'auto',
          display: 'flex',
          gap: 6,
          scrollbarWidth: 'none',
        }}
      >
        {chapters.map((ch) => {
          const isVisible = filteredChapters.some((f) => f.id === ch.id);
          if (!isVisible) return null;

          const isActive = activeSection === ch.id;
          return (
            <button
              key={ch.id}
              onClick={() => scrollToChapter(ch.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 999,
                border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: isActive ? 'var(--accent-soft)' : 'var(--bg)',
                color: isActive ? 'var(--accent-strong)' : 'var(--ink-2)',
                fontSize: 11,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {ch.icon}
              {ch.title[docLang]}
            </button>
          );
        })}
      </div>

      {/* DOCUMENTATION CONTENT BODY */}
      <div
        ref={contentContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          background: 'var(--bg)',
        }}
      >
        {filteredChapters.length === 0 ? (
          <div
            style={{
              padding: '40px 10px',
              textAlign: 'center',
              color: 'var(--ink-3)',
              fontSize: 12.5,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div>
              {makeT(lang)("No documentation chapters match your search.")}
            </div>
          </div>
        ) : (
          filteredChapters.map((ch) => {
            const isActive = activeSection === ch.id;
            return (
              <div
                key={ch.id}
                id={`doc-sec-${ch.id}`}
                style={{
                  paddingBottom: 16,
                  borderBottom: '1px solid var(--border-faint)',
                  scrollMarginTop: 12,
                  transition: 'opacity 0.2s',
                  opacity: searchQuery ? 1 : isActive ? 1 : 0.65,
                }}
              >
                <h4
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    color: isActive ? 'var(--accent-strong)' : 'var(--ink)',
                    margin: '0 0 10px 0',
                    transition: 'color 0.2s',
                  }}
                >
                  <span
                    style={{
                      color: isActive ? 'var(--accent)' : 'var(--ink-3)',
                      display: 'inline-flex',
                    }}
                  >
                    {ch.icon}
                  </span>
                  {highlightText(ch.title[docLang], searchQuery)}
                </h4>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: 'var(--ink-2)',
                  }}
                >
                  {ch.matchedParagraphs.map((para, idx) => (
                    <p key={idx} style={{ margin: 0 }}>
                      {highlightText(para, searchQuery)}
                    </p>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* FOOTER */}
      <div
        style={{
          padding: '8px 14px',
          background: 'var(--panel-2)',
          borderTop: '1px solid var(--border-faint)',
          fontSize: 10,
          color: 'var(--ink-3)',
          fontFamily: 'var(--font-mono)',
          textAlign: 'center',
        }}
      >
        {makeT(lang)("Select an object to locate details")}
      </div>
    </div>
  );
}
