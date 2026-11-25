import { webSurveyInbox } from './lib/surveyInbox';
import { useEffect, useMemo, useState } from 'react';
import { isAdministrator } from './lib/adminClient';
import type { AssistantContext, SkaitchPlatform } from '@skaitch/ui/platform';
import { useAuth } from './hooks/useAuth';
import { useAiPreferences } from './hooks/useAiPreferences';
import { useAiCredentials } from './hooks/useAiCredentials';
import { useCloudMcpSettings } from './hooks/useCloudMcpSettings';
import { useMcpBridge } from './hooks/useMcpBridge';
import { captureLegacyAi, publicAiConfig } from './lib/aiVaultClient';
import { firestoreProjectRepository } from './lib/projectStore';
import About from './components/About';
import { WEB_PROJECT_LIMIT } from '@skaitch/core/lib/projectLimit';
import LoginPage from './components/auth/LoginPage';
import SettingsModal from './components/modals/SettingsModal';
import ChatPanel from './components/modals/ChatPanel';

function useWebAccount() {
  const { user, logout } = useAuth();
  // The server decides the role; until it answers, the beta limit applies.
  const [administrator, setAdministrator] = useState(false);
  useEffect(() => {
    setAdministrator(false);
    if (!user) return;
    let active = true;
    isAdministrator(user).then(ok => { if (active) setAdministrator(ok); });
    return () => { active = false; };
  }, [user]);
  return useMemo(() => user === undefined ? undefined : user === null ? null
    : { id: user.uid, user, logout, ...(administrator ? { projectLimit: null } : {}) }, [user, logout, administrator]);
}

/** AI settings and keys live in the user's vault; MCP clients reach the editor through the cloud mailbox. */
function useWebAssistant(context: AssistantContext) {
  const { accountId, ai, setAi, onError } = context;
  useAiPreferences(accountId, ai, setAi, onError);
  useAiCredentials(accountId, setAi, onError);
  const mcpSettingsReady = useCloudMcpSettings(accountId, ai, setAi, onError, context.lang);
  return useMcpBridge({
    ...context,
    uid: accountId,
    alwaysValidate: ai.mcpAlwaysValidate ?? true,
    setAlwaysValidate: value => setAi(previous => ({ ...previous, mcpAlwaysValidate: value })),
  }, ai.mcpEnabled && mcpSettingsReady);
}

/** The web app: Firebase accounts, Firestore projects, server-side AI vault and cloud MCP. */
export const webPlatform: SkaitchPlatform = {
  useAccount: useWebAccount,
  renderSignIn: ({ lang, onLangChange }) => <LoginPage lang={lang} onLangChange={onLangChange} />,
  createProjectRepository: account => firestoreProjectRepository(account.id),
  surveyInbox: webSurveyInbox,
  renderAbout: (lang, placement) => <About lang={lang} placement={placement} />,
  projectLimit: WEB_PROJECT_LIMIT,
  useAssistant: useWebAssistant,
  renderSettings: ({ accountId, ...props }) => <SettingsModal {...props} uid={accountId} />,
  renderChat: props => <ChatPanel {...props} />,
  aiSettings: {
    load(saved) {
      try { captureLegacyAi(saved); }
      catch { return { ai: publicAiConfig(saved), storageBlocked: true }; }
      return { ai: publicAiConfig(saved) };
    },
    toStored: ai => publicAiConfig(ai),
  },
};
