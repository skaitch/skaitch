import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { AiConfig, ItemsMap, LangType, ViewState2D } from '@skaitch/core/types/ifc';
import type { ElementDef } from '@skaitch/core/data/elementCatalogue';
import type { ProjectMeta } from '@skaitch/core/types/project';
import type { ProjectRepository } from '@skaitch/core/lib/projectRepository';
import type { HomeUser } from './components/HomePage';

type Item = ItemsMap[string];

/** Who is using the app. The desktop app has a single local account with no sign-in. */
export interface AppAccount {
  /** Stable identifier used to key per-account state. */
  id: string;
  user: HomeUser;
  logout?: () => void;
  /** Overrides the platform's project limit for this account (for example administrators); null means no limit. */
  projectLimit?: number | null;
}

/** Everything the editor exposes to an assistant (MCP server, built-in AI). */
export interface AssistantContext {
  accountId: string | null;
  activeProjectId: string | null;
  items: ItemsMap;
  catalogue: ElementDef[];
  focusStorey: string;
  /** Interface language: default names of created elements follow it. */
  lang: LangType;
  ai: AiConfig;
  setAi: Dispatch<SetStateAction<AiConfig>>;
  onError: (error: Error) => void;
  getView: () => Record<string, unknown>;
  setView: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  captureView: () => Promise<Record<string, unknown>>;
  flushProject: () => Promise<void>;
  openProject: (project: { id: string }) => Promise<void>;
  addItem: (item: Item) => void;
  updateItem: (id: string, patch: Partial<Item>) => void;
  deleteItems: (ids: string[]) => void;
  replaceItems: (items: ItemsMap) => void;
  setFocusStorey: (storeyId: string) => void;
  setSelection: (ids: string[]) => void;
  triggerFit: () => void;
}

export interface AssistantApi {
  /** An external assistant (MCP client) is connected to this editor. */
  connected: boolean;
  /** A model change is waiting for the user's confirmation; saving and navigation wait for it. */
  pending: boolean;
  renderConfirmDialog?: () => ReactNode;
  /** Runs one model tool, asking for confirmation when required. */
  execute: (name: string, args: Record<string, unknown>, forceConfirm?: boolean, expiresAt?: number, approvalOnly?: boolean) => Promise<unknown>;
}

export interface SettingsSlotProps {
  open: boolean;
  onClose: () => void;
  /** Home page: application settings only, no project-specific sections. */
  applicationOnly?: boolean;
  ai: AiConfig;
  setAi: Dispatch<SetStateAction<AiConfig>>;
  t: (key: string, values?: Record<string, string | number>) => string;
  lang: LangType;
  onLangChange: (lang: LangType) => void;
  projects: ProjectMeta[];
  accountId: string | null;
}

export interface ChatSlotProps {
  catalogue: ElementDef[];
  open: boolean;
  onClose: () => void;
  items: ItemsMap;
  ai: AiConfig;
  selection: string[];
  setSelection: (ids: string[]) => void;
  addItem: (item: Item) => void;
  updateItem: (id: string, patch: Partial<Item>) => void;
  deleteItems: (ids: string[]) => void;
  injectIfc: (ifcText: string, filename?: string) => Promise<unknown>;
  focusStorey: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  lang: LangType;
  view2d: ViewState2D;
  chatPrompt: { text: string; image?: string } | null;
  clearChatPrompt: () => void;
  executeToolWithValidation: AssistantApi['execute'];
}

/**
 * What a host app (web or desktop) plugs into the shared editor (ADR 0002).
 * Functions named `use…` are React hooks: the host passes the same function on every render.
 */
/** A survey sent from the Survey app to the account (ADR 0011). */
export interface ReceivedSurvey { id: string; surveyId: string; name: string; revision: number; bytes: number; receivedAt: string }
/** A pairing key of the Survey app; `key` is only present right after creation. */
export interface SurveyPairingKey {
  id: string; name: string; createdAt: string; lastUsedAt: string | null; key?: string;
  /** Right after creation: what the Survey app scans to pair (server addresses and key), shown as a QR code. */
  pairingUri?: string;
}

/** Account inbox of surveys sent from the Survey app; absent on platforms without an account. */
export interface SurveyInbox {
  list(): Promise<ReceivedSurvey[]>;
  /** The survey file as sent, ready to import like a file. */
  download(survey: ReceivedSurvey): Promise<Uint8Array>;
  remove(id: string): Promise<void>;
  listKeys(): Promise<SurveyPairingKey[]>;
  createKey(name: string): Promise<SurveyPairingKey>;
  revokeKey(id: string): Promise<void>;
}

export interface SkaitchPlatform {
  /** `undefined` while loading, `null` when signed out. */
  useAccount(): AppAccount | null | undefined;
  /** Shown when `useAccount` returns null. */
  renderSignIn?(props: { lang: LangType; onLangChange: (lang: LangType) => void }): ReactNode;
  createProjectRepository(account: AppAccount): ProjectRepository;
  /** Version and build information control shown in headers. */
  /** About dialog trigger: a home page button, or a row of the editor's "More" menu. */
  renderAbout?(lang: LangType, placement?: 'home' | 'menu'): ReactNode;
  /** Host notice (for example a beta badge) shown over the home page and the editor. */
  renderBanner?(props: { lang: LangType; projectLimit?: number }): ReactNode;
  /** Maximum number of projects an account may hold. Omit for no limit. */
  projectLimit?: number;
  useAssistant(context: AssistantContext): AssistantApi;
  renderSettings(props: SettingsSlotProps): ReactNode;
  renderChat(props: ChatSlotProps): ReactNode;
  /** Prepares AI settings read from local UI state, and strips secrets before writing it back. */
  surveyInbox?: SurveyInbox;
  aiSettings?: {
    load(saved: Partial<AiConfig> | undefined): { ai: Partial<AiConfig>; storageBlocked?: boolean };
    toStored(ai: Partial<AiConfig> | undefined): Partial<AiConfig>;
  };
}
