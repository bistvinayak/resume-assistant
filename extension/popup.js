const statusEl = document.getElementById('status');
const fillBtn = document.getElementById('fillBtn');
const resultEl = document.getElementById('result');

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
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] });
    resultEl.textContent = 'Check the page — Arjun shows a summary there.';
  } catch (e) {
    resultEl.textContent = `Couldn't run on this page (${e.message}).`;
  } finally {
    fillBtn.disabled = false;
  }
});
