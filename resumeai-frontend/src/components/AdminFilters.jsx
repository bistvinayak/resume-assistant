// Shared filter bar + filter logic for the Admin tabs (Users, Jobs, Feedback, Schema
// Proposals, Gmail Forwarding). Lists are small and already loaded, so filtering is
// client-side and instant. The Extension tab has its own server-side filters.

const mono = "'DM Mono', monospace";
const control = { border: '1px solid #d6d3d1', borderRadius: '6px', padding: '6px 8px', fontSize: '12px', background: '#fff', color: '#1c1917', fontFamily: "'DM Sans', sans-serif", maxWidth: '220px' };
const labelStyle = { fontSize: '10px', fontFamily: mono, letterSpacing: '0.08em', color: '#a8a29e', marginBottom: '4px' };

// fields: [{ key, label, type: 'search' | 'select', options: [{ value, label }], placeholder }]
export function FilterBar({ fields, value, onChange, defaults, shown, total, noun = 'items' }) {
  const active = Object.keys(defaults).some(k => value[k] !== defaults[k]);
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: '16px' }}>
      {fields.map(f => (
        <div key={f.key} style={f.type === 'search' ? { flex: '1 1 200px' } : undefined}>
          <div style={labelStyle}>{f.label.toUpperCase()}</div>
          {f.type === 'search' ? (
            <input aria-label={f.label} value={value[f.key]} placeholder={f.placeholder || 'Search…'} onChange={e => onChange({ ...value, [f.key]: e.target.value })}
              style={{ ...control, width: '100%', maxWidth: 'none', boxSizing: 'border-box' }} />
          ) : (
            <select aria-label={f.label} value={value[f.key]} onChange={e => onChange({ ...value, [f.key]: e.target.value })} style={control}>
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingBottom: '6px', fontSize: '12px', color: '#78716c' }}>
        <span style={{ fontFamily: mono }}>{shown} of {total} {noun}</span>
        {active && <button onClick={() => onChange(defaults)} style={{ background: 'none', border: 'none', color: '#b45309', fontSize: '12px', cursor: 'pointer', padding: 0 }}>Clear</button>}
      </div>
    </div>
  );
}

const DAY = 24 * 60 * 60 * 1000;
const within = (date, range) => {
  if (!range || range === 'all') return true;
  if (!date) return false;
  const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }[range];
  return Date.now() - new Date(date).getTime() <= days * DAY;
};
const has = (hay, needle) => !needle || String(hay || '').toLowerCase().includes(needle.trim().toLowerCase());
const opts = (values, allLabel) => [{ value: '', label: allLabel }, ...[...new Set(values.filter(Boolean))].sort().map(v => ({ value: v, label: v }))];
const RANGE = [{ value: 'all', label: 'Any time' }, { value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' }];

// ── Users ────────────────────────────────────────────────────────────────
export const USER_DEFAULTS = { q: '', profile: '', gmail: '', access: '', auto: '', seen: 'all', sort: 'recent' };
export const userFields = () => [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Name or email' },
  { key: 'profile', label: 'Profile', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'yes', label: 'Has a profile' }, { value: 'no', label: 'No profile yet' }] },
  { key: 'gmail', label: 'Gmail', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'yes', label: 'Connected' }, { value: 'no', label: 'Not connected' }] },
  { key: 'access', label: 'Access', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'active', label: 'Active' }, { value: 'restricted', label: 'Restricted' }] },
  { key: 'auto', label: 'Auto-process', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'on', label: 'Running' }, { value: 'paused', label: 'Paused' }] },
  { key: 'seen', label: 'Last sign-in', type: 'select', options: [...RANGE.map(r => (r.value === 'all' ? { ...r, label: 'Any time' } : r))] },
  { key: 'sort', label: 'Sort', type: 'select', options: [{ value: 'recent', label: 'Last sign-in' }, { value: 'joined', label: 'Newest sign-up' }, { value: 'resumes', label: 'Most resumes' }, { value: 'name', label: 'Name A–Z' }] },
];
export function filterUsers(users, f) {
  const out = users.filter(u =>
    (has(u.name, f.q) || has(u.email, f.q) || has(u.profile_email, f.q)) &&
    (!f.profile || (f.profile === 'yes') === (u.has_profile !== false)) &&
    (!f.gmail || (f.gmail === 'yes') === !!u.gmail_connected) &&
    (!f.access || (f.access === 'active') === !!u.active) &&
    (!f.auto || (f.auto === 'paused') === !!u.auto_process_paused) &&
    within(u.last_sign_in || u.last_updated, f.seen));
  const by = {
    recent: (a, b) => new Date(b.last_sign_in || b.joined || 0) - new Date(a.last_sign_in || a.joined || 0),
    joined: (a, b) => new Date(b.joined || 0) - new Date(a.joined || 0),
    resumes: (a, b) => (b.jobs_count || 0) - (a.jobs_count || 0),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
  }[f.sort];
  return by ? [...out].sort(by) : out;
}

// ── Jobs ─────────────────────────────────────────────────────────────────
export const JOB_DEFAULTS = { q: '', user: '', status: '', ats: '', range: 'all', improved: '', sort: 'newest' };
export const jobFields = (jobs) => [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Title, company or user' },
  { key: 'user', label: 'User', type: 'select', options: opts(jobs.map(j => j.user_email), 'All users') },
  { key: 'status', label: 'Status', type: 'select', options: opts(jobs.map(j => j.status), 'Any status') },
  { key: 'ats', label: 'ATS score', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'high', label: '90 and above' }, { value: 'mid', label: '70–89' }, { value: 'low', label: 'Below 70' }, { value: 'none', label: 'No score' }] },
  { key: 'range', label: 'Date', type: 'select', options: RANGE },
  { key: 'improved', label: 'Improvement pass', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'yes', label: 'Improved' }, { value: 'no', label: 'Not improved' }] },
  { key: 'sort', label: 'Sort', type: 'select', options: [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'ats_desc', label: 'ATS high → low' }, { value: 'ats_asc', label: 'ATS low → high' }] },
];
export function filterJobs(jobs, f) {
  const score = (j) => (j.ats_score == null ? null : Number(j.ats_score));
  const out = jobs.filter(j =>
    (has(j.title, f.q) || has(j.company, f.q) || has(j.user_email, f.q)) &&
    (!f.user || j.user_email === f.user) &&
    (!f.status || j.status === f.status) &&
    (!f.ats || (f.ats === 'none' ? !score(j) : f.ats === 'high' ? score(j) >= 90 : f.ats === 'mid' ? score(j) >= 70 && score(j) < 90 : score(j) > 0 && score(j) < 70)) &&
    (!f.improved || (f.improved === 'yes') === !!j.improved) &&
    within(j.seen_at, f.range));
  const by = {
    newest: (a, b) => new Date(b.seen_at || 0) - new Date(a.seen_at || 0),
    oldest: (a, b) => new Date(a.seen_at || 0) - new Date(b.seen_at || 0),
    ats_desc: (a, b) => (score(b) ?? -1) - (score(a) ?? -1),
    ats_asc: (a, b) => (score(a) ?? 999) - (score(b) ?? 999),
  }[f.sort];
  return by ? [...out].sort(by) : out;
}

// ── Chat feedback ────────────────────────────────────────────────────────
export const FEEDBACK_DEFAULTS = { q: '', rating: '', status: '', mode: '', range: 'all' };
export const feedbackFields = (feedback) => [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Message, reply, comment or user' },
  { key: 'rating', label: 'Rating', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'down', label: '👎 Thumbs down' }, { value: 'up', label: '👍 Thumbs up' }] },
  { key: 'status', label: 'Status', type: 'select', options: opts(feedback.map(f => f.status), 'Any status') },
  { key: 'mode', label: 'Chat mode', type: 'select', options: opts(feedback.map(f => f.chat_mode), 'Any mode') },
  { key: 'range', label: 'Date', type: 'select', options: RANGE },
];
export function filterFeedback(feedback, f) {
  return feedback.filter(x =>
    (has(x.user_message, f.q) || has(x.arjun_reply, f.q) || has(x.comment, f.q) || has(x.user_email, f.q)) &&
    (!f.rating || (f.rating === 'down' ? x.score === 0 : x.score !== 0)) &&
    (!f.status || x.status === f.status) &&
    (!f.mode || x.chat_mode === f.mode) &&
    within(x.created_at, f.range));
}

// ── Schema proposals ─────────────────────────────────────────────────────
export const SCHEMA_DEFAULTS = { q: '', status: '' };
export const schemaFields = (proposals) => [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Category, description or example' },
  { key: 'status', label: 'Status', type: 'select', options: opts(proposals.map(p => p.status), 'Any status') },
];
export function filterSchema(proposals, f) {
  return proposals.filter(p =>
    (has(p.display_name, f.q) || has(p.category, f.q) || has(p.description, f.q) || has(JSON.stringify(p.example_fields || []), f.q)) &&
    (!f.status || p.status === f.status));
}

// ── Gmail forwarding ─────────────────────────────────────────────────────
export const GMAIL_DEFAULTS = { q: '', status: '', range: 'all' };
export const gmailFields = (rows) => [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Email' },
  { key: 'status', label: 'Status', type: 'select', options: opts(rows.map(g => g.status), 'Any status') },
  { key: 'range', label: 'Requested', type: 'select', options: RANGE },
];
export function filterGmail(rows, f) {
  return rows.filter(g => has(g.email, f.q) && (!f.status || g.status === f.status) && within(g.requested_at, f.range));
}
