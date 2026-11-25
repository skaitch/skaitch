# Vector background plans stored as normalized geometry, not as the original CAD file

A vector background plan (imported from DXF; DWG support will convert to DXF first, see ADR 0015) is parsed once at import, on the client in `packages/core`. The `.skaitch` project file then stores only the result, next to the image background plans: flattened polylines (blocks exploded, arcs and splines split into segments), texts, and layers with their colour and visibility. Coordinates are integer millimetres, recentred on the extent's bottom-left corner and placed in the world like an image plan. The chosen unit and the origin offset (metres) are kept as metadata; `url` keeps a raster preview of the visible layers for image consumers. The original DXF/DWG is not kept. Changing the unit, the crop or the source version means importing again, as an image crop already does.

## Considered Options

- Keeping the original DXF and parsing it on every load: rejected. Architects' and surveyors' files of 20 to 50 MB would bloat the project file, slow down opening, and make every consumer (rendering, snapping, MCP tools, both web and desktop) depend on the parser.
- Keeping both the original file and the normalized geometry: rejected for now. It doubles the storage for a benefit (re-cropping or changing the unit without the source file) that a re-import already covers.

## Consequences

- The geometry can be drawn, snapped to and served to MCP tools as soon as the project opens, with no parsing.
- Any information dropped at import (hatches, 3D entities, paper space, precise spline definitions) cannot be recovered from the project. Reading more of the CAD file later requires a new import from the source file.
- The origin offset must be kept so that georeferenced coordinates (e.g. Lambert 93) can be recovered for a later georeferenced export or an aligned re-import.
