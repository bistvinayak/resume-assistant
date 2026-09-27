// Pushes the current Firebase ID token + refresh token to the Arjun Chrome extension
// (if installed), so it can make authenticated calls without its own login flow and
// renew the hourly ID token itself after this tab is closed.
const EXTENSION_ID = 'ljeplebcfpakamlgehpfmemkbmnalfdc';

let refreshTimer = null;
let pushToken = null; // set while a user is signed in
let lastFocusPush = 0;

// Installing the extension happens in another tab (chrome://extensions), after this page has
// already pushed its token to nothing. Re-push when the user comes back so a fresh install
// connects without a manual refresh. Throttled; getIdToken() is cached by Firebase.
function onReturn() {
  if (!pushToken || document.visibilityState !== 'visible') return;
  if (Date.now() - lastFocusPush < 5000) return;
  lastFocusPush = Date.now();
  pushToken();
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onReturn);
}

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
    pushToken = null;
    send({ type: 'ARJUN_LOGOUT' });
    return;
  }

  pushToken = async () => {
    const token = await user.getIdToken().catch(() => null);
    if (token) send({ type: 'ARJUN_AUTH', token, refreshToken: user.refreshToken, email: user.email });
  };

  pushToken();
  // Firebase ID tokens expire hourly — refresh while this tab stays open.
  refreshTimer = setInterval(pushToken, 45 * 60 * 1000);
}

// Asks the installed extension for its version (the extension answers ARJUN_PING).
// Resolves null when it isn't installed, or is an older version that doesn't answer.
export function pingExtension(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: 'ARJUN_PING' }, (resp) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !resp?.ok) return resolve(null);
        // Found it: make sure it has our sign-in (covers installs made after page load).
        if (pushToken) pushToken();
        resolve(resp.version || 'unknown');
      });
    } catch { clearTimeout(timer); resolve(null); }
  });
}
