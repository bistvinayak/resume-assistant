import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, signOutUser } from '../firebase';
import { api } from '../api';

const ADMIN_EMAIL = 'arjun.resumeai@gmail.com';

const Card = ({ children, style }) => (
  <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px', ...style }}>
    {children}
  </div>
);

const Label = ({ children }) => (
  <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '12px' }}>
    {children}
  </div>
);

const StatBox = ({ label, value, sub, color }) => (
  <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '16px' }}>
    <div style={{ fontSize: '28px', fontFamily: "'DM Serif Display', serif", color: color || '#1c1917', marginBottom: '4px' }}>{value}</div>
    <div style={{ fontSize: '12px', color: '#78716c' }}>{label}</div>
    {sub && <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginTop: '4px' }}>{sub}</div>}
  </div>
);

export default function Admin() {
  const navigate = useNavigate();
  const user = auth.currentUser;
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [schemaProposals, setSchemaProposals] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [gmailForwarding, setGmailForwarding] = useState([]);
  const [extension, setExtension] = useState({ events: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [cronMsg, setCronMsg] = useState('');
  const [reviewingId, setReviewingId] = useState(null);
  const [feedbackNote, setFeedbackNote] = useState({});

  useEffect(() => {
    if (user?.email !== ADMIN_EMAIL) {
      navigate('/dashboard', { replace: true });
      return;
    }
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, u, j, cfg, sp, fb, gf, ext] = await Promise.all([
        api.adminGetStats(),
        api.adminGetUsers(),
        api.adminGetJobs(),
        api.adminGetSettings(),
        api.adminGetSchemaProposals(),
        api.adminGetFeedback(),
        api.adminGetGmailForwarding(),
        api.adminGetExtensionEvents(),
      ]);
      setStats(s);
      setUsers(u.users || []);
      setJobs(j.jobs || []);
      setSettings(cfg);
      setSchemaProposals(sp.proposals || []);
      setFeedback(fb.feedback || []);
      setGmailForwarding(gf.requests || []);
      setExtension({ events: ext.events || [], summary: ext.summary || null });
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const refreshSchemaProposals = async () => {
    const sp = await api.adminGetSchemaProposals();
    setSchemaProposals(sp.proposals || []);
  };

  const handleApproveProposal = async (id) => {
    setReviewingId(id);
    try {
      await api.adminApproveSchemaProposal(id);
      await refreshSchemaProposals();
    } finally {
      setReviewingId(null);
    }
  };

  const handleRejectProposal = async (id) => {
    setReviewingId(id);
    try {
      await api.adminRejectSchemaProposal(id);
      await refreshSchemaProposals();
    } finally {
      setReviewingId(null);
    }
  };

  const refreshExtension = async () => {
    const ext = await api.adminGetExtensionEvents();
    setExtension({ events: ext.events || [], summary: ext.summary || null });
  };

  const refreshGmailForwarding = async () => {
    const gf = await api.adminGetGmailForwarding();
    setGmailForwarding(gf.requests || []);
  };

  const handleApproveGmailForwarding = async (userId) => {
    setReviewingId(userId);
    try {
      await api.adminApproveGmailForwarding(userId);
      await refreshGmailForwarding();
    } finally {
      setReviewingId(null);
    }
  };

  const handleRejectGmailForwarding = async (userId) => {
    setReviewingId(userId);
    try {
      await api.adminRejectGmailForwarding(userId);
      await refreshGmailForwarding();
    } finally {
      setReviewingId(null);
    }
  };

  const [retryingId, setRetryingId] = useState(null);
  const refreshJobs = async () => {
    const j = await api.adminGetJobs();
    setJobs(j.jobs || []);
  };
  const handleRetryJob = async (jobId) => {
    setRetryingId(jobId);
    try {
      await api.adminRetryJob(jobId);
      await refreshJobs();
    } catch (e) {
      console.error(e);
    } finally {
      setRetryingId(null);
    }
  };

  const handleReviewFeedback = async (id, status) => {
    setReviewingId(id);
    try {
      await api.adminReviewFeedback(id, status, feedbackNote[id] || '');
      setFeedback(prev => prev.map(f => f.id === id ? { ...f, status, admin_note: feedbackNote[id] || '', reviewed_at: new Date().toISOString() } : f));
    } finally {
      setReviewingId(null);
    }
  };

  const handleToggleUser = async (userId, active) => {
    await api.adminUpdateUser(userId, { active });
    setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, active } : u));
  };

  const handleSetLimit = async (userId, daily_limit) => {
    await api.adminUpdateUser(userId, { daily_limit: parseInt(daily_limit) });
    setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, daily_limit: parseInt(daily_limit) } : u));
  };

  const handleToggleAutoProcess = async (userId, auto_process_paused) => {
    await api.adminUpdateUser(userId, { auto_process_paused });
    setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, auto_process_paused } : u));
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm('Delete this user and all their data?')) return;
    await api.adminDeleteUser(userId);
    setUsers(prev => prev.filter(u => u.user_id !== userId));
  };

  const handleTriggerCron = async () => {
    setCronMsg('Running...');
    await api.adminTriggerCron();
    setCronMsg('✓ Cron triggered — check logs');
    setTimeout(() => setCronMsg(''), 4000);
  };

  const handleSaveSettings = async () => {
    await api.adminUpdateSettings(settings);
    setCronMsg('✓ Settings saved');
    setTimeout(() => setCronMsg(''), 3000);
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fafaf9' }}>
      <div style={{ width: 24, height: 24, border: '2px solid #d6d3d1', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#fafaf9', color: '#1c1917', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 40px', borderBottom: '1px solid #e7e5e4', position: 'sticky', top: 0, background: '#fafaf9', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '18px' }}>arjun<span style={{ color: '#f59e0b' }}>.</span></span>
          <span style={{ fontSize: '11px', color: '#ef4444', fontFamily: "'DM Mono', monospace", background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', padding: '2px 8px' }}>ADMIN</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{user?.email}</span>
          <button onClick={() => navigate('/dashboard')} style={{ background: 'none', border: '1px solid #d6d3d1', color: '#57534e', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
            User view
          </button>
          <button onClick={async () => { await signOutUser(); navigate('/', { replace: true }); }} style={{ background: 'none', border: '1px solid #d6d3d1', color: '#a8a29e', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
            sign out
          </button>
        </div>
      </nav>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', minHeight: 'calc(100vh - 61px)' }}>
        {/* Sidebar */}
        <aside style={{ borderRight: '1px solid #e7e5e4', padding: '24px 16px' }}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'users', label: 'Users' },
            { id: 'jobs', label: 'Jobs' },
            { id: 'schema', label: 'Schema Proposals', badge: schemaProposals.filter(p => p.status === 'pending').length },
            { id: 'feedback', label: 'Feedback', badge: feedback.filter(f => f.status === 'open' && f.score === 0).length },
            { id: 'gmail', label: 'Gmail Forwarding', badge: gmailForwarding.filter(g => g.status === 'pending').length },
            { id: 'extension', label: 'Extension', badge: extension.summary?.failed_24h || 0 },
            { id: 'settings', label: 'Settings' },
          ].map(({ id, label, badge }) => (
            <button key={id} onClick={() => setTab(id)} style={{
              width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: tab === id ? '#ffffff' : 'transparent',
              border: `1px solid ${tab === id ? '#e7e5e4' : 'transparent'}`,
              borderRadius: '6px', padding: '9px 12px', marginBottom: '3px',
              color: tab === id ? '#1c1917' : '#78716c', fontSize: '13px', cursor: 'pointer',
            }}>
              <span>{label}</span>
              {!!badge && (
                <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", background: '#f59e0b', color: '#1c1917', borderRadius: '10px', padding: '1px 7px', fontWeight: 600 }}>{badge}</span>
              )}
            </button>
          ))}

          <div style={{ marginTop: '20px', borderTop: '1px solid #e7e5e4', paddingTop: '16px' }}>
            <button
              onClick={handleTriggerCron}
              style={{ width: '100%', background: '#f59e0b', border: 'none', color: '#1c1917', padding: '10px', borderRadius: '6px', fontSize: '12px', fontFamily: "'DM Mono', monospace", fontWeight: 600, cursor: 'pointer' }}
            >
              Run cron now
            </button>
            {cronMsg && <div style={{ fontSize: '11px', color: '#22c55e', fontFamily: "'DM Mono', monospace", marginTop: '8px' }}>{cronMsg}</div>}
          </div>
        </aside>

        {/* Main */}
        <main style={{ padding: '32px 40px', overflowY: 'auto' }}>

          {/* OVERVIEW */}
          {tab === 'overview' && stats && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '28px' }}>Overview</h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '24px' }}>
                <StatBox label="Total users" value={stats.users.total} sub={`${stats.users.active_week} active this week`} />
                <StatBox label="Resumes sent" value={stats.jobs.total} sub={`${stats.jobs.today} today`} />
                <StatBox label="Avg ATS score" value={`${stats.jobs.avg_ats}/100`} color={stats.jobs.avg_ats >= 85 ? '#22c55e' : '#f59e0b'} sub="across all jobs" />
                <StatBox label="This month" value={stats.jobs.this_month} sub={`${stats.jobs.this_week} this week`} />
                <StatBox
                  label="Failure rate"
                  value={`${stats.failures?.rate_30d ?? 0}%`}
                  color={(stats.failures?.rate_30d ?? 0) === 0 ? '#22c55e' : (stats.failures?.rate_30d ?? 0) <= 10 ? '#f59e0b' : '#ef4444'}
                  sub={`${stats.failures?.failed_30d ?? 0}/${stats.failures?.attempted_30d ?? 0} last 30d`}
                />
              </div>

              {stats.failures?.topReasons?.length > 0 && (
                <Card style={{ marginBottom: '16px' }}>
                  <Label>TOP FAILURE REASONS (LAST 30D)</Label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {stats.failures.topReasons.map(([reason, count]) => (
                      <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '12px', color: '#57534e' }}>{reason}</span>
                        <span style={{ fontSize: '11px', color: '#ef4444', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{count}×</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card>
                <Label>TOP MISSING KEYWORDS (GLOBAL)</Label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {(stats.topMissing || []).map(([kw, count]) => (
                    <div key={kw} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", minWidth: 140 }}>{kw}</span>
                      <div style={{ flex: 1, height: '3px', background: '#e7e5e4', borderRadius: '2px' }}>
                        <div style={{ height: '100%', width: `${(count / (stats.topMissing[0]?.[1] || 1)) * 100}%`, background: '#f59e0b', borderRadius: '2px' }} />
                      </div>
                      <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{count}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* USERS */}
          {tab === 'users' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '4px' }}>Users</h2>
                  <p style={{ fontSize: '13px', color: '#78716c' }}>{users.length} total</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {users.map(u => (
                  <div key={u.user_id} style={{ background: '#ffffff', border: `1px solid ${u.active ? '#e7e5e4' : '#fecaca'}`, borderRadius: '10px', padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 500 }}>{u.name}</span>
                          {u.gmail_connected && <span style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace", background: '#ecfdf5', border: '1px solid #22c55e22', borderRadius: '4px', padding: '1px 6px' }}>gmail ✓</span>}
                          {!u.active && <span style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", background: '#fef2f2', border: '1px solid #ef444422', borderRadius: '4px', padding: '1px 6px' }}>restricted</span>}
                        </div>
                        <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{u.email}</div>
                      </div>

                      <div style={{ display: 'flex', gap: '24px', fontSize: '12px', color: '#57534e' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", color: '#1c1917' }}>{u.jobs_count}</div>
                          <div style={{ fontSize: '10px', color: '#a8a29e' }}>resumes</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", color: u.avg_ats >= 85 ? '#22c55e' : '#f59e0b' }}>{u.avg_ats || '—'}</div>
                          <div style={{ fontSize: '10px', color: '#a8a29e' }}>avg ATS</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>limit/day</span>
                        <input
                          type="number"
                          value={u.daily_limit}
                          onChange={e => handleSetLimit(u.user_id, e.target.value)}
                          min={0} max={100}
                          style={{ width: 50, background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '4px', color: '#1c1917', padding: '4px 8px', fontSize: '12px', fontFamily: "'DM Mono', monospace", textAlign: 'center', outline: 'none' }}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => handleToggleAutoProcess(u.user_id, !u.auto_process_paused)}
                          title="Pause automatic resume generation from this user's forwarded Gmail alerts — manual 'Apply to Job' submissions still work"
                          style={{ background: u.auto_process_paused ? '#fffbeb' : '#ffffff', border: `1px solid ${u.auto_process_paused ? '#f59e0b44' : '#d6d3d1'}`, color: u.auto_process_paused ? '#f59e0b' : '#57534e', padding: '5px 10px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}
                        >
                          {u.auto_process_paused ? 'Auto-process paused' : 'Pause auto-process'}
                        </button>
                        <button
                          onClick={() => handleToggleUser(u.user_id, !u.active)}
                          style={{ background: u.active ? '#fef2f2' : '#ecfdf5', border: `1px solid ${u.active ? '#ef444422' : '#22c55e22'}`, color: u.active ? '#ef4444' : '#22c55e', padding: '5px 10px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}
                        >
                          {u.active ? 'Restrict' : 'Activate'}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u.user_id)}
                          style={{ background: '#fef2f2', border: '1px solid #ef444422', color: '#ef444488', padding: '5px 10px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* JOBS */}
          {tab === 'jobs' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '24px' }}>All Jobs</h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {jobs.map(job => (
                  <div key={job.job_id} style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr auto auto auto auto auto', alignItems: 'center', gap: '16px' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>{job.title || job.job_id} · {job.company || '—'}</div>
                      <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{job.user_email}</div>
                      {job.error_reason && (
                        <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>⚠ {job.error_reason}</div>
                      )}
                    </div>
                    <span style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: job.ats_score == null ? '#a8a29e' : job.ats_score >= 90 ? '#22c55e' : job.ats_score >= 75 ? '#f59e0b' : '#ef4444' }}>
                      {job.ats_score != null ? `${job.ats_score}/100` : '—'}
                    </span>
                    {job.improved && <span style={{ fontSize: '10px', color: '#f59e0b', background: '#f59e0b11', border: '1px solid #f59e0b33', borderRadius: '4px', padding: '2px 8px', fontFamily: "'DM Mono', monospace" }}>2nd run</span>}
                    <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{new Date(job.seen_at).toLocaleDateString()}</span>
                    <span style={{
                      fontSize: '10px', fontFamily: "'DM Mono', monospace", borderRadius: '4px', padding: '2px 8px', textAlign: 'center',
                      color: job.status === 'delivered' ? '#22c55e' : job.status === 'failed' ? '#ef4444' : '#f59e0b',
                      background: job.status === 'delivered' ? '#ecfdf5' : job.status === 'failed' ? '#fef2f2' : '#fffbeb',
                      border: `1px solid ${job.status === 'delivered' ? '#22c55e33' : job.status === 'failed' ? '#ef444422' : '#f59e0b33'}`,
                    }}>{job.status}</span>
                    {job.status !== 'delivered' && (
                      <button
                        onClick={() => handleRetryJob(job.job_id)}
                        disabled={retryingId === job.job_id}
                        title={!job.jd_text || job.jd_text.length < 50 ? 'No job description text saved — retry will fail' : 'Re-run this job through the pipeline'}
                        style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: '#57534e', padding: '5px 10px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', opacity: retryingId === job.job_id ? 0.6 : 1 }}
                      >
                        {retryingId === job.job_id ? 'Retrying...' : 'Retry'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* EXTENSION */}
          {tab === 'extension' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '4px' }}>Extension</h2>
                  <p style={{ fontSize: '13px', color: '#78716c' }}>Latest autofill field-mapping requests from the browser extension</p>
                </div>
                <button onClick={refreshExtension} style={{ background: 'none', border: '1px solid #d6d3d1', color: '#57534e', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                  Refresh
                </button>
              </div>

              {extension.summary && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
                  <StatBox label="Requests (24h)" value={extension.summary.total_24h} />
                  <StatBox label="Failed (24h)" value={extension.summary.failed_24h} color={extension.summary.failed_24h ? '#ef4444' : '#22c55e'} />
                  <StatBox label="Last success" value={extension.summary.last_success_at ? new Date(extension.summary.last_success_at).toLocaleDateString() : '—'} sub={extension.summary.last_success_at ? new Date(extension.summary.last_success_at).toLocaleTimeString() : 'never'} />
                  <StatBox label="Last failure" value={extension.summary.last_failure_at ? new Date(extension.summary.last_failure_at).toLocaleDateString() : '—'} sub={extension.summary.last_failure_at ? new Date(extension.summary.last_failure_at).toLocaleTimeString() : 'none'} color={extension.summary.last_failure_at ? '#ef4444' : undefined} />
                </div>
              )}

              {extension.events.length === 0 && (
                <Card><p style={{ fontSize: '13px', color: '#78716c' }}>No extension requests recorded yet.</p></Card>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {extension.events.map(ev => (
                  <div key={ev.id} style={{ background: '#ffffff', border: `1px solid ${ev.status === 'failed' ? '#fecaca' : '#e7e5e4'}`, borderRadius: '8px', padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: '16px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>{ev.host || 'unknown page'}</div>
                      <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{ev.user_email || ev.user_id}{ev.model ? ` · ${ev.model}` : ''}{ev.duration_ms != null ? ` · ${(ev.duration_ms / 1000).toFixed(1)}s` : ''}</div>
                      {ev.error && (
                        <div style={{ fontSize: '11px', color: ev.status === 'failed' ? '#ef4444' : '#f59e0b', marginTop: '4px', wordBreak: 'break-word' }}>
                          ⚠ {ev.status === 'success' ? 'Primary model failed, fallback used: ' : ''}{ev.error}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: '#57534e' }}>{ev.mapped_count}/{ev.fields_count} fields</span>
                    <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{new Date(ev.created_at).toLocaleString()}</span>
                    <span style={{
                      fontSize: '10px', fontFamily: "'DM Mono', monospace", borderRadius: '4px', padding: '2px 8px', textAlign: 'center',
                      color: ev.status === 'success' ? '#22c55e' : '#ef4444',
                      background: ev.status === 'success' ? '#ecfdf5' : '#fef2f2',
                      border: `1px solid ${ev.status === 'success' ? '#22c55e33' : '#ef444422'}`,
                    }}>{ev.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SCHEMA PROPOSALS */}
          {tab === 'schema' && (
            <div style={{ animation: 'fadeIn 0.3s ease', maxWidth: '760px' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '4px' }}>Schema Proposals</h2>
              <p style={{ fontSize: '13px', color: '#78716c', marginBottom: '24px' }}>
                Arjun flags resume sections it can't fit into the existing profile schema (Publications, Patents, Awards, etc). Approve to make the category permanent — every user's existing uncategorized data is automatically re-scanned and backfilled into it.
              </p>

              {(() => {
                const pending = schemaProposals.filter(p => p.status === 'pending');
                const reviewed = schemaProposals.filter(p => p.status !== 'pending');
                return (
                  <>
                    <div style={{ marginBottom: '28px' }}>
                      <Label>PENDING ({pending.length})</Label>
                      {pending.length === 0 ? (
                        <div style={{ fontSize: '13px', color: '#a8a29e', padding: '16px 0' }}>No pending proposals — Arjun hasn't found anything new yet.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {pending.map(p => (
                            <Card key={p.id}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                <div>
                                  <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '2px' }}>{p.display_name}</div>
                                  <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{p.category} · suggested {p.proposed_count}×</div>
                                </div>
                              </div>
                              {p.description && <div style={{ fontSize: '13px', color: '#57534e', marginBottom: '10px', lineHeight: 1.5 }}>{p.description}</div>}
                              {(p.example_fields || []).length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                                  {p.example_fields.map(f => (
                                    <span key={f} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>{f}</span>
                                  ))}
                                </div>
                              )}
                              {(p.sample_data || []).length > 0 && (
                                <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                                  <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>SAMPLE DATA SEEN</div>
                                  {p.sample_data.slice(0, 3).map((s, i) => (
                                    <div key={i} style={{ fontSize: '12px', color: '#78716c', padding: '2px 0' }}>· {String(s).slice(0, 140)}</div>
                                  ))}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  onClick={() => handleApproveProposal(p.id)}
                                  disabled={reviewingId === p.id}
                                  style={{ flex: 1, background: '#22c55e', color: '#1c1917', border: 'none', padding: '9px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: reviewingId === p.id ? 0.6 : 1 }}
                                >
                                  {reviewingId === p.id ? 'Working...' : 'Approve + Backfill'}
                                </button>
                                <button
                                  onClick={() => handleRejectProposal(p.id)}
                                  disabled={reviewingId === p.id}
                                  style={{ flex: 1, background: 'transparent', color: '#57534e', border: '1px solid #d6d3d1', padding: '9px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', opacity: reviewingId === p.id ? 0.6 : 1 }}
                                >
                                  Reject
                                </button>
                              </div>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>

                    {reviewed.length > 0 && (
                      <div>
                        <Label>REVIEWED</Label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {reviewed.map(p => (
                            <div key={p.id} style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontSize: '13px', fontWeight: 500 }}>{p.display_name}</span>
                                <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginLeft: '10px' }}>{p.category}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {p.status === 'approved' && p.backfill_status && (
                                  <span style={{ fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>{p.backfill_status}</span>
                                )}
                                <span style={{
                                  fontSize: '10px', fontFamily: "'DM Mono', monospace", borderRadius: '4px', padding: '2px 8px',
                                  color: p.status === 'approved' ? '#22c55e' : '#ef4444',
                                  background: p.status === 'approved' ? '#ecfdf5' : '#fef2f2',
                                  border: `1px solid ${p.status === 'approved' ? '#22c55e33' : '#ef444422'}`,
                                }}>{p.status}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* GMAIL FORWARDING */}
          {tab === 'gmail' && (
            <div style={{ animation: 'fadeIn 0.3s ease', maxWidth: '760px' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '4px' }}>Gmail Forwarding</h2>
              <p style={{ fontSize: '13px', color: '#78716c', marginBottom: '24px' }}>
                Users who've asked to have their forwarded LinkedIn job-alert emails processed. Matching is by their Arjun login email — approve to start attributing their forwarded mail to their account.
              </p>

              {(() => {
                const pending = gmailForwarding.filter(g => g.status === 'pending');
                const reviewed = gmailForwarding.filter(g => g.status !== 'pending');
                return (
                  <>
                    <div style={{ marginBottom: '28px' }}>
                      <Label>PENDING ({pending.length})</Label>
                      {pending.length === 0 ? (
                        <div style={{ fontSize: '13px', color: '#a8a29e', padding: '16px 0' }}>No pending requests.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {pending.map(g => (
                            <Card key={g.user_id}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <div>
                                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{g.email}</div>
                                  <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginTop: '2px' }}>
                                    requested {new Date(g.requested_at).toLocaleDateString()}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  onClick={() => handleApproveGmailForwarding(g.user_id)}
                                  disabled={reviewingId === g.user_id}
                                  style={{ flex: 1, background: '#22c55e', color: '#1c1917', border: 'none', padding: '9px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: reviewingId === g.user_id ? 0.6 : 1 }}
                                >
                                  {reviewingId === g.user_id ? 'Working...' : 'Approve'}
                                </button>
                                <button
                                  onClick={() => handleRejectGmailForwarding(g.user_id)}
                                  disabled={reviewingId === g.user_id}
                                  style={{ flex: 1, background: 'transparent', color: '#57534e', border: '1px solid #d6d3d1', padding: '9px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', opacity: reviewingId === g.user_id ? 0.6 : 1 }}
                                >
                                  Reject
                                </button>
                              </div>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>

                    {reviewed.length > 0 && (
                      <div>
                        <Label>REVIEWED</Label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {reviewed.map(g => (
                            <div key={g.user_id} style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '13px', fontWeight: 500 }}>{g.email}</span>
                              <span style={{
                                fontSize: '10px', fontFamily: "'DM Mono', monospace", borderRadius: '4px', padding: '2px 8px',
                                color: g.status === 'approved' ? '#22c55e' : '#ef4444',
                                background: g.status === 'approved' ? '#ecfdf5' : '#fef2f2',
                                border: `1px solid ${g.status === 'approved' ? '#22c55e33' : '#ef444422'}`,
                              }}>{g.status}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* FEEDBACK */}
          {tab === 'feedback' && (
            <div style={{ animation: 'fadeIn 0.3s ease', maxWidth: '820px' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '4px' }}>Chat Feedback</h2>
              <p style={{ fontSize: '13px', color: '#78716c', marginBottom: '24px' }}>
                Thumbs-down feedback from users. Review the conversation, note what went wrong, and mark as actioned.
              </p>

              {(() => {
                const open = feedback.filter(f => f.status === 'open');
                const reviewed = feedback.filter(f => f.status !== 'open');
                return (
                  <>
                    <div style={{ marginBottom: '28px' }}>
                      <Label>OPEN ({open.length})</Label>
                      {open.length === 0 ? (
                        <div style={{ fontSize: '13px', color: '#a8a29e', padding: '16px 0' }}>No open feedback.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {open.map(f => (
                            <Card key={f.id}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                <div>
                                  <span style={{ fontSize: '13px', fontWeight: 500 }}>{f.user_email || f.user_id}</span>
                                  <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginLeft: '10px' }}>
                                    {f.chat_mode || 'chat'} · {new Date(f.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                                <span style={{ fontSize: '16px' }}>{f.score === 0 ? '👎' : '👍'}</span>
                              </div>

                              {f.comment && (
                                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
                                  <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", marginBottom: '4px' }}>USER COMPLAINT</div>
                                  <div style={{ fontSize: '12px', color: '#1c1917', lineHeight: 1.5 }}>{f.comment}</div>
                                </div>
                              )}

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '10px 12px' }}>
                                  <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginBottom: '4px' }}>USER SAID</div>
                                  <div style={{ fontSize: '12px', color: '#57534e', lineHeight: 1.5, maxHeight: '120px', overflowY: 'auto' }}>{f.user_message || '—'}</div>
                                </div>
                                <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '10px 12px' }}>
                                  <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", marginBottom: '4px' }}>ARJUN REPLIED</div>
                                  <div style={{ fontSize: '12px', color: '#57534e', lineHeight: 1.5, maxHeight: '120px', overflowY: 'auto' }}>{f.arjun_reply || '—'}</div>
                                </div>
                              </div>

                              <div style={{ marginBottom: '10px' }}>
                                <textarea
                                  value={feedbackNote[f.id] || ''}
                                  onChange={e => setFeedbackNote(prev => ({ ...prev, [f.id]: e.target.value }))}
                                  placeholder="What should have happened? What prompt change would fix this?"
                                  style={{ width: '100%', minHeight: '48px', background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '6px', padding: '8px 10px', fontSize: '12px', fontFamily: "'DM Sans', sans-serif", color: '#1c1917', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                                />
                              </div>

                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  onClick={() => handleReviewFeedback(f.id, 'actioned')}
                                  disabled={reviewingId === f.id}
                                  style={{ flex: 1, background: '#22c55e', color: '#1c1917', border: 'none', padding: '9px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: reviewingId === f.id ? 0.6 : 1 }}
                                >
                                  {reviewingId === f.id ? 'Saving...' : 'Mark Actioned'}
                                </button>
                                <button
                                  onClick={() => handleReviewFeedback(f.id, 'wont_fix')}
                                  disabled={reviewingId === f.id}
                                  style={{ flex: 1, background: 'transparent', color: '#57534e', border: '1px solid #d6d3d1', padding: '9px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', opacity: reviewingId === f.id ? 0.6 : 1 }}
                                >
                                  Won't Fix
                                </button>
                                <button
                                  onClick={() => handleReviewFeedback(f.id, 'dismissed')}
                                  disabled={reviewingId === f.id}
                                  style={{ background: 'transparent', color: '#a8a29e', border: '1px solid #e7e5e4', padding: '9px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', opacity: reviewingId === f.id ? 0.6 : 1 }}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>

                    {reviewed.length > 0 && (
                      <div>
                        <Label>REVIEWED ({reviewed.length})</Label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {reviewed.map(f => (
                            <div key={f.id} style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '12px 16px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontSize: '13px', fontWeight: 500 }}>{f.user_email || f.user_id}</span>
                                  <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginLeft: '10px' }}>
                                    {f.chat_mode || 'chat'}
                                  </span>
                                  {f.comment && (
                                    <div style={{ fontSize: '11px', color: '#78716c', marginTop: '2px' }}>{f.comment.slice(0, 100)}{f.comment.length > 100 ? '...' : ''}</div>
                                  )}
                                  {f.admin_note && (
                                    <div style={{ fontSize: '11px', color: '#57534e', marginTop: '4px', fontStyle: 'italic' }}>Note: {f.admin_note.slice(0, 100)}</div>
                                  )}
                                </div>
                                <span style={{
                                  fontSize: '10px', fontFamily: "'DM Mono', monospace", borderRadius: '4px', padding: '2px 8px',
                                  color: f.status === 'actioned' ? '#22c55e' : f.status === 'wont_fix' ? '#f59e0b' : '#a8a29e',
                                  background: f.status === 'actioned' ? '#ecfdf5' : f.status === 'wont_fix' ? '#fef3c7' : '#fafaf9',
                                  border: `1px solid ${f.status === 'actioned' ? '#22c55e33' : f.status === 'wont_fix' ? '#f59e0b33' : '#e7e5e4'}`,
                                }}>{f.status.replace('_', ' ')}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* SETTINGS */}
          {tab === 'settings' && settings && (
            <div style={{ animation: 'fadeIn 0.3s ease', maxWidth: '500px' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '24px' }}>Settings</h2>

              <Card style={{ marginBottom: '16px' }}>
                <Label>GLOBAL CONTROLS</Label>

                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '13px', color: '#78716c', marginBottom: '8px' }}>Global daily email limit (per user default)</div>
                  <input
                    type="number"
                    value={settings.global_daily_limit}
                    onChange={e => setSettings(s => ({ ...s, global_daily_limit: parseInt(e.target.value) }))}
                    style={{ background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', padding: '10px 14px', fontSize: '14px', fontFamily: "'DM Mono', monospace", width: '120px', outline: 'none' }}
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '13px', color: '#78716c', marginBottom: '8px' }}>Max users allowed</div>
                  <input
                    type="number"
                    value={settings.max_users}
                    onChange={e => setSettings(s => ({ ...s, max_users: parseInt(e.target.value) }))}
                    style={{ background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', padding: '10px 14px', fontSize: '14px', fontFamily: "'DM Mono', monospace", width: '120px', outline: 'none' }}
                  />
                </div>

                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '13px', color: '#78716c', marginBottom: '10px' }}>Cron status</div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => setSettings(s => ({ ...s, cron_paused: false }))}
                      style={{ background: !settings.cron_paused ? '#ecfdf5' : 'transparent', border: `1px solid ${!settings.cron_paused ? '#22c55e33' : '#d6d3d1'}`, color: !settings.cron_paused ? '#22c55e' : '#78716c', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                    >
                      Running
                    </button>
                    <button
                      onClick={() => setSettings(s => ({ ...s, cron_paused: true }))}
                      style={{ background: settings.cron_paused ? '#fef2f2' : 'transparent', border: `1px solid ${settings.cron_paused ? '#ef444422' : '#d6d3d1'}`, color: settings.cron_paused ? '#ef4444' : '#78716c', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                    >
                      Paused
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleSaveSettings}
                  style={{ background: '#f59e0b', color: '#1c1917', border: 'none', padding: '12px 24px', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Save settings
                </button>
                {cronMsg && <span style={{ marginLeft: '12px', fontSize: '12px', color: '#22c55e', fontFamily: "'DM Mono', monospace" }}>{cronMsg}</span>}
              </Card>

              <Card>
                <Label>GMAIL HEALTH</Label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {[
                    { label: 'IMAP inbox', value: 'arjun.resumeai@gmail.com', status: 'ok' },
                    { label: 'Cron schedule', value: 'Every 2 hours', status: 'ok' },
                    { label: 'Admin email', value: ADMIN_EMAIL, status: 'ok' },
                  ].map(({ label, value, status }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #e7e5e4' }}>
                      <span style={{ fontSize: '12px', color: '#57534e' }}>{label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>{value}</span>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: status === 'ok' ? '#22c55e' : '#ef4444', display: 'inline-block' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
