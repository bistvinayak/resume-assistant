import { useState } from 'react';
import { api } from '../api';
import { signOutUser } from '../firebase';

// Permanent account deletion. The user must type DELETE; the server also requires it.
export default function DeleteAccountDialog({ onClose, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirmed = typed.trim() === 'DELETE';

  const handleDelete = async () => {
    setBusy(true);
    setError('');
    try {
      await api.deleteAccount();
      await signOutUser().catch(() => {});
      onDeleted();
    } catch (e) {
      setError(e.message || 'Could not delete your account. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="delete-account-title"
      onClick={busy ? undefined : onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '16px' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#ffffff', border: '1px solid #fecaca', borderRadius: '12px', padding: '24px', maxWidth: '440px', width: '100%' }}>
        <h2 id="delete-account-title" style={{ fontFamily: "'DM Serif Display', serif", fontSize: '22px', marginBottom: '10px' }}>Delete your account?</h2>
        <p style={{ fontSize: '13px', color: '#57534e', marginBottom: '10px' }}>
          This permanently deletes everything Arjun has stored for you. It can't be undone.
        </p>
        <ul style={{ fontSize: '13px', color: '#57534e', margin: '0 0 16px 18px', lineHeight: 1.6 }}>
          <li>Your career profile and all its saved versions</li>
          <li>Your applications, tailored resumes and cover letters</li>
          <li>Your skills, resume format, saved API key and extension history</li>
          <li>Your job-alert forwarding and your Google sign-in with Arjun</li>
        </ul>
        <p style={{ fontSize: '12px', color: '#78716c', marginBottom: '8px' }}>
          Download any resumes you want to keep first. Type <b>DELETE</b> to confirm.
        </p>
        <input
          value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder="DELETE"
          aria-label="Type DELETE to confirm"
          disabled={busy}
          style={{ width: '100%', boxSizing: 'border-box', background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', fontSize: '13px', padding: '8px 12px', fontFamily: "'DM Mono', monospace", marginBottom: '12px', outline: 'none' }}
        />
        {error && <div role="alert" style={{ fontSize: '12px', color: '#ef4444', marginBottom: '12px' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} disabled={busy} style={{ background: 'none', border: '1px solid #d6d3d1', color: '#57534e', padding: '8px 14px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!confirmed || busy}
            style={{ background: confirmed ? '#ef4444' : '#fca5a5', border: 'none', color: '#ffffff', padding: '8px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: confirmed && !busy ? 'pointer' : 'not-allowed' }}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}
