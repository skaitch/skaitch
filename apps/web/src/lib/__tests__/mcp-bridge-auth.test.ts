import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorizeBridgeCall, filterBridgeProjects, verifyBridgeProof } from '../mcpBridgeAuth';

const KEY = 'ak_user_' + 'c'.repeat(40);
const keys = [
  { id: 'ak_user_' + 'd'.repeat(40), data: { permissions: { p1: 'write' } } },
  { id: KEY, data: { permissions: { p1: 'read' } } },
];
const proof = (key: string, nonce: string) => ({
  keyHash: createHash('sha256').update(key).digest('hex'),
  mac: createHmac('sha256', key).update(nonce).digest('hex'),
});

describe('local MCP bridge authentication in the browser', () => {
  it('accepts a bridge that holds one of the user keys and returns that key grant', async () => {
    const p = proof(KEY, 'n1');
    expect(await verifyBridgeProof(keys, 'n1', p.keyHash, p.mac)).toEqual({ permissions: { p1: 'read' }, accountAccess: undefined });
  });

  it('rejects an unknown key, a replayed proof and a forged MAC', async () => {
    const stranger = proof('ak_other_' + 'e'.repeat(40), 'n1');
    expect(await verifyBridgeProof(keys, 'n1', stranger.keyHash, stranger.mac)).toBeNull();
    const old = proof(KEY, 'n1');
    expect(await verifyBridgeProof(keys, 'n2', old.keyHash, old.mac)).toBeNull();
    expect(await verifyBridgeProof(keys, 'n1', old.keyHash, 'f'.repeat(64))).toBeNull();
    expect(await verifyBridgeProof(keys, 'n1', undefined, undefined)).toBeNull();
  });

  it('limits tool calls and project lists to the bridge key grant', () => {
    const grant = { permissions: { p1: 'read' } };
    expect(() => authorizeBridgeCall(null, 'get_view', {}, 'p1')).toThrow();
    expect(() => authorizeBridgeCall(grant, 'get_view', {}, 'p1')).not.toThrow();
    expect(() => authorizeBridgeCall(grant, 'create_wall', {}, 'p1')).toThrow(/read-only/);
    expect(() => authorizeBridgeCall(grant, 'select_project', { project_id: 'p2' }, 'p1')).toThrow(/denied/);
    expect(filterBridgeProjects(grant, [{ id: 'p1' }, { id: 'p2' }])).toEqual([{ id: 'p1' }]);
  });
});
