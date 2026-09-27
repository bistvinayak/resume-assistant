// Pushes the current Firebase ID token + refresh token to the Arjun Autofill extension
// (if installed), so it can make authenticated calls without its own login flow and
// renew the hourly ID token itself after this tab is closed.
const EXTENSION_ID = 'ljeplebcfpakamlgehpfmemkbmnalfdc';

let refreshTimer = null;

function send(message) {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage(EXTENSION_ID, message, () => {
      // Swallow "could not establish connection" — expected when the extension isn't installed.
      void chrome.runtime.lastError;
    });
  } catch { /* extension not installed */ }
}

export function syncExtensionAuth(user) {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }

  if (!user) {
    send({ type: 'ARJUN_LOGOUT' });
    return;
  }

  const pushToken = async () => {
    const token = await user.getIdToken().catch(() => null);
    if (token) send({ type: 'ARJUN_AUTH', token, refreshToken: user.refreshToken, email: user.email });
  };

  pushToken();
  // Firebase ID tokens expire hourly — refresh while this tab stays open.
  refreshTimer = setInterval(pushToken, 45 * 60 * 1000);
}

// Asks the installed extension for its version (extension 1.3.2+ answers ARJUN_PING).
// Resolves null when it isn't installed, or is an older version that doesn't answer.
export function pingExtension(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: 'ARJUN_PING' }, (resp) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !resp?.ok) return resolve(null);
        resolve(resp.version || 'unknown');
      });
    } catch { clearTimeout(timer); resolve(null); }
  });
}
