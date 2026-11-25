import { mkdtemp, readFile, writeFile, mkdir, readdir, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { transformWithOxc } from 'vite';
import { expect, it } from 'vitest';

it('starts the compiled ESM server routes in Node without the Vite or tsx resolver', async () => {
  const root = resolve('.'), output = await mkdtemp(join(tmpdir(), 'skaitch-server-esm-'));
  try {
    await writeFile(join(output, 'package.json'), JSON.stringify({ type: 'module' }));
    await copyFile(join(root, 'build-info.json'), join(output, 'build-info.json'));
    await symlink(join(root, 'node_modules'), join(output, 'node_modules'), 'dir');
    async function compile(relative: string) {
      for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
        if (['__tests__', '_tmp'].includes(entry.name) || /\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name)) continue;
        const source = join(relative, entry.name);
        if (entry.isDirectory()) { await compile(source); continue; }
        if (!/\.(tsx?|json)$/.test(entry.name)) continue;
        const destination = join(output, source.replace(/\.tsx?$/, '.js'));
        await mkdir(dirname(destination), { recursive: true });
        if (entry.name.endsWith('.json')) await copyFile(join(root, source), destination);
        else {
          const result = await transformWithOxc(await readFile(join(root, source), 'utf8'), join(root, source), { sourcemap: false });
          await writeFile(destination, result.code);
        }
      }
    }
    for (const folder of ['api', 'server', 'src']) await compile(folder);
    const check = `
      import assert from 'node:assert/strict';
      import { Readable } from 'node:stream';
      import { writeFileSync } from 'node:fs';
      const verified = [];
      for (const route of ['bim', 'ai', 'mcp']) {
        const { default: handler } = await import('./api/' + route + '.js');
        const req = Object.assign(Readable.from([]), { method: 'POST', url: '/api/' + route, headers: { host: 'localhost' } });
        const res = { statusCode: 0, setHeader() {}, writeHead(status) { this.statusCode = status; }, end() {} };
        await handler(req, res);
        assert.equal(res.statusCode, 401, route + ' must initialize and enforce authentication');
        verified.push(route);
      }
      writeFileSync('ready.json', JSON.stringify(verified));
    `;
    await promisify(execFile)(process.execPath, ['--no-experimental-require-module', '--input-type=module', '-e', check], { cwd: output, timeout: 20000 });
    expect(JSON.parse(await readFile(join(output, 'ready.json'), 'utf8'))).toEqual(['bim', 'ai', 'mcp']);
  } finally { await rm(output, { recursive: true, force: true }); }
}, 30000);
