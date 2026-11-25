import { strToU8, zipSync } from 'fflate';
import logo from '../../../../plugins/skaitch/assets/skaitch-icon.svg?raw';
import skill from '../../../../plugins/skaitch/skills/skaitch-mcp/SKILL.md?raw';
import mcp from '../../../../plugins/skaitch/mcp.json';
import manifest from '../../../../plugins/skaitch/plugin.json';
import { triggerFileDownload } from './exportFormats';

export function codexPluginArchive(url: string) {
  return zipSync({
    'plugin.json': strToU8(JSON.stringify(manifest, null, 2)),
    'assets/skaitch-icon.svg': strToU8(logo),
    'mcp.json': strToU8(JSON.stringify({ ...mcp, mcpServers: { skaitch: { ...mcp.mcpServers.skaitch, url } } }, null, 2)),
    'skills/skaitch-mcp/SKILL.md': strToU8(skill),
  });
}

export function downloadCodexPlugin(url: string) {
  const archive = codexPluginArchive(url);
  triggerFileDownload(new Blob([new Uint8Array(archive)], { type: 'application/zip' }), 'skaitch-agent-plugin.zip', 'application/zip');
}
