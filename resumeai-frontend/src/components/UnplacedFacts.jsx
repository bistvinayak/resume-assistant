import { useState, useEffect } from 'react';
import { api } from '../api';

// Resume content extraction couldn't fit into the profile schema, grouped by user.
// Review these to decide which new schema fields or sections to add.
export default function UnplacedFacts() {
  const [facts, setFacts] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api.adminGetUnplacedFacts()
      .then(r => setFacts(r.facts || []))
      .catch(e => setError(e.message || 'Could not load'));
  };
  useEffect(load, []);

  const byUser = {};
  for (const f of facts || []) (byUser[f.user_email || f.user_id] ||= []).push(f);

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em' }}>
          NOT PLACED IN PROFILE {facts ? `· ${facts.length}` : ''}
        </div>
        <button onClick={load} style={{ background: 'none', border: '1px solid #d6d3d1', color: '#57534e', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>
      <p style={{ fontSize: '12px', color: '#78716c', marginBottom: '14px' }}>
        Content from uploaded resumes that doesn't fit any profile field yet. Items disappear from this list once an approved schema category absorbs them.
      </p>
      {error && <div style={{ fontSize: '12px', color: '#ef4444' }}>{error}</div>}
      {facts && facts.length === 0 && <div style={{ fontSize: '13px', color: '#78716c' }}>Nothing unplaced. Every uploaded fact fits the current schema.</div>}
      {Object.entries(byUser).map(([who, items]) => (
        <div key={who} style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>
            {who} <span style={{ color: '#a8a29e', fontFamily: "'DM Mono', monospace", fontWeight: 400 }}>· {items.length}</span>
          </div>
          {items.map(f => (
            <div key={f.id} style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#57534e', padding: '6px 0', borderTop: '1px solid #f5f5f4' }}>
              <span style={{ flex: 1 }}>{f.text}</span>
              <span style={{ color: '#a8a29e', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{f.source} · {new Date(f.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
