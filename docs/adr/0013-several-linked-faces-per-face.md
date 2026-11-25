# A face can be linked to several faces, each over its own stretch

Amends ADR 0008. A wall face keeps a list of face links instead of a single one: a long wall of a room can be the other side of several rooms (a living room wall along a corridor then a bedroom), each link with its own offset, so its common stretch. Links of one face must not overlap, and every link has its back link on the other face. The face keeps its single measured length: there is no artificial corner to add, and the offset of each link is the cote measured along the wall from the corner to the next room. Survey format 5 turns the former single link into a one-element list.

## Considered Options

- Split the long face with a vertex, one face per neighbouring room: keeps one link per face, but adds a corner that does not exist and a second length to measure on site.
- Level walls referenced by segments from the rooms (rejected in ADR 0008 for the same reasons).

## Consequences

- Reconstruction still produces one BIM wall per long face, with a single thickness, even when the partitions behind it differ; each link keeps its own thickness for placement, and a thickness measured on one partition is not copied over another one measured differently.
- Linked faces drawn further apart than a wall are not merged at reconstruction: each keeps its own wall until the room is placed.
- Linking a room that is not moved (resolved by its measurements, or frozen) no longer requires its face to be drawn within reach: the link is recorded and the global plan places the room.
