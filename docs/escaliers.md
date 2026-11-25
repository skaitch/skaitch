# Stairs and building sections — validated scope

## Scope

Create and edit parametric stairs in plan and in 3D, from the interface and from the AI assistant.

- Shapes: straight, quarter turn, two quarter turns, half turn, spiral.
- Turns with a landing or with winders when the shape allows it.
- Configurable width, position, orientation, direction of rotation, going and number of steps; radius for the spiral and landing dimensions depending on the shape.
- Linked to a start storey and an arrival storey. The height to climb follows their elevations.
- Number of steps computed automatically, recomputed after an elevation change unless set by hand.
- Dimensions kept when space is short, with a warning; no silent correction.
- Left and right guardrails enabled separately, adjustable height, balusters or solid panels.
- Stair opening proposed automatically, with position and dimensions adjustable before validation.
- Vertical section of the whole building placed from the plan, showing stairs and floors.
- Structured IFC export: stair, flights, landings and guardrails identifiable.

## Competition

- Revit: assembly of flights, landings and guardrails; usual shapes and spirals; work in plan and 3D. https://help.autodesk.com/cloudhelp/2017/ENU/Revit-Model/files/GUID-D4861B15-29FF-49F8-B292-39AD62EBCDD3.htm
- Archicad: geometric constraints, alternatives on conflict, headroom shown in 3D and in section. https://help.graphisoft.com/AC/29/INT/_AC29_Help/040_ElementsVB/040_ElementsVB-188.htm
- Sweet Home 3D: stair models paired with a ceiling cut-out when an upper level exists. https://www.sweethome3d.com/blog/how-to-customize-staircases/

The chosen approach combines a selection of parametric shapes, an explicit stair opening and a building section. Warnings are not a regulatory certification.

## Technical scope to cover

- Entity types and persisted data, defaults, translations and catalogue.
- Creation, selection, moving, rotation, duplication, deletion and properties.
- Geometry shared by the plan and 3D representations, sections and export.
- Floor openings and storey tracking; existing projects preserved.
- AI tools: schemas, execution, parameter validation and parity with the interface.
- IFC export and handling of imported entities; geometric tests and checks in web-ifc.
- Tests of elevation changes, manual mode, turning shapes, stair openings and sections.

## Findings and points still to check

The current types define neither a parametric stair nor a section view. IFC processing recognises IFCSTAIR and IFCSTAIRFLIGHT as generic elements: this does not prove they can be edited parametrically. Floors have an outline and a thickness, without a typed opening in their current interface.

Still to check: section rendering, floor cut-outs, the behaviour of imported stairs and whether parameters survive a re-import. Distinguish geometrically two quarter turns (three flights) from the half turn (two opposite flights) in the catalogue. Warning thresholds, guardrail details and the cases of a deleted storey must be made explicit during technical design.

## Usage

1. Create an upper storey with a higher elevation.
2. Pick the Stair tool: a palette shows the five shapes with a preview. Choose the shape and, for turns, landing or winders, then click in the plan of the start storey.
3. In the properties, select the arrival storey, then adjust the steps and guardrails. Each flight has its length, adjustable with the mouse by dragging the square handle at its end in the plan (snapping per the plan settings), or in the properties; each landing has its depth and width. Resizing a flight keeps the going and adds or removes steps in that flight. Its effective length moves in going increments; the riser height is recomputed to reach the arrival storey. Resizing with the mouse or in the properties replaces a step count previously set by hand. "Recompute with the going" restores the automatic lengths.
4. To rotate the selected stair, move its round handle in the plan (Shift: 15° steps), or type the rotation in the properties. The outer diameter is adjustable for the spiral and for turns with winders; it includes the inner radius and the step width.
5. With a slab on the arrival storey, propose a stair opening, adjust its position and dimensions, then validate it.
6. Click Draw a section, draw its axis in the plan, then open the Section tab. The selector picks between several sections.
7. Through AI/MCP, use create_stair then update_element; count:null re-enables automatic computation.

The "Up" arrow follows the steps and landings, from the bottom to the top exit, including in turns and spirals.

## Start on radiating winders

For a quarter turn, two quarter turns or a half turn, enable "Start on radiating winders" in the properties. The first turn is moved to the start, without adding a turn: 90° for a quarter turn or two quarter turns, 180° for a half turn. All straight flights keep their lengths and steps. The first landing, if any, is replaced by this radiating start; the other turns and landings are kept. The riser height is recomputed to reach the arrival storey. Through the assistant: startWinders:true. Older starts saved with a zero first length are read as an added start with a first flight restored to its default length.

## Moving a storey

In a storey's properties, the "Move storey" section translates all its elements, its background plan and the openings cut in its slabs at once (a single undo). Sections do not move. A stair opening always follows its slab: moving only the start storey or only the arrival storey misaligns the stair from its opening, and a warning invites to readjust it. On IFC export, imported elements only get their placement changed; walls hosting doors or windows are regenerated with their openings at the same position.

## Current limits

- Winders use an equal angular split, without a custom balancing solver.
- The proposed stair opening is rectangular and must stay within a single slab of the arrival storey. It keeps its position when the stair is moved; warnings invite to readjust it.
- IFC elements imported as generic elements are shown in section by their bounding volumes. New parametric geometries are cut directly.
- IFC re-import does not restore the parametric configuration of stairs; the native project save keeps it.
- Dimensional warnings are indicative, with no guarantee of regulatory compliance.

Status: implemented; automated TypeScript, geometry, section SVG rendering, MCP tools and IFC export checks.
