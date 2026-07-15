import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { auth } from '../firebase';

const FORWARD_EMAIL = 'arjun.resumeai@gmail.com';

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(searchParams.get('step') === 'gmail' ? 2 : 1);
  const [bio, setBio] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [gmailVerified, setGmailVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  const user = auth.currentUser;

  useEffect(() => {
    if (searchParams.get('step') === 'gmail') {
      api.getProfile().then(p => {
        if (p?.gmail_connected || p?.gmail_filter_pending) {
          navigate('/dashboard', { replace: true });
        }
      }).catch(() => {});
    }
  }, []);

  const handleVerifyFilter = async () => {
    setVerifying(true);
    try {
      await api.verifyGmailFilter();
      setGmailVerified(true);
    } catch (e) {
      setError('Verification failed. Please try again.');
    }
    setVerifying(false);
  };

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(FORWARD_EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const card = {
    width: '100%', maxWidth: '620px',
    background: '#ffffff', border: '1px solid #d6d3d1',
    borderRadius: '16px', padding: '36px',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      {/* Logo */}
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '20px', marginBottom: '40px' }}>
        resumai<span style={{ color: '#f59e0b' }}>.</span>
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
        {[1, 2].map(n => (
          <div key={n} style={{
            width: n === step ? 24 : 8, height: 8, borderRadius: '4px',
            background: n === step ? '#f59e0b' : n < step ? '#22c55e' : '#d6d3d1',
            transition: 'all 0.3s',
          }} />
        ))}
      </div>

      <div style={card}>
        {step === 1 && (
          <>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#f59e0b', letterSpacing: '0.1em', marginBottom: '10px' }}>
              STEP 01 — TELL US ABOUT YOURSELF
            </div>
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '28px', marginBottom: '8px' }}>
              Hi {user?.displayName?.split(' ')[0]} 👋
            </h2>
            <p style={{ fontSize: '14px', color: '#78716c', lineHeight: 1.6, marginBottom: '20px' }}>
              Upload your resume or write about your career — roles, skills, achievements, tools.
            </p>

            {/* Document upload */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              border: `2px dashed ${files.length ? '#22c55e44' : '#d6d3d1'}`,
              borderRadius: '10px', padding: '16px 20px', cursor: 'pointer',
              background: files.length ? '#ecfdf5' : '#fafaf9',
              transition: 'all 0.2s', marginBottom: '16px',
            }}>
              <input type="file" accept=".pdf,.docx,.doc,.txt,.json" multiple style={{ display: 'none' }} onChange={e => setFiles([...e.target.files])} />
              <span style={{ fontSize: '24px', flexShrink: 0 }}>{files.length ? '✅' : '📄'}</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: files.length ? '#22c55e' : '#1c1917' }}>
                  {files.length > 1 ? `${files.length} files selected` : files.length === 1 ? files[0].name : 'Upload resume'}
                </div>
                <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginTop: '2px' }}>
                  {files.length ? (files.length > 1 ? files.map(f => f.name).join(', ') : 'Click to change') : 'PDF, DOCX, TXT, or JSON — up to 5 files'}
                </div>
              </div>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ flex: 1, height: '1px', background: '#d6d3d1' }} />
              <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>or write about yourself</span>
              <div style={{ flex: 1, height: '1px', background: '#d6d3d1' }} />
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
              {['I spent X years at...', 'I built a product that...', 'I know Python and...', 'I led a team of...'].map(eg => (
                <span key={eg} style={{
                  background: '#e7e5e4', border: '1px solid #d6d3d1',
                  borderRadius: '100px', padding: '3px 12px',
                  fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace",
                }}>{eg}</span>
              ))}
            </div>

            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="I'm a Product Manager with 6 years of experience. I've worked at Zinnia building transaction automation systems handling 100K+ monthly workflows..."
              style={{
                width: '100%', minHeight: '160px', background: '#fafaf9',
                border: `1px solid ${bio.length > 50 ? '#f59e0b44' : '#d6d3d1'}`,
                borderRadius: '8px', color: '#1c1917',
                fontFamily: "'DM Sans', sans-serif", fontSize: '14px',
                lineHeight: 1.7, padding: '16px', resize: 'vertical', outline: 'none',
                transition: 'border-color 0.3s',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
              <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: (files.length || bio.length >= 50) ? '#22c55e' : '#444' }}>
                {files.length && bio.length >= 50 ? `✓ ${files.length} file${files.length > 1 ? 's' : ''} + bio ready` : files.length ? `✓ ${files.length} file${files.length > 1 ? 's' : ''} uploaded` : bio.length < 50 ? `${50 - bio.length} more chars or upload a file` : '✓ ready'}
              </span>
              <button
                onClick={async () => {
                  if (!files.length && bio.trim().length < 50) return;
                  setLoading(true);
                  try {
                    if (bio.trim().length >= 50) await api.ingestText(bio);
                    if (files.length) await api.ingestFiles(files);
                    setStep(2);
                  } catch (e) {
                    setError('Failed to save. Please try again.');
                  }
                  setLoading(false);
                }}
                disabled={(!files.length && bio.trim().length < 50) || loading}
                style={{
                  background: (files.length || bio.trim().length >= 50) ? '#f59e0b' : '#e7e5e4',
                  color: (files.length || bio.trim().length >= 50) ? '#1c1917' : '#78716c',
                  border: 'none', padding: '10px 24px', borderRadius: '6px',
                  fontSize: '13px', fontWeight: 600,
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Processing...' : 'Continue →'}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            {gmailVerified ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎯</div>
                <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '12px' }}>
                  Gmail is live!
                </h2>
                <div style={{ background: '#ecfdf5', border: '1px solid #22c55e22', borderRadius: '8px', padding: '14px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                    <span style={{ fontSize: '13px', color: '#22c55e88', fontFamily: "'DM Mono', monospace" }}>Arjun is watching for LinkedIn job alerts</span>
                  </div>
                </div>
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
                <button onClick={() => navigate('/dashboard')} style={{ width: '100%', background: '#f59e0b', color: '#1c1917', border: 'none', padding: '14px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                  Go to dashboard →
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#f59e0b', letterSpacing: '0.1em', marginBottom: '10px' }}>
                  AUTO-MODE
                </div>
                <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '8px' }}>
                  Connect Gmail
                </h2>
                <p style={{ fontSize: '14px', color: '#78716c', lineHeight: 1.6, marginBottom: '20px' }}>
                  Set up a Gmail filter so LinkedIn job alerts forward to Arjun automatically. Takes 2 minutes.
                </p>

                <div style={{ background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '14px' }}>GMAIL FILTER SETUP</div>
                  {[
                    { n: '01', text: 'Open Gmail → click the gear icon → See all settings' },
                    { n: '02', text: 'Click the "Filters and Blocked Addresses" tab' },
                    { n: '03', text: 'Click "Create a new filter" at the bottom' },
                    { n: '04', text: 'In the From field enter: jobalerts-noreply@linkedin.com' },
                    { n: '05', text: 'Click "Create filter"' },
                    { n: '06', text: `Check "Forward it to" → enter: ${FORWARD_EMAIL}` },
                    { n: '07', text: 'Click "Create filter" — done!' },
                  ].map(({ n, text }) => (
                    <div key={n} style={{ display: 'flex', gap: '14px', padding: '10px 0', borderBottom: '1px solid #e7e5e4' }}>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#f59e0b', flexShrink: 0, paddingTop: '2px' }}>{n}</span>
                      <span style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.5 }}>{text}</span>
                    </div>
                  ))}
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '8px', padding: '14px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>{FORWARD_EMAIL}</span>
                  <button onClick={handleCopyEmail} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: copied ? '#22c55e' : '#666', padding: '4px 12px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'color 0.2s' }}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>

                {error && <p style={{ color: '#ef4444', fontSize: '12px', marginBottom: '10px' }}>{error}</p>}

                <button onClick={handleVerifyFilter} disabled={verifying} style={{ width: '100%', background: '#f59e0b', color: '#1c1917', border: 'none', padding: '14px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', marginBottom: '10px', opacity: verifying ? 0.7 : 1 }}>
                  {verifying ? 'Verifying...' : "✓ I've set up the filter"}
                </button>
                <button onClick={() => navigate('/dashboard')} style={{ width: '100%', background: 'transparent', border: '1px solid #d6d3d1', color: '#78716c', padding: '12px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>
                  Skip — I'll do this later
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
