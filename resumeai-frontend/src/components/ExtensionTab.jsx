import { useEffect, useState } from 'react';
import { api } from '../api';
import { pingExtension } from '../extensionBridge';

// Dashboard "Chrome Extension" tab: download + install steps for the unpacked extension
// (until the Chrome Web Store listing exists), with installed / update-available detection.

const mono = "'DM Mono', monospace";
const card = { background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '22px 24px' };
const olderThan = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0); }
  return false;
};

function Step({ n, title, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: '12px', padding: '12px 0', borderTop: '1px solid #f5f5f4' }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#fef3c7', color: '#b45309', fontFamily: mono, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</div>
      <div>
        <div style={{ fontSize: '13.5px', fontWeight: 600, marginBottom: '2px' }}>{title}</div>
        <div style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.55 }}>{children}</div>
      </div>
    </div>
  );
}

const Code = ({ children }) => (
  <code style={{ fontFamily: mono, fontSize: '12px', background: '#f5f5f4', borderRadius: '4px', padding: '1px 6px' }}>{children}</code>
);

export function JevKeyCard() {
  const [info, setInfo] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.getJevKey().then(setInfo).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setMsg('');
    try { await api.saveJevKey(key.trim()); setKey(''); setMsg('Saved. Job-fit checks now use Jev on your key.'); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setMsg('');
    try { await api.deleteJevKey(); setMsg('Removed. Job-fit checks use the free AI model again.'); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const usingJev = info?.engine === 'jev';
  return (
    <div style={card}>
      <div style={{ fontSize: '10.5px', fontFamily: mono, letterSpacing: '0.08em', color: '#78716c', marginBottom: '6px' }}>JOB-FIT ENGINE</div>
      <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
        {!info ? 'Checking…' : usingJev ? `Jev (TypeSafe)${info.keySource === 'user' ? ` · your key ····${info.last4}` : ''}` : 'Free AI model (OpenRouter)'}
      </div>
      <p style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.6, margin: '0 0 12px' }}>
        “Check this job” and the side panel analysis run on a free AI model by default. For sharper, more consistent scoring,
        add your own TypeSafe Jev API key: checks then use Jev and are billed to your TypeSafe account. The key is encrypted and never shown again.
      </p>
      {info?.hasKey ? (
        <button onClick={remove} disabled={busy} style={{ background: '#fff', border: '1px solid #fecaca', color: '#ef4444', padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
          {busy ? '…' : 'Remove my key'}
        </button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (key.trim()) save(); }} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input id="jev-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your TypeSafe API key"
            aria-label="TypeSafe API key" style={{ flex: '1 1 260px', border: '1px solid #d6d3d1', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: mono }} />
          <button type="submit" disabled={busy || !key.trim() || info?.canStore === false} style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 16px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', opacity: busy || !key.trim() ? 0.6 : 1 }}>
            {busy ? 'Checking key…' : 'Save key'}
          </button>
        </form>
      )}
      {msg && <div style={{ fontSize: '12.5px', color: /didn|isn|Could/.test(msg) ? '#dc2626' : '#166534', marginTop: '8px' }}>{msg}</div>}
    </div>
  );
}

export default function ExtensionTab() {
  const [latest, setLatest] = useState(null);
  const [installed, setInstalled] = useState(undefined); // undefined = checking, null = not detected
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const check = async () => {
    setInstalled(undefined);
    setInstalled(await pingExtension());
  };
  useEffect(() => {
    api.getExtensionInfo().then(r => setLatest(r.version)).catch(() => {});
    check();
  }, []);

  const download = async () => {
    setBusy(true); setError('');
    try { await api.downloadExtension(); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText('chrome://extensions'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* user can type it */ }
  };

  const needsUpdate = installed && latest && installed !== 'unknown' && olderThan(installed, latest);
  const status = installed === undefined ? { text: 'Checking…', bg: '#f5f5f4', fg: '#57534e' }
    : installed === null ? { text: 'Not detected in this browser', bg: '#f5f5f4', fg: '#57534e' }
    : needsUpdate ? { text: `Update available (you have ${installed})`, bg: '#fef3c7', fg: '#92400e' }
    : { text: `Installed ✓ ${installed !== 'unknown' ? `v${installed}` : ''}`, bg: '#dcfce7', fg: '#166534' };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'grid', gap: '18px', maxWidth: '760px' }}>
      <div>
        <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>Chrome Extension</h2>
        <p style={{ fontSize: '13px', color: '#78716c', lineHeight: 1.55, maxWidth: '620px' }}>
          The Arjun extension checks any job posting against your profile, explains where you fit and where you don't,
          and fills job applications on Greenhouse, Lever, Workday, Ashby and more.
        </p>
      </div>

      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: '6px' }}>
          <div style={{ fontSize: '15px', fontWeight: 700 }}>Arjun {latest && <span style={{ fontFamily: mono, fontSize: '12px', color: '#a8a29e', fontWeight: 400 }}>v{latest}</span>}</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ background: status.bg, color: status.fg, borderRadius: '999px', padding: '3px 10px', fontSize: '11.5px', fontWeight: 600 }}>{status.text}</span>
            {installed !== undefined && <button onClick={check} style={{ background: 'none', border: 'none', color: '#b45309', fontSize: '12px', cursor: 'pointer', padding: 0 }}>Check again</button>}
          </div>
        </div>
        <button onClick={download} disabled={busy} style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Preparing…' : needsUpdate ? 'Download update (.zip)' : 'Download extension (.zip)'}
        </button>
      </div>
      {error && <div style={{ fontSize: '13px', color: '#dc2626' }}>{error}</div>}

      <div style={card}>
        <div style={{ fontSize: '10.5px', fontFamily: mono, letterSpacing: '0.08em', color: '#78716c', marginBottom: '4px' }}>
          {needsUpdate ? 'HOW TO UPDATE' : 'HOW TO INSTALL (ABOUT 1 MINUTE, CHROME OR EDGE ON A COMPUTER)'}
        </div>
        {needsUpdate ? (
          <>
            <Step n={1} title="Download the update">Use the button above and unzip it.</Step>
            <Step n={2} title="Replace the old folder">Put the new <Code>arjun-extension</Code> folder where the old one was (replace it).</Step>
            <Step n={3} title="Reload">Open <Code>chrome://extensions</Code> and click the reload arrow on Arjun. Your sign-in carries over.</Step>
          </>
        ) : (
          <>
            <Step n={1} title="Download and unzip">Click <b>Download extension</b>, then double-click the file. You get a folder called <Code>arjun-extension</Code>. Keep it somewhere permanent, like Documents, because Chrome loads it from there.</Step>
            <Step n={2} title="Open Chrome's extensions page">
              Type <Code>chrome://extensions</Code> in the address bar and press Enter.{' '}
              <button onClick={copy} style={{ background: 'none', border: 'none', color: '#b45309', fontSize: '12.5px', cursor: 'pointer', padding: 0 }}>{copied ? 'Copied' : 'Copy address'}</button>
            </Step>
            <Step n={3} title="Turn on Developer mode">Use the switch in the top-right corner of that page.</Step>
            <Step n={4} title="Load the extension">Click <b>Load unpacked</b> and select the <Code>arjun-extension</Code> folder.</Step>
            <Step n={5} title="Pin it">Click the puzzle-piece icon in Chrome's toolbar and pin <b>Arjun</b>.</Step>
            <Step n={6} title="Connect your account">Come back to this page. The extension signs in automatically and stays signed in. If its popup still says "Not signed in", refresh this page.</Step>
          </>
        )}
      </div>

      <JevKeyCard />

      <div style={{ ...card, fontSize: '13px', color: '#57534e', lineHeight: 1.6 }}>
        <div style={{ fontSize: '10.5px', fontFamily: mono, letterSpacing: '0.08em', color: '#78716c', marginBottom: '6px' }}>USING IT</div>
        <b>Fill an application:</b> open the form, click the Arjun icon, then <b>Fill this page</b>. On Greenhouse, Lever, Workday and similar sites it starts on its own.<br />
        <b>Check a job:</b> on any job posting, click the Arjun icon, then <b>Check this job</b> for your fit score and whether the posting rules out visa sponsorship.<br />
        <span style={{ color: '#a8a29e' }}>Chrome may show a "developer mode extensions" notice at startup. That's expected for extensions installed this way; a Chrome Web Store version is coming.</span>
      </div>
    </div>
  );
}
