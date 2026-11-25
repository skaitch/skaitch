# Free section — scoping in progress

## Validated choices

- Replace the "Section" and "Draw a section" buttons with "Define a section" in the 3D view.
- Place the plane on a face of the building, then allow moving and freely rotating it with handles.
- Allow flipping the hidden side.
- Save several named sections in the project, with only one active at a time.
- Allow tilted planes in 3D.
- Show the cut elements with a solid cut surface and a marked outline; hatching per material is out of the first scope.
- Offer "View the section in 2D" for vertical planes only in the first version.

- In the 2D view, show cut elements with a thick line and elements visible behind with a thin line, with an adjustable depth.

## Validated compatibility

- Keep existing sections and turn them into vertical planes.
- The section hides elements visually without changing the building geometry.

Scope confirmed by the user on 13 November 2026.

## Verification and limits

- Unit tests: conversion of existing sections, tilted planes, intersection of transformed meshes, holes and open outlines.
- Browser walkthrough checked on the native demo building.
- TypeScript and Vite build validated.
- IFC validation done in the browser: loading, placement on a face, moving the plane and 2D view. `web-ifc` is pinned to 0.0.77 and its WASM is served by Vite from the installed package. IFC geometries used for sections come from the ThatOpen API, because render buffers may live on the GPU only.
- Filling requires closed outlines; open meshes stay shown by their lines.
- Edges behind the section are projected up to the chosen depth; full hidden-line removal remains a limit of this version.

## Refined ergonomics

- `three-pivot-controls` manipulator: moving along the normal with a single handle; rotation by rings, constant on-screen size, enlarged grab zones and annotations while dragging.
- Section plane shown as a translucent rectangle; handles centred on the building.
- Panel using the application's buttons, fields, segmented controls and theme variables.
- Position set with a slider, metric input and 10 cm steps; direction and tilt typed in degrees.
- Dragging and angle input checked on an IFC in the browser; styles checked in light and dark themes.

- Panel draggable by its header, with its position remembered in the browser and kept within the view on resize. Arrow keys move it; the Home key brings it back to its initial place. Dragging and restoring after a reload checked in the browser.
- Thickness of the move handles reduced, length kept.
