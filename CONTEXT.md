# Building modelling

## Language

French UI terms are given in parentheses.

**Stair** (escalier):
Circulation element joining a start storey to an arrival storey; the height it climbs depends on the elevations of those two storeys.

**Flight** (volée):
Continuous run of steps between two levels or landings.

**Landing** (palier):
Horizontal surface interrupting or ending a flight.

**Going** (giron):
Horizontal distance between the nosings of two successive steps, measured on the walking line.

**Winder** (marche balancée):
Step of varying width allowing a change of direction without a landing.

**Stair opening** (trémie):
Opening in a floor letting the stair through.

**Section** (coupe générale):
View of the building along a vertical plane, showing the elements it cuts and how they relate in height.

**Headroom** (échappée):
Clear height above the walking path of a stair.

**Background plan** (fond de plan):
Reference drawing attached to a storey, positioned and calibrated to support drawing. A storey has at most one; it is either an image background plan or a vector background plan, and importing one replaces the other.

**Vector background plan** (fond de plan vectoriel):
Background plan read from a CAD drawing (DXF, or DWG converted to DXF), kept as lines rather than pixels. A reference only: it never becomes model elements by itself.

**Reference storey** (étage de référence):
Lower storey shown as a guide to draw or adjust the walls of the current storey.

**Crop at import** (recadrage à l'import):
Selection of a rectangular part of an image or a CAD drawing to make the current storey's background plan. Changing that selection requires a new import.

**Plan alignment** (alignement du fond de plan):
Translation of a newly imported background plan so that a point picked on it coincides with the matching point on the reference storey. Works the same for image and vector background plans.

**Origin offset** (décalage d'origine):
Translation applied at import to bring a CAD drawing's coordinates near the project origin; kept so the drawing's original coordinates can be recovered.

**Section plane** (plan de coupe):
Oriented plane crossing the building that decides which side is hidden to look inside, without changing its elements.

**Free section** (coupe libre):
Named section whose plane can be moved and oriented in space, including tilted.

**Section depth** (profondeur de coupe):
Distance behind the section plane up to which elements are shown in the section view.

**Project file** (fichier projet):
Self-contained document holding a whole project, opened and saved by the user; the only way to exchange a project between the web app and the desktop app.

**Desktop app** (application de bureau):
Edition of skAItch installed on Windows, Linux or macOS, usable without an account; its projects are local project files.

**Project library** (bibliothèque de projets):
Folder chosen by the desktop app's user whose project files make the home page's project list; a project file elsewhere is imported or exported.

**Archived project** (projet archivé):
Project hidden from the home page's main list, shown under the Archived view; it stays intact, can be opened and edited, and is unarchived by the user. On the web it still counts toward the account's project limit. Archiving is a state of the library or account, not of the project file.

**Administrator** (administrateur):
Web app account allowed to read the usage statistics of all accounts; it acts neither on other accounts nor on their projects.

**Operation** (opération):
Named processing the web app asks the server for (IFC import, project save, chat turn, rendering…); the counting unit of usage statistics.

**Active account** (compte actif):
Account that requested at least one operation during the period considered.

**Code Mode** (mode script du chat):
Capability of the built-in chat in skAItch Desktop and skAItch Online to run a script written by the assistant or the user. A script can combine multiple tool calls in one chat turn and has read-only access to the open project, across all its storeys.

## Survey

**Survey** (relevé):
Everything observed and typed on site for a storey (rooms, walls, cotes, openings, existing technical points, photos, annotations); it is the source of truth for measurements and is used to rebuild the model.

**Survey app** (application Survey):
Dedicated mobile app to capture a survey on site, offline; it shares the survey model with the editor.

**Technical point** (point technique):
An individual electrical, data, plumbing, HVAC or fire safety point identified by a model in the skAItch technical catalogue, such as a power outlet, a cold water supply or a fire extinguisher.

**Wall elevation** (vue de face du mur):
View of a surveyed wall face from its room, showing the positions and cotes of its technical points.

**Survey tab** (onglet Survey):
View of the skAItch editor (web and desktop) that shows a storey's survey, checks it and starts its reconstruction.

**Survey level** (niveau relevé):
Level created in the Survey app, independently of any skAItch project; a survey may hold several.

**Level association** (association de niveau):
Explicit, reversible link between a survey level and a skAItch storey, made at import; a storey's Survey tab shows the survey level associated with it.

**Survey file** (fichier relevé):
Self-contained archive (versioned data and photos) produced by the Survey app and imported in the Survey tab; it is the exchange contract of a survey, whatever the transport.

**Reconstruction**:
Creation or update of a storey's BIM elements from its survey level; it never touches elements that do not come from the survey.

**Survey correlation** (corrélation relevé):
Persistent link between a survey object (wall, opening, room, technical point) and the BIM element it produced; a new reconstruction updates that element instead of creating another.

**Reconstruction conflict** (conflit de reconstruction):
An element produced by the survey was modified in skAItch since the last reconstruction; it is reported to the user, never silently overwritten.

**Face length** (cote de face):
Length measured on the finished inner face of a wall, room side; the only reference for survey cotes (walls, before/after distances of openings). A shared wall has one face length per room; their difference is a check.

**Surveyed thickness** (épaisseur relevée):
Wall thickness, measured (for example at a door jamb) or estimated; used to go from faces to the wall axis at reconstruction only.

**Assumed geometry** (géométrie supposée):
Room shape completed by an explicit hypothesis (for example a rectangle's right angles) for lack of measurements; it stays marked as such until a measurement confirms it.

**Linked faces** (faces liées):
Two wall faces of neighbouring rooms that are the two sides of one physical wall, over a common stretch; each face keeps its face length, and reconstruction produces a single wall. A face can be linked to several faces, over stretches that do not overlap.

**Aligned faces** (murs dans le prolongement):
Two inner wall faces of different rooms on the same line and running the same way, as one wall continuing past a partition (a façade along two rooms); a measured set-back may separate the two lines. They fix how the rooms are turned and how far out they lie, and complete a link whose offset is not measured.

**Adjacent room** (pièce adjacente):
Room created from a door of a surveyed room, on the other side of its wall; it inherits the orientation and the wall, joined by linked faces.

**Resolution tolerance** (tolérance de résolution):
Largest difference between a measured cote and the resolved geometry before a warning; 1 cm by default, configurable per survey.

**Unresolved geometry** (géométrie non résolue):
State of a room whose cotes do not determine its shape; the app asks for a diagonal, an angle or an alignment.

**Reference room** (pièce de référence):
Room of a survey level chosen by the user (the first one by default) that stays where it is drawn and gives the plan its origin and orientation; rooms with no chain of linked faces to it are unplaced.

**Link offset** (décalage de liaison):
Distance, measured along a linked face, between the start of this face and the end of the opposite face; measured or assumed, like the surveyed thickness.

**Room placement** (placement de pièce):
Position and orientation of a resolved room deduced from a linked face with an already placed room, its link offset and the wall's surveyed thickness; it never needs a diagonal between rooms.

**Assumed placement** (placement supposé):
Room placement that relies on an assumed link offset or thickness; it is shown, marked as such, and the app asks for the missing cote.

**Closure check** (contrôle de bouclage):
Linked face not used to place a room, because the room is already placed by another path; the gap it leaves is reported with the cotes involved, never spread or averaged.

**Suggested cote** (cote suggérée):
The single measurement the app asks for to unblock a room's geometry or placement, chosen among wall lengths, link offsets and thicknesses, then angles; a diagonal only as a last resort.

**Frozen room** (pièce figée):
Room the user has locked against any change (cotes, drawing, openings, photos, position, deletion) until it is unfrozen; unrelated to a locked (measured) wall length.

**Sending to the account** (envoi au compte):
Upload of a survey file from the Survey app to the user's web account; each send is a revision, nothing is merged. The account stays optional.

**Survey reliability** (fiabilité relevé):
Summary level carried by each BIM element produced by the survey: measured, partly estimated, assumed, or modified in skAItch. Computed from the survey at reconstruction; the per-value detail stays in the survey.

**Modified in skAItch** (modifié dans skAItch):
Survey reliability of an element changed by hand since the last reconstruction; it no longer claims to reflect the survey until a new reconstruction is accepted.

**Previous survey elements** (éléments d'un relevé précédent):
Elements a storey received from another survey than the one now attached; the next reconstruction asks whether to delete them or keep them as ordinary elements, never both kept and followed.
