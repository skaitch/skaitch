import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { codexPluginArchive } from '@skaitch/ui/lib/codexPlugin';

function read(url: string, target?: 'web' | 'desktop') {
  const files = unzipSync(codexPluginArchive(url, target));
  return {
    files,
    mcp: JSON.parse(strFromU8(files['mcp.json'])),
    manifest: JSON.parse(strFromU8(files['plugin.json'])),
  };
}

describe('Codex plugin download', () => {
  it('puts one portable plugin at the archive root with the selected MCP connection', () => {
    const url = 'https://skaitch.example/api/mcp';
    const { files, mcp, manifest } = read(url);
    expect(Object.keys(files).sort()).toEqual(['assets/skaitch-icon.svg', 'mcp.json', 'plugin.json', 'skills/skaitch-mcp/SKILL.md']);
    expect(mcp).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { skaitch: { type: 'streamable-http', url, extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'dcr' }, baseScopes: ['mcp'] } } } } },
    });
    expect(strFromU8(files['skills/skaitch-mcp/SKILL.md'])).toContain('name: skaitch-mcp');
    expect(manifest).toMatchObject({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'skaitch',
    });
    const { logo, composerIcon, displayName } = manifest.extensions['com.openai'].interface;
    expect(displayName).toBe('SkAItch');
    expect(composerIcon).toBe(logo);
    expect(strFromU8(files[logo.slice(2)])).toContain('viewBox="0 0 64 64"');
  });

  it('names the desktop plugin and server differently so both can be installed', () => {
    const url = 'http://127.0.0.1:3923/mcp/secret';
    const { mcp, manifest } = read(url, 'desktop');
    expect(manifest.name).toBe('skaitch-desktop');
    expect(manifest.extensions['com.openai'].interface.displayName).toBe('SkAItch Desktop');
    expect(mcp.mcpServers).toEqual({ 'skaitch-desktop': { type: 'streamable-http', url } });
  });
});
