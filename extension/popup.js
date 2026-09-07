const statusEl = document.getElementById('status');
const fillBtn = document.getElementById('fillBtn');
const resultEl = document.getElementById('result');
const pwInput = document.getElementById('pwInput');
const savePwBtn = document.getElementById('savePwBtn');
const clearPwBtn = document.getElementById('clearPwBtn');
const pwStatusEl = document.getElementById('pwStatus');

// Password never leaves this browser — stored in chrome.storage.local only,
// read directly by content-script.js to fill password fields locally. It is
// never included in the MAP_FIELDS payload sent to the backend/LLM.
function refreshPwStatus() {
  chrome.storage.local.get(['autofillPassword'], ({ autofillPassword }) => {
    pwStatusEl.textContent = autofillPassword ? 'Saved for this browser.' : 'Not set.';
    pwStatusEl.className = autofillPassword ? 'ok' : '';
    clearPwBtn.style.display = autofillPassword ? 'block' : 'none';
  });
}
refreshPwStatus();

savePwBtn.addEventListener('click', () => {
  const value = pwInput.value;
  if (!value) return;
  chrome.storage.local.set({ autofillPassword: value }, () => {
    pwInput.value = '';
    refreshPwStatus();
  });
});

clearPwBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['autofillPassword'], refreshPwStatus);
});

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = `status ${cls || ''}`;
}

chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (state) => {
  if (state?.loggedIn) {
    setStatus(`Signed in as ${state.userEmail || 'you'}`, 'ok');
    fillBtn.disabled = false;
  } else if (state?.stale) {
    setStatus('Session expired — reopen Arjun to refresh', 'warn');
  } else {
    setStatus('Not signed in — open vinayakbist.com/projects/arjun first');
  }
});

fillBtn.addEventListener('click', async () => {
  fillBtn.disabled = true;
  resultEl.textContent = 'Scanning page…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    resultEl.textContent = 'No active tab.';
    fillBtn.disabled = false;
    return;
  }

  try {
    // allFrames: true — many ATS platforms (Greenhouse especially) embed the actual
    // application form in an iframe rather than the top-level page, so scanning only
    // the top frame finds zero fields even on forms that are clearly fillable.
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content-script.js'] });
    resultEl.textContent = 'Check the page — Arjun shows a summary there.';
  } catch (e) {
    resultEl.textContent = `Couldn't run on this page (${e.message}).`;
  } finally {
    fillBtn.disabled = false;
  }
});
