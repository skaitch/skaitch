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
  const [access, setAccess] = useState<'write' | 'read'>('write');
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

  const card: React.CSSProperties = { width: '100%', maxWidth: 420, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow-md)', color: 'var(--ink)' };
  const option = (checked: boolean): React.CSSProperties => ({ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 8, padding: '11px 13px', borderRadius: 10, cursor: 'pointer',
    border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`, background: checked ? 'color-mix(in oklch, var(--accent) 10%, transparent)' : 'transparent' });

  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
    <main style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, fontSize: 13, fontWeight: 600 }}>
        <span style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 999, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host}</span>
        <span aria-hidden="true" style={{ flex: 1, borderTop: '1px dashed var(--border)' }} />
        <span style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 999 }}>Sk<span style={{ color: 'var(--accent)' }}>AI</span>tch</span>
      </div>
      <h1 style={{ fontSize: 20, lineHeight: 1.3, margin: '0 0 6px', overflowWrap: 'anywhere' }}>Connecter {host} à SkAItch</h1>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-3)' }}>Choisissez les droits, puis connectez-vous avec Google.</p>
      <form method="POST" action="/api/mcp/authorize" onSubmit={e => {
        e.preventDefault();
        void authorize(e.currentTarget);
      }}>
        {FIELDS.map(name =>
          <input key={name} type="hidden" name={name} value={params.get(name) || ''} />)}
        <input type="hidden" name="google_id_token" defaultValue="" />
        <fieldset style={{ border: 0, padding: 0, margin: '20px 0 0' }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', padding: 0 }}>Droits sur tous vos projets, présents et futurs</legend>
          {([['write', 'Lecture et modification', 'Recommandé pour modéliser avec l’assistant'], ['read', 'Lecture seule', 'Consulter et exporter, sans rien changer']] as const).map(([value, title, hint]) =>
            <label key={value} style={option(access === value)}>
              <input type="radio" name="access" value={value} checked={access === value} onChange={() => setAccess(value)} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
              <span><b style={{ display: 'block', fontSize: 14 }}>{title}</b><small style={{ fontSize: 12, color: 'var(--ink-3)' }}>{hint}</small></span>
            </label>)}
        </fieldset>
        {error && <p role="alert" style={{ color: '#a52222', fontSize: 14 }}>{error}</p>}
        <button disabled={busy} type="submit" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', marginTop: 18, padding: '12px 16px', border: 0, borderRadius: 10, background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: busy ? 'wait' : 'pointer', opacity: busy ? .7 : 1 }}>{busy ? 'Connexion…' : 'Continuer avec Google'}</button>
      </form>
      <p style={{ margin: '16px 0 0', fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' }}>Révocable à tout moment dans vos clés API, sous « Connexion OAuth ».</p>
    </main>
  </div>;
}
