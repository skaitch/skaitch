import type { AppAccount, SkaitchPlatform } from '@skaitch/ui/platform';
import { libraryProjectRepository } from './fileRepository';
import { useDesktopAssistant } from './useDesktopAssistant';
import RemoteAccessBanner from './RemoteAccessBanner';
import DesktopSettings from './DesktopSettings';
import DesktopAbout from './DesktopAbout';
import { desktopSurveyInbox } from './surveyInbox';
import ChatPanel from '@skaitch/ui/components/ChatPanel';
import type { AiConfig } from '@skaitch/core/types/ifc';

/** Keys live in the main process; never let one reach the saved UI state. */
function withoutSecrets(ai: Partial<AiConfig> | undefined): Partial<AiConfig> {
  const { apiKey: _apiKey, apiKeys: _apiKeys, visualizerApiKey: _visualizerApiKey, ...rest } = ai ?? {};
  return { ...rest, apiKey: '' };
}

/** The desktop app has no sign-in: a single local account. */
const LOCAL_ACCOUNT: AppAccount = { id: 'local', user: {} };

export const desktopPlatform: SkaitchPlatform = {
  useAccount: () => LOCAL_ACCOUNT,
  createProjectRepository: () => libraryProjectRepository(),
  /** Local MCP server (step 6c). */
  useAssistant: useDesktopAssistant,
  renderBanner: () => <RemoteAccessBanner />,
  renderSettings: props => <DesktopSettings {...props} />,
  renderAbout: (lang, placement) => <DesktopAbout lang={lang} placement={placement} />,
  /** Built-in AI chat (step 6d): the engine runs in the main process (electron/aiEngine.ts). */
  renderChat: props => <ChatPanel {...props} />,
  /** Surveys from the phone on the local network, paired with a QR code. */
  surveyInbox: desktopSurveyInbox,
  aiSettings: {
    load: saved => ({ ai: withoutSecrets(saved) }),
    toStored: ai => withoutSecrets(ai),
  },
};
