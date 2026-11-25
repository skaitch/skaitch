import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { provideBimService } from '@skaitch/ui/lib/bimService';
import { provideAiService } from '@skaitch/ui/lib/aiService';
import { fetchConversation, conversationIntent, adjustConversation, discoverModelCapabilities } from './lib/aiClient';
import { httpBimService } from './lib/bimClient';
import App from './App';
import OAuthGoogle from './components/auth/OAuthGoogle';
import AdminPage from './components/admin/AdminPage';
import PrivacyPage from './components/PrivacyPage';

provideBimService(httpBimService);
provideAiService({ fetchConversation, conversationIntent, adjustConversation, discoverModelCapabilities });

createRoot(document.getElementById('root')!, {
  onUncaughtError(error, info) {
    console.error('[SkAItch] Uncaught render error:', error, info.componentStack);
    const root = document.getElementById('root');
    if (root) {
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.style.padding = '24px';
      message.textContent = `Impossible d’afficher l’application : ${error instanceof Error ? error.message : String(error)}`;
      root.replaceChildren(message);
    }
  },
}).render(
  <StrictMode>
    {window.location.pathname === '/oauth/google' ? <OAuthGoogle /> : window.location.pathname === '/admin' ? <AdminPage /> : window.location.pathname === '/confidentialite' ? <PrivacyPage /> : <App />}
  </StrictMode>,
);