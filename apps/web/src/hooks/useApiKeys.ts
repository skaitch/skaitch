import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/firebase';
import { collection, doc, getDocs, setDoc, deleteDoc, query, where, updateDoc } from 'firebase/firestore';

export interface ApiKey {
  id: string; // The token itself, e.g. ak_...
  name: string;
  uid: string;
  createdAt: string;
  permissions: Record<string, 'read' | 'write' | 'none'>;
  accountAccess?: 'read' | 'write';
}

export function useApiKeys(uid: string | null) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchKeys = useCallback(async () => {
    if (!uid) {
      setKeys([]);
      return;
    }
    setLoading(true);
    try {
      const q = collection(db, 'users', uid, 'apiKeys');
      const snap = await getDocs(q);
      const list = snap.docs.map(d => d.data() as ApiKey);
      setKeys(list);
    } catch (e) {
      console.error('Error fetching API keys:', e);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const createKey = useCallback(async (name: string): Promise<ApiKey | null> => {
    if (!uid) return null;
    
    const randomBytes = new Uint8Array(20);
    window.crypto.getRandomValues(randomBytes);
    const token = `ak_${uid}_` + Array.from(randomBytes, b => b.toString(16).padStart(2, '0')).join('');
    
    const newKey: ApiKey = {
      id: token,
      name: name.trim() || 'Sans titre',
      uid,
      createdAt: new Date().toISOString(),
      permissions: {}
    };

    try {
      await setDoc(doc(db, 'users', uid, 'apiKeys', token), newKey);
      setKeys(prev => [newKey, ...prev]);
      return newKey;
    } catch (e) {
      console.error('Error creating API key:', e);
      return null;
    }
  }, [uid]);

  const deleteKey = useCallback(async (id: string) => {
    if (!uid) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'apiKeys', id));
      setKeys(prev => prev.filter(k => k.id !== id));
    } catch (e) {
      console.error('Error deleting API key:', e);
    }
  }, [uid]);

  const updatePermissions = useCallback(async (id: string, permissions: Record<string, 'read' | 'write' | 'none'>) => {
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'users', uid, 'apiKeys', id), { permissions });
      setKeys(prev => prev.map(k => k.id === id ? { ...k, permissions } : k));
    } catch (e) {
      console.error('Error updating permissions:', e);
    }
  }, [uid]);

  const updateKeyName = useCallback(async (id: string, name: string) => {
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'users', uid, 'apiKeys', id), { name });
      setKeys(prev => prev.map(k => k.id === id ? { ...k, name } : k));
    } catch (e) {
      console.error('Error updating key name:', e);
    }
  }, [uid]);

  return { keys, loading, createKey, deleteKey, updatePermissions, updateKeyName, refresh: fetchKeys };
}
