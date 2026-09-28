import Brand from '../components/Brand';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithGoogle } from '../firebase';
import { api } from '../api';

const ADMIN_EMAIL = 'arjun.resumeai@gmail.com';

const FEATURES = [
  {
    tag: 'REMEMBER',
    title: 'Your whole career, in one place',
    desc: 'Every role, project, metric and skill you have ever worked on, kept in one profile that grows with you. When a job asks for something you did three years ago, Arjun still knows it, so relevant experience never gets left off the page.',
  },
  {
    tag: 'INGEST',
    title: 'Upload, or just talk',
    desc: 'Drop in resumes, notes or project write-ups (PDF, DOCX, text), or tell Arjun about your work in plain words. It pulls out each role, bullet and number, merges new uploads without duplicates, and asks when it is unsure where something belongs. Nothing is saved until you confirm.',
  },
  {
    tag: 'TAILOR',
    title: 'A resume for every job, from real facts',
    desc: 'Paste a job link. Arjun reads what the role needs and picks your most relevant experience for it. Every bullet has to trace back to your profile, and code removes anything that doesn\'t, including stretched summaries like "5+ years" when you have four.',
  },
  {
    tag: 'ATS',
    title: 'Scored against the posting',
    desc: 'Each resume is scored for keyword match. Where your real experience already covers a requirement in different words, Arjun rewords it in the posting\'s language. Tools and methods you never used are listed as gaps, never slipped in.',
  },
  {
    tag: 'LAYOUT',
    title: 'One clean page, or your own format',
    desc: 'By default you get a one-page resume: Education, Experience, Projects, Skills, with bold bullet labels and dates aligned right. Upload your own resume to use its layout instead, or say "keep it to 2 pages" in the chat. PDF, Word and a matching cover letter.',
  },
  {
    tag: 'SKILLS',
    title: 'Writes like you',
    desc: 'Arjun Skills turns your profile into playbooks: your strongest evidence, your cover-letter story, your writing voice and your resume format. Every resume and letter follows them. Correct them any time, or download them to use with Claude.',
  },
  {
    tag: 'AUTOMATE',
    title: 'Runs while you sleep',
    desc: 'Forward your LinkedIn job alerts to Arjun. Every 2 hours it reads each posting, tailors a resume and emails it to you. If the AI models are busy, it keeps retrying in the background instead of giving up.',
  },
  {
    tag: 'FREE',
    title: 'Free by default, faster with your key',
    desc: 'Everything runs on free AI models, so it costs nothing to use. Add your own OpenRouter key for a stronger writing model, or a Jev key for sharper job-fit scoring, billed to your own account. If your key fails, Arjun falls back to the free models.',
  },
  {
    tag: 'PRIVACY',
    title: 'Your data stays yours',
    desc: 'API keys are encrypted, passwords you save in the extension never leave your browser, and Arjun never guesses gender, race or other self-identification. Delete your account and every trace of your data goes with it.',
  },
];

const EXTENSION_FEATURES = [
  {
    tag: 'JOB FIT',
    title: 'How well do I fit this job?',
    desc: 'On any job posting, one click gives a fit score against your real profile, your skills, domain and seniority match, and a visa verdict that flags a job only when the posting rules out sponsorship.',
  },
  {
    tag: 'ANALYSIS',
    title: 'Requirement by requirement',
    desc: 'The side panel lists what the job asks for and where you stand on each: strong, only worded differently, partial, or a real gap. Then ask follow-up questions in the chat, grounded in your profile.',
  },
  {
    tag: 'RESUME',
    title: 'Make the resume right in the chat',
    desc: 'Say "make my resume for this job" and it arrives as a chat reply with PDF, Word and cover-letter downloads. Want changes? "Make it one page" or "lead with my payments work". Rate replies and copy the conversation.',
  },
  {
    tag: 'AUTOFILL',
    title: 'Fill applications in one click',
    desc: 'On Workday, Greenhouse, Lever, Ashby, iCIMS and more, Arjun fills contact details, work history, education and links, matching fields by meaning. Repeated job and school rows are filled in order, dates in the form\'s format. Anything uncertain is left for you.',
  },
  {
    tag: 'FOCUSED',
    title: 'Only where it helps',
    desc: 'The popup checks the page first. Job-fit is offered on postings, autofill on application forms, and everywhere else it simply says Arjun isn\'t needed here.',
  },
];

const HOW_IT_WORKS = [
  { step: 'Build your profile once', detail: 'Upload a resume, paste notes, or chat about your work. Arjun turns it into a structured profile of every role, project, metric and skill, and keeps adding to it over time.' },
  { step: 'Find a job', detail: 'Paste a job link, forward LinkedIn alerts, or open a posting with the Chrome extension to see how well you fit before you apply.' },
  { step: 'Apply with the right resume', detail: 'Arjun picks your most relevant experience, writes a one-page resume and cover letter from real facts only, scores it against the posting, and fills the application form for you.' },
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

  // nextTab: open a specific dashboard tab after sign-in (the extension section uses 'extension').
  const handleGoogle = async (nextTab) => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithGoogle();
      const email = result?.user?.email;
      if (email === ADMIN_EMAIL) {
        navigate('/admin', { replace: true });
      } else {
        const profile = await api.getProfile();
        const dashboard = typeof nextTab === 'string' ? `/dashboard?tab=${nextTab}` : '/dashboard';
        navigate(profile?._onboarded ? dashboard : '/onboarding', { replace: true });
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
          .ext-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* NAV */}
      <nav className="nav-bar" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '22px 48px', borderBottom: '1px solid #e7e5e4',
        position: 'sticky', top: 0, background: '#fafaf9', zIndex: 10,
      }}>
        <Brand size={20} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <a href="#chrome-extension" style={{ fontSize: '13px', color: '#57534e', textDecoration: 'none' }}>Chrome extension</a>
        <Link to="/features" style={{ fontSize: '13px', color: '#57534e', textDecoration: 'none' }}>Features</Link>
        <button
          onClick={() => handleGoogle()}
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
        </div>
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
            career memory · tailored resumes · job-site extension
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
          Arjun keeps your whole career in one place, every role, project and number you have ever
          worked on. For each job, it picks the experience that matters, writes a one-page resume and
          cover letter from real facts only, and fills the application for you.
        </p>

        <button
          className="g-btn"
          onClick={() => handleGoogle()}
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
            { n: '0', label: 'invented claims' },
            { n: '1 page', label: 'fitted by default' },
            { n: 'Free', label: 'to use' },
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
          You have worked at several companies, shipped real projects and picked up skills along the way.
          When it is time to apply, you forget half of it, and asking an AI to "improve" your resume only
          rewords what is already there. Arjun holds everything you have done, so the right experience
          shows up for the right job, and nothing on the page is made up.
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

      {/* CHROME EXTENSION */}
      <section id="chrome-extension" className="section-pad" style={{ padding: '80px 48px', scrollMarginTop: '80px' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <span style={{
            fontSize: '11px', fontFamily: "'DM Mono', monospace",
            color: '#f59e0b', letterSpacing: '2px', textTransform: 'uppercase',
          }}>
            ARJUN FOR CHROME
          </span>
          <h2 style={{
            fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(28px, 4vw, 40px)',
            maxWidth: '640px', margin: '16px auto 16px', letterSpacing: '-1px', lineHeight: 1.15,
          }}>
            Your profile, <span style={{ color: '#f59e0b', fontStyle: 'italic' }}>right on</span> the job page.
          </h2>
          <p style={{ fontSize: '15px', color: '#78716c', maxWidth: '540px', margin: '0 auto', lineHeight: 1.7, fontWeight: 300 }}>
            The Arjun extension brings everything in your profile to the application form, and tells you
            whether a job is worth applying to before you spend twenty minutes on it.
          </p>
        </div>

        <div className="ext-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '20px', maxWidth: '1040px', margin: '0 auto', alignItems: 'stretch',
        }}>
          {EXTENSION_FEATURES.map((f, i) => (
            <div key={f.tag} className="feature-card" data-idx={i + 20} style={{
              textAlign: 'left', padding: '32px', border: '1px solid #e7e5e4', borderRadius: '12px',
              background: '#fff', transition: 'border-color 0.2s', ...fadeIn(i + 20),
            }}>
              <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '1.5px' }}>{f.tag}</span>
              <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '20px', margin: '8px 0 12px', letterSpacing: '-0.5px' }}>{f.title}</h3>
              <p style={{ fontSize: '13.5px', color: '#78716c', lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
            </div>
          ))}

          {/* Popup preview: a sample job-fit result, labelled as an example */}
          <div data-idx={22} aria-label="Example of the extension popup" style={{
            border: '1px solid #e7e5e4', borderRadius: '12px', background: '#fff', padding: '18px',
            boxShadow: '0 12px 32px rgba(28,25,23,0.08)', ...fadeIn(22),
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ width: 18, height: 18, borderRadius: '5px', background: '#f59e0b', display: 'inline-block' }} />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Arjun</span>
              <span style={{ marginLeft: 'auto', fontSize: '9.5px', fontFamily: "'DM Mono', monospace", color: '#a8a29e' }}>EXAMPLE</span>
            </div>
            <div style={{ fontSize: '9.5px', fontFamily: "'DM Mono', monospace", color: '#a8a29e', letterSpacing: '0.06em', marginBottom: '6px' }}>JOB FIT &amp; SPONSORSHIP</div>
            <div style={{ background: '#1c1917', color: '#fff', borderRadius: '7px', padding: '8px', fontSize: '12px', fontWeight: 600, textAlign: 'center', marginBottom: '12px' }}>How well do I fit this job?</div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '26px', fontWeight: 700 }}>92%</span>
              <span style={{ fontSize: '11px', color: '#57534e' }}>Excellent fit</span>
            </div>
            <div style={{ height: 5, background: '#f5f5f4', borderRadius: 3, overflow: 'hidden', marginBottom: '10px' }}>
              <div style={{ width: '92%', height: '100%', background: '#f59e0b' }} />
            </div>
            {[
              ['Visa', <span key="v" style={{ background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '1px 8px', fontSize: '10.5px', fontWeight: 600 }}>OK to apply</span>],
              ['Skills', '98%'], ['Domain', '95%'], ['Seniority', 'Good match'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid #f5f5f4', fontSize: '11.5px' }}>
                <span style={{ color: '#78716c' }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
            <div style={{ fontSize: '9.5px', fontFamily: "'DM Mono', monospace", color: '#a8a29e', letterSpacing: '0.06em', margin: '12px 0 6px' }}>APPLICATION FORM</div>
            <div style={{ background: '#f59e0b', color: '#fff', borderRadius: '7px', padding: '8px', fontSize: '12px', fontWeight: 600, textAlign: 'center' }}>Fill this page</div>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '40px' }}>
          <button className="g-btn" onClick={() => handleGoogle('extension')} disabled={loading} style={{
            background: '#f59e0b', color: '#1c1917', border: 'none', padding: '13px 28px', borderRadius: '8px',
            fontSize: '14px', fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
          }}>
            {loading ? 'Signing in...' : 'Get the Chrome extension'}
          </button>
          <p style={{ fontSize: '12px', color: '#a8a29e', marginTop: '12px', fontFamily: "'DM Mono', monospace" }}>
            free · Chrome and Edge on desktop · installs in about a minute
          </p>
        </div>
      </section>

      {/* THE PIPELINE (visual) */}
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
            'Alert forwarded',
            'Read the job',
            'Tailor from your profile',
            'Fact check',
            'ATS score',
            'Score < 95?',
            'Improve wording',
            'One-page PDF + Word',
            'Emailed to you',
          ].map((label, i, all) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                padding: '10px 18px', borderRadius: '8px',
                background: label === 'Score < 95?' ? '#fef3c7' : '#fff',
                border: `1px solid ${label === 'Score < 95?' ? '#f59e0b' : '#e7e5e4'}`,
                color: label === 'Score < 95?' ? '#92400e' : '#1c1917',
                whiteSpace: 'nowrap',
              }}>{label}</span>
              {i < all.length - 1 && <span style={{ color: '#d6d3d1', fontSize: '16px' }}>&rarr;</span>}
            </div>
          ))}
        </div>
        <p style={{
          fontSize: '13px', color: '#a8a29e', marginTop: '24px',
          fontFamily: "'DM Mono', monospace",
        }}>
          Runs every 2 hours on its own. If the AI models are busy, it retries in the background.
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
          Your career deserves better than a document you rewrite for every application.
          Let Arjun hold it all, and put your true, strongest story forward for every role.
        </p>
        <button
          className="g-btn"
          onClick={() => handleGoogle()}
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
          {loading ? 'Signing in...' : 'Get started, it’s free'}
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
        <Link to="/features" style={{ fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>all features</Link>
        <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>
          built by vinayak bist
        </span>
      </footer>
    </div>
  );
}
