// Lists the English texts of every tr(fr, en) call of the survey code, as translation keys.
// A template literal becomes a key with numbered placeholders: `Place ${a} against ${b}` → "Place {0} against {1}".
// Usage, from the repository root: node apps/survey/scripts/extract-survey-strings.mjs > strings.json
// With --missing: lists, per language table (packages/core/src/survey/i18n), the English texts it lacks.
import { readFileSync } from 'node:fs';

export const FILES = [
  'apps/survey/src/App.tsx', 'apps/survey/src/FurnitureSheet.tsx', 'apps/survey/src/GlobalPlan.tsx', 'apps/survey/src/WallElevation.tsx', 'apps/survey/src/send.ts',
  'packages/ui/src/components/survey/SurveyEditor.tsx', 'packages/ui/src/components/survey/SurveyTab.tsx',
  ...['edit', 'surveyFile', 'solve', 'inbox', 'checks', 'placement', 'association', 'reconstruct', 'globalPlan'].map(f => `packages/core/src/survey/${f}.ts`),
];

const ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`', $: '$', '{': '{', '}': '}' };

/** Reads a literal at i; returns { text, end } (text with {n} for each ${…}), or null when it is not a literal. */
function literal(s, i) {
  const q = s[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let text = '', n = 0, j = i + 1;
  while (j < s.length && s[j] !== q) {
    if (s[j] === '\\') { const c = s[j + 1]; text += ESC[c] ?? c; j += 2; continue; }
    if (q === '`' && s[j] === '$' && s[j + 1] === '{') { j = skipExpr(s, j + 2); text += `{${n++}}`; continue; }
    text += s[j++];
  }
  return { text, end: j + 1 };
}

/** Skips a ${…} expression (nested braces and strings), returns the index after its closing brace. */
function skipExpr(s, j) {
  let depth = 1;
  while (j < s.length && depth) {
    const c = s[j];
    if (c === "'" || c === '"' || c === '`') { j = literal(s, j).end; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
    j++;
  }
  return j;
}

const ws = (s, i) => { while (/\s/.test(s[i])) i++; return i; };

/** Texts translated from data (tools, themes) rather than written in a tr() call: [en, fr]. */
const EXTRA = [['Select', 'Sélection'], ['Rectangle', 'Rectangle'], ['Outline', 'Tracer'], ['Door', 'Porte'], ['Window', 'Fenêtre'], ['Black', 'Noir'], ['Green', 'Vert'], ['Gold', 'Or']];

export function extract(files = FILES) {
  const out = new Map(EXTRA);
  for (const file of files) {
    const s = readFileSync(file, 'utf8');
    const re = /(?<![\w.$])tr\(/g;
    for (let m; (m = re.exec(s));) {
      const a = literal(s, ws(s, m.index + 3));
      if (!a) continue;
      let k = ws(s, a.end);
      if (s[k] !== ',') continue;
      const b = literal(s, ws(s, k + 1));
      if (!b || s[ws(s, b.end)] !== ')') continue;
      if (!out.has(b.text)) out.set(b.text, a.text);
    }
  }
  return out;
}

function missing() {
  const keys = [...extract().keys()];
  let total = 0;
  for (const lang of ['ar', 'de', 'es', 'it', 'ja', 'nl', 'pt', 'ru', 'zh']) {
    const src = readFileSync(`packages/core/src/survey/i18n/${lang}.ts`, 'utf8');
    const have = new Set([...src.matchAll(/^  ("(?:[^"\\]|\\.)*"):/gm)].map(m => JSON.parse(m[1])));
    const lack = keys.filter(k => !have.has(k));
    total += lack.length;
    if (lack.length) console.log(`${lang}: ${lack.length} missing\n${lack.map(k => `  ${JSON.stringify(k)}`).join('\n')}`);
  }
  if (!total) console.log('Every language table is complete.');
  process.exitCode = total ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--missing')) missing();
  else process.stdout.write(JSON.stringify(Object.fromEntries(extract()), null, 1));
}
