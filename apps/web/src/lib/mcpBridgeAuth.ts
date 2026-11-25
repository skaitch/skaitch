// Authentication of the local `pnpm mcp` bridge by the browser tab.
//
// Any process can listen on localhost:3001, so the tab must not trust whoever answers. When the
// socket opens, the tab sends a random nonce; the bridge proves it holds one of the signed-in
// user's API keys by returning SHA-256(key) and HMAC-SHA256(key, nonce). The key itself never
// crosses the socket. Tool calls are then limited to that key's grants.
import { authorizeMcpTool } from '@skaitch/core/lib/mcpPermissions';

export interface BridgeGrant { permissions: Record<string, string>; accountAccess?: string }

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const utf8 = (value: string) => new TextEncoder().encode(value);

export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', utf8(value)));
}

export async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', utf8(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, utf8(message)));
}

export function newNonce(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

/** Constant-time equality of two hex strings. */
function sameHex(a: string, b: string) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a bridge's proof against the user's key documents (id = the key). Returns the matching
 * key's grant, or null when the bridge does not hold one of the user's keys.
 */
export async function verifyBridgeProof(
  keys: { id: string; data: Record<string, unknown> }[], nonce: string, keyHash: unknown, mac: unknown,
): Promise<BridgeGrant | null> {
  if (typeof keyHash !== 'string' || typeof mac !== 'string') return null;
  for (const key of keys) {
    if (!sameHex(await sha256Hex(key.id), keyHash)) continue;
    if (!sameHex(await hmacHex(key.id, nonce), mac)) return null;
    const { permissions, accountAccess } = key.data as { permissions?: unknown; accountAccess?: unknown };
    return {
      permissions: permissions && typeof permissions === 'object' ? permissions as Record<string, string> : {},
      accountAccess: accountAccess === 'read' || accountAccess === 'write' ? accountAccess : undefined,
    };
  }
  return null;
}

/** Throws when the authenticated bridge's key may not run this tool on the open project. */
export function authorizeBridgeCall(grant: BridgeGrant | null, name: string, args: Record<string, unknown>, activeProjectId: string | null) {
  if (!grant) throw new Error('MCP bridge not authenticated');
  authorizeMcpTool(name, args ?? {}, activeProjectId, grant.permissions, grant.accountAccess);
}

/** Projects the bridge's key may see. */
export function filterBridgeProjects<T extends { id: string }>(grant: BridgeGrant, projects: T[]): T[] {
  return projects.filter(p => ['read', 'write'].includes(grant.accountAccess || grant.permissions[p.id]));
}
