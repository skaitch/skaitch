// pnpm may skip Electron's install script; download the Electron binary when it is missing.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
try {
  require('electron');
} catch {
  const installer = join(dirname(require.resolve('electron/package.json')), 'install.js');
  const run = spawnSync(process.execPath, [installer], { stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
