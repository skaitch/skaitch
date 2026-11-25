# The survey's geometric solver is written in the core

Resolving a room from its cotes (face lengths, diagonals, angles) is deterministic code in `packages/core`: triangulation from the measured diagonals for quadrilaterals and polygons, use of the typed angles, and the largest residual to measure how far contradictory constraints disagree. A locked cote is never changed; a difference above the **tolerance, 1 cm by default and configurable per survey**, is reported, never corrected. A room without enough measurements stays "unresolved geometry" and the app asks for the missing measurement.

## Considered Options

- Generic geometric constraint library (WASM): more general, but a heavy dependency in the core and a behaviour harder to explain to the user, whereas dwelling rooms are resolved by triangulation.
- A 5 mm tolerance (too many warnings with a tape measure) or 2 cm (lets typing errors through): 1 cm matches a laser meter and centimetre cotes.
