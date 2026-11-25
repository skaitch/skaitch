import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';

/** Survey app: shared core and UI, bundled for the Capacitor web view (ADR 0007). */
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { conditions: ['@skaitch/source', ...defaultClientConditions] },
  server: { port: 5175, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
