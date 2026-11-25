import { expect, it, vi } from 'vitest';
import { CHAT_SKILLS, CHAT_TOOL_HINTS, getToolSchema, searchChatTools } from '@skaitch/core/ai/tools';
import { finishConversation } from '../../../server/ai/conversation';
import { executeTool } from '../../components/modals/ChatPanel';

it('advertises only the four chat tools and loads one exact schema on demand', () => {
  expect(CHAT_TOOL_HINTS.map(tool => tool.name).sort()).toEqual(['call_tool', 'execute_script', 'load_skill', 'search_tools']);
  expect(searchChatTools('create_door').tools).toEqual([
    expect.objectContaining({ name: 'create_door', inputSchema: getToolSchema('create_door') }),
  ]);
  expect(searchChatTools('create wall').tools.length).toBeLessThanOrEqual(3);
});

it('loads a skill and keeps discovered mutations on the existing validation path', async () => {
  const execute = vi.fn();
  const run = (name: string, args: Record<string, unknown>) => executeTool(name, args, execute, {}, 'storey', vi.fn(), vi.fn(), vi.fn());
  expect(await run('load_skill', { id: 'edit_model' })).toEqual(CHAT_SKILLS.edit_model);
  expect(await run('load_skill', { id: 'constructor' })).toEqual({ error: 'Unknown chat skill' });
  const { toolUses: [tool] } = finishConversation({
    text: '',
    toolUses: [{ id: 'call', name: 'call_tool', input: { name: 'delete_element', arguments_json: '{"id":"wall"}' } }],
  }, [], 0);
  await run(tool.name, tool.input as Record<string, unknown>);
  expect(execute).toHaveBeenCalledExactlyOnceWith('delete_element', { id: 'wall' });
});
