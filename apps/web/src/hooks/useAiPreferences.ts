import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AiConfig } from '@skaitch/core/types/ifc';
import { aiPreferences } from '../lib/aiPreferences';
import { getAiPreferences } from '../lib/aiVaultClient';

export function useAiPreferences(uid: string | null, ai: AiConfig, setAi: Dispatch<SetStateAction<AiConfig>>, fail: (error: Error) => void) {
  const current = useRef(ai); current.current = ai;
  const failRef = useRef(fail); failRef.current = fail;
  useEffect(() => {
    let active = true;
    const initial = JSON.stringify(aiPreferences(current.current));
    setAi(value => ({ ...value, preferencesRevision: undefined, savedPreferencesSignature: '' }));
    if (!uid) return;
    getAiPreferences(uid).then(saved => {
      if (!active) return;
      setAi(value => ({ ...value,
        ...(saved.config && !value.apiKey && !value.visualizerApiKey && JSON.stringify(aiPreferences(value)) === initial ? { ...saved.config, models: value.cachedModels?.[saved.config.provider] || [], baseUrls: { ...value.baseUrls, [saved.config.provider]: saved.config.baseUrl } } : {}),
        preferencesRevision: saved.revision, savedPreferencesSignature: saved.config ? JSON.stringify(saved.config) : '',
      }));
    }).catch(error => { if (active) failRef.current(error); });
    return () => { active = false; };
  }, [uid, setAi]);
}
