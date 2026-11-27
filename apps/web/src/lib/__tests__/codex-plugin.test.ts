import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { codexPluginArchive } from '@skaitch/ui/lib/codexPlugin';

function read(url: string, target: 'web' | 'desktop') {
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
    const { files, mcp, manifest } = read(url, 'web');
    expect(Object.keys(files).sort()).toEqual(['assets/skaitch-icon.svg', 'mcp.json', 'plugin.json', 'skills/skaitch-web-mcp/SKILL.md']);
    expect(mcp).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { 'skaitch-web': { type: 'streamable-http', url } },
    });
    const webSkill = strFromU8(files['skills/skaitch-web-mcp/SKILL.md']);
    expect(webSkill).toContain('name: skaitch-web-mcp');
    expect(webSkill).toContain('OAuth');
    expect(manifest).toMatchObject({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'skaitch-web',
      version: '0.1.4',
    });
    const { logo, composerIcon, displayName } = manifest.extensions['com.openai'].interface;
    expect(displayName).toBe('SkAItch Web');
    expect(composerIcon).toBe(logo);
    expect(strFromU8(files[logo.slice(2)])).toContain('viewBox="0 0 64 64"');
  });

  it('names the desktop plugin and server differently so both can be installed', () => {
    const url = 'http://127.0.0.1:3923/mcp/secret';
    const { files, mcp, manifest } = read(url, 'desktop');
    const desktopSkill = strFromU8(files['skills/skaitch-desktop-mcp/SKILL.md']);
    expect(desktopSkill).toContain('name: skaitch-desktop-mcp');
    expect(desktopSkill).toContain('local library');
    expect(desktopSkill).not.toMatch(/OAuth|browser confirmation|generate_visualization/);
    expect(manifest.name).toBe('skaitch-desktop');
    expect(manifest.extensions['com.openai'].interface.displayName).toBe('SkAItch Desktop');
    expect(mcp.mcpServers).toEqual({ 'skaitch-desktop': { type: 'streamable-http', url } });
  });
});
