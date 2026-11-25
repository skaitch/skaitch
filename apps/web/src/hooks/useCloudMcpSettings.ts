import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AiConfig } from '@skaitch/core/types/ifc';
import { requestBim } from '../lib/bimClient';

type Settings = { enabled: boolean; alwaysValidate: boolean; revision: number; lang?: string };

export function useCloudMcpSettings(uid: string | null, ai: AiConfig,
  setAi: Dispatch<SetStateAction<AiConfig>>, fail: (error: Error) => void, lang?: string) {
  const uidRef = useRef(uid); uidRef.current = uid;
  const [readyUid, setReadyUid] = useState<string | null>(null);
  const epochRef = useRef(0);
  const requested = useRef('');
  const saved = useRef<Settings | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const failRef = useRef(fail); failRef.current = fail;
  useEffect(() => {
    let active = true;
    epochRef.current++;
    requested.current = '';
    saved.current = null;
    setReadyUid(null);
    if (!uid) return;
    requestBim<Settings>('mcp-settings', { action: 'get' }).then(settings => {
      if (!active) return;
      saved.current = settings;
      requested.current = JSON.stringify([settings.enabled, settings.alwaysValidate, settings.lang]);
      setAi(current => ({ ...current, mcpEnabled: settings.enabled, mcpAlwaysValidate: settings.alwaysValidate }));
      setReadyUid(uid);
    }).catch(error => { if (active) failRef.current(error); });
    return () => { active = false; };
  }, [uid, setAi]);
  useEffect(() => {
    if (!uid || readyUid !== uid) return;
    const enabled = ai.mcpEnabled ?? true, alwaysValidate = ai.mcpAlwaysValidate ?? true;
    const target = JSON.stringify([enabled, alwaysValidate, lang]);
    if (requested.current === target) return;
    requested.current = target;
    const epoch = epochRef.current;
    const current = () => uidRef.current === uid && epochRef.current === epoch;
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!current()) return;
      const settings = await requestBim<Settings>('mcp-settings', { action: 'set', enabled, alwaysValidate, lang, expectedRevision: saved.current?.revision ?? 0 });
      if (current()) saved.current = settings;
    }).catch(async error => {
      if (!current()) return;
      failRef.current(error);
      const settings = await requestBim<Settings>('mcp-settings', { action: 'get' });
      if (!current()) return;
      saved.current = settings;
      if (requested.current === target) {
        requested.current = JSON.stringify([settings.enabled, settings.alwaysValidate, settings.lang]);
        setAi(value => ({ ...value, mcpEnabled: settings.enabled, mcpAlwaysValidate: settings.alwaysValidate }));
      }
    }).catch(error => { if (current()) failRef.current(error); });
  }, [uid, readyUid, ai.mcpEnabled, ai.mcpAlwaysValidate, lang, setAi]);
  return readyUid === uid && !!uid;
}
