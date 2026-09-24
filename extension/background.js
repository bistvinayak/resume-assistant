// Arjun Autofill — background service worker
// Holds the Firebase ID token bridged from the vinayakbist.com tab, and proxies
// authenticated calls to the Arjun API (extension content scripts have no auth of their own).

const API_BASE = 'https://vinayakbist.com/api';
// Public Firebase web API key (same one shipped in the Arjun frontend bundle) — used only to
// exchange the refresh token for a fresh ID token via Google's securetoken endpoint.
const FIREBASE_API_KEY = 'AIzaSyCavPS5aAp_E4MyYOXhMrjB822rUQ_-cIs';
const AUTH_KEYS = ['authToken', 'refreshToken', 'userEmail', 'authAt', 'tokenExp'];

// Firebase ID tokens are JWTs; read `exp` so we know when to renew.
function tokenExpiry(idToken) {
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000;
  } catch {
    return Date.now() + 55 * 60 * 1000;
  }
}

// Receives the tokens pushed from vinayakbist.com (see resumeai-frontend/src/extensionBridge.js)
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ARJUN_AUTH') {
    const update = { authToken: message.token, userEmail: message.email, authAt: Date.now(), tokenExp: tokenExpiry(message.token) };
    if (message.refreshToken) update.refreshToken = message.refreshToken;
    chrome.storage.local.set(update);
    sendResponse({ ok: true });
  } else if (message.type === 'ARJUN_LOGOUT') {
    chrome.storage.local.remove(AUTH_KEYS);
    sendResponse({ ok: true });
  }
  return true;
});

// Concurrent callers share one in-flight refresh instead of each hitting Google.
let refreshing = null;

async function refreshIdToken() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refreshToken } = await chrome.storage.local.get(['refreshToken']);
    if (!refreshToken) throw new Error('not_logged_in');
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!res.ok) {
      // Revoked/expired refresh token or disabled user — force a fresh sign-in on the site.
      if (res.status === 400 || res.status === 401 || res.status === 403) await chrome.storage.local.remove(AUTH_KEYS);
      throw new Error('not_logged_in');
    }
    const data = await res.json();
    await chrome.storage.local.set({
      authToken: data.id_token,
      refreshToken: data.refresh_token,
      authAt: Date.now(),
      tokenExp: Date.now() + Number(data.expires_in) * 1000,
    });
    return data.id_token;
  })();
  try { return await refreshing; } finally { refreshing = null; }
}

// Returns a usable ID token, renewing it when it's within 5 min of expiry.
async function getValidToken({ forceRefresh = false } = {}) {
  const { authToken, tokenExp, authAt } = await chrome.storage.local.get(['authToken', 'tokenExp', 'authAt']);
  const exp = tokenExp || (authAt ? authAt + 55 * 60 * 1000 : 0);
  if (authToken && !forceRefresh && exp - Date.now() > 5 * 60 * 1000) return authToken;
  return refreshIdToken();
}

// Calls the Arjun API; on a 401 renews the token once and retries.
async function apiPost(path, body) {
  const call = (token) => fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let res = await call(await getValidToken());
  if (res.status === 401) res = await call(await getValidToken({ forceRefresh: true }));
  if (res.status === 401) throw new Error('not_logged_in');
  return res;
}

async function getAuthState() {
  const { authToken, refreshToken, userEmail, tokenExp, authAt } = await chrome.storage.local.get(AUTH_KEYS);
  // With a refresh token the extension renews itself, so the session only ends on logout/revocation.
  if (refreshToken) return { loggedIn: true, userEmail, stale: false };
  const exp = tokenExp || (authAt ? authAt + 50 * 60 * 1000 : 0);
  const stale = !!authToken && exp <= Date.now();
  return { loggedIn: !!authToken && !stale, userEmail, stale };
}

async function mapFields(fields, url) {
  const res = await apiPost('/extension/map-fields', { fields, url });
  if (!res.ok) throw new Error(`api_error_${res.status}`);
  const data = await res.json();
  return data.mappings || [];
}

async function checkJobFit(job) {
  const res = await apiPost('/extension/job-fit', job);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `api_error_${res.status}`);
  }
  return res.json();
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
  if (message.type === 'JOB_FIT') {
    checkJobFit(message.job)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
