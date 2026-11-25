# A core shared by the web app and the desktop app

skAItch becomes a pnpm monorepo: `packages/core` (BIM model, IFC, MCP tools, project file format), `packages/ui` (shared React), `apps/web` (Vite, Firebase, Vercel) and `apps/desktop` (Electron). The core never imports `firebase`, `react` or `electron`; storage goes through a `ProjectRepository` interface, implemented with Firestore on the web and with files on the desktop. This split keeps authentication and Firestore out of the shared code, where they would prevent a desktop app without an account.

## Considered Options

- Electron rather than Tauri: the same Chromium engine on Windows, Linux and macOS for three.js and web-ifc (WASM), and the Node MCP server runs as is in the main process.
- Two repositories with `skaitch-core` published on npm: rejected, too costly to maintain for a single developer.
