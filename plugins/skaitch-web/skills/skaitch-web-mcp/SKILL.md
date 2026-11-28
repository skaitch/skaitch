---
name: skaitch-web-mcp
description: Drive a skAItch BIM/IFC project through its MCP server (tools named *skaitch*__list_projects, get_storey_floorplan, create_wall, create_door, create_furniture, create_sheet, export_ifc…). Use whenever the user wants to inspect, model, digitise a floor plan, furnish, annotate, lay out sheets or export a skAItch project — for example, "model this floor plan", "add doors", "create an A3 sheet", or "export the IFC" — even if they don't say "MCP".
---

# skAItch MCP

Tool names below omit the MCP server prefix.

Use the compact MCP interface when available. Load `edit_model` before modelling and `analyze_model` for substantial queries. Discover only the required argument schemas with `search_tools`. Tool names below refer to BIM operations you can invoke through `call_tool` with JSON-encoded arguments.

## 0. Context — always first

The `skaitch-web` server uses OAuth and lists the projects authorized for this connection.

1. `list_projects` → `select_project` → `list_spatial_structure` → `select_storey`. Avoid `execute_script` on Web: it needs an open editor tab and is disabled while change validation is on.
2. Never assume the project shown in the browser is the MCP context: selection belongs to the connection/API key.
3. Cloud reads see the **saved** model — ask the user to save before reading their recent edits.
4. Mutations apply directly on the saved model by default. If the user turned on « always validate » in settings, they need an open editor tab to approve. `get_view`/`set_view`/`capture_view` need an open editor tab.

5. `generate_visualization` uses the account’s saved AI preferences.

## Pick the mode

| User intent | Mode |
|---|---|
| "What's in…", audit, quantities, check | **A. Inspect** |
| Model walls/rooms/openings from a plan image or DXF | **B. Digitise a plan** |
| Furnish, fixtures (WC, shower, sink, water heater…) | **C. Furnish** |
| Roof, stairs, slabs, storeys | **D. Structure** |
| Dimensions, markers, sections, sheets, PDF/IFC | **E. Document & export** |
| Look at the result | **F. Visual check** |

### A. Inspect (read-only, no confirmation needed)
- `get_ifc_scene_overview` for a summary + catalogue.
- `list_ifc_entities {type, storey_id}` then `get_element_properties` on what matters.
- `get_wall_connections` for topology questions; `measure_distance` for clearances.
- Answer with IDs and metric values; don't mutate.

### B. Digitise a plan
1. `get_storey_floorplan` on the target storey. If it reports a **vector** (DXF) background, use `get_background_geometry` (filter by layers/bbox) instead of measuring pixels.
2. Read existing walls/spaces/markers (`list_ifc_entities`, `get_element_properties`). Markers are already world metres.
3. **Write the inventory before creating anything** (in your reply or a scratch file): walls (endpoints, thickness, interior side), rooms, every opening (jambs, width, host wall, hinge, leaf tip, type), every requested fixture, dimension lines if requested. Mark uncertain items with a reason.
4. Fix one **wall height per storey** (user → section → existing walls → else 2.80 m, stated as assumption). Pass it explicitly to every `create_wall`.
5. Use `apply_model_batch` for related creations in the selected storey. Order operations by dependency: slab → walls → wall connections → spaces → hosted openings → fixtures and dimensions → roof. Give an operation an alias and reference its ID later with `{"$ref":"alias.id"}`. Then inspect the applied geometry.
6. Coordinates: either world metres, or `coordinates_in_pixels:true` + `pixel_space:"image"` for pixels measured on the attached image. Convert once, never twice.
7. Doors: prefer `hinge_point` + `opening_towards` (world points or marker IDs); `position` is the **centre fraction**, not metres. Windows: pick the operation type from the symbol + catalogue `catalogue_id`, measure the sill.

### C. Furnish
- Only use `catalogue_id`s from the catalogue returned by `get_storey_floorplan` / `get_ifc_scene_overview` (or `list_object_types`). Never invent IDs.
- Read `frontAngle` + `frontDescription`; place with `anchor:"center"` (measured centre) or `anchor:"back"` (inner wall face), and orient with `facing_point` rather than guessing `rotation`.
- Pre-check rotated corners against the room polygon and neighbours before each call.

### D. Structure
- `create_storey` / `update_storey` with explicit elevation and slab thickness; inspect existing elevations first.
- `create_slab`, `create_roof` (polygon in world metres, `roofType`, `pitch`, `attach_walls:true` to trim walls under it).
- `create_stair` with `geometry.targetId` = a real upper storey ID; edit via `update_element`.
- `create_technical` / `update_technical` for wall-mounted technical elements (rotation 0 faces −Y).

### E. Document & export
- `create_dimension` from actual drawing locations; `create_marker` for reference points you'll reuse.
- `create_section` (plan line `x1,y1,x2,y2`) → `create_sheet` (A3 landscape default) → `add_sheet_view` (plan: storey id; section: section id; position in mm from top-left) → `update_sheet_view` → `export_sheet` to check.
- `export_ifc` returns IFC4 STEP text: write it to a file the user named (default `export.ifc`), don't dump it in chat.

### F. Visual check
`set_view {mode:"2d"|"3d", storey_id, fit}` → `capture_view` → look at the image. Use it after each batch of creations, not only at the end.

## Verify — every mutation batch
1. Re-read created elements with `get_element_properties`; a success response doesn't prove correct placement.
2. Compare against the measured references (positions, widths, hinge side, facing).
3. Fix with `update_wall` / `update_opening` / `update_furniture` / `update_element`; `delete_element` only for elements you created or the user named.
4. Before finishing, reconcile the inventory: every entry → created ID, or an explicit unresolved reason. Report all wall heights and any justified exception.

## Final report
Short list: what was created/changed (counts + IDs per type), assumptions (wall height, thickness, types), unresolved items, and a `capture_view` image when the editor is open.

## Guardrails
- Never delete storeys (`delete_storey recursive:true`) or bulk-delete without the user's explicit yes.
- Don't copy coordinates from the server's synthetic examples.
- Missing optional parameters in a client (e.g. no `anchor`) are not a reason to skip an element — use the compatibility fallbacks in the server guide.
