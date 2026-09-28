const statusEl = document.getElementById('status');
const fillBtn = document.getElementById('fillBtn');
const fitBtn = document.getElementById('fitBtn');
const resultEl = document.getElementById('result');
function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = `status ${cls || ''}`;
}

chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (state) => {
  if (state?.loggedIn) {
    setStatus(`Signed in as ${state.userEmail || 'you'}`, 'ok');
    checkApplicable();
  } else {
    setStatus(state?.stale ? 'Session expired. Reconnect to keep using Arjun.' : 'Not connected to your Arjun account yet.', 'warn');
    showConnect();
  }
});

// ── Where Arjun applies ─────────────────────────────────────────────────
// Runs inside the page (every frame: Greenhouse and others put the form in an iframe).
// job = a job posting; form = a job application form. Heuristics, so the popup offers
// "Use anyway" when it says no.
function detectPage() {
  const host = location.hostname.toLowerCase();
  const url = location.href.toLowerCase();
  const ATS = /greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|icims\.com|smartrecruiters\.com|ashbyhq\.com|workable\.com|jobvite\.com|bamboohr\.com|taleo\.net|successfactors\.|oraclecloud\.com|eightfold\.ai|recruitee\.com|breezy\.hr|teamtailor\.com|applytojob\.com|rippling-ats\.com|ats\.rippling\.com|dayforcehcm\.com|paylocity\.com|ultipro\.com|jobs\.amazon\.com|hiring\.amazon\.com/;
  const JOB_URL = /linkedin\.com\/jobs|indeed\.[a-z.]+\/(viewjob|jobs|rc\/clk|m\/viewjob)|glassdoor\.[a-z.]+\/(job-listing|job)|wellfound\.com\/(jobs|l\/)|ziprecruiter\.com\/(c\/|jobs|k\/)|dice\.com\/job|builtin[a-z]*\.com\/job|monster\.[a-z.]+\/job|simplyhired|handshake|\/careers?\/|\/jobs?\/|\/job-|\/positions?\/|\/openings?\/|\/vacanc|\/apply/;
  let job = ATS.test(host) || JOB_URL.test(url);
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (/"@type"\s*:\s*"JobPosting"/.test(s.textContent || '')) job = true;
  }
  const text = (document.body?.innerText || '').slice(0, 30000).toLowerCase();
  if (!job) {
    const hits = ['responsibilities', 'qualifications', 'requirements', "what you'll do", 'about the role', 'apply now', 'years of experience', 'benefits', 'job description', 'preferred qualifications']
      .filter(k => text.includes(k)).length;
    job = hits >= 3;
  }
  const fields = [...document.querySelectorAll('input, select, textarea')]
    .filter(el => !['hidden', 'submit', 'button', 'search', 'image', 'reset'].includes(el.type) && el.getClientRects().length);
  const labels = fields.map(el => [el.labels?.[0]?.innerText, el.getAttribute('aria-label'), el.name, el.placeholder, el.id].filter(Boolean).join(' ')).join(' | ').toLowerCase();
  const formHits = ['first name', 'last name', 'firstname', 'lastname', 'email', 'phone', 'resume', 'cv', 'cover letter', 'linkedin', 'authoriz', 'sponsor', 'address', 'school', 'employer', 'job title', 'degree']
    .filter(k => labels.includes(k)).length;
  const form = fields.length >= 3 && (formHits >= 3 || (ATS.test(host) && formHits >= 1));
  return { job, form };
}

async function checkApplicable() {
  let job = false, form = false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: detectPage });
    for (const r of results || []) { job = job || !!r.result?.job; form = form || !!r.result?.form; }
  } catch { /* chrome:// pages, the web store, etc. can't be read: not applicable */ }
  applyAvailability(job, form);
}

function applyAvailability(job, form) {
  fitBtn.disabled = !job;
  fillBtn.disabled = !form;
  const note = document.getElementById('applyNote') || Object.assign(document.createElement('div'), { id: 'applyNote' });
  note.style.cssText = 'font-size:12px;color:#57534e;background:#f5f5f4;border-radius:6px;padding:8px 10px;margin-top:8px;line-height:1.45;';
  note.textContent = '';
  if (job && form) { note.remove(); return; }
  note.append(!job && !form
    ? 'Arjun isn’t needed on this page. Open a job posting to check your fit, or a job application form to fill it.'
    : job ? 'This is a job posting. “Fill this page” works once you open the application form.'
    : 'This looks like an application form. Open the job posting to check your fit.');
  const any = document.createElement('a');
  any.href = '#'; any.textContent = ' Use anyway';
  any.style.cssText = 'color:#b45309;';
  any.addEventListener('click', (e) => { e.preventDefault(); fitBtn.disabled = false; fillBtn.disabled = false; note.remove(); });
  note.append(any);
  statusEl.insertAdjacentElement('afterend', note);
}

// The extension gets its sign-in from an open Arjun page. Opening the dashboard sends it
// right away, so "not signed in" is one click to fix even if you are already logged in.
function showConnect() {
  if (document.getElementById('connectBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'connectBtn';
  btn.textContent = 'Connect to Arjun';
  btn.style.cssText = 'display:block;width:100%;margin-top:8px;padding:8px 12px;border:none;border-radius:6px;background:#f59e0b;color:#fff;font-weight:600;cursor:pointer;';
  btn.addEventListener('click', () => chrome.tabs.create({ url: 'https://vinayakbist.com/projects/arjun/dashboard' }));
  statusEl.insertAdjacentElement('afterend', btn);
}

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
    resultEl.textContent = 'Done. Filled fields are outlined in green, and a list on the page shows exactly what Arjun filled.';
  } catch (e) {
    resultEl.textContent = `Couldn't run on this page (${e.message}).`;
  } finally {
    fillBtn.disabled = false;
  }
});

// ── Job fit (TypeSafe Jev via /api/extension/job-fit) ────────────────────
const fitResultEl = document.getElementById('fitResult');

// Runs inside the job page (injected, so it must be self-contained). Returns the posting plus
// `source`, which says where the text came from so a bad read is visible in Langfuse.
async function extractJobPosting() {
  const clean = (s) => String(s || '').replace(/\n{3,}/g, '\n\n').trim();

  // LinkedIn: search results show a list of jobs beside the open one, so page-wide containers
  // like <main> mix in other postings. The description block's id carries the job id
  // (JobDetails_AboutTheJob_<id>), which pins the text to the job in the URL. Class names
  // are generated hashes and change without notice, so they are not used.
  if (/(^|\.)linkedin\.com$/.test(location.hostname)) {
    const jobId = new URLSearchParams(location.search).get('currentJobId')
      || location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] || '';
    // After a click in the job list, LinkedIn renders the description block empty and fills it
    // about half a second later; wait up to 3 s so a quick click doesn't read nothing.
    let about;
    for (let i = 0; i < 15; i++) {
      about = (jobId && document.getElementById(`JobDetails_AboutTheJob_${jobId}`))
        || document.querySelector('[id^="JobDetails_AboutTheJob_"]');
      if (about && about.innerText.trim().length > 200) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    // Tab title is "<title> | <company> | LinkedIn" for the open job.
    const parts = document.title.replace(/^\(\d+\)\s*/, '').split(' | ');
    const [title, company] = parts.length >= 3 && parts[parts.length - 1] === 'LinkedIn' ? parts : [parts[0], ''];
    const text = about
      ? clean(about.innerText.replace(/^\s*About the job\s*/, '').replace(/\n…\s*more[\s\S]*$/, ''))
      : '';
    return { url: location.href, jobId, title: title.trim(), company: company.trim(), text: text.slice(0, 20000), source: about ? 'linkedin_about' : 'linkedin_missing' };
  }

  const selectors = [
    '#content .job-post', '.posting-page', '[data-automation-id="jobPostingDescription"]',
    '.ashby-job-posting-right-pane', '#jobDescriptionText', '#content', 'main', 'article',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 400) {
      return { url: location.href, title: document.querySelector('h1')?.innerText.trim() || document.title, company: '', text: clean(el.innerText).slice(0, 20000), source: sel };
    }
  }
  return { url: location.href, title: document.querySelector('h1')?.innerText.trim() || document.title, company: '', text: clean(document.body.innerText).slice(0, 20000), source: 'body' };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderFit(r, job) {
  const visaPill = r.visa.status === 'blocked'
    ? '<span class="pill bad">Not eligible</span>'
    : '<span class="pill good">OK to apply</span>';
  const seniority = { under_qualified: 'Under-qualified', good_match: 'Good match', over_qualified: 'Over-qualified' }[r.seniority.value];

  const checked = [job?.title, job?.company].filter(Boolean).join(' at ');
  fitResultEl.innerHTML = `
    ${checked ? `<div class="fit-checked">Checked: ${esc(checked)}</div>` : ''}
    <div class="fit-head">
      <span class="fit-pct">${r.overallFit.percent}%</span>
      <span class="fit-label">${esc(r.overallFit.label)}<br><span class="conf">confidence ${pct(r.overallFit.confidence)}</span></span>
    </div>
    <div class="bar"><div style="width:${r.overallFit.percent}%"></div></div>
    <div class="row"><span>Visa</span><span>${visaPill}<br><span class="conf">${esc(r.visa.reason)} · ${pct(r.visa.confidence)}</span></span></div>
    <div class="row"><span>Skills</span><span>${r.skills.percent}% <span class="conf">${esc(r.skills.label)}</span></span></div>
    <div class="row"><span>Domain</span><span>${r.domain.percent}% <span class="conf">${esc(r.domain.label)}</span></span></div>
    <div class="row"><span>Seniority</span><span>${seniority} <span class="conf">${pct(r.seniority.confidence)}</span></span></div>
    <div class="fit-note">Scored by ${esc(r.model)} in ${r.durationMs} ms. Visa is flagged only when the posting explicitly rules you out.${r.engine === 'openrouter' ? ' For sharper scoring, add your own Jev key in Arjun’s Chrome Extension tab.' : ''}</div>
    ${r.jobKey ? '<button id="insightsBtn" class="secondary">Open full analysis</button>' : ''}`;
  const btn = document.getElementById('insightsBtn');
  if (btn) btn.addEventListener('click', () => openInsights(r, job));
}

// Looked up when the popup opens, so the click handler can call sidePanel.open synchronously.
let popupWindowId;
chrome.windows.getCurrent().then((w) => { popupWindowId = w.id; });

// Opens the side panel for this job. sidePanel.open must run inside the click, before any await.
function openInsights(r, job) {
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    chrome.storage.session.set({ arjunPanelJob: { jobKey: r.jobKey, title: job?.title || '', company: job?.company || '', fit: { overall: r.overallFit, skills: r.skills, domain: r.domain, seniority: r.seniority, visa: r.visa }, at: Date.now() } });
  });
  chrome.sidePanel.open({ windowId: popupWindowId })
    .then(() => window.close())
    .catch((e) => { fitResultEl.insertAdjacentHTML('beforeend', `<div class="fit-note">Couldn’t open the side panel (${esc(e.message)}).</div>`); });
}

const FIT_ERRORS = {
  not_logged_in: 'Not connected to your Arjun account. Click Connect to Arjun above.',
  no_job_text: 'Couldn’t find a job description on this page. Open the full job posting and try again.',
  no_profile: 'Your Arjun profile is empty — upload your resume first.',
  ai_busy: 'Arjun runs on free AI models, and they’re busy right now because many people are using them. Please try again in a minute.',
  fit_busy: 'The job-fit service is slow to respond right now. Please try again in a minute.',
  extension_outdated: 'Arjun needs a restart. Open chrome://extensions, click the reload icon on Arjun, then refresh this page.',
  unsupported_message: 'Arjun needs a restart. Open chrome://extensions, click the reload icon on Arjun, then refresh this page.',
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
    // No response at all means the background worker is an older version that doesn't know
    // JOB_FIT (unpacked installs keep running the old worker until the extension is reloaded).
    if (!resp) throw new Error('extension_outdated');
    if (!resp.ok) throw new Error(resp.error || 'unknown_error');
    renderFit(resp.result, job);
  } catch (e) {
    fitResultEl.textContent = FIT_ERRORS[e.message] || `Couldn’t check this job (${e.message}).`;
  } finally {
    fitBtn.disabled = false;
  }
});
