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
  const [loading, setLoading] = useState(true);
  const [cronMsg, setCronMsg] = useState('');

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
      const [s, u, j, cfg] = await Promise.all([
        api.adminGetStats(),
        api.adminGetUsers(),
        api.adminGetJobs(),
        api.adminGetSettings(),
      ]);
      setStats(s);
      setUsers(u.users || []);
      setJobs(j.jobs || []);
      setSettings(cfg);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleToggleUser = async (userId, active) => {
    await api.adminUpdateUser(userId, { active });
    setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, active } : u));
  };

  const handleSetLimit = async (userId, daily_limit) => {
    await api.adminUpdateUser(userId, { daily_limit: parseInt(daily_limit) });
    setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, daily_limit: parseInt(daily_limit) } : u));
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
            { id: 'settings', label: 'Settings' },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)} style={{
              width: '100%', textAlign: 'left',
              background: tab === id ? '#ffffff' : 'transparent',
              border: `1px solid ${tab === id ? '#e7e5e4' : 'transparent'}`,
              borderRadius: '6px', padding: '9px 12px', marginBottom: '3px',
              color: tab === id ? '#1c1917' : '#78716c', fontSize: '13px', cursor: 'pointer',
            }}>{label}</button>
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

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
                <StatBox label="Total users" value={stats.users.total} sub={`${stats.users.active_week} active this week`} />
                <StatBox label="Resumes sent" value={stats.jobs.total} sub={`${stats.jobs.today} today`} />
                <StatBox label="Avg ATS score" value={`${stats.jobs.avg_ats}/100`} color={stats.jobs.avg_ats >= 85 ? '#22c55e' : '#f59e0b'} sub="across all jobs" />
                <StatBox label="This month" value={stats.jobs.this_month} sub={`${stats.jobs.this_week} this week`} />
              </div>

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
                  <div key={job.job_id} style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', alignItems: 'center', gap: '16px' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>{job.title} · {job.company}</div>
                      <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{job.user_email}</div>
                    </div>
                    <span style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: job.ats_score >= 90 ? '#22c55e' : job.ats_score >= 75 ? '#f59e0b' : '#ef4444' }}>
                      {job.ats_score}/100
                    </span>
                    {job.improved && <span style={{ fontSize: '10px', color: '#f59e0b', background: '#f59e0b11', border: '1px solid #f59e0b33', borderRadius: '4px', padding: '2px 8px', fontFamily: "'DM Mono', monospace" }}>2nd run</span>}
                    <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{new Date(job.seen_at).toLocaleDateString()}</span>
                    <span style={{ fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>{job.status}</span>
                  </div>
                ))}
              </div>
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
