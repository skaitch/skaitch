# A shared wall is a pair of linked faces

In the survey file, each room keeps its walls and their face lengths. A physical wall common to two rooms is represented by a **face link**: a face of one room is linked to the opposite face of the other room, over a common stretch (an offset on each face). The link is recorded on both sides. An opening stays a single object held by one room; the other room sees it through the link. Reconstruction produces a single BIM wall for a pair of faces linked over their whole length.

## Considered Options

- Level walls referenced by segments from the rooms: closer to BIM, but it would rework the format, the editor and the reconstruction already delivered.
- Sharing limited to faces of equal extent: simpler, but a wall common to a large and a small room could not be shared.
