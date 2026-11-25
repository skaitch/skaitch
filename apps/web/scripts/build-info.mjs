import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { version: release } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
let commit = process.env.VERCEL_GIT_COMMIT_SHA;
if (!commit) {
  try { commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { commit = 'local'; }
}
const compiledAt = new Date().toISOString();
const build = `${compiledAt.slice(2, 19).replace(/[-:]/g, '').replace('T', '.')}-${commit.slice(0, 12)}`;
writeFileSync(new URL('../build-info.json', import.meta.url), JSON.stringify({ release, build, compiledAt }, null, 2) + '\n');
