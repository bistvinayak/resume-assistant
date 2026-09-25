import { useEffect, useState } from 'react';
import { api } from '../api';

// Admin "Self-healing" tab. Agents turn failure signals (thumbs-down chats, extension
// problems) into proposals; an admin reads the diagnosis and evidence, optionally edits the
// rule, and accepts or rejects. Accepted prompt rules are appended to their prompt at runtime
// and can be switched off below. Ingestion schema gaps stay in the Schema Proposals tab.

const mono = "'DM Mono', monospace";
const box = { background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '10px', padding: '16px 18px' };
const label = { fontSize: '10px', fontFamily: mono, letterSpacing: '0.08em', color: '#a8a29e', marginBottom: '6px' };
const BTN = {
  primary: { background: '#1c1917', color: '#fff', border: 'none' },
  accept: { background: '#16a34a', color: '#fff', border: 'none' },
  reject: { background: 'transparent', color: '#57534e', border: '1px solid #d6d3d1' },
};
const btn = (kind) => ({ ...BTN[kind], borderRadius: '6px', padding: '7px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" });

const SOURCE = {
  chat: { text: 'Disliked chat', bg: '#fef3c7', fg: '#92400e' },
  extension: { text: 'Extension', bg: '#e0e7ff', fg: '#3730a3' },
};
const KIND = {
  prompt_rule: 'Adds a rule to the prompt when accepted',
  schema_field: 'Suggests a new profile field (needs a code change after you accept)',
  ops: 'Operational change (acknowledge to track it)',
};
const PROMPT_NAMES = {
  intent_classify: 'chat: intent classifier',
  chat_enrich: 'chat: profile builder',
  map_form_fields: 'extension: form-field mapper',
};

function Evidence({ p }) {
  const e = p.evidence || {};
  if (p.source === 'chat') {
    return (
      <div style={{ display: 'grid', gap: '8px', fontSize: '12.5px' }}>
        <div><div style={label}>USER SAID</div><div style={{ background: '#fafaf9', borderRadius: '6px', padding: '8px 10px', whiteSpace: 'pre-wrap' }}>{e.user_message || '(not recorded)'}</div></div>
        <div><div style={label}>ARJUN REPLIED</div><div style={{ background: '#fafaf9', borderRadius: '6px', padding: '8px 10px', whiteSpace: 'pre-wrap' }}>{e.arjun_reply || '(not recorded)'}</div></div>
        {e.comment && <div><div style={label}>USER'S COMMENT</div><div style={{ background: '#fef2f2', borderRadius: '6px', padding: '8px 10px' }}>{e.comment}</div></div>}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: '8px', fontSize: '12.5px' }}>
      <div style={{ fontFamily: mono, fontSize: '12px', color: '#57534e' }}>
        {e.host} · {e.requests} requests · {e.failed} failed · {e.slow_over_30s} over 30 s · {e.avg_fill_pct ?? '—'}% filled on average
      </div>
      {!!(e.errors || []).length && (
        <div><div style={label}>ERRORS</div>
          {(e.errors || []).map((er, i) => <div key={i} style={{ fontSize: '11.5px', color: '#b91c1c' }}>{typeof er === 'string' ? er : `[${er.source}] ${er.message}`}</div>)}</div>
      )}
      {!!(e.unfilled_fields || []).length && (
        <div><div style={label}>FIELDS LEFT UNFILLED (TIMES SEEN)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {e.unfilled_fields.map(f => <span key={f.label} style={{ background: '#f5f5f4', borderRadius: '999px', padding: '2px 10px', fontSize: '11.5px' }}>{f.label} × {f.count}</span>)}
          </div></div>
      )}
    </div>
  );
}

function ProposalCard({ p, onAccept, onReject }) {
  const [rule, setRule] = useState(p.proposed_rule || '');
  const [open, setOpen] = useState(p.status === 'pending');
  const [busy, setBusy] = useState(false);
  const src = SOURCE[p.source] || { text: p.source, bg: '#f5f5f4', fg: '#57534e' };
  const pending = p.status === 'pending';
  const act = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div style={{ ...box, display: 'grid', gap: '12px', opacity: pending ? 1 : 0.8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ background: src.bg, color: src.fg, borderRadius: '999px', padding: '2px 10px', fontSize: '11px', fontWeight: 600 }}>{src.text}</span>
            {p.target_prompt && <span style={{ fontSize: '11px', fontFamily: mono, color: '#78716c' }}>→ {PROMPT_NAMES[p.target_prompt] || p.target_prompt}</span>}
            <span style={{ fontSize: '11px', color: '#a8a29e' }}>{new Date(p.created_at).toLocaleString()}</span>
          </div>
          <div style={{ fontSize: '15px', fontWeight: 700 }}>{p.title}</div>
        </div>
        {!pending && (
          <span style={{ fontSize: '11px', fontWeight: 600, borderRadius: '999px', padding: '3px 10px', background: p.status === 'accepted' ? '#dcfce7' : '#f5f5f4', color: p.status === 'accepted' ? '#166534' : '#57534e' }}>
            {p.status}{p.reviewed_by ? ` by ${p.reviewed_by}` : ''}
          </span>
        )}
      </div>

      <div><div style={label}>AGENT'S DIAGNOSIS</div><div style={{ fontSize: '13px', lineHeight: 1.55, color: '#292524' }}>{p.diagnosis}</div></div>

      <button onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', padding: 0, color: '#b45309', fontSize: '12px', cursor: 'pointer', justifySelf: 'start' }}>
        {open ? 'Hide evidence' : 'Show evidence'}
      </button>
      {open && <Evidence p={p} />}

      <div>
        <div style={label}>PROPOSED FIX · {KIND[p.kind] || p.kind}</div>
        {pending ? (
          <textarea aria-label="Proposed rule" value={rule} onChange={e => setRule(e.target.value)} rows={3}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d6d3d1', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", resize: 'vertical' }} />
        ) : (
          <div style={{ fontSize: '13px', background: '#fafaf9', borderRadius: '6px', padding: '8px 10px' }}>{p.proposed_rule}</div>
        )}
      </div>

      {pending && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button disabled={busy || !rule.trim()} onClick={() => act(() => onAccept(p.id, rule))} style={{ ...btn('accept'), opacity: busy || !rule.trim() ? 0.5 : 1 }}>
            {p.kind === 'prompt_rule' ? 'Accept and apply' : 'Accept'}
          </button>
          <button disabled={busy} onClick={() => act(() => onReject(p.id))} style={btn('reject')}>Reject</button>
          {p.kind === 'prompt_rule' && <span style={{ fontSize: '11.5px', color: '#78716c' }}>Takes effect within a minute. You can switch it off below.</span>}
        </div>
      )}
    </div>
  );
}

export default function SelfHealing({ schemaPending = 0, onOpenSchema }) {
  const [data, setData] = useState({ proposals: [], rules: [] });
  const [filter, setFilter] = useState('pending');
  const [source, setSource] = useState('');
  const [msg, setMsg] = useState('');
  const [running, setRunning] = useState(false);

  const load = async () => {
    try { setData(await api.adminGetProposals()); } catch (e) { setMsg(e.message); }
  };
  useEffect(() => { load(); }, []);

  const run = async () => {
    setRunning(true); setMsg('Agents are reviewing recent chats and extension requests…');
    try {
      const r = await api.adminRunSelfHealing();
      const n = (r.chat?.proposed || 0) + (r.extension?.proposed || 0);
      setMsg(`Done: reviewed ${r.chat?.analyzed || 0} disliked chat(s) and ${r.extension?.sites || 0} problem site(s), ${n} new proposal${n === 1 ? '' : 's'}.`);
      await load();
    } catch (e) { setMsg(`Run failed: ${e.message}`); }
    finally { setRunning(false); }
  };
  const accept = async (id, rule) => { await api.adminAcceptProposal(id, rule); setMsg('Accepted.'); await load(); };
  const reject = async (id) => { await api.adminRejectProposal(id); await load(); };
  const toggle = async (id, active) => { await api.adminTogglePromptRule(id, active); await load(); };

  const shown = data.proposals.filter(p => (filter === 'all' || p.status === filter) && (!source || p.source === source));
  const pendingCount = data.proposals.filter(p => p.status === 'pending').length;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'grid', gap: '16px', maxWidth: '860px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '4px' }}>Self-healing</h2>
          <p style={{ fontSize: '13px', color: '#78716c', maxWidth: '620px', lineHeight: 1.5 }}>
            Agents read disliked chats and extension problems every hour, work out what went wrong, and propose a fix. Nothing changes until you accept it.
          </p>
        </div>
        <button onClick={run} disabled={running} style={{ ...btn('primary'), opacity: running ? 0.6 : 1 }}>{running ? 'Running…' : 'Run analysis now'}</button>
      </div>
      {msg && <div style={{ fontSize: '12.5px', color: '#57534e' }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        <div style={box}><div style={label}>AWAITING YOUR REVIEW</div><div style={{ fontSize: '22px', fontWeight: 700 }}>{pendingCount}</div></div>
        <div style={box}><div style={label}>ACTIVE LEARNED RULES</div><div style={{ fontSize: '22px', fontWeight: 700 }}>{data.rules.filter(r => r.active).length}</div></div>
        <button onClick={onOpenSchema} style={{ ...box, textAlign: 'left', cursor: 'pointer' }}>
          <div style={label}>UPLOADS THAT DIDN'T FIT THE SCHEMA</div>
          <div style={{ fontSize: '22px', fontWeight: 700 }}>{schemaPending} <span style={{ fontSize: '12px', fontWeight: 400, color: '#b45309' }}>open Schema Proposals →</span></div>
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        {['pending', 'accepted', 'rejected', 'all'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...btn(filter === f ? 'primary' : 'reject'), padding: '5px 12px', textTransform: 'capitalize' }}>{f}</button>
        ))}
        <select aria-label="Source" value={source} onChange={e => setSource(e.target.value)} style={{ border: '1px solid #d6d3d1', borderRadius: '6px', padding: '5px 8px', fontSize: '12px', background: '#fff' }}>
          <option value="">All sources</option><option value="chat">Disliked chats</option><option value="extension">Extension</option>
        </select>
      </div>

      {!shown.length && (
        <div style={{ ...box, fontSize: '13px', color: '#78716c' }}>
          {filter === 'pending' ? 'Nothing waiting for review. Agents run every hour, or press "Run analysis now".' : 'No proposals here.'}
        </div>
      )}
      {shown.map(p => <ProposalCard key={p.id} p={p} onAccept={accept} onReject={reject} />)}

      <div style={box}>
        <div style={label}>LEARNED RULES IN USE</div>
        {!data.rules.length && <div style={{ fontSize: '13px', color: '#a8a29e' }}>None yet. Accepted prompt fixes appear here.</div>}
        <div style={{ display: 'grid', gap: '8px' }}>
          {data.rules.map(r => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '12px', alignItems: 'center', borderTop: '1px solid #f5f5f4', paddingTop: '8px' }}>
              <div>
                <div style={{ fontSize: '11px', fontFamily: mono, color: '#78716c' }}>{PROMPT_NAMES[r.prompt_name] || r.prompt_name} · added {new Date(r.created_at).toLocaleDateString()}{r.created_by ? ` by ${r.created_by}` : ''}</div>
                <div style={{ fontSize: '13px', color: r.active ? '#1c1917' : '#a8a29e', textDecoration: r.active ? 'none' : 'line-through' }}>{r.rule}</div>
              </div>
              <button onClick={() => toggle(r.id, !r.active)} style={{ ...btn(r.active ? 'reject' : 'primary'), padding: '5px 12px' }}>{r.active ? 'Switch off' : 'Switch on'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
