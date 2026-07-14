import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const FORWARD_EMAIL = 'arjun.resumeai@gmail.com';

const codeStyle = { background: '#e7e5e4', padding: '2px 8px', borderRadius: '3px', fontSize: '12px', color: '#f59e0b', fontFamily: "'DM Mono', monospace" };

const FILTER_STEPS = [
  { n: '01', text: 'Open Gmail → click the gear icon → See all settings' },
  { n: '02', text: 'Click the "Filters and Blocked Addresses" tab' },
  { n: '03', text: 'Click "Create a new filter" at the bottom' },
  { n: '04', text: <span>In the <strong>From</strong> field enter: <code style={codeStyle}>jobalerts-noreply@linkedin.com</code></span> },
  { n: '05', text: 'Click "Create filter"' },
  { n: '06', text: <span>Check <strong>"Forward it to"</strong> → enter: <code style={codeStyle}>{FORWARD_EMAIL}</code></span> },
  { n: '07', text: 'Click "Create filter" — done! ✓' },
];

export default function GmailOAuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('connecting'); // connecting | done | manual | error
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (params.get('error') || !code) {
      navigate('/dashboard');
      return;
    }
    api.connectGmail(code)
      .then(res => {
        if (res.filterCreated) {
          setStatus('done');
          setTimeout(() => navigate('/dashboard?gmail=connected'), 2500);
        } else {
          setStatus('manual');
        }
      })
      .catch(() => setStatus('error'));
  }, []);

  const handleVerify = async () => {
    setVerifying(true);
    await api.verifyGmailFilter();
    setVerified(true);
    setVerifying(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fafaf9', color: '#1c1917', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '22px', marginBottom: '40px' }}>
        arjun<span style={{ color: '#f59e0b' }}>.</span>
      </div>

      {status === 'connecting' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '2px solid #d6d3d1', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ fontSize: '14px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>Connecting Gmail...</div>
        </div>
      )}

      {status === 'done' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '28px', marginBottom: '8px' }}>Gmail connected!</h2>
          <p style={{ fontSize: '14px', color: '#78716c', marginBottom: '4px' }}>Filter created — LinkedIn alerts will auto-forward to Arjun.</p>
          <p style={{ fontSize: '12px', color: '#c4c0bc', fontFamily: "'DM Mono', monospace" }}>Check your inbox — we sent a confirmation email.</p>
          <div style={{ marginTop: '20px', width: 24, height: 24, border: '2px solid #d6d3d1', borderTopColor: '#22c55e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {status === 'error' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '24px', marginBottom: '8px' }}>Something went wrong</h2>
          <button onClick={() => navigate('/dashboard')} style={{ background: '#f59e0b', color: '#1c1917', border: 'none', padding: '12px 24px', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', marginTop: '16px' }}>
            Go to dashboard
          </button>
        </div>
      )}

      {status === 'manual' && (
        <div style={{ width: '100%', maxWidth: '580px', animation: 'fadeIn 0.3s ease' }}>
          {verified ? (
            <div style={{ textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎯</div>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '12px' }}>You're all set!</h2>
              <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '12px', padding: '20px', marginBottom: '24px', textAlign: 'left' }}>
                <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '14px' }}>WHAT HAPPENS NEXT</div>
                {[
                  { icon: '📧', text: 'Your LinkedIn job alerts forward to Arjun automatically' },
                  { icon: '⏱', text: 'Every 2 hours: Arjun checks for new alerts' },
                  { icon: '🤖', text: 'Scrapes full job description from LinkedIn' },
                  { icon: '✍️', text: 'Tailors your resume using your profile' },
                  { icon: '📊', text: 'Calculates ATS score (target: 95/100)' },
                  { icon: '📨', text: 'Emails you the tailored .docx resume' },
                ].map(({ icon, text }) => (
                  <div key={text} style={{ display: 'flex', gap: '12px', padding: '8px 0', borderBottom: '1px solid #e7e5e4' }}>
                    <span style={{ fontSize: '14px', flexShrink: 0 }}>{icon}</span>
                    <span style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.5 }}>{text}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: '#ecfdf5', border: '1px solid #22c55e22', borderRadius: '8px', padding: '14px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                  <span style={{ fontSize: '13px', color: '#22c55e88', fontFamily: "'DM Mono', monospace" }}>Gmail is live — Arjun is watching for job alerts</span>
                </div>
              </div>
              <button onClick={() => navigate('/dashboard?gmail=connected')} style={{ width: '100%', background: '#f59e0b', color: '#1c1917', border: 'none', padding: '14px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                Go to dashboard →
              </button>
            </div>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>📬</div>
                <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '8px' }}>One quick step</h2>
                <p style={{ fontSize: '14px', color: '#78716c', lineHeight: 1.6 }}>Set up a Gmail filter to forward LinkedIn job alerts to Arjun — takes 2 minutes.</p>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '12px', padding: '24px', marginBottom: '16px' }}>
                <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>GMAIL FILTER SETUP</div>
                {FILTER_STEPS.map(({ n, text }) => (
                  <div key={n} style={{ display: 'flex', gap: '14px', padding: '10px 0', borderBottom: '1px solid #e7e5e4' }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#f59e0b', flexShrink: 0, paddingTop: '2px' }}>{n}</span>
                    <span style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.5 }}>{text}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '8px', padding: '14px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>{FORWARD_EMAIL}</span>
                <button onClick={() => navigator.clipboard.writeText(FORWARD_EMAIL)} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: '#78716c', padding: '4px 12px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                  Copy
                </button>
              </div>

              <button onClick={handleVerify} disabled={verifying} style={{ width: '100%', background: '#f59e0b', color: '#1c1917', border: 'none', padding: '14px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', marginBottom: '10px', opacity: verifying ? 0.7 : 1 }}>
                {verifying ? 'Saving...' : "✓ I've set up the filter"}
              </button>
              <button onClick={() => navigate('/dashboard')} style={{ width: '100%', background: 'transparent', border: '1px solid #d6d3d1', color: '#a8a29e', padding: '12px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>
                I'll do this later
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
