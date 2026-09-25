import { useEffect, useState } from 'react';
import { api } from '../api';

// Admin "Extension" tab: observability for the browser extension's autofill requests.
// Filters are applied server-side; the summary, breakdowns and daily chart all describe the
// same filtered set as the event list. Clicking a site or user in a breakdown filters to it.

const mono = "'DM Mono', monospace";
const box = { background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '10px', padding: '16px 18px' };
const select = { border: '1px solid #d6d3d1', borderRadius: '6px', padding: '6px 8px', fontSize: '12px', background: '#fff', color: '#1c1917', fontFamily: "'DM Sans', sans-serif", maxWidth: '220px' };
const label = { fontSize: '10px', fontFamily: mono, letterSpacing: '0.08em', color: '#a8a29e', marginBottom: '4px' };

const DEFAULTS = { range: '7d', status: '', user: '', host: '', model: '', q: '', problems: false };
const fmtMs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const pctColor = (v, good = 80, bad = 50) => (v == null ? '#78716c' : v >= good ? '#16a34a' : v >= bad ? '#d97706' : '#dc2626');

function Stat({ title, value, sub, color }) {
  return (
    <div style={box}>
      <div style={label}>{title}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color || '#1c1917', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: '#a8a29e', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows, keyName, onPick, cols }) {
  return (
    <div style={box}>
      <div style={{ ...label, marginBottom: '10px' }}>{title}</div>
      {!rows.length && <div style={{ fontSize: '12px', color: '#a8a29e' }}>No data</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <tbody>
          {rows.map(r => (
            <tr key={r[keyName] || 'unknown'} style={{ borderTop: '1px solid #f5f5f4' }}>
              <td style={{ padding: '6px 0', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {onPick ? (
                  <button onClick={() => onPick(r[keyName])} title="Filter to this" style={{ background: 'none', border: 'none', padding: 0, color: '#b45309', cursor: 'pointer', fontSize: '12px', textAlign: 'left' }}>
                    {r[keyName] || 'unknown'}
                  </button>
                ) : (r[keyName] || 'unknown')}
              </td>
              {cols.map(c => (
                <td key={c.key} style={{ padding: '6px 0 6px 10px', textAlign: 'right', fontFamily: mono, fontVariantNumeric: 'tabular-nums', color: c.color ? c.color(r) : '#57534e', whiteSpace: 'nowrap' }}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyChart({ daily }) {
  if (!daily.length) return null;
  const max = Math.max(...daily.map(d => d.total), 1);
  return (
    <div style={box}>
      <div style={{ ...label, marginBottom: '10px' }}>REQUESTS PER DAY <span style={{ color: '#dc2626' }}>■</span> FAILED</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '90px' }}>
        {daily.map(d => (
          <div key={d.day} title={`${new Date(d.day).toLocaleDateString()}: ${d.total} requests, ${d.failed} failed`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '100%', maxWidth: '28px', height: `${(d.total / max) * 70}px`, background: '#fde68a', borderRadius: '3px 3px 0 0', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
              <div style={{ height: `${d.total ? (d.failed / d.total) * 100 : 0}%`, background: '#dc2626' }} />
            </div>
            <div style={{ fontSize: '9px', color: '#a8a29e', fontFamily: mono }}>{new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ExtensionObservability() {
  const [filters, setFilters] = useState(DEFAULTS);
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (f = filters) => {
    setLoading(true);
    try { setData(await api.adminGetExtensionEvents(f)); setError(''); }
    catch (e) { setError(e.message || 'Could not load extension data'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(filters); }, [filters]);
  // Debounce the free-text search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setFilters(f => (f.q === search ? f : { ...f, q: search })), 400);
    return () => clearTimeout(t);
  }, [search]);

  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const active = Object.entries(filters).filter(([k, v]) => v && v !== DEFAULTS[k]);
  const s = data?.summary;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'grid', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '4px' }}>Extension</h2>
          <p style={{ fontSize: '13px', color: '#78716c' }}>Autofill requests from the browser extension: health, speed and where it struggles</p>
        </div>
        <button onClick={() => load()} style={{ background: 'none', border: '1px solid #d6d3d1', color: '#57534e', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div style={{ ...box, display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
        <div><div style={label}>TIME</div>
          <select aria-label="Time range" value={filters.range} onChange={e => set('range', e.target.value)} style={select}>
            <option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option>
          </select></div>
        <div><div style={label}>STATUS</div>
          <select aria-label="Status" value={filters.status} onChange={e => set('status', e.target.value)} style={select}>
            <option value="">Any</option><option value="success">Success</option><option value="fallback">Success via fallback</option><option value="failed">Failed</option>
          </select></div>
        <div><div style={label}>USER</div>
          <select aria-label="User" value={filters.user} onChange={e => set('user', e.target.value)} style={select}>
            <option value="">All users</option>{(data?.facets?.users || []).map(u => <option key={u} value={u}>{u}</option>)}
          </select></div>
        <div><div style={label}>SITE</div>
          <select aria-label="Site" value={filters.host} onChange={e => set('host', e.target.value)} style={select}>
            <option value="">All sites</option>{(data?.facets?.hosts || []).map(h => <option key={h} value={h}>{h}</option>)}
          </select></div>
        <div><div style={label}>MODEL</div>
          <select aria-label="Model" value={filters.model} onChange={e => set('model', e.target.value)} style={select}>
            <option value="">All models</option>{(data?.facets?.models || []).map(m => <option key={m} value={m}>{m.replace(/:free$/, ' (free)')}</option>)}
          </select></div>
        <div style={{ flex: '1 1 180px' }}><div style={label}>SEARCH ERRORS / URLS</div>
          <input aria-label="Search errors and URLs" value={search} onChange={e => setSearch(e.target.value)} placeholder="e.g. timeout, workday"
            style={{ ...select, width: '100%', maxWidth: 'none', boxSizing: 'border-box' }} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#57534e', paddingBottom: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={filters.problems} onChange={e => set('problems', e.target.checked)} />
          Only problems <span style={{ color: '#a8a29e' }}>(failed, &gt;30 s, or &lt;50% filled)</span>
        </label>
        {active.length > 0 && (
          <button onClick={() => { setSearch(''); setFilters(DEFAULTS); }} style={{ background: 'none', border: 'none', color: '#b45309', fontSize: '12px', cursor: 'pointer', paddingBottom: '6px' }}>Clear filters</button>
        )}
      </div>

      {error && <div style={{ fontSize: '13px', color: '#dc2626' }}>{error}</div>}

      {/* Summary */}
      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
          <Stat title="REQUESTS" value={s.total} sub={`${s.users} user${s.users === 1 ? '' : 's'}`} />
          <Stat title="SUCCESS RATE" value={s.success_rate == null ? '—' : `${s.success_rate}%`} sub={`${s.failed} failed`} color={pctColor(s.success_rate, 95, 80)} />
          <Stat title="FALLBACK USED" value={s.fallback} sub="free model busy, backup answered" color={s.fallback ? '#d97706' : undefined} />
          <Stat title="AVG FIELDS FILLED" value={s.fill_pct == null ? '—' : `${s.fill_pct}%`} sub="mapped ÷ fields found" color={pctColor(s.fill_pct, 70, 40)} />
          <Stat title="SPEED" value={fmtMs(s.p50_ms)} sub={`median · p90 ${fmtMs(s.p90_ms)}`} />
          <Stat title="OVER 30 S" value={s.over_30s} sub="CloudFront cuts these off" color={s.over_30s ? '#dc2626' : '#16a34a'} />
        </div>
      )}

      {/* Breakdowns */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
          <Breakdown title="BY SITE (CLICK TO FILTER)" rows={data.by_host} keyName="host" onPick={h => set('host', h)} cols={[
            { key: 't', render: r => `${r.total} req` },
            { key: 'f', render: r => `${r.failed} failed`, color: r => (r.failed ? '#dc2626' : '#a8a29e') },
            { key: 'fill', render: r => (r.fill_pct == null ? '—' : `${r.fill_pct}% filled`), color: r => pctColor(r.fill_pct, 70, 40) },
          ]} />
          <Breakdown title="BY USER (CLICK TO FILTER)" rows={data.by_user} keyName="user" onPick={u => set('user', u)} cols={[
            { key: 't', render: r => `${r.total} req` },
            { key: 'f', render: r => `${r.failed} failed`, color: r => (r.failed ? '#dc2626' : '#a8a29e') },
            { key: 'l', render: r => new Date(r.last_seen).toLocaleDateString() },
          ]} />
          <Breakdown title="BY MODEL (CLICK TO FILTER)" rows={data.by_model} keyName="model" onPick={m => set('model', m === 'unknown' ? '' : m)} cols={[
            { key: 't', render: r => `${r.total} req` },
            { key: 'f', render: r => `${r.failed} failed`, color: r => (r.failed ? '#dc2626' : '#a8a29e') },
            { key: 'p', render: r => fmtMs(r.p50_ms) },
          ]} />
          <DailyChart daily={data.daily} />
        </div>
      )}

      {/* Events */}
      {data && (
        <div style={{ display: 'grid', gap: '4px' }}>
          <div style={label}>REQUESTS ({data.events.length}{data.events.length >= 200 ? ', newest 200' : ''})</div>
          {!data.events.length && <div style={{ ...box, fontSize: '13px', color: '#78716c' }}>No requests match these filters.</div>}
          {data.events.map(ev => {
            const fill = ev.fields_count ? Math.round((ev.mapped_count / ev.fields_count) * 100) : null;
            const slow = ev.duration_ms > 30000;
            return (
              <div key={ev.id} style={{ background: '#ffffff', border: `1px solid ${ev.status === 'failed' ? '#fecaca' : '#e7e5e4'}`, borderRadius: '8px', padding: '12px 16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', alignItems: 'center', gap: '14px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>
                    <button onClick={() => set('host', ev.host)} title="Filter to this site" style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#1c1917', cursor: 'pointer' }}>{ev.host || 'unknown page'}</button>
                    {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" style={{ marginLeft: '8px', fontSize: '11px', color: '#b45309' }}>open page</a>}
                  </div>
                  <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: mono }}>
                    {ev.user_email || ev.user_id}{ev.model ? ` · ${ev.model.replace(/:free$/, ' (free)')}` : ''}{ev.duration_ms != null ? ` · ${fmtMs(ev.duration_ms)}` : ''}
                  </div>
                  {ev.error && (
                    <div style={{ fontSize: '11px', color: ev.status === 'failed' ? '#dc2626' : '#d97706', marginTop: '4px', wordBreak: 'break-word' }}>
                      ⚠ {ev.status === 'success' ? 'Primary model failed, fallback used: ' : ''}{ev.error}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontFamily: mono, color: pctColor(fill, 70, 40) }}>{ev.mapped_count}/{ev.fields_count}{fill != null ? ` (${fill}%)` : ''}</span>
                  {slow && <span style={{ fontSize: '10px', fontFamily: mono, color: '#dc2626', background: '#fef2f2', borderRadius: '4px', padding: '2px 6px' }}>&gt;30s</span>}
                </div>
                <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: mono }}>{new Date(ev.created_at).toLocaleString()}</span>
                <span style={{
                  fontSize: '10px', fontFamily: mono, borderRadius: '4px', padding: '2px 8px', textAlign: 'center',
                  color: ev.status === 'success' ? (ev.error ? '#d97706' : '#16a34a') : '#dc2626',
                  background: ev.status === 'success' ? (ev.error ? '#fffbeb' : '#ecfdf5') : '#fef2f2',
                }}>{ev.status === 'success' && ev.error ? 'fallback' : ev.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
