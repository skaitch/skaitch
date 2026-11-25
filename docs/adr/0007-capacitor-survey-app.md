# The Survey app is a Capacitor app of the monorepo

The Survey app is `apps/survey`: a Vite + React application packaged for Android and iOS with Capacitor. It reuses `packages/core` (model and survey file format) and `packages/ui`, in particular the sketch editor shared with the editor's Survey tab. As with Electron (ADR 0002), the native layer is only a shell around web code; camera and file system go through Capacitor plugins.

## Considered Options

- React Native / Expo: native rendering, but the DOM/SVG sketch editor of `packages/ui` would have to be rewritten, doubling maintenance for a single developer.
