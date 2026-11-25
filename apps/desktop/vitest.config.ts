import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

export default defineConfig({
  resolve: { conditions: ['@skaitch/source', ...defaultServerConditions.filter(c => c !== 'module')] },
  ssr: { resolve: { conditions: ['@skaitch/source', ...defaultServerConditions.filter(c => c !== 'module')] } },
  test: { environment: 'node', include: ['electron/**/*.test.ts', 'renderer/**/*.test.ts'] },
});
