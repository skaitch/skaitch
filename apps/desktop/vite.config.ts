import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const { version } = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
let commit = 'local';
try { commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}

/** Renderer of the desktop app: the shared editor UI, served by the main process over app://. */
export default defineConfig({
  root: path.join(here, 'renderer'),
  // shortcut: reuse the web app's static assets (IFC WASM, fragments worker, sample IFC) until they move to a shared package.
  publicDir: path.join(here, '../web/public'),
  base: '/',
  plugins: [react(), {
    name: 'no-bim-engine-in-renderer',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk' && Object.keys(file.modules).some(id => /\/packages\/core\/(?:src|dist)\/bim\//.test(id))) throw new Error('BIM engine leaked into the renderer bundle; use BimService.');
      }
    },
  }],
  css: { postcss: { plugins: [tailwind(), autoprefixer()] } },
  define: { __RELEASE_VERSION__: JSON.stringify(version), __BUILD_VERSION__: JSON.stringify(`${version}-${commit}`) },
  resolve: { conditions: ['@skaitch/source', ...defaultClientConditions] },
  optimizeDeps: { exclude: ['web-ifc-three', 'web-ifc'] },
  build: { outDir: path.join(here, 'dist/renderer'), emptyOutDir: true, chunkSizeWarningLimit: 8000 },
});
