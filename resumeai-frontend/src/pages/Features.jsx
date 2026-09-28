import { Link } from 'react-router-dom';
import { auth } from '../firebase';
import { FEATURE_GROUPS } from '../features';
import Brand from '../components/Brand';

// Public feature list. Content lives in ../features.js; add new features there.

const serif = "'DM Serif Display', serif";
const mono = "'DM Mono', monospace";

// "New" for anything shipped in the current or previous month.
function isNew(added) {
  const [y, m] = (added || '').split('-').map(Number);
  if (!y) return false;
  const now = new Date();
  const months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  return months <= 1;
}

export default function Features() {
  const signedIn = !!auth.currentUser;
  const total = FEATURE_GROUPS.reduce((n, g) => n + g.features.length, 0);

  return (
    <div style={{ minHeight: '100vh', background: '#fafaf9', color: '#1c1917' }}>
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #e7e5e4', position: 'sticky', top: 0, background: '#fafaf9', zIndex: 10, gap: '12px', flexWrap: 'wrap' }}>
        <Link to="/" style={{ fontFamily: serif, fontSize: '20px', color: '#1c1917', textDecoration: 'none' }}>
          <Brand size={20} />
        </Link>
        <Link to={signedIn ? '/dashboard' : '/'} style={{ fontSize: '13px', color: '#1c1917', border: '1px solid #d6d3d1', borderRadius: '6px', padding: '7px 16px', textDecoration: 'none' }}>
          {signedIn ? 'Back to dashboard' : 'Get started'}
        </Link>
      </nav>

      <main style={{ maxWidth: '880px', margin: '0 auto', padding: '48px 16px 80px' }}>
        <div style={{ fontSize: '11px', fontFamily: mono, color: '#b45309', letterSpacing: '0.1em', marginBottom: '10px' }}>
          {total} FEATURES
        </div>
        <h1 style={{ fontFamily: serif, fontSize: 'clamp(30px, 6vw, 44px)', lineHeight: 1.1, marginBottom: '14px' }}>Everything Arjun does</h1>
        <p style={{ fontSize: '15px', color: '#57534e', lineHeight: 1.6, maxWidth: '620px', marginBottom: '28px' }}>
          Arjun keeps a complete record of your career and uses it to tailor every resume, cover letter and application form, using only things you have actually done.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '40px' }}>
          {FEATURE_GROUPS.map(g => (
            <a key={g.id} href={`#${g.id}`} style={{ fontSize: '12px', color: '#57534e', background: '#fff', border: '1px solid #e7e5e4', borderRadius: '999px', padding: '6px 12px', textDecoration: 'none' }}>
              {g.title}
            </a>
          ))}
        </div>

        {FEATURE_GROUPS.map(g => (
          <section key={g.id} id={g.id} style={{ marginBottom: '44px', scrollMarginTop: '80px' }}>
            <h2 style={{ fontFamily: serif, fontSize: '26px', marginBottom: '4px' }}>{g.title}</h2>
            <p style={{ fontSize: '14px', color: '#78716c', marginBottom: '16px' }}>{g.intro}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
              {g.features.map(f => (
                <div key={f.title} style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600 }}>{f.title}</h3>
                    {isNew(f.added) && <span style={{ fontSize: '10px', fontFamily: mono, background: '#fef3c7', color: '#b45309', borderRadius: '999px', padding: '2px 8px' }}>New</span>}
                  </div>
                  <p style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.6, marginBottom: '10px' }}>{f.what}</p>
                  <div style={{ fontSize: '11px', fontFamily: mono, color: '#a8a29e' }}>Where: {f.where}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
