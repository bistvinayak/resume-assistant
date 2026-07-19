import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithGoogle } from '../firebase';
import { api } from '../api';

const ADMIN_EMAIL = 'arjun.resumeai@gmail.com';

const FEATURES = [
  {
    tag: 'INGEST',
    title: 'Smart ingestion',
    desc: 'Drop in a PDF, DOCX, or just paste plain text about your work. Arjun pulls out every role, skill, metric, and achievement — and builds your profile intelligently. Add the same info twice? It catches duplicates instead of blindly stacking them.',
  },
  {
    tag: 'PROFILE',
    title: 'Your professional repository',
    desc: 'Think of it as a single place that holds your entire professional journey — every company, every project, every skill you\'ve picked up. When it\'s time to apply, you don\'t have to remember what you did three years ago. It\'s already here.',
  },
  {
    tag: 'TAILOR',
    title: 'Right data for the right job',
    desc: 'Every JD asks for different things. Arjun reads the full job description and picks the most relevant parts of your profile to build a resume that actually matches what they\'re looking for — so you never leave the right experience off the page.',
  },
  {
    tag: 'AUTOMATE',
    title: 'Runs while you sleep',
    desc: 'Connect your Gmail. Arjun reads your LinkedIn job alerts every 2 hours, scrapes each listing, builds a tailored resume, and delivers it to your inbox. You wake up with resumes ready to send.',
  },
  {
    tag: 'CHAT',
    title: 'Just talk to it',
    desc: 'Tell Arjun about your work the way you\'d tell a friend. "I led a team of 5 at Acme and shipped a payment system." It extracts the structured data, confirms what it found, and adds it to your profile.',
  },
  {
    tag: 'ATS',
    title: 'ATS-ready, automatically',
    desc: 'Every tailored resume is scored against the job description for ATS compatibility. If the score is below the bar, Arjun rewrites the weak spots and rescores — until your resume is actually ready to get through.',
  },
];

const HOW_IT_WORKS = [
  { step: 'Add your work', detail: 'Upload a resume, paste some text, or just chat about your experience. Arjun pulls out everything — roles, skills, metrics, impact — and builds a structured profile that holds your full professional journey.' },
  { step: 'Point it at jobs', detail: 'Paste a job URL or connect Gmail to your LinkedIn alerts. Arjun reads the full job description and understands what they\'re actually looking for.' },
  { step: 'Get the right resume', detail: 'Arjun picks the most relevant parts of your profile, builds a resume tailored to that specific role, scores it for ATS, and rewrites until the score clears the bar.' },
];

export default function Landing() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(new Set());
  const observerRef = useRef(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            setVisible(prev => new Set([...prev, e.target.dataset.idx]));
          }
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll('[data-idx]').forEach(el => observerRef.current.observe(el));
    return () => observerRef.current?.disconnect();
  }, []);

  const handleGoogle = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithGoogle();
      const email = result?.user?.email;
      if (email === ADMIN_EMAIL) {
        navigate('/admin', { replace: true });
      } else {
        const profile = await api.getProfile();
        navigate(profile?._onboarded ? '/dashboard' : '/onboarding', { replace: true });
      }
    } catch (e) {
      setError('Sign-in failed. Please try again.');
      setLoading(false);
    }
  };

  const fadeIn = (idx) => ({
    opacity: visible.has(String(idx)) ? 1 : 0,
    transform: visible.has(String(idx)) ? 'translateY(0)' : 'translateY(24px)',
    transition: 'opacity 0.5s ease, transform 0.5s ease',
  });

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      background: '#fafaf9', color: '#1c1917',
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        .g-btn:hover { opacity: 0.85 !important; }
        .feature-card:hover { border-color: #f59e0b !important; }
        .step-card:hover { background: #fefce8 !important; }
        @media (max-width: 768px) {
          .features-grid { grid-template-columns: 1fr !important; }
          .steps-grid { grid-template-columns: 1fr !important; }
          .hero-h1 { font-size: 38px !important; letter-spacing: -1px !important; }
          .hero-section { padding: 60px 20px !important; }
          .stats-row { gap: 32px !important; flex-wrap: wrap; justify-content: center; }
          .nav-bar { padding: 16px 20px !important; }
          .section-pad { padding: 60px 20px !important; }
        }
      `}</style>

      {/* NAV */}
      <nav className="nav-bar" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '22px 48px', borderBottom: '1px solid #e7e5e4',
        position: 'sticky', top: 0, background: '#fafaf9', zIndex: 10,
      }}>
        <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '20px' }}>
          arjun<span style={{ color: '#f59e0b' }}>.</span>
        </span>
        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{
            background: 'transparent', border: '1px solid #d6d3d1',
            color: '#1c1917', padding: '8px 20px', borderRadius: '6px',
            fontSize: '13px', fontFamily: "'DM Sans', sans-serif",
            cursor: 'pointer', opacity: loading ? 0.5 : 1,
          }}
        >
          Sign in
        </button>
      </nav>

      {/* HERO */}
      <section className="hero-section" style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '100px 24px 80px', textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: '#fff', border: '1px solid #d6d3d1',
          borderRadius: '100px', padding: '6px 16px', marginBottom: '40px',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: '12px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>
            powered by LLM — ingestion, tailoring, scoring
          </span>
        </div>

        <h1 className="hero-h1" style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: 'clamp(44px, 7vw, 76px)', lineHeight: 1.05,
          letterSpacing: '-2px', maxWidth: '800px', marginBottom: '24px',
        }}>
          You did the work.<br />
          Arjun <span style={{ color: '#f59e0b', fontStyle: 'italic' }}>remembers</span> it.
        </h1>

        <p style={{
          fontSize: '17px', color: '#78716c', maxWidth: '520px',
          lineHeight: 1.7, marginBottom: '48px', fontWeight: 300,
        }}>
          Arjun keeps your entire professional journey in one place — every role, project, and skill
          you've ever worked on. When you apply for a job, it picks the right experience for that
          specific role and builds an ATS-ready resume. You never have to worry about forgetting
          what's relevant again.
        </p>

        <button
          className="g-btn"
          onClick={handleGoogle}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            background: '#1c1917', color: '#fafaf9', border: 'none',
            padding: '14px 32px', borderRadius: '8px',
            fontSize: '15px', fontWeight: 600, cursor: 'pointer',
            opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01c-.72.48-1.63.77-2.7.77-2.08 0-3.84-1.4-4.47-3.3H1.83v2.07A8 8 0 0 0 8.98 17z"/>
            <path fill="#FBBC05" d="M4.51 10.52A4.8 4.8 0 0 1 4.26 9c0-.53.09-1.04.25-1.52V5.41H1.83A8 8 0 0 0 .98 9c0 1.29.31 2.51.85 3.59l2.68-2.07z"/>
            <path fill="#EA4335" d="M8.98 3.58c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 .98 9l2.85 2.07c.63-1.9 2.39-3.3 4.47-3.3-.02 0-.01.01-.32-.19z"/>
          </svg>
          {loading ? 'Signing in...' : 'Get started with Google'}
        </button>

        {error && <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '12px' }}>{error}</p>}

        <div className="stats-row" style={{
          display: 'flex', gap: '64px', marginTop: '80px',
          borderTop: '1px solid #e7e5e4', paddingTop: '48px',
        }}>
          {[
            { n: '2hr', label: 'auto-refresh' },
            { n: '95+', label: 'target ATS score' },
            { n: '<$0.01', label: 'per resume' },
          ].map(({ n, label }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '30px' }}>{n}</div>
              <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginTop: '4px' }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* DIVIDER LINE */}
      <div style={{ width: '60px', height: '1px', background: '#f59e0b', margin: '0 auto' }} />

      {/* NOT JUST A RESUME BUILDER */}
      <section className="section-pad" style={{ padding: '80px 48px', textAlign: 'center' }}>
        <span style={{
          fontSize: '11px', fontFamily: "'DM Mono', monospace",
          color: '#f59e0b', letterSpacing: '2px', textTransform: 'uppercase',
        }}>
          WHY ARJUN
        </span>
        <h2 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(28px, 4vw, 40px)',
          maxWidth: '640px', margin: '16px auto 16px', letterSpacing: '-1px', lineHeight: 1.15,
        }}>
          Not just a resume builder.<br />
          A <span style={{ color: '#f59e0b', fontStyle: 'italic' }}>repository</span> of your career.
        </h2>
        <p style={{
          fontSize: '15px', color: '#78716c', maxWidth: '520px',
          margin: '0 auto 64px', lineHeight: 1.7, fontWeight: 300,
        }}>
          You've worked at multiple companies, shipped real projects, picked up skills along the way.
          When it's time to apply, you sit down and forget half of it. Every JD wants different things,
          and there's a good chance the right experience is sitting in your head — just not on the page.
          Arjun holds all of it, so the right data shows up for the right job.
        </p>

        {/* FEATURES GRID */}
        <div className="features-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '20px', maxWidth: '960px', margin: '0 auto',
        }}>
          {FEATURES.map((f, i) => (
            <div
              key={f.tag}
              className="feature-card"
              data-idx={i}
              style={{
                textAlign: 'left', padding: '32px',
                border: '1px solid #e7e5e4', borderRadius: '12px',
                background: '#fff', transition: 'border-color 0.2s',
                ...fadeIn(i),
              }}
            >
              <span style={{
                fontSize: '10px', fontFamily: "'DM Mono', monospace",
                color: '#f59e0b', letterSpacing: '1.5px',
              }}>{f.tag}</span>
              <h3 style={{
                fontFamily: "'DM Serif Display', serif", fontSize: '20px',
                margin: '8px 0 12px', letterSpacing: '-0.5px',
              }}>{f.title}</h3>
              <p style={{
                fontSize: '13.5px', color: '#78716c', lineHeight: 1.65, margin: 0,
              }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section-pad" style={{
        padding: '80px 48px', background: '#1c1917', color: '#fafaf9',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <span style={{
            fontSize: '11px', fontFamily: "'DM Mono', monospace",
            color: '#f59e0b', letterSpacing: '2px', textTransform: 'uppercase',
          }}>
            HOW IT WORKS
          </span>
          <h2 style={{
            fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(28px, 4vw, 40px)',
            margin: '16px 0 0', letterSpacing: '-1px', lineHeight: 1.15,
          }}>
            Three steps. Then it's <span style={{ color: '#f59e0b', fontStyle: 'italic' }}>automatic</span>.
          </h2>
        </div>

        <div className="steps-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '24px', maxWidth: '900px', margin: '0 auto',
        }}>
          {HOW_IT_WORKS.map((s, i) => (
            <div
              key={i}
              className="step-card"
              data-idx={i + 10}
              style={{
                padding: '32px', borderRadius: '12px',
                border: '1px solid #292524', background: '#1c1917',
                transition: 'background 0.2s',
                ...fadeIn(i + 10),
              }}
            >
              <span style={{
                fontFamily: "'DM Mono', monospace", fontSize: '12px',
                color: '#f59e0b',
              }}>0{i + 1}</span>
              <h3 style={{
                fontFamily: "'DM Serif Display', serif", fontSize: '20px',
                margin: '12px 0', letterSpacing: '-0.5px',
              }}>{s.step}</h3>
              <p style={{
                fontSize: '13.5px', color: '#a8a29e', lineHeight: 1.65, margin: 0,
              }}>{s.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* THE PIPELINE — VISUAL */}
      <section className="section-pad" style={{ padding: '80px 48px', textAlign: 'center' }}>
        <span style={{
          fontSize: '11px', fontFamily: "'DM Mono', monospace",
          color: '#f59e0b', letterSpacing: '2px', textTransform: 'uppercase',
        }}>
          THE PIPELINE
        </span>
        <h2 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(28px, 4vw, 40px)',
          margin: '16px auto 48px', letterSpacing: '-1px', lineHeight: 1.15, maxWidth: '560px',
        }}>
          What happens when a<br />job alert hits your inbox
        </h2>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexWrap: 'wrap', gap: '12px', maxWidth: '860px', margin: '0 auto',
          fontFamily: "'DM Mono', monospace", fontSize: '12px',
        }}>
          {[
            'Gmail alert',
            'Scrape JD',
            'Tailor resume',
            'ATS score',
            'Score < 95?',
            'Rewrite & rescore',
            'Deliver',
          ].map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                padding: '10px 18px', borderRadius: '8px',
                background: label === 'Score < 95?' ? '#fef3c7' : '#fff',
                border: `1px solid ${label === 'Score < 95?' ? '#f59e0b' : '#e7e5e4'}`,
                color: label === 'Score < 95?' ? '#92400e' : '#1c1917',
                whiteSpace: 'nowrap',
              }}>{label}</span>
              {i < 6 && <span style={{ color: '#d6d3d1', fontSize: '16px' }}>&rarr;</span>}
            </div>
          ))}
        </div>
        <p style={{
          fontSize: '13px', color: '#a8a29e', marginTop: '24px',
          fontFamily: "'DM Mono', monospace",
        }}>
          Runs automatically every 2 hours. No manual work.
        </p>
      </section>

      {/* FINAL CTA */}
      <section style={{
        padding: '80px 48px 100px', textAlign: 'center',
        borderTop: '1px solid #e7e5e4',
      }}>
        <h2 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(28px, 4vw, 44px)',
          letterSpacing: '-1px', marginBottom: '16px', lineHeight: 1.1,
        }}>
          Add your work once.<br />Apply <span style={{ color: '#f59e0b', fontStyle: 'italic' }}>everywhere</span>.
        </h2>
        <p style={{
          fontSize: '15px', color: '#78716c', maxWidth: '420px',
          margin: '0 auto 36px', lineHeight: 1.7, fontWeight: 300,
        }}>
          Your professional journey deserves better than a static document you rewrite every time.
          Let Arjun hold it all, and put the right story forward for every role.
        </p>
        <button
          className="g-btn"
          onClick={handleGoogle}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '12px',
            background: '#1c1917', color: '#fafaf9', border: 'none',
            padding: '14px 32px', borderRadius: '8px',
            fontSize: '15px', fontWeight: 600, cursor: 'pointer',
            opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01c-.72.48-1.63.77-2.7.77-2.08 0-3.84-1.4-4.47-3.3H1.83v2.07A8 8 0 0 0 8.98 17z"/>
            <path fill="#FBBC05" d="M4.51 10.52A4.8 4.8 0 0 1 4.26 9c0-.53.09-1.04.25-1.52V5.41H1.83A8 8 0 0 0 .98 9c0 1.29.31 2.51.85 3.59l2.68-2.07z"/>
            <path fill="#EA4335" d="M8.98 3.58c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 .98 9l2.85 2.07c.63-1.9 2.39-3.3 4.47-3.3-.02 0-.01.01-.32-.19z"/>
          </svg>
          {loading ? 'Signing in...' : 'Get started — free'}
        </button>
        {error && <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '12px' }}>{error}</p>}
      </section>

      {/* FOOTER */}
      <footer style={{
        padding: '24px 48px', borderTop: '1px solid #e7e5e4',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '14px', color: '#a8a29e' }}>
          arjun<span style={{ color: '#f59e0b' }}>.</span>
        </span>
        <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>
          built by vinayak bist
        </span>
      </footer>
    </div>
  );
}
