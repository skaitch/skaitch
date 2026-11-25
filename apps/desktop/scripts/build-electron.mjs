// Bundles the Electron main process (ESM) and preload (CommonJS) into dist/electron.
import { build } from 'esbuild';
import { copyFileSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: true, conditions: ['@skaitch/source'], logLevel: 'warning' };

await build({
  ...common,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist/electron/main.js',
  format: 'esm',
  // web-ifc stays a real dependency: the engine resolves its Node WASM next to the package.
  external: ['electron', 'web-ifc'],
  // The shared local-AI client reads Vite's flag; the main process is never a dev server.
  define: { __APP_VERSION__: JSON.stringify(version), 'import.meta.env.DEV': 'false' },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

await build({
  ...common,
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist/electron/preload.cjs',
  format: 'cjs',
  external: ['electron'],
});

// Window and taskbar icon on Windows and Linux (macOS takes the bundle icon).
copyFileSync(new URL('../build/icon.png', import.meta.url), new URL('../dist/electron/icon.png', import.meta.url));
