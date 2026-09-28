import { useEffect, useState } from 'react';
import { api } from '../api';
import { JevKeyCard } from './ExtensionTab';

// "AI Settings" tab: optional own API keys. Without them Arjun uses free default models.
const mono = "'DM Mono', monospace";
const card = { background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px 22px', marginBottom: '16px' };

function OpenRouterKeyCard() {
  const [info, setInfo] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.getOpenRouterKey().then(setInfo).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setMsg('');
    try { await api.saveOpenRouterKey(key.trim()); setKey(''); setMsg('Saved. Your AI tasks now use your key.'); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setMsg('');
    try { await api.deleteOpenRouterKey(); setMsg('Removed. Arjun uses the free default models again.'); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={card}>
      <div style={{ fontSize: '10.5px', fontFamily: mono, letterSpacing: '0.08em', color: '#78716c', marginBottom: '6px' }}>RESUME WRITING & AI TASKS</div>
      <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
        {!info ? 'Checking…' : info.hasKey ? `Your OpenRouter key ····${info.last4} · ${info.model}` : 'Free default models'}
      </div>
      <p style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.6, margin: '0 0 12px' }}>
        Tailored resumes, cover letters, profile building, chat and form filling run on free AI models by default.
        They work, but can be slow when busy. Add your own OpenRouter key to use a stronger model, billed to your OpenRouter account.
        If your key ever fails, Arjun falls back to the free models. The key is encrypted and never shown again.
      </p>
      {info?.hasKey ? (
        <button onClick={remove} disabled={busy} style={{ background: '#fff', border: '1px solid #fecaca', color: '#ef4444', padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
          {busy ? '…' : 'Remove my key'}
        </button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (key.trim()) save(); }} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input id="openrouter-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-…"
            aria-label="OpenRouter API key" style={{ flex: '1 1 260px', border: '1px solid #d6d3d1', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: mono }} />
          <button type="submit" disabled={busy || !key.trim() || info?.canStore === false} style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 16px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', opacity: busy || !key.trim() ? 0.6 : 1 }}>
            {busy ? 'Checking key…' : 'Save key'}
          </button>
        </form>
      )}
      <div style={{ fontSize: '12px', color: '#78716c', marginTop: '10px' }}>
        Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" style={{ color: '#b45309' }}>openrouter.ai/keys</a> and add credits there.
      </div>
      {msg && <div style={{ fontSize: '12.5px', color: /didn|isn|Could/.test(msg) ? '#dc2626' : '#166534', marginTop: '8px' }}>{msg}</div>}
    </div>
  );
}

export default function AiSettingsTab() {
  return (
    <div style={{ maxWidth: '720px' }}>
      <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>AI Settings</h2>
      <p style={{ fontSize: '13px', color: '#78716c', marginBottom: '20px', lineHeight: 1.6 }}>
        Both keys are optional. Without them, everything still works on free default models.
      </p>
      <OpenRouterKeyCard />
      <div id="jev-key-card"><JevKeyCard /></div>
    </div>
  );
}
