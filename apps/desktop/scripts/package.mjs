// Packages the built app (run `pnpm build` first) into installers under release/out.
// Usage: node scripts/package.mjs [--linux] [--win] [--mac]   (default: the current platform)
//
// electron-builder runs on a staging folder rather than on this pnpm workspace package:
// main.js and the renderer are already bundled, so the app only needs dist/ and web-ifc
// (the BIM engine resolves its Node WASM next to the package).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build, Platform } from 'electron-builder';

const root = join(import.meta.dirname, '..');
const stage = join(root, 'release', 'app');
const output = join(root, 'release', 'out');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
// Pinned exactly in package.json; its exports map hides web-ifc/package.json.
const webIfcVersion = pkg.dependencies['web-ifc'];

rmSync(join(root, 'release'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, 'dist', 'electron'), join(stage, 'dist', 'electron'), { recursive: true, filter: file => !file.endsWith('.map') });
cpSync(join(root, 'dist', 'renderer'), join(stage, 'dist', 'renderer'), { recursive: true, filter: file => !file.endsWith('.map') });
writeFileSync(join(stage, 'package.json'), JSON.stringify({
  name: 'skaitch',
  productName: 'skAItch',
  version: pkg.version,
  description: pkg.description,
  author: 'Pintorus',
  homepage: 'https://skaitch.online',
  desktopName: 'skaitch.desktop',
  type: 'module',
  main: pkg.main,
  dependencies: { 'web-ifc': webIfcVersion },
}, null, 2));

const install = spawnSync('npm', ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
if (install.status !== 0) process.exit(install.status ?? 1);

const args = new Set(process.argv.slice(2));
const platforms = [
  args.has('--linux') && Platform.LINUX,
  args.has('--win') && Platform.WINDOWS,
  args.has('--mac') && Platform.MAC,
].filter(Boolean);
const targets = (platforms.length ? platforms : [Platform.current()]).map(platform => platform.createTarget());
const merged = new Map(targets.flatMap(target => [...target]));

await build({
  projectDir: stage,
  targets: merged,
  publish: 'never',
  config: {
    appId: 'app.skaitch.desktop',
    productName: 'skAItch',
    electronVersion,
    npmRebuild: false,
    directories: { output },
    files: ['dist/**/*', 'package.json'],
    asar: true,
    // The engine reads web-ifc-node.wasm with fs: keep the package outside the archive.
    asarUnpack: ['node_modules/web-ifc/**'],
    artifactName: 'skAItch-${version}-${os}-${arch}.${ext}',
    // 1024 px PNG: electron-builder derives the .ico, .icns and Linux sizes from it.
    icon: join(root, 'build', 'icon.png'),
    win: { target: [{ target: 'nsis', arch: ['x64'] }] },
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
    mac: { target: [{ target: 'dmg', arch: ['arm64', 'x64'] }], category: 'public.app-category.productivity', identity: null },
    linux: {
      target: [{ target: 'AppImage', arch: ['x64'] }, { target: 'deb', arch: ['x64'] }],
      category: 'Graphics',
      maintainer: 'Pintorus',
      syncDesktopName: true,
    },
  },
});
console.log(`Installers written to ${output}`);
