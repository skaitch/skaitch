import { useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  OAuthProvider,
  type User,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

export type AuthState = User | null | undefined; // undefined = loading

export function useAuth() {
  const [user, setUser] = useState<AuthState>(undefined);

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  const signInWithGoogle = () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(auth, provider);
  };

  const signInWithApple = () =>
    signInWithPopup(auth, new OAuthProvider('apple.com'));

  const signInWithEmail = (email: string, password: string) =>
    signInWithEmailAndPassword(auth, email, password);

  const signUpWithEmail = (email: string, password: string) =>
    createUserWithEmailAndPassword(auth, email, password);

  const logout = () => signOut(auth);

  return { user, signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail, logout };
}
