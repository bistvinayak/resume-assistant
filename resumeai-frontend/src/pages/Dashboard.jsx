import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, signOutUser } from '../firebase';
import { api } from '../api';

const ATSBadge = ({ score }) => {
  const color = score >= 90 ? '#22c55e' : score >= 75 ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color, fontWeight: 600 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {score}/100
    </span>
  );
};

const ProgressBar = ({ value, label, sublabel }) => {
  const color = value === 0 ? '#2a2a27' : value === 100 ? '#22c55e' : '#f59e0b';
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
        <span style={{ fontSize: '12px', color: '#888' }}>{label}</span>
        <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: value === 0 ? '#333' : value === 100 ? '#22c55e' : '#f59e0b' }}>
          {value === 0 ? 'missing' : value === 100 ? 'complete' : `${value}%`}
        </span>
      </div>
      <div style={{ height: '3px', background: '#1f1f1c', borderRadius: '2px' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: '2px', transition: 'width 1s ease' }} />
      </div>
      {sublabel && <div style={{ fontSize: '10px', color: '#333', fontFamily: "'DM Mono', monospace", marginTop: '3px' }}>{sublabel}</div>}
    </div>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const user = auth.currentUser;
  const [tab, setTab] = useState('profile');
  const [profile, setProfile] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [addedKeywords, setAddedKeywords] = useState([]);
  const [jobUrl, setJobUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);

  const handleDownload = async (e, jobId) => {
    e.stopPropagation();
    setDownloading(jobId);
    try {
      await api.downloadResume(jobId);
    } catch (err) {
      console.error('Download failed:', err);
    }
    setDownloading(null);
  };

  useEffect(() => {
    Promise.all([api.getProfile(), api.getJobs()])
      .then(([p, j]) => { setProfile(p); setJobs(j.jobs || []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleAddKeyword = async (keyword) => {
    setAddedKeywords(prev => [...prev, keyword]);
    await api.addKeywordToProfile(keyword);
  };

  const handleSubmitUrl = async () => {
    if (!jobUrl.trim()) return;
    setSubmitting(true);
    setSubmitMsg('');
    try {
      await api.submitJobUrl(jobUrl);
      setSubmitMsg('✓ Job queued — resume will be emailed shortly');
      setJobUrl('');
      setTimeout(() => setSubmitMsg(''), 4000);
    } catch (e) {
      setSubmitMsg('Failed — check the URL and try again');
    }
    setSubmitting(false);
  };

  const allSkills = profile ? [
    ...(profile.skills || []),
  ] : [];

  const completeness = profile ? {
    contact: profile.contact?.name && profile.contact?.email ? 100 : 40,
    summary: (profile.summary?.length || 0) > 50 ? 100 : 20,
    skills: allSkills.length > 10 ? 100 : allSkills.length > 0 ? 60 : 0,
    experience: (profile.experience?.length || 0) >= 2 ? 100 : (profile.experience?.length || 0) > 0 ? 50 : 0,
    education: (profile.education?.length || 0) > 0 ? 100 : 0,
    certifications: 0,
    projects: (profile.projects?.length || 0) > 0 ? 100 : 0,
  } : {};

  const overallScore = Object.keys(completeness).length
    ? Math.round(Object.values(completeness).reduce((a, b) => a + b, 0) / Object.keys(completeness).length)
    : 0;

  const avgATS = jobs.length ? Math.round(jobs.reduce((a, j) => a + (j.ats_score || 0), 0) / jobs.length) : 0;

  const allMissing = jobs.flatMap(j => j.missing_keywords || []);
  const missingFreq = allMissing.reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const topMissing = Object.entries(missingFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ width: 24, height: 24, border: '2px solid #333', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 40px', borderBottom: '1px solid #1a1a18',
        position: 'sticky', top: 0, background: '#0e0e0d', zIndex: 10,
      }}>
        <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '18px' }}>
          resumai<span style={{ color: '#f59e0b' }}>.</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#141413', border: '1px solid #1f1f1c', borderRadius: '100px', padding: '5px 14px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: '11px', color: '#555', fontFamily: "'DM Mono', monospace" }}>auto-running</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {user?.photoURL && <img src={user.photoURL} style={{ width: 28, height: 28, borderRadius: '50%' }} />}
            <button onClick={async () => { await signOutUser(); navigate('/'); }} style={{ background: 'none', border: 'none', color: '#444', fontSize: '12px', fontFamily: "'DM Mono', monospace" }}>
              sign out
            </button>
          </div>
        </div>
      </nav>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1 }}>
        {/* Sidebar */}
        <aside style={{ borderRight: '1px solid #1a1a18', padding: '24px 16px', position: 'sticky', top: 61, height: 'calc(100vh - 61px)', overflowY: 'auto' }}>
          {/* Profile ring */}
          <div style={{ background: '#141413', border: '1px solid #2a2a27', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              {user?.photoURL && <img src={user.photoURL} style={{ width: 32, height: 32, borderRadius: '50%' }} />}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>{user?.displayName}</div>
                <div style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace" }}>{user?.email}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: `conic-gradient(#f59e0b ${overallScore * 3.6}deg, #1f1f1c 0deg)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#141413', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                  {overallScore}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#f0ede8' }}>Profile score</div>
                <div style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace" }}>
                  {overallScore < 70 ? 'add more info' : 'looking good'}
                </div>
              </div>
            </div>
          </div>

          {/* Nav tabs */}
          {[
            { id: 'profile', label: 'Profile Index' },
            { id: 'jobs', label: 'Job Activity' },
            { id: 'submit', label: 'Submit Job URL' },
            { id: 'gaps', label: 'Skill Gaps' },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)} style={{
              width: '100%', textAlign: 'left',
              background: tab === id ? '#141413' : 'transparent',
              border: `1px solid ${tab === id ? '#2a2a27' : 'transparent'}`,
              borderRadius: '6px', padding: '9px 12px', marginBottom: '3px',
              color: tab === id ? '#f0ede8' : '#555', fontSize: '13px',
              transition: 'all 0.15s',
            }}>{label}</button>
          ))}

          {/* Quick stats */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #1a1a18', paddingTop: '16px' }}>
            {[
              { label: 'Resumes sent', value: jobs.length },
              { label: 'Avg ATS', value: avgATS ? `${avgATS}/100` : '—' },
              { label: '90+ matches', value: jobs.filter(j => j.ats_score >= 90).length },
              { label: 'Skills', value: allSkills.length },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #141413' }}>
                <span style={{ fontSize: '11px', color: '#444' }}>{label}</span>
                <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace" }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Gmail connector */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #1a1a18', paddingTop: '16px' }}>
            <div style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '6px' }}>
              ⚡ CONNECT GMAIL
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px', lineHeight: 1.5 }}>
              Auto-process job alerts every 2 hours
            </div>
            {profile?.gmail_connected ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#22c55e', fontFamily: "'DM Mono', monospace" }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                Connected
              </div>
            ) : (
              <button
                onClick={() => navigate('/onboarding?step=gmail')}
                style={{
                  width: '100%', background: '#f59e0b', color: '#0e0e0d',
                  border: 'none', padding: '8px', borderRadius: '6px',
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Connect Gmail →
              </button>
            )}
          </div>
        </aside>

        {/* Main */}
        <main style={{ padding: '32px 40px', overflowY: 'auto' }}>

          {/* ── PROFILE INDEX ── */}
          {tab === 'profile' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>Profile Index</h2>
              <p style={{ fontSize: '13px', color: '#555', marginBottom: '28px' }}>Everything the system knows about you.</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                {/* Completeness */}
                <div style={{ background: '#141413', border: '1px solid #1f1f1c', borderRadius: '12px', padding: '20px' }}>
                  <div style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>COMPLETENESS</div>
                  <ProgressBar value={completeness.contact || 0} label="Contact info" />
                  <ProgressBar value={completeness.summary || 0} label="Summary" sublabel={`${profile?.summary?.length || 0} chars`} />
                  <ProgressBar value={completeness.skills || 0} label="Skills" sublabel={`${allSkills.length} indexed`} />
                  <ProgressBar value={completeness.experience || 0} label="Experience" sublabel={`${profile?.experience?.length || 0} roles`} />
                  <ProgressBar value={completeness.education || 0} label="Education" />
                  <ProgressBar value={0} label="Certifications" sublabel="none added" />
                  <ProgressBar value={completeness.projects || 0} label="Projects" />
                </div>

                {/* Contact */}
                <div style={{ background: '#141413', border: '1px solid #1f1f1c', borderRadius: '12px', padding: '20px' }}>
                  <div style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>CONTACT</div>
                  {profile?.contact && Object.entries(profile.contact).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: '12px', padding: '7px 0', borderBottom: '1px solid #1a1a18' }}>
                      <span style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace", minWidth: 60, textTransform: 'capitalize' }}>{k}</span>
                      <span style={{ fontSize: '12px', color: '#f0ede8' }}>{Array.isArray(v) ? v.join(', ') : String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Skills */}
              {profile?.skills && profile.skills.length > 0 && (
                <div style={{ background: '#141413', border: '1px solid #1f1f1c', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em' }}>SKILLS — {profile.skills.length} TOTAL</div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {profile.skills.map(skill => (
                      <span key={skill} style={{ background: '#1a1a18', border: '1px solid #2a2a27', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', color: '#c0bdb8', fontFamily: "'DM Mono', monospace" }}>{skill}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Experience */}
              {profile?.experience && profile.experience.length > 0 && (
                <div style={{ background: '#141413', border: '1px solid #1f1f1c', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>EXPERIENCE</div>
                  {profile.experience.map((exp, i) => (
                    <div key={exp.company || i} style={{ display: 'flex', gap: '14px', paddingBottom: '14px', borderBottom: i < profile.experience.length - 1 ? '1px solid #1a1a18' : 'none', marginBottom: i < profile.experience.length - 1 ? '14px' : 0 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '8px', background: '#1f1f1c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 600, color: '#f59e0b', flexShrink: 0 }}>
                        {(exp.company || '?')[0]}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 500 }}>{exp.title} · {exp.company}</span>
                          <span style={{ fontSize: '11px', color: '#444', fontFamily: "'DM Mono', monospace" }}>{exp.dates}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#444', fontFamily: "'DM Mono', monospace" }}>
                          {exp.location} · {(exp.bullets || []).length} bullets
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Missing */}
              <div style={{ background: '#1a0a0a', border: '1px solid #3a1a1a', borderRadius: '12px', padding: '20px' }}>
                <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '12px' }}>⚠ MISSING</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {['Certifications', 'Projects', 'Awards', 'LinkedIn URL'].map(item => (
                    <button key={item} onClick={() => setTab('submit')} style={{ background: 'transparent', border: '1px dashed #3a1a1a', borderRadius: '6px', padding: '7px 14px', fontSize: '12px', color: '#555', fontFamily: "'DM Sans', sans-serif" }}>
                      + Add {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── JOB ACTIVITY ── */}
          {tab === 'jobs' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>Job Activity</h2>
              <p style={{ fontSize: '13px', color: '#555', marginBottom: '28px' }}>Every job processed and resume sent.</p>

              {jobs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: '#444' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>📭</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '13px' }}>No jobs processed yet</div>
                  <div style={{ fontSize: '12px', color: '#333', marginTop: '6px' }}>Submit a job URL or wait for the auto-run</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {jobs.map(job => (
                    <div key={job.job_id}>
                      <div
                        onClick={() => setActiveJob(activeJob?.job_id === job.job_id ? null : job)}
                        style={{
                          display: 'grid', gridTemplateColumns: '1fr auto auto auto auto',
                          alignItems: 'center', gap: '16px', padding: '14px 16px',
                          background: activeJob?.job_id === job.job_id ? '#141413' : 'transparent',
                          border: `1px solid ${activeJob?.job_id === job.job_id ? '#2a2a27' : 'transparent'}`,
                          borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>{job.title}</div>
                          <div style={{ fontSize: '11px', color: '#555', fontFamily: "'DM Mono', monospace" }}>{job.company}</div>
                        </div>
                        {job.ats_score && <ATSBadge score={job.ats_score} />}
                        {job.improved && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', background: '#f59e0b11', border: '1px solid #f59e0b33', borderRadius: '4px', padding: '2px 8px' }}>2nd run</span>}
                        <span style={{ fontSize: '11px', color: '#333', fontFamily: "'DM Mono', monospace" }}>{new Date(job.created_at).toLocaleDateString()}</span>
                        <button onClick={(e) => handleDownload(e, job.job_id)} disabled={downloading === job.job_id} style={{ background: '#1a1a18', border: '1px solid #2a2a27', color: downloading === job.job_id ? '#f59e0b' : '#888', padding: '5px 12px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'color 0.2s' }}>
                          {downloading === job.job_id ? '...' : '↓ docx'}
                        </button>
                      </div>

                      {activeJob?.job_id === job.job_id && (
                        <div style={{ background: '#0d0d0c', border: '1px solid #1f1f1c', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '16px', animation: 'fadeIn 0.2s ease' }}>
                          {/* ATS Score bar */}
                          {job.ats_score && (
                            <div style={{ marginBottom: '16px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <span style={{ fontSize: '10px', color: '#888', fontFamily: "'DM Mono', monospace" }}>ATS MATCH SCORE</span>
                                <span style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", fontWeight: 600, color: job.ats_score >= 90 ? '#22c55e' : job.ats_score >= 75 ? '#f59e0b' : '#ef4444' }}>{job.ats_score}/100</span>
                              </div>
                              <div style={{ height: '4px', background: '#1f1f1c', borderRadius: '2px' }}>
                                <div style={{ height: '100%', width: `${job.ats_score}%`, background: job.ats_score >= 90 ? '#22c55e' : job.ats_score >= 75 ? '#f59e0b' : '#ef4444', borderRadius: '2px', transition: 'width 1s ease' }} />
                              </div>
                            </div>
                          )}

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                            <div>
                              <div style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace", marginBottom: '8px' }}>✓ MATCHED ({(job.matched_keywords || []).length})</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {(job.matched_keywords || []).map(k => (
                                  <span key={k} style={{ background: '#0d2a1a', border: '1px solid #22c55e22', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', color: '#22c55e88', fontFamily: "'DM Mono', monospace" }}>{k}</span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", marginBottom: '8px' }}>✗ MISSING ({(job.missing_keywords || []).length})</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {(job.missing_keywords || []).map(k => (
                                  <button key={k} onClick={() => handleAddKeyword(k)} style={{ background: addedKeywords.includes(k) ? '#0d2a1a' : '#1a0d0d', border: `1px solid ${addedKeywords.includes(k) ? '#22c55e33' : '#ef444422'}`, borderRadius: '4px', padding: '3px 8px', fontSize: '10px', color: addedKeywords.includes(k) ? '#22c55e88' : '#ef444488', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                                    {addedKeywords.includes(k) ? '✓ ' : '+ '}{k}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Download + meta row */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#141413', border: '1px solid #2a2a27', borderRadius: '8px' }}>
                            <button onClick={(e) => handleDownload(e, job.job_id)} disabled={downloading === job.job_id} style={{ background: '#f59e0b', color: '#0e0e0d', border: 'none', padding: '8px 20px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: downloading === job.job_id ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                              {downloading === job.job_id ? 'Downloading...' : 'Download Resume (.docx)'}
                            </button>
                            <div style={{ flex: 1, display: 'flex', gap: '16px', fontSize: '11px', color: '#555', fontFamily: "'DM Mono', monospace" }}>
                              {job.ats_score && <span>ATS: {job.ats_score}</span>}
                              <span>Matched: {(job.matched_keywords || []).length}</span>
                              <span>Missing: {(job.missing_keywords || []).length}</span>
                              {job.improved && <span style={{ color: '#f59e0b' }}>2nd pass</span>}
                            </div>
                          </div>

                          {job.url && <a href={job.url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: '12px', fontSize: '11px', color: '#333', fontFamily: "'DM Mono', monospace" }}>→ {job.url}</a>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── SUBMIT JOB URL ── */}
          {tab === 'submit' && (
            <div style={{ animation: 'fadeIn 0.3s ease', maxWidth: '600px' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>Submit a Job URL</h2>
              <p style={{ fontSize: '13px', color: '#555', marginBottom: '28px', lineHeight: 1.6 }}>
                Paste any LinkedIn job URL. We'll scrape the full description, tailor your resume, calculate ATS score, and email it to you.
              </p>

              <div style={{ background: '#141413', border: '1px solid #2a2a27', borderRadius: '12px', padding: '24px', marginBottom: '16px' }}>
                <label style={{ fontSize: '11px', color: '#555', fontFamily: "'DM Mono', monospace", display: 'block', marginBottom: '10px' }}>JOB URL</label>
                <input
                  value={jobUrl}
                  onChange={e => setJobUrl(e.target.value)}
                  placeholder="https://www.linkedin.com/jobs/view/4432548390"
                  style={{
                    width: '100%', background: '#0e0e0d', border: '1px solid #2a2a27',
                    borderRadius: '6px', color: '#f0ede8',
                    fontFamily: "'DM Mono', monospace", fontSize: '13px',
                    padding: '12px 16px', outline: 'none', marginBottom: '16px',
                  }}
                />
                <button
                  onClick={handleSubmitUrl}
                  disabled={!jobUrl.trim() || submitting}
                  style={{
                    width: '100%', background: jobUrl.trim() ? '#f59e0b' : '#1f1f1c',
                    color: jobUrl.trim() ? '#0e0e0d' : '#444',
                    border: 'none', padding: '12px', borderRadius: '6px',
                    fontSize: '14px', fontWeight: 600,
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? 'Processing...' : 'Tailor resume for this job →'}
                </button>
                {submitMsg && (
                  <div style={{ marginTop: '12px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color: submitMsg.startsWith('✓') ? '#22c55e' : '#ef4444' }}>
                    {submitMsg}
                  </div>
                )}
              </div>

              <div style={{ background: '#141413', border: '1px solid #1f1f1c', borderRadius: '12px', padding: '20px' }}>
                <div style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '14px' }}>HOW IT WORKS</div>
                {[
                  { n: '01', text: 'Puppeteer opens the LinkedIn job page and scrapes the full JD' },
                  { n: '02', text: 'OpenRouter tailors your resume using only facts from your profile' },
                  { n: '03', text: 'ATS score calculated — if < 95, one improvement run' },
                  { n: '04', text: 'Tailored .docx emailed to you with score + matched/missing keywords' },
                ].map(({ n, text }) => (
                  <div key={n} style={{ display: 'flex', gap: '14px', padding: '10px 0', borderBottom: '1px solid #1a1a18' }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#f59e0b', flexShrink: 0 }}>{n}</span>
                    <span style={{ fontSize: '13px', color: '#888', lineHeight: 1.5 }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SKILL GAPS ── */}
          {tab === 'gaps' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>Skill Gaps</h2>
              <p style={{ fontSize: '13px', color: '#555', marginBottom: '28px' }}>
                Keywords appearing in job descriptions but missing from your profile.
              </p>

              {topMissing.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: '#444' }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '13px' }}>No gap data yet — process some jobs first</div>
                </div>
              ) : (
                <div style={{ background: '#141413', border: '1px solid #1f1f1c', borderRadius: '12px', padding: '24px' }}>
                  <div style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '20px' }}>
                    MOST COMMON GAPS — {jobs.length} JOBS ANALYZED
                  </div>
                  {topMissing.map(([keyword, count]) => (
                    <div key={keyword} style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
                      <div style={{ width: '130px', fontSize: '12px', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{keyword}</div>
                      <div style={{ flex: 1, height: '3px', background: '#1f1f1c', borderRadius: '2px' }}>
                        <div style={{ height: '100%', width: `${(count / jobs.length) * 100}%`, background: count >= 3 ? '#ef4444' : '#f59e0b', borderRadius: '2px', transition: 'width 1s ease' }} />
                      </div>
                      <span style={{ fontSize: '10px', color: '#444', fontFamily: "'DM Mono', monospace", minWidth: 40 }}>{count}/{jobs.length}</span>
                      <button
                        onClick={() => handleAddKeyword(keyword)}
                        style={{
                          background: addedKeywords.includes(keyword) ? '#0d2a1a' : 'transparent',
                          border: `1px solid ${addedKeywords.includes(keyword) ? '#22c55e33' : '#2a2a27'}`,
                          color: addedKeywords.includes(keyword) ? '#22c55e' : '#555',
                          padding: '4px 12px', borderRadius: '4px',
                          fontSize: '11px', fontFamily: "'DM Mono', monospace",
                          transition: 'all 0.2s',
                        }}
                      >
                        {addedKeywords.includes(keyword) ? '✓ added' : '+ add'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
