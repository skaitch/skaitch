import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { codexPluginArchive } from '@skaitch/ui/lib/codexPlugin';

describe('Codex plugin download', () => {
  it('puts one portable plugin at the archive root with the selected MCP connection', () => {
    for (const url of ['https://skaitch.example/api/mcp', 'http://localhost:1234/secret']) {
      const files = unzipSync(codexPluginArchive(url));
      const mcp = JSON.parse(strFromU8(files['mcp.json']));
      expect(Object.keys(files).sort()).toEqual(['assets/skaitch-icon.svg', 'mcp.json', 'plugin.json', 'skills/skaitch-mcp/SKILL.md']);
      expect(mcp).toEqual({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: { skaitch: { type: 'streamable-http', url } },
      });
      expect(strFromU8(files['skills/skaitch-mcp/SKILL.md'])).toContain('name: skaitch-mcp');
      const manifest = JSON.parse(strFromU8(files['plugin.json']));
      expect(manifest).toMatchObject({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
        name: 'skaitch',
      });
      const { logo, composerIcon } = manifest.extensions['com.openai'].interface;
      expect(composerIcon).toBe(logo);
      expect(strFromU8(files[logo.slice(2)])).toContain('viewBox="0 0 64 64"');
    }
  });
});
