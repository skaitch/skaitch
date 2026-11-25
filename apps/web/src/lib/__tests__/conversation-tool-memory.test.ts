import { describe, expect, it } from 'vitest';
import { finishConversation } from '../../../server/ai/conversation';

describe('tool rounds keep a memory of the calls', () => {
  it('records the calls when the model answered with tools only', () => {
    const result = finishConversation({ text: '', toolUses: [{ id: 'a', name: 'update_wall', input: { id: 'w_570' } }] }, [{ role: 'user', content: 'fix the walls' }], 1);
    const messages = result.next!.messages; const last = messages[messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('[Tool calls]\nupdate_wall({"id":"w_570"})');
    expect(result.next!.round).toBe(2);
  });

  it('ends the conversation when no tool is called', () => {
    expect(finishConversation({ text: 'Done.', toolUses: [] }, [], 3).next).toBeNull();
  });
});
