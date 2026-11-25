import LanguageSelect from '@skaitch/ui/components/LanguageSelect';
import { SkaitchMark } from '@skaitch/ui/components/SkaitchMark';
import About from '../About';
import { makeT } from '@skaitch/core/data/i18n';
import type { LangType } from '@skaitch/core/types/ifc';
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';

const BG_IMAGES = [
  'https://images.unsplash.com/photo-1486325212027-8081e485255e?auto=format&fit=crop&w=1920&q=80',
  'https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=1920&q=80',
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1920&q=80',
];

const QUOTES = [
  { text: 'L\'architecture est le grand livre de l\'humanité.', author: 'Victor Hugo' },
  { text: 'Form follows function.', author: 'Louis Sullivan' },
  { text: 'Less is more.', author: 'Mies van der Rohe' },
];

export default function LoginPage({ lang, onLangChange }: {
  lang: LangType;
  onLangChange: (lang: LangType) => void;
}) {
  const t = makeT(lang);
  const { signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [bgIndex, setBgIndex] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);
  const [winW, setWinW] = useState(() => window.innerWidth);

  const isMobile = winW < 640;
  const isTablet = winW >= 640 && winW < 1024;

  useEffect(() => {
    const interval = setInterval(() => {
      setFadeIn(false);
      setTimeout(() => {
        setBgIndex((i) => (i + 1) % BG_IMAGES.length);
        setFadeIn(true);
      }, 600);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') await signInWithEmail(email, password);
      else await signUpWithEmail(email, password);
    } catch (err: any) {
      setError(err.code || 'unknown');
    } finally {
      setLoading(false);
    }
  }

  async function handleSocial(signIn: () => Promise<unknown>) {
    setError('');
    setLoading(true);
    try { await signIn(); }
    catch (err: any) { setError(err.code || 'unknown'); }
    finally { setLoading(false); }
  }

  const quote = QUOTES[bgIndex % QUOTES.length];

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'var(--font-sans)', overflow: 'hidden' }}>

      {/* ── Left: image panel ─────────────────────────────────────────────── */}
      <div style={{
        display: isMobile ? 'none' : 'flex',
        flex: isTablet ? '0 0 40%' : '0 0 62%',
        position: 'relative',
        overflow: 'hidden',
        background: '#0d1a26',
      }}>
        {/* Background image */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url(${BG_IMAGES[bgIndex]})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          opacity: fadeIn ? 1 : 0,
          transition: 'opacity 0.6s ease',
        }} />

        {/* Dark gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0.7) 100%)',
        }} />

        {/* Blueprint grid overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `
            linear-gradient(rgba(79,124,172,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(79,124,172,0.08) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }} />

        {/* Content */}
        <div style={{
          position: 'relative', zIndex: 1, height: '100%',
          display: 'flex', flexDirection: 'column',
          padding: '40px 48px', justifyContent: 'space-between',
        }}>
          {/* Logo top-left */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SkaitchMark size={50} />
            <span style={{ fontWeight: 700, fontSize: 48, color: '#fff', lineHeight: 1, letterSpacing: '-0.02em' }}>
              <span className="skaitch-wordmark">sk<b>ai</b>tch</span>
            </span>
          </div>

          {/* Quote bottom */}
          <div style={{ maxWidth: 480 }}>
            <div style={{
              width: 40, height: 3, background: 'var(--accent)', borderRadius: 2, marginBottom: 20,
            }} />
            <p style={{
              margin: '0 0 12px', fontSize: 22, fontWeight: 300,
              color: 'rgba(255,255,255,0.92)', lineHeight: 1.45, fontStyle: 'italic',
            }}>
              "{quote.text}"
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}>
              — {quote.author}
            </p>

            {/* Dots */}
            <div style={{ display: 'flex', gap: 6, marginTop: 28 }}>
              {BG_IMAGES.map((_, i) => (
                <div key={i} style={{
                  width: i === bgIndex ? 20 : 6, height: 6,
                  borderRadius: 3, background: i === bgIndex ? 'var(--accent)' : 'rgba(255,255,255,0.3)',
                  transition: 'width 0.3s ease, background 0.3s ease',
                }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: form panel ─────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        background: 'var(--bg)',
        overflowY: 'auto',
        display: 'flex',
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'center',
        padding: isMobile ? '0' : (isTablet ? '32px 24px' : '40px 32px'),
        flexDirection: 'column',
        backgroundImage: isMobile ? `
          linear-gradient(var(--border-faint) 1px, transparent 1px),
          linear-gradient(90deg, var(--border-faint) 1px, transparent 1px)
        ` : 'none',
        backgroundSize: isMobile ? '32px 32px' : 'auto',
      }}>
        {isMobile && (
          <div style={{ width: '100%', padding: '20px 24px 0', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
            <SkaitchMark size={44} />
            <span style={{ fontWeight: 700, fontSize: 42, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.02em' }}>
              <span className="skaitch-wordmark">sk<b>ai</b>tch</span>
            </span>
          </div>
        )}
        <div style={{ width: '100%', maxWidth: isMobile ? '100%' : (isTablet ? '340px' : '380px'), padding: isMobile ? '24px' : '0' }}>

          <LanguageSelect lang={lang} onChange={onLangChange} />
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            {mode === 'login' ? t("Welcome") : t("Create an account")}
          </h1>
          <p style={{ margin: '0 0 32px', fontSize: 14, color: 'var(--ink-3)' }}>
            {mode === 'login'
              ? t("Sign in to access your projects")
              : t("Start designing for free")}
          </p>

          {/* Social */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            <button onClick={() => handleSocial(signInWithGoogle)} disabled={loading} style={socialBtn()}>
              <GoogleIcon />
              <span>{t("Continue with Google")}</span>
            </button>
            <button onClick={() => handleSocial(signInWithApple)} disabled={loading} style={socialBtn()}>
              <AppleIcon />
              <span>{t("Continue with Apple")}</span>
            </button>
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 12, color: 'var(--ink-4)', fontWeight: 500, letterSpacing: '0.04em' }}>{t("Or")}</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* Email form */}
          <form onSubmit={handleEmail} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{t("Email")}</span>
              <input
                type="email" placeholder="you@example.com" dir="ltr" value={email} required
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle()}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{t("Password")}</span>
              <input
                type="password" placeholder="••••••••" value={password} required minLength={6}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle()}
              />
            </label>

            {error && (
              <div role="alert" style={{
                fontSize: 12.5, color: 'oklch(0.55 0.18 25)',
                padding: '10px 14px', background: 'oklch(0.97 0.03 25)',
                borderRadius: 8, border: '1px solid oklch(0.88 0.06 25)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10 6v5M10 13.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {friendlyError(error, lang)}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              marginTop: 4,
              padding: '12px 0', border: 0, borderRadius: 8,
              background: 'var(--accent)', color: 'var(--bg)',
              cursor: loading ? 'default' : 'pointer',
              fontSize: 14, fontWeight: 600, width: '100%',
              opacity: loading ? 0.7 : 1,
              transition: 'opacity 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {loading
                ? <><Spinner />{mode === 'login' ? t("Signing in\u2026") : t("Creating account\u2026")}</>
                : (mode === 'login' ? t("Sign in") : t("Create my account"))}
            </button>
          </form>

          {/* Toggle */}
          <p style={{ marginTop: 24, textAlign: 'center', fontSize: 13.5, color: 'var(--ink-3)' }}>
            {mode === 'login' ? (
              <>{t("No account yet?")} {' '}
                <button onClick={() => { setMode('signup'); setError(''); }} style={linkBtn()}>{t('Sign up')}</button>
              </>
            ) : (
              <>{t("Already have an account?")} {' '}
                <button onClick={() => { setMode('login'); setError(''); }} style={linkBtn()}>{t("Sign in")}</button>
              </>
            )}
          </p>

          <About lang={lang} />

          <p style={{ marginTop: 32, textAlign: 'center', fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.6 }}>
            {t('By continuing, you accept our terms of use and privacy policy.')}{' '}
            <a href="/confidentialite" style={{ color: 'inherit', textDecoration: 'underline' }}>{t('Privacy policy')}</a>
          </p>
        </div>
      </div>
    </div>
  );
}

function friendlyError(code: string, lang: LangType): string {
  const map: Record<string, string> = {
    'auth/unauthorized-domain': "This address is not authorized for Google sign-in. For local development, open localhost instead of 127.0.0.1.",
    'auth/popup-blocked': "Allow the sign-in popup in your browser and try again.",
    'auth/popup-closed-by-user': "The sign-in window was closed. Try again to finish signing in.",
    'auth/cancelled-popup-request': "Another sign-in window is already open. Finish that sign-in or try again.",
    'auth/network-request-failed': "Unable to reach the sign-in service. Check your connection and try again.",
    'auth/user-not-found':       "No account with this email.",
    'auth/wrong-password':       "Incorrect password.",
    'auth/email-already-in-use': "This email is already in use.",
    'auth/weak-password':        "Password too short (min. 6 characters).",
    'auth/invalid-email':        "Invalid email address.",
    'auth/too-many-requests':    "Too many attempts. Try again later.",
    'auth/invalid-credential':   "Incorrect email or password.",
  };
  return map[code] ? makeT(lang)(map[code]) : makeT(lang)('Error');
}

function socialBtn(): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: '11px 16px', border: '1.5px solid var(--border)', borderRadius: 8,
    background: 'var(--panel)', color: 'var(--ink)', cursor: 'pointer',
    fontSize: 13.5, fontWeight: 500, width: '100%',
    transition: 'border-color 0.15s, background 0.15s',
  };
}

function inputStyle(): React.CSSProperties {
  return {
    padding: '11px 14px', border: '1.5px solid var(--border)', borderRadius: 8,
    background: 'var(--bg)', color: 'var(--ink)', fontSize: 14,
    outline: 'none', fontFamily: 'var(--font-sans)', width: '100%',
    boxSizing: 'border-box', transition: 'border-color 0.15s',
  };
}

function linkBtn(): React.CSSProperties {
  return {
    background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer',
    fontSize: 13.5, fontWeight: 600, padding: 0, textDecoration: 'underline',
    textUnderlineOffset: 2,
  };
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ animation: 'spin 0.7s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/>
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.5 33.3 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8 20-20 0-1.3-.1-2.7-.4-4z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.8 19 13 24 13c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.5 35.5 26.9 36 24 36c-5.2 0-9.5-2.6-11.2-6.4l-6.5 5C9.9 40.1 16.5 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.6 4.6-4.8 6l6.2 5.2C40.7 35.5 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  );
}
