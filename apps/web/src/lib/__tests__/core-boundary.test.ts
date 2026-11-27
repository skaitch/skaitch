import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';

// ADR 0002: core and UI are shared by the web app and the desktop app.
const root = resolve(import.meta.dirname, '../../../../..');
const core = join(root, 'packages/core');
const ui = join(root, 'packages/ui');
const web = join(root, 'apps/web');
const firebase = /^(firebase|firebase-admin)(\/|$)|^@firebase\//;
const forbiddenInCore = /^(firebase|firebase-admin|react|react-dom|electron)(\/|$)|^@firebase\/|^@skaitch\/(core|ui)(\/|$)/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function imports(dir: string) {
  return sources(dir).flatMap(file => [...readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)]
    .map(match => ({ file: relative(root, file), spec: match[1], abs: match[1].startsWith('.') ? resolve(dirname(file), match[1]) : null })));
}

const dependencies = (dir: string) => {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
};

it('keeps Firebase, React and Electron out of @skaitch/core dependencies', () => {
  expect(dependencies(core).filter(name => forbiddenInCore.test(name))).toEqual([]);
});

it('keeps Firebase, React, Electron and package self-references out of @skaitch/core sources', () => {
  expect(imports(join(core, 'src')).filter(({ spec }) => forbiddenInCore.test(spec))).toEqual([]);
});

// The Codex plugin bundles the static files of `plugins/skaitch`, which also serves as the Claude marketplace source.
const pluginAssets = join(root, 'plugins', 'skaitch');

it('keeps Firebase and web-app code out of @skaitch/ui', () => {
  expect(dependencies(ui).filter(name => firebase.test(name))).toEqual([]);
  const offenders = imports(join(ui, 'src')).filter(({ spec, abs }) =>
    firebase.test(spec) || spec.startsWith('@/') || spec.startsWith('@skaitch/ui')
    || (abs !== null && !abs.startsWith(join(ui, 'src')) && !abs.startsWith(pluginAssets + '/')));
  expect(offenders).toEqual([]);
});

it('never loads the uncompiled UI package from server code', () => {
  const server = [...imports(join(web, 'api')), ...imports(join(web, 'server'))];
  expect(server.filter(({ spec }) => spec.startsWith('@skaitch/ui'))).toEqual([]);
});
