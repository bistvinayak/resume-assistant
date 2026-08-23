// Arjun Autofill — background service worker
// Holds the Firebase ID token bridged from the vinayakbist.com tab, and proxies
// authenticated calls to the Arjun API (extension content scripts have no auth of their own).

const API_BASE = 'https://vinayakbist.com/api';

// Receives the token pushed from vinayakbist.com (see resumeai-frontend/src/extensionBridge.js)
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ARJUN_AUTH') {
    chrome.storage.local.set({ authToken: message.token, userEmail: message.email, authAt: Date.now() });
    sendResponse({ ok: true });
  } else if (message.type === 'ARJUN_LOGOUT') {
    chrome.storage.local.remove(['authToken', 'userEmail', 'authAt']);
    sendResponse({ ok: true });
  }
  return true;
});

async function getAuthState() {
  const { authToken, userEmail, authAt } = await chrome.storage.local.get(['authToken', 'userEmail', 'authAt']);
  // Firebase ID tokens last 1h; treat as stale after 50min so we prompt a refresh before it hard-fails
  const stale = !authAt || (Date.now() - authAt) > 50 * 60 * 1000;
  return { loggedIn: !!authToken && !stale, userEmail, stale: !!authToken && stale };
}

async function mapFields(fields, url) {
  const { authToken } = await chrome.storage.local.get(['authToken']);
  if (!authToken) throw new Error('not_logged_in');

  const res = await fetch(`${API_BASE}/extension/map-fields`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ fields, url }),
  });

  if (res.status === 401) throw new Error('not_logged_in');
  if (!res.ok) throw new Error(`api_error_${res.status}`);
  const data = await res.json();
  return data.mappings || [];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_AUTH_STATE') {
    getAuthState().then(sendResponse);
    return true;
  }
  if (message.type === 'MAP_FIELDS') {
    mapFields(message.fields, message.url)
      .then((mappings) => sendResponse({ ok: true, mappings }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
