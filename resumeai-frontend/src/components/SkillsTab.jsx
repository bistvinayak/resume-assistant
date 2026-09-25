import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

// "My Skills" tab: per-user playbooks Arjun generates from the profile (career profile,
// cover-letter story, writing voice). Users read them, add corrections that take priority,
// regenerate, and download them as Claude skills.

const mono = "'DM Mono', monospace";
const card = { background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '22px 24px' };
const btn = (primary) => ({
  background: primary ? '#f59e0b' : 'transparent',
  color: primary ? '#ffffff' : '#57534e',
  border: primary ? 'none' : '1px solid #d6d3d1',
  borderRadius: '6px', padding: '8px 14px', fontSize: '12px', fontWeight: 600,
  fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
});

const SKILL_BLURBS = {
  career_profile: 'Your verified bullets, metrics and keyword evidence. Arjun uses it to pick and phrase content for every tailored resume.',
  cover_letter: 'Your story material and strongest achievement stories. Arjun uses it to give cover letters a real, personal voice.',
  writing_voice: 'How you write. Arjun uses it so resumes and letters sound like you, not like AI.',
};

// Minimal markdown for the skill text: headings, bullets, tables, **bold**.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

function Markdown({ text }) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
      i--;
      const cells = rows.filter(r => !/^\|[\s:|-]+\|$/.test(r.trim())).map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      out.push(
        <div key={i} style={{ overflowX: 'auto', margin: '8px 0 14px' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%' }}>
            <tbody>
              {cells.map((row, r) => (
                <tr key={r}>
                  {row.map((c, cI) => {
                    const Cell = r === 0 ? 'th' : 'td';
                    return <Cell key={cI} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #f0eeeb', verticalAlign: 'top', fontWeight: r === 0 ? 600 : 400, color: r === 0 ? '#78716c' : '#1c1917' }}>{inline(c)}</Cell>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (line.startsWith('# ')) {
      out.push(<h3 key={i} style={{ fontFamily: "'DM Serif Display', serif", fontSize: '20px', fontWeight: 400, margin: '4px 0 10px' }}>{line.slice(2)}</h3>);
    } else if (line.startsWith('## ')) {
      out.push(<h4 key={i} style={{ fontSize: '13px', fontWeight: 700, margin: '18px 0 6px' }}>{line.slice(3)}</h4>);
    } else if (/^\s*[-*] /.test(line)) {
      out.push(<div key={i} style={{ display: 'flex', gap: '8px', fontSize: '13px', lineHeight: 1.55, margin: '2px 0' }}><span style={{ color: '#f59e0b' }}>•</span><span>{inline(line.replace(/^\s*[-*] /, ''))}</span></div>);
    } else if (line.trim()) {
      out.push(<p key={i} style={{ fontSize: '13px', lineHeight: 1.6, margin: '4px 0', color: '#292524' }}>{inline(line)}</p>);
    }
  }
  return <div>{out}</div>;
}

function statusChip(s) {
  const map = {
    ready: s.stale ? ['Updating soon', '#fef3c7', '#92400e'] : ['Up to date', '#dcfce7', '#166534'],
    generating: ['Generating…', '#fef3c7', '#92400e'],
    failed: ['Last update failed', '#fee2e2', '#991b1b'],
    pending: ['Not generated yet', '#f5f5f4', '#57534e'],
  };
  const [label, bg, fg] = map[s.status] || map.pending;
  return <span style={{ background: bg, color: fg, padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600 }}>{label}</span>;
}

function SkillCard({ skill, onSaveNotes }) {
  const [open, setOpen] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [notes, setNotes] = useState(skill.user_notes || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setNotes(skill.user_notes || ''); }, [skill.user_notes]);

  const save = async () => {
    setSaving(true);
    try { await onSaveNotes(skill.id, notes); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ ...card, display: 'grid', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700 }}>{skill.title}</div>
          <div style={{ fontSize: '12.5px', color: '#78716c', marginTop: '3px', maxWidth: '520px' }}>{SKILL_BLURBS[skill.id]}</div>
        </div>
        {statusChip(skill)}
      </div>

      {skill.error && (
        <div style={{ fontSize: '12px', color: '#991b1b', background: '#fef2f2', borderRadius: '6px', padding: '8px 10px' }}>
          The free AI model couldn't finish this update. Your previous version is still in use. Try “Regenerate” in a few minutes.
        </div>
      )}

      {skill.content ? (
        <>
          <button onClick={() => setOpen(!open)} style={{ ...btn(false), justifySelf: 'start' }}>{open ? 'Hide skill' : 'Read skill'}</button>
          {open && (
            <div style={{ borderTop: '1px solid #f0eeeb', paddingTop: '10px', maxHeight: '520px', overflowY: 'auto' }}>
              <Markdown text={skill.content} />
              <button onClick={() => setShowRules(!showRules)} style={{ background: 'none', border: 'none', color: '#b45309', fontSize: '12px', cursor: 'pointer', padding: '10px 0 0' }}>
                {showRules ? 'Hide' : 'Show'} the rules Arjun applies to everyone
              </button>
              {showRules && <div style={{ marginTop: '6px', opacity: 0.85 }}><Markdown text={skill.shared_rules} /></div>}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: '12.5px', color: '#a8a29e', fontFamily: mono }}>
          {skill.status === 'generating' ? 'Writing your skill. This takes about 30 seconds.' : 'Arjun writes this once your profile is saved.'}
        </div>
      )}

      <div>
        <label htmlFor={`notes-${skill.id}`} style={{ fontSize: '10.5px', fontFamily: mono, letterSpacing: '0.08em', color: '#78716c' }}>YOUR CORRECTIONS (ALWAYS WIN)</label>
        <textarea
          id={`notes-${skill.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={skill.id === 'writing_voice' ? 'e.g. I prefer short sentences. Never use the word "leverage".' : skill.id === 'cover_letter' ? 'e.g. Don\'t mention my startup unless the company is early-stage.' : 'e.g. Lead with my AI work for PM roles. My Kitewire title was Senior PM.'}
          rows={3}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: '6px', border: '1px solid #d6d3d1', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", resize: 'vertical' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
          <button onClick={save} disabled={saving || notes === (skill.user_notes || '')} style={{ ...btn(true), opacity: saving || notes === (skill.user_notes || '') ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save corrections'}
          </button>
          {saved && <span style={{ fontSize: '12px', color: '#16a34a' }}>Saved. Arjun is updating this skill.</span>}
        </div>
      </div>
    </div>
  );
}

export default function SkillsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  const load = async () => {
    try { setData(await api.getSkills()); setError(''); }
    catch { setError('Could not load your skills.'); }
  };

  useEffect(() => { load(); return () => clearTimeout(pollRef.current); }, []);

  // Poll while anything is generating so the cards update without a refresh.
  useEffect(() => {
    clearTimeout(pollRef.current);
    if (data && (data.generating || data.skills.some(s => s.status === 'generating'))) {
      pollRef.current = setTimeout(load, 5000);
    }
  }, [data]);

  const regenerate = async () => {
    setBusy(true);
    try { setData(await api.regenerateSkills()); setTimeout(load, 1500); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const download = async () => {
    try { await api.downloadSkills(); } catch (e) { setError(e.message); }
  };

  const saveNotes = async (skill, notes) => {
    setData(await api.saveSkillNotes(skill, notes));
    setTimeout(load, 1500);
  };

  const anyContent = data?.skills.some(s => s.content);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'grid', gap: '18px' }}>
      <div>
        <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>My Skills</h2>
        <p style={{ fontSize: '13px', color: '#78716c', maxWidth: '620px', lineHeight: 1.55 }}>
          Arjun turns your profile into three writing playbooks and uses them for every resume and cover letter.
          They update automatically when your profile changes. Add corrections to steer them.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button onClick={download} disabled={!anyContent} style={{ ...btn(true), opacity: anyContent ? 1 : 0.5 }}>Download for Claude</button>
        <button onClick={regenerate} disabled={busy} style={btn(false)}>{busy ? 'Starting…' : 'Regenerate all'}</button>
      </div>
      {anyContent && (
        <div style={{ fontSize: '12px', color: '#78716c', marginTop: '-8px' }}>
          The download is a .zip of Claude skills. In Claude, go to Settings, then Capabilities, then Skills, and upload each folder.
        </div>
      )}

      {error && <div style={{ fontSize: '13px', color: '#991b1b' }}>{error}</div>}
      {!data && !error && <div style={{ fontSize: '13px', color: '#a8a29e', fontFamily: mono }}>Loading…</div>}
      {data?.skills.map(s => <SkillCard key={s.id} skill={s} onSaveNotes={saveNotes} />)}
    </div>
  );
}
