import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AiConfig } from '@skaitch/core/types/ifc';
import { listAiCredentials } from '../lib/aiVaultClient';

export function useAiCredentials(uid: string | null, setAi: Dispatch<SetStateAction<AiConfig>>, fail: (error: Error) => void) {
  useEffect(() => {
    let active = true;
    setAi(value => ({ ...value, apiKey: '', apiKeys: {}, visualizerApiKey: '', credentials: [] }));
    if (!uid) return;
    listAiCredentials(uid).then(credentials => {
      if (active) setAi(value => ({ ...value, credentials }));
    }).catch(error => { if (active) fail(error); });
    return () => { active = false; };
  }, [uid, setAi]);
}
