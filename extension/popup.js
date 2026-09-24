const statusEl = document.getElementById('status');
const fillBtn = document.getElementById('fillBtn');
const fitBtn = document.getElementById('fitBtn');
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
    fitBtn.disabled = false;
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

// ── Job fit (TypeSafe Jev via /api/extension/job-fit) ────────────────────
const fitResultEl = document.getElementById('fitResult');

// Runs inside the job page. Prefers known job-description containers (LinkedIn, Greenhouse,
// Lever, Workday, Ashby, Indeed) and falls back to <main>/<body> text.
function extractJobPosting() {
  const selectors = [
    '.jobs-description__content', '#job-details', '.jobs-search__job-details--container',
    '#content .job-post', '#content', '.posting-page', '[data-automation-id="jobPostingDescription"]',
    '.ashby-job-posting-right-pane', '#jobDescriptionText', 'main', 'article',
  ];
  let text = '';
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 400) { text = el.innerText; break; }
  }
  if (!text) text = document.body.innerText;
  const title = document.querySelector('h1')?.innerText.trim() || document.title;
  const company = document.querySelector('meta[property="og:site_name"]')?.content
    || document.querySelector('.job-details-jobs-unified-top-card__company-name')?.innerText.trim() || '';
  return { url: location.href, title, company, text: text.trim().slice(0, 20000) };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderFit(r) {
  const visaPill = r.visa.status === 'blocked'
    ? '<span class="pill bad">Not eligible</span>'
    : '<span class="pill good">OK to apply</span>';
  const seniority = { under_qualified: 'Under-qualified', good_match: 'Good match', over_qualified: 'Over-qualified' }[r.seniority.value];

  fitResultEl.innerHTML = `
    <div class="fit-head">
      <span class="fit-pct">${r.overallFit.percent}%</span>
      <span class="fit-label">${esc(r.overallFit.label)}<br><span class="conf">confidence ${pct(r.overallFit.confidence)}</span></span>
    </div>
    <div class="bar"><div style="width:${r.overallFit.percent}%"></div></div>
    <div class="row"><span>Visa</span><span>${visaPill}<br><span class="conf">${esc(r.visa.reason)} · ${pct(r.visa.confidence)}</span></span></div>
    <div class="row"><span>Skills</span><span>${r.skills.percent}% <span class="conf">${esc(r.skills.label)}</span></span></div>
    <div class="row"><span>Domain</span><span>${r.domain.percent}% <span class="conf">${esc(r.domain.label)}</span></span></div>
    <div class="row"><span>Seniority</span><span>${seniority} <span class="conf">${pct(r.seniority.confidence)}</span></span></div>
    <div class="fit-note">Scored by ${esc(r.model)} in ${r.durationMs} ms. Visa is flagged only when the posting explicitly rules you out.</div>`;
}

const FIT_ERRORS = {
  not_logged_in: 'Not signed in — open vinayakbist.com/projects/arjun first.',
  no_job_text: 'Couldn’t find a job description on this page. Open the full job posting and try again.',
  no_profile: 'Your Arjun profile is empty — upload your resume first.',
};

fitBtn.addEventListener('click', async () => {
  fitBtn.disabled = true;
  fitResultEl.textContent = 'Reading job posting…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab.');
    const [{ result: job }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobPosting });
    fitResultEl.textContent = 'Asking Jev…';
    const resp = await chrome.runtime.sendMessage({ type: 'JOB_FIT', job });
    if (!resp?.ok) throw new Error(resp?.error || 'unknown_error');
    renderFit(resp.result);
  } catch (e) {
    fitResultEl.textContent = FIT_ERRORS[e.message] || `Couldn’t check this job (${e.message}).`;
  } finally {
    fitBtn.disabled = false;
  }
});
