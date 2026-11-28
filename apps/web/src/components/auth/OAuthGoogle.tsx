import { useEffect, useState } from 'react';
import { GoogleAuthProvider } from 'firebase/auth';
import { useAuth } from '../../hooks/useAuth';

const FIELDS = ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource', 'consent'];

/** Host that will receive the authorization, shown so the user knows which client asks. */
function redirectHost(params: URLSearchParams): string {
  try { return new URL(params.get('redirect_uri') || '').host; } catch { return ''; }
}

export default function OAuthGoogle() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const host = redirectHost(params);
  // Only the server consent page issues `consent` (bound to this browser by a cookie).
  // Without it, send the user there instead of authorizing an unknown client.
  const hasConsent = !!params.get('consent') && !!host;

  useEffect(() => {
    if (!hasConsent) {
      const back = new URLSearchParams(FIELDS.filter(f => f !== 'consent').map(f => [f, params.get(f) || '']));
      window.location.replace(`/api/mcp/authorize?${back.toString()}`);
    }
  }, [hasConsent]);

  async function authorize(form: HTMLFormElement) {
    setBusy(true);
    setError('');
    try {
      const result = await signInWithGoogle();
      const token = GoogleAuthProvider.credentialFromResult(result)?.idToken;
      if (!token) throw new Error('Google n’a pas fourni de jeton de connexion.');
      (form.elements.namedItem('google_id_token') as HTMLInputElement).value = token;
      form.submit();
    } catch {
      setError('Connexion Google impossible. Réessayez et autorisez la fenêtre de connexion.');
      setBusy(false);
    }
  }

  if (!hasConsent) return null;

  return <main style={{ maxWidth: 440, margin: '10vh auto', padding: 32, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-md)', color: 'var(--ink)' }}>
    <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Sk<span style={{ color: 'var(--accent)' }}>AI</span>tch</div>
    <h1>Autoriser l’accès à vos projets</h1>
    <p>L’application <b>{host}</b> demande l’accès à tous vos projets SkAItch, présents et futurs. Connectez-vous avec Google pour l’autoriser.</p>
    <form method="POST" action="/api/mcp/authorize" onSubmit={e => {
      e.preventDefault();
      void authorize(e.currentTarget);
    }}>
      {FIELDS.map(name =>
        <input key={name} type="hidden" name={name} value={params.get(name) || ''} />)}
      <input type="hidden" name="google_id_token" defaultValue="" />
      <label htmlFor="oauth-access">Accès à tous les projets de ce compte, présents et futurs</label>{' '}
      <select id="oauth-access" name="access" defaultValue="write" style={{ display: 'block', width: '100%', marginTop: 8, padding: '11px 14px', border: '1.5px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--ink)' }}>
        <option value="write">Lecture et modification</option>
        <option value="read">Lecture seule</option>
      </select>
      <p>L’autorisation sera révocable dans vos clés API sous « Connexion OAuth ».</p>
      {error && <p role="alert" style={{ color: '#a52222' }}>{error}</p>}
      <button disabled={busy} type="submit" style={{ width: '100%', padding: 12, border: 0, borderRadius: 8, background: 'var(--accent)', color: 'var(--bg)', fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Connexion…' : `Continuer avec Google et autoriser ${host}`}</button>
    </form>
  </main>;
}
