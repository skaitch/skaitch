import { strToU8, zipSync } from 'fflate';
import logo from '../../../../plugins/skaitch/assets/skaitch-icon.svg?raw';
import skill from '../../../../plugins/skaitch/skills/skaitch-mcp/SKILL.md?raw';
import mcp from '../../../../plugins/skaitch/mcp.json';
import manifest from '../../../../plugins/skaitch/plugin.json';
import { triggerFileDownload } from './exportFormats';

/**
 * Two distinct plugins so both can be installed side by side in Codex:
 * - `web`: the hosted server, authenticated with OAuth (`codex mcp login skaitch`).
 * - `desktop`: the local skAItch Desktop server, authenticated by its secret URL.
 */
export type CodexPluginTarget = 'web' | 'desktop';

const variants = {
  web: { name: 'skaitch', displayName: 'SkAItch', description: 'Connect Codex to SkAItch BIM projects.' },
  desktop: { name: 'skaitch-desktop', displayName: 'SkAItch Desktop', description: 'Connect Codex to the projects open in skAItch Desktop.' },
} as const;

export function codexPluginArchive(url: string, target: CodexPluginTarget = 'web') {
  const variant = variants[target];
  const openai = manifest.extensions['com.openai'];
  return zipSync({
    'plugin.json': strToU8(JSON.stringify({
      ...manifest,
      name: variant.name,
      description: variant.description,
      extensions: { ...manifest.extensions, 'com.openai': { ...openai, interface: { ...openai.interface, displayName: variant.displayName } } },
    }, null, 2)),
    'assets/skaitch-icon.svg': strToU8(logo),
    'mcp.json': strToU8(JSON.stringify({ ...mcp, mcpServers: { [variant.name]: { ...mcp.mcpServers.skaitch, url } } }, null, 2)),
    'skills/skaitch-mcp/SKILL.md': strToU8(skill),
  });
}

export function downloadCodexPlugin(url: string, target: CodexPluginTarget = 'web') {
  const archive = codexPluginArchive(url, target);
  triggerFileDownload(new Blob([new Uint8Array(archive)], { type: 'application/zip' }), `${variants[target].name}-agent-plugin.zip`, 'application/zip');
}
