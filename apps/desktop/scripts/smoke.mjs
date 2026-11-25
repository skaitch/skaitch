// Launches the built app against scratch folders and checks renderer, IPC, IFC engine and library.
// Usage: node scripts/smoke.mjs <out-dir>   (run `pnpm build` first)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'smoke-output');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env, SKAITCH_SMOKE_OUT: out, SKAITCH_LIBRARY_DIR: join(out, 'library'), SKAITCH_USER_DATA: join(out, 'user-data') };
// --no-sandbox is for this local check only (some Linux kernels refuse Chromium's sandbox); the app itself keeps it.
const run = spawnSync(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env, stdio: 'inherit', timeout: 180_000 });
const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
console.log(JSON.stringify(report, null, 2));
process.exit(run.status === 0 && report.ok ? 0 : 1);
