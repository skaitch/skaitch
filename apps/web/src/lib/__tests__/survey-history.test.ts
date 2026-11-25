import { describe, expect, it } from 'vitest';
import { historyOf, record, redo, undo, HISTORY_LIMIT } from '@skaitch/core/survey/history';

describe('survey history', () => {
  it('undoes and redoes, and a new edit clears the redo stack', () => {
    let h = record(record(historyOf(1), 2), 3);
    h = undo(h); expect(h.present).toBe(2);
    h = undo(h); expect(h.present).toBe(1);
    expect(undo(h)).toBe(h);
    h = redo(h); expect(h.present).toBe(2);
    h = record(h, 9); expect(h.future).toEqual([]); expect(redo(h)).toBe(h);
  });

  it('merges the steps of one gesture into a single undo', () => {
    let h = record(historyOf('a'), 'b');
    h = record(h, 'c', true);
    h = record(h, 'd', true);
    expect(undo(h).present).toBe('a');
  });

  it('keeps a bounded history', () => {
    let h = historyOf(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = record(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});
