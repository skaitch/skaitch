import { defineConfig, loadEnv, defaultClientConditions, defaultServerConditions } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import buildInfo from './build-info.json'
import { bimServerPlugin } from './server/bim-dev.ts'
import { corsProxyPlugin } from './server/cors-proxy.ts'

export default defineConfig(({ mode }) => {
  const serverVariables = ['VITE_FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS', 'AI_VAULT_SECRET', 'GITHUB_TOKEN', 'GITHUB_REPO'];
  const env = loadEnv(mode, process.cwd(), serverVariables);
  for (const name of serverVariables) if (env[name] !== undefined) process.env[name] ??= env[name];
  return {
    plugins: [react(), corsProxyPlugin(), bimServerPlugin(), {
      name: 'server-only-bim-boundary',
      generateBundle(_options, bundle) {
        for (const file of Object.values(bundle)) {
          if (file.type === 'chunk' && Object.keys(file.modules).some(id => /\/server\/(?:bim|ai)\/|\/packages\/core\/(?:src|dist)\/bim\//.test(id))) throw new Error('Server BIM engine leaked into the browser bundle');
        }
      },
    }],
    define: { __RELEASE_VERSION__: JSON.stringify(buildInfo.release), __BUILD_VERSION__: JSON.stringify(buildInfo.build) },
    // `@skaitch/source` resolves @skaitch/core to its TypeScript sources in dev; production functions use the compiled dist.
    resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') }, conditions: ['@skaitch/source', ...defaultClientConditions] },
    ssr: { resolve: { conditions: ['@skaitch/source', ...defaultServerConditions.filter(c => c !== 'module')] } },
    optimizeDeps: { exclude: ['web-ifc-three', 'web-ifc'] },
    build: { chunkSizeWarningLimit: 8000 },
  };
})
