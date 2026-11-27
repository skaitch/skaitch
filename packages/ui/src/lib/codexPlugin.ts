import { strToU8, zipSync } from 'fflate';
import logo from '../../../../plugins/skaitch-web/assets/skaitch-icon.svg?raw';
import skill from '../../../../plugins/skaitch-web/skills/skaitch-web-mcp/SKILL.md?raw';
import mcp from '../../../../plugins/skaitch-web/mcp.json';
import manifest from '../../../../plugins/skaitch-web/plugin.json';
import { triggerFileDownload } from './exportFormats';

export type CodexPluginTarget = 'web' | 'desktop';

const variants = {
  web: { name: manifest.name, displayName: manifest.extensions['com.openai'].interface.displayName, description: manifest.description },
  desktop: { name: 'skaitch-desktop', displayName: 'SkAItch Desktop', description: 'Connect Codex to local skAItch Desktop BIM projects.' },
} as const;

const desktopSkill = skill
  .replace('name: skaitch-web-mcp', 'name: skaitch-desktop-mcp')
  .replace(/## 0\. Context.*?(?=## Pick the mode)/s, `## 0. Context — always first

The \`skaitch-desktop\` server connects through the private URL in Desktop settings. Keep skAItch Desktop open.

1. Run \`list_projects\` to see the local library, then \`select_project\` to open the project in the editor.
2. Run \`execute_script\` with \`return callTool("list_spatial_structure");\`, then \`select_storey\`.
3. Watch for Accept or Refuse prompts in the desktop editor when change confirmation is enabled.

`);

export function codexPluginArchive(url: string, target: CodexPluginTarget) {
  const variant = variants[target];
  const openai = manifest.extensions['com.openai'];
  const server = {
    ...mcp.mcpServers['skaitch-web'],
    url,
    ...(target === 'web' && {
      extensions: { 'com.openai': { auth: { type: 'oauth' } } },
    }),
  };
  return zipSync({
    'plugin.json': strToU8(JSON.stringify({
      ...manifest,
      name: variant.name,
      version: target === 'web' ? '0.1.3' : manifest.version,
      description: variant.description,
      extensions: { ...manifest.extensions, 'com.openai': { ...openai, interface: { ...openai.interface, displayName: variant.displayName } } },
    }, null, 2)),
    'assets/skaitch-icon.svg': strToU8(logo),
    'mcp.json': strToU8(JSON.stringify({ ...mcp, mcpServers: { [variant.name]: server } }, null, 2)),
    [`skills/${variant.name}-mcp/SKILL.md`]: strToU8(target === 'desktop' ? desktopSkill : skill),
  });
}

export function downloadCodexPlugin(url: string, target: CodexPluginTarget) {
  const archive = codexPluginArchive(url, target);
  triggerFileDownload(new Blob([new Uint8Array(archive)], { type: 'application/zip' }), `${variants[target].name}-agent-plugin.zip`, 'application/zip');
}
