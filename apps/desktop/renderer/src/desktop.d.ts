import type { BimOperation } from '@skaitch/core/types/bim';
import type { StoredProject } from '@skaitch/core/lib/projectRepository';
import type { ProjectMeta } from '@skaitch/core/types/project';
import type { AiCredentialMeta } from '@skaitch/core/lib/aiCredentialTarget';
import type { ConversationResult } from '@skaitch/core/types/ai';
import type { ReceivedSurvey, SurveyPairingKey } from '@skaitch/ui/platform';

/** Exposed by electron/preload.ts. */
interface SkaitchDesktopBridge {
  bim<T>(operation: BimOperation, data: unknown): Promise<T>;
  library: {
    list(): Promise<ProjectMeta[]>;
    read(id: string): Promise<StoredProject | null>;
    write(id: string, patch: Partial<StoredProject>): Promise<StoredProject>;
    delete(id: string): Promise<void>;
    setArchived(id: string, archived: boolean): Promise<ProjectMeta>;
  };
  ai: {
    keys(): Promise<{ keys: AiCredentialMeta[]; storage: 'keychain' | 'basic_text' | 'unavailable' }>;
    setKey(provider: string, baseUrl: string | undefined, secret: string): Promise<AiCredentialMeta[]>;
    request<T>(operation: 'models' | 'capabilities' | 'test' | 'conversation-intent' | 'conversation-adjust', data: unknown, requestId?: string): Promise<T>;
    chat(requestId: string, data: unknown): Promise<ConversationResult>;
    abort(requestId: string): Promise<void>;
    onChunk(listener: (event: { requestId: string; chunk: string; thinking: boolean }) => void): () => void;
  };
  /** Optional diagnostic journal (electron/diagnosticLog.ts). */
  logs: {
    get(): Promise<{ enabled: boolean; dir: string }>;
    set(enabled: boolean): Promise<{ enabled: boolean; dir: string }>;
    open(): Promise<void>;
  };
  /** Surveys received from the phone on the local network (electron/surveyReceiver.ts). */
  survey: {
    list(): Promise<ReceivedSurvey[]>;
    /** One stored piece of a received file, base64-encoded. */
    readChunk(id: string, index: number): Promise<string>;
    remove(id: string): Promise<void>;
    keys(): Promise<SurveyPairingKey[]>;
    createKey(name: string): Promise<SurveyPairingKey>;
    revokeKey(id: string): Promise<void>;
  };
  mcp: {
    ready(): Promise<DesktopMcpStatus>;
    status(): Promise<DesktopMcpStatus>;
    stop(): Promise<void>;
    reply(id: string, outcome: { result: unknown } | { error: string }): Promise<void>;
    onCall(listener: (call: { id: string; name: string; args: Record<string, unknown>; expiresAt: number }) => void): () => void;
    onStatus(listener: (status: DesktopMcpStatus) => void): () => void;
  };
}

/** The local MCP server in the main process (electron/main.ts). */
export interface DesktopMcpStatus {
  listening: boolean;
  url: string | null;
  /** Remote access through a tunnel is open. */
  remote: boolean;
  /** A client called recently. */
  connected: boolean;
}

declare global {
  interface Window { skaitchDesktop: SkaitchDesktopBridge }
}

/** Injected by vite.config.ts from package.json and the git commit. */
declare const __RELEASE_VERSION__: string;
declare const __BUILD_VERSION__: string;
