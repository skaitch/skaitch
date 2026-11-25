import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';
import path from 'path';

export default defineConfig({
  ssr: { resolve: { conditions: ['@skaitch/source', ...defaultServerConditions.filter(c => c !== 'module')] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
    conditions: ['@skaitch/source', ...defaultServerConditions.filter(c => c !== 'module')],
  },
});
