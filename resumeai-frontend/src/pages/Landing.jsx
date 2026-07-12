import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithGoogle } from '../firebase';

const s = {
  root: { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  nav: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '22px 48px', borderBottom: '1px solid #1a1a18',
  },
  logo: { fontFamily: "'DM Serif Display', serif", fontSize: '20px' },
  accent: { color: '#f59e0b' },
  hero: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '80px 24px', textAlign: 'center',
  },
  pill: {
    display: 'inline-flex', alignItems: 'center', gap: '8px',
    background: '#141413', border: '1px solid #2a2a27',
    borderRadius: '100px', padding: '6px 16px', marginBottom: '40px',
  },
  dot: { width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' },
  pillText: { fontSize: '12px', color: '#666', fontFamily: "'DM Mono', monospace" },
  h1: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 'clamp(44px, 7vw, 80px)', lineHeight: 1.05,
    letterSpacing: '-2px', maxWidth: '780px', marginBottom: '24px',
  },
  em: { color: '#f59e0b', fontStyle: 'italic' },
  sub: { fontSize: '17px', color: '#666', maxWidth: '460px', lineHeight: 1.65, marginBottom: '48px', fontWeight: 300 },
  btnGoogle: {
    display: 'flex', alignItems: 'center', gap: '12px',
    background: '#f0ede8', color: '#0e0e0d', border: 'none',
    padding: '14px 32px', borderRadius: '8px',
    fontSize: '15px', fontWeight: 600, transition: 'opacity 0.15s',
  },
  stats: {
    display: 'flex', gap: '64px', marginTop: '80px',
    borderTop: '1px solid #1a1a18', paddingTop: '48px',
  },
  stat: { textAlign: 'center' },
  statN: { fontFamily: "'DM Serif Display', serif", fontSize: '30px' },
  statL: { fontSize: '11px', color: '#444', fontFamily: "'DM Mono', monospace", marginTop: '4px' },
};

export default function Landing() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogle = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
      navigate('/onboarding');
    } catch (e) {
      setError('Sign-in failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div style={s.root}>
      <nav style={s.nav}>
        <span style={s.logo}>resumai<span style={s.accent}>.</span></span>
        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{
            background: 'transparent', border: '1px solid #2a2a27',
            color: '#f0ede8', padding: '8px 20px', borderRadius: '6px',
            fontSize: '13px', fontFamily: "'DM Sans', sans-serif",
            opacity: loading ? 0.5 : 1,
          }}
        >
          Sign in →
        </button>
      </nav>

      <div style={s.hero}>
        <div style={s.pill}>
          <span style={s.dot} />
          <span style={s.pillText}>auto-runs every 2 hours</span>
        </div>

        <h1 style={s.h1}>
          Your resume,<br />
          <em style={s.em}>tailored</em> for every job
        </h1>

        <p style={s.sub}>
          Tell us who you are in plain English. We read your LinkedIn job alerts,
          scrape the full JD, and send you a tailored resume with ATS score — automatically.
        </p>

        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{ ...s.btnGoogle, opacity: loading ? 0.7 : 1 }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01c-.72.48-1.63.77-2.7.77-2.08 0-3.84-1.4-4.47-3.3H1.83v2.07A8 8 0 0 0 8.98 17z"/>
            <path fill="#FBBC05" d="M4.51 10.52A4.8 4.8 0 0 1 4.26 9c0-.53.09-1.04.25-1.52V5.41H1.83A8 8 0 0 0 .98 9c0 1.29.31 2.51.85 3.59l2.68-2.07z"/>
            <path fill="#EA4335" d="M8.98 3.58c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 .98 9l2.85 2.07c.63-1.9 2.39-3.3 4.47-3.3-.02 0-.01.01-.32-.19z"/>
          </svg>
          {loading ? 'Signing in...' : 'Continue with Google'}
        </button>

        {error && <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '12px' }}>{error}</p>}

        <div style={s.stats}>
          {[
            { n: '2hr', label: 'auto-refresh cycle' },
            { n: '~$0.001', label: 'cost per resume' },
            { n: '1×', label: 'improvement iteration' },
          ].map(({ n, label }) => (
            <div key={label} style={s.stat}>
              <div style={s.statN}>{n}</div>
              <div style={s.statL}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
