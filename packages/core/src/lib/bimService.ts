import type { BimOperation } from '../types/bim.js';

/**
 * Runs BIM engine operations (IFC import/export/patch, MCP model edits, exports).
 * The web app sends them to its server API; the desktop app will run the core
 * engine in its own process (ADR 0002).
 */
export interface BimService {
  request<T>(operation: BimOperation, data: unknown): Promise<T>;
}
