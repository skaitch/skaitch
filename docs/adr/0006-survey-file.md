# A survey travels as a self-contained survey file

The Survey app (mobile, offline) hands a survey to skAItch through a survey file: an archive holding the versioned data and the photos, whose format is defined in `packages/core`. A storey's Survey tab imports it, on the web as well as in the desktop app without an account. The survey is self-contained and may hold several levels; at import, each survey level is explicitly associated with a skAItch storey.

## Considered Options

- Server synchronisation from the start (Firestore/Storage): rejected for the MVP; web-only, it excludes the desktop app without an account and requires conflict and media handling. It may come later as a mere transport of the same contract (see ADR 0011).
- Survey tied to an existing skAItch storey: rejected; the craftsperson must be able to survey without a prepared project or network.
