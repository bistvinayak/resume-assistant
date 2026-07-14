import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { auth, signOutUser } from '../firebase';

const ADMIN_EMAIL = 'arjun.resumeai@gmail.com';

export default function Admin() {
  const navigate = useNavigate();
  const user = auth.currentUser;
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [tab, setTab] = useState('stats');
  const [loading, setLoading] = useState(true);
  const [cronRunning, setCronRunning] = useState(false);

  useEffect(() => {
    if (user?.email !== ADMIN_EMAIL) {
      navigate('/dashboard', { replace: true });
      return;
    }
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const headers = async () => {
        const token = await user.getIdToken(true);
        return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      };
      const h = await headers();
      const base = api.BASE || (import.meta.env.VITE_API_URL || '/api');

      const [statsRes, usersRes, jobsRes, settingsRes] = await Promise.all([
        fetch(`${base}/admin/stats`, { headers: h }).then(r => r.json()),
        fetch(`${base}/admin/users`, { headers: h }).then(r => r.json()),
        fetch(`${base}/admin/jobs`, { headers: h }).then(r => r.json()),
        fetch(`${base}/admin/settings`, { headers: h }).then(r => r.json()),
      ]);

      setStats(statsRes);
      setUsers(usersRes.users || []);
      setJobs(jobsRes.jobs || []);
      setSettings(settingsRes);
    } catch (e) {
      console.error('Admin load failed:', e);
    }
    setLoading(false);
  }

  async function handleCron() {
    setCronRunning(true);
    try {
      const token = await user.getIdToken(true);
      const base = import.meta.env.VITE_API_URL || '/api';
      await fetch(`${base}/admin/cron/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
    } catch {}
    setCronRunning(false);
  }

  async function toggleUser(userId, active) {
    try {
      const token = await user.getIdToken(true);
      const base = import.meta.env.VITE_API_URL || '/api';
      await fetch(`${base}/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ active }),
      });
      setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, active } : u));
    } catch {}
  }

  const mono = { fontFamily: "'DM Mono', monospace" };
  const label = { fontSize: '10px', color: '#a8a29e', ...mono, letterSpacing: '0.1em', marginBottom: '12px' };
  const card = { background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px' };

  const tabs = [
    { key: 'stats', label: 'Overview' },
    { key: 'users', label: 'Users' },
    { key: 'jobs', label: 'Jobs' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#fafaf9', color: '#1c1917', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 32px', borderBottom: '1px solid #e7e5e4' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '20px' }}>arjun<span style={{ color: '#f59e0b' }}>.</span></span>
          <span style={{ fontSize: '10px', color: '#ef4444', ...mono, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', padding: '2px 8px' }}>ADMIN</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => navigate('/dashboard')} style={{ background: 'none', border: '1px solid #d6d3d1', color: '#57534e', padding: '6px 14px', borderRadius: '6px', fontSize: '12px', ...mono, cursor: 'pointer' }}>
            Dashboard →
          </button>
          <button onClick={async () => { await signOutUser(); navigate('/', { replace: true }); }} style={{ background: 'none', border: 'none', color: '#a8a29e', fontSize: '12px', ...mono, cursor: 'pointer' }}>
            sign out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 24px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '28px' }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              background: tab === t.key ? '#1c1917' : 'transparent',
              color: tab === t.key ? '#fafaf9' : '#78716c',
              border: tab === t.key ? 'none' : '1px solid #d6d3d1',
              padding: '8px 20px', borderRadius: '6px', fontSize: '12px', ...mono, cursor: 'pointer',
            }}>
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={handleCron} disabled={cronRunning} style={{
            background: '#f59e0b', color: '#1c1917', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: cronRunning ? 0.6 : 1,
          }}>
            {cronRunning ? 'Running...' : 'Run Cron'}
          </button>
          <button onClick={loadData} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: '#57534e', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', ...mono, cursor: 'pointer' }}>
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ width: 24, height: 24, border: '2px solid #d6d3d1', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            <div style={{ fontSize: '12px', color: '#78716c', ...mono }}>Loading admin data...</div>
          </div>
        ) : (
          <>
            {/* ── STATS ── */}
            {tab === 'stats' && stats && (
              <div style={{ animation: 'fadeIn 0.3s ease' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                  {[
                    { n: stats.users?.total || 0, l: 'Total Users' },
                    { n: stats.users?.active_week || 0, l: 'Active (7d)' },
                    { n: stats.jobs?.total || 0, l: 'Resumes Built' },
                    { n: stats.jobs?.avg_ats || 0, l: 'Avg ATS Score' },
                  ].map(({ n, l }) => (
                    <div key={l} style={card}>
                      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '28px', marginBottom: '4px' }}>{n}</div>
                      <div style={{ fontSize: '10px', color: '#a8a29e', ...mono }}>{l}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div style={card}>
                    <div style={label}>JOBS TIMELINE</div>
                    {[
                      { l: 'Today', v: stats.jobs?.today || 0 },
                      { l: 'This week', v: stats.jobs?.this_week || 0 },
                      { l: 'This month', v: stats.jobs?.this_month || 0 },
                      { l: 'All time', v: stats.jobs?.total || 0 },
                    ].map(({ l, v }) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #e7e5e4' }}>
                        <span style={{ fontSize: '13px', color: '#57534e' }}>{l}</span>
                        <span style={{ fontSize: '13px', fontWeight: 600, ...mono }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  <div style={card}>
                    <div style={label}>TOP MISSING KEYWORDS</div>
                    {(stats.topMissing || []).map(([kw, count]) => (
                      <div key={kw} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #e7e5e4' }}>
                        <span style={{ fontSize: '12px', color: '#57534e', ...mono }}>{kw}</span>
                        <span style={{ fontSize: '11px', color: '#a8a29e', ...mono }}>{count}×</span>
                      </div>
                    ))}
                    {(!stats.topMissing || stats.topMissing.length === 0) && (
                      <div style={{ fontSize: '12px', color: '#a8a29e', padding: '12px 0' }}>No data yet</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── USERS ── */}
            {tab === 'users' && (
              <div style={{ ...card, animation: 'fadeIn 0.3s ease' }}>
                <div style={label}>ALL USERS ({users.length})</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', ...mono }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e7e5e4' }}>
                        {['Name', 'Email', 'Jobs', 'Avg ATS', 'Gmail', 'Active', 'Joined'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#a8a29e', fontWeight: 500, fontSize: '10px', letterSpacing: '0.05em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.user_id} style={{ borderBottom: '1px solid #e7e5e4' }}>
                          <td style={{ padding: '10px' }}>{u.name}</td>
                          <td style={{ padding: '10px', color: '#57534e' }}>{u.email}</td>
                          <td style={{ padding: '10px' }}>{u.jobs_count}</td>
                          <td style={{ padding: '10px', color: (u.avg_ats || 0) >= 90 ? '#22c55e' : (u.avg_ats || 0) >= 75 ? '#f59e0b' : '#ef4444' }}>{u.avg_ats || '—'}</td>
                          <td style={{ padding: '10px' }}>{u.gmail_connected ? '✓' : '—'}</td>
                          <td style={{ padding: '10px' }}>
                            <button onClick={() => toggleUser(u.user_id, !u.active)} style={{
                              background: u.active ? '#ecfdf5' : '#fef2f2',
                              color: u.active ? '#22c55e' : '#ef4444',
                              border: `1px solid ${u.active ? '#22c55e33' : '#ef444433'}`,
                              borderRadius: '4px', padding: '2px 10px', fontSize: '10px', cursor: 'pointer', ...mono,
                            }}>
                              {u.active ? 'active' : 'disabled'}
                            </button>
                          </td>
                          <td style={{ padding: '10px', color: '#a8a29e' }}>{u.joined ? new Date(u.joined).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── JOBS ── */}
            {tab === 'jobs' && (
              <div style={{ ...card, animation: 'fadeIn 0.3s ease' }}>
                <div style={label}>RECENT JOBS ({jobs.length})</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', ...mono }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e7e5e4' }}>
                        {['Title', 'Company', 'User', 'ATS', 'Date'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#a8a29e', fontWeight: 500, fontSize: '10px', letterSpacing: '0.05em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #e7e5e4' }}>
                          <td style={{ padding: '10px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.title || '—'}</td>
                          <td style={{ padding: '10px', color: '#57534e' }}>{j.company || '—'}</td>
                          <td style={{ padding: '10px', color: '#78716c' }}>{j.user_email || '—'}</td>
                          <td style={{ padding: '10px', color: (j.ats_score || 0) >= 90 ? '#22c55e' : (j.ats_score || 0) >= 75 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>{j.ats_score || '—'}</td>
                          <td style={{ padding: '10px', color: '#a8a29e' }}>{j.seen_at ? new Date(j.seen_at).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
