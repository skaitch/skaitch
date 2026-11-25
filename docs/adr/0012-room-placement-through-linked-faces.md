# Rooms are placed through their linked faces, without diagonals between rooms

A room is placed rigidly against an already placed room from a single linked face: the wall's direction, its surveyed thickness and the link offset, which now carries a measured/assumed status. Each room is placed by one path from the reference room, preferring fully measured links, then shorter ones; extra links become closure checks whose gap is reported, never spread or averaged. A face linked to a placed room also gives the room solver that wall's direction; one direction only orients the room, but from two linked walls on, the angles between them constrain its shape, so such a room can be resolved from its wall lengths and links alone; this extends ADR 0009, where a room was resolved only by its own measurements. When something is missing, the app asks for a single suggested cote, in this order of preference: wall length, then link offset or thickness, then angle, and a diagonal only as a last resort. Diagonals are hard to measure on site (furniture, long spans), whereas offsets and thicknesses are taken along a wall or at a door jamb.

## Considered Options

- Least-squares adjustment of loops (as in a surveyor's traverse): it hides typing errors by spreading them over every room, and contradicts the rule that a measured cote is never corrected silently.
- Keeping each room solved in isolation and placing only resolved rooms: it forces a diagonal in rooms whose shape is already fixed by their neighbours.
- Placing on an unmeasured offset (0 by default) as if it were measured: it would present a guess as a measurement.

## Consequences

- The placement is computed every time, but a room's drawing moves only on an explicit "Replace" action; a room whose cotes change is flagged "to replace".
- A placement that relies on an assumed offset or thickness is an assumed placement: shown, marked as such, and reported as a warning at reconstruction.
