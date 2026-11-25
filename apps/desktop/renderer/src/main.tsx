import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { provideBimService } from '@skaitch/ui/lib/bimService';
import { provideAiService } from '@skaitch/ui/lib/aiService';
import { desktopAiService } from './aiService';
import SkaitchApp from '@skaitch/ui/SkaitchApp';
import { desktopPlatform } from './platform';

// The BIM engine runs in the Electron main process.
provideBimService({ request: (operation, data) => window.skaitchDesktop.bim(operation, data) });
// So does the AI engine; API keys never reach this window.
provideAiService(desktopAiService);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SkaitchApp platform={desktopPlatform} />
  </StrictMode>,
);
