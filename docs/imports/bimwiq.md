# BIMWIQ import — 1 T exercise

First partial import, built from the supplied JSON (save_version 3.37.5).
The "Import IFC / BIMWIQ" menu now accepts .json files.
A BIMWIQ import always creates a new project. The source file stays untouched.

## Verified coverage

- Project, building and one level.
- 40 wall/partition segments, coordinates and total thickness computed from the layers.
- 8 windows and 8 passage elements (7 doors and 1 passage without a leaf), linked to the walls; dimensions inherited from the catalogue, sills and positions.
- 8 interior rooms including 3 bedrooms: outline, name, use and ceiling height.
- The space marked outside is left out: it is not a ninth room.

Coordinates are assumed to be in metres. Walls with axis=1 use a face line: their axis is offset by half the
thickness towards the inside, then the axes are intersected at shared
corners. Partitions with axis=0 keep their axis. Longitudinal positions
of the openings are recomputed to keep their placement after this
conversion. This convention is checked on the supplied file.
Wall height uses slab_height, which will need to be told apart from ceiling
heights for an accurate reconstruction. For several levels,
elevations are accumulated in file order: convention to confirm.

## What is missing to import all the data of this file

| Data | What skAItch already has | Remaining work |
| --- | --- | --- |
| Doors and windows | Entities linked to walls, dimensions, sill, opening direction | Import added for the opening_position=1 mode: distance to the jamb from wall_lock_vertex, inherited dimensions (-1), sills, sliding windows and swing doors. Confirm the opening-direction conventions and the other placement modes before a precise import. |
| Wall axes and joins | Centre axes, thickness, junctions | axis=0 and axis=1 converted, corners recomputed and opening placement preserved. Other conventions need examples; flip_wall_type remains to be interpreted for the layer order. |
| Slabs (8 in the level) | Polygonal slabs and thickness | Read outlines and slab_type, thickness/layers and vertical offsets; handle holes if any. |
| Roof | Parametric roof model | Convert BIMWIQ vertices, lines and surfaces, planes, slopes, overhangs and attachments. The surface in this file has a zero slope. |
| Beams (2) | Generic IFC elements | Build the oriented geometry from the end points and the section type; plan an editable beam model to keep all its properties. |
| Multi-layer materials | Wall thickness and overall material | Add the ordered composition, material references and physical properties. The current import only keeps the sum of thicknesses. |
| Finishes | A few material properties | Model finishes per face/floor/ceiling and their references; import facing_types, facings and finishes. |
| Thermal | A few properties such as U and IsExternal | Add zones, room-zone relations, heating, boundary conditions, thermal bridges and detailed joinery properties. |
| Regulatory areas | Room polygons | Keep the Carrez/habitable/usable selections and the computation rules. This import performs no equivalent regulatory computation. |
| Site and exterior | No site model in ItemsMap | Add a terrain grid (zero heights here), an exterior container and the related objects/outlines. |
| Background plans (2 references) | Calibrated plan image per level | Resolve image_id to the images, translate scale, orientation and reference points. Pixels are not in this JSON: the images are needed. |
| Presentation and metadata | Project name, address, markers/sections | Translate room numbering, display settings, section planes, orientation and administrative extensions. |
| Faithful preservation | Saving skAItch entities | Durably store the source JSON, BIMWIQ IDs and unsupported fields, with conversion tracking. rawStructure is available in memory, with no guarantee it survives a reopen. A faithful BIMWIQ export is not implemented. |

The file contains no stairs and no furniture placed in the level.
The catalogue contains more types than those actually used.
The goal of an exhaustive import also includes keeping
unused catalogues and settings, not only the visible geometry.
