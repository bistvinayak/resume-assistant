// Arjun side panel: insights for the job last checked in the popup, plus a grounded chat.
// The popup writes { jobKey, title, company, fit } to chrome.storage.session; this page reads it,
// starts the server-side analysis and polls until it's ready (runs take 15-30 s).

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const show = (id, on = true) => { $(id).hidden = !on; };

const STAGES = {
  starting: 'Starting the analysis…',
  requirements: 'Reading what the job asks for…',
  matching: 'Matching each requirement against your profile…',
  explaining: 'Writing the analysis…',
};
const BADGES = {
  strong: 'Strong', wording_gap: 'Different wording', partial: 'Partial', none: 'Not in profile', unsure: 'Unsure',
};
const ERRORS = {
  not_logged_in: 'You’re signed out. Open vinayakbist.com/projects/arjun, then try again.',
  job_not_checked: 'Click “How well do I fit this job?” in the Arjun popup first.',
  insights_not_ready: 'The analysis isn’t ready yet.',
  chat_timeout: 'Arjun runs on free AI models, and they’re busy right now because many people are using them. Please try again in a minute.',
  ai_busy: 'Arjun runs on free AI models, and they’re busy right now because many people are using them. Please try again in a minute.',
  fit_busy: 'The job-fit service is slow to respond right now. Please try again in a minute.',
  unsupported_message: 'Arjun needs a restart. Reload it at chrome://extensions.',
};
const errorText = (e) => ERRORS[e] || `Something went wrong (${e}).`;

let current = null;   // { jobKey, title, company, fit }
let pollTimer = null;
let chat = [];        // in-memory only; never stored
let resumeTimer = null;
const DASHBOARD_JOBS = 'https://vinayakbist.com/projects/arjun/dashboard?tab=jobs';

function send(message) {
  return chrome.runtime.sendMessage(message).then((resp) => {
    if (!resp) throw new Error('unsupported_message');
    if (!resp.ok) throw new Error(resp.error || 'unknown_error');
    return resp.data;
  });
}

function resetView() {
  clearTimeout(pollTimer);
  clearTimeout(resumeTimer);
  chat = [];
  $('msgs').innerHTML = '';
  for (const id of ['fitSection', 'status', 'error', 'reqSection', 'analysisSection', 'strengthSection', 'watchSection', 'stepsSection', 'resumeSection', 'chatSection']) show(id, false);
}

function renderFit(job) {
  $('job').textContent = [job.title, job.company].filter(Boolean).join(' · ');
  const f = job.fit || {};
  if (!f.overall) return;
  $('fitPct').textContent = `${f.overall.percent}%`;
  $('fitLabel').textContent = `${f.overall.label} · confidence ${pct(f.overall.confidence)}`;
  const chips = [
    f.skills && `Skills ${f.skills.percent}%`,
    f.domain && `Domain ${f.domain.percent}%`,
    f.seniority && `Seniority: ${String(f.seniority.value).replace('_', ' ')}`,
    f.visa && (f.visa.status === 'blocked' ? 'Visa: not eligible' : 'Visa: OK to apply'),
  ].filter(Boolean);
  $('fitChips').innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  show('fitSection');
}

function setStatus(stage) {
  $('statusText').textContent = STAGES[stage] || 'Working…';
  show('status');
}

function renderRequirements(reqs, counts) {
  const order = ['strong', 'wording_gap', 'partial', 'none', 'unsure'];
  $('counts').textContent = order.filter((k) => counts?.[k]).map((k) => `${counts[k]} ${BADGES[k].toLowerCase()}`).join(' · ');
  $('reqs').innerHTML = reqs.map((r) => `
    <div class="req">
      <div class="req-top">
        <div class="req-text">${esc(r.text)} <span class="level">${esc(r.level)}</span></div>
        <span class="badge b-${esc(r.status)}">${esc(BADGES[r.status] || r.status)}</span>
      </div>
      ${r.status === 'wording_gap' && r.wording?.absent?.length ? `<div class="terms">Job's words not in your profile: ${esc(r.wording.absent.join(', '))}</div>` : ''}
      ${r.status === 'unsure' ? `<div class="terms">Jev wasn’t confident (${pct(r.confidence)}). Judge this one yourself.</div>` : ''}
    </div>`).join('');
  show('reqSection');
}

function renderAnalysis(a) {
  renderRequirements(a.requirements || [], a.counts);
  const x = a.explanation || {};
  if (x.summary) { $('summary').textContent = x.summary; show('analysisSection'); }
  if (x.strengths?.length) {
    $('strengths').innerHTML = x.strengths.map((s) => `<li><span class="k">${esc(s.requirement)}</span><span class="v">${esc(s.evidence)}</span></li>`).join('');
    show('strengthSection');
  }
  if (x.watchOuts?.length) {
    $('watchOuts').innerHTML = x.watchOuts.map((w) => `<li><span class="k">${esc(w.requirement)}</span>${w.why ? `<span class="v">${esc(w.why)}</span>` : ''}${w.what_to_do ? `<span class="todo">→ ${esc(w.what_to_do)}</span>` : ''}</li>`).join('');
    show('watchSection');
  }
  if (x.nextSteps?.length) {
    $('steps').innerHTML = x.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('');
    show('stepsSection');
  }
  show('status', false);
  show('chatSection');
  pollResume(current.jobKey);
}

// ── Resume card ────────────────────────────────────────────────────────
function renderResume(v) {
  if (!v || v.status === 'none') { show('resumeSection', false); return; }
  const fb = (v.feedback || []).map((f) => `<li>${esc(f.text)}</li>`).join('');
  let html = '';
  if (v.status === 'processing') {
    html = `<div class="r-status"><span class="spinner"></span>Making your resume from your profile… usually about a minute.</div>`;
  } else if (v.status === 'failed') {
    html = `<div class="error">Couldn’t make the resume this time${v.error ? ` (${esc(v.error)})` : ''}. Ask again in the chat to retry.</div>`;
  } else if (v.preview) {
    html = `
      ${v.atsScore != null ? `<div class="r-score">Keyword match with the posting: ${esc(v.atsScore)}%</div>` : ''}
      ${v.preview.summary ? `<p class="r-summary">${esc(v.preview.summary)}</p>` : ''}
      ${v.preview.role ? `<div class="r-role">${esc(v.preview.role)}</div><ul class="r-bullets">${v.preview.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}`;
  }
  if (fb) html += `<div class="r-fb">Your feedback applied:<ul>${fb}</ul></div>`;
  if (v.status === 'delivered') {
    html += `<div class="r-actions"><a href="${DASHBOARD_JOBS}" target="_blank" rel="noopener">Download from My Applications →</a>${v.hasCoverLetter ? '<span>Cover letter included</span>' : ''}</div>
      <div class="hint">Want changes? Tell me in the chat, e.g. “shorter summary” or “lead with my payments work”.</div>`;
  }
  $('resumeBody').innerHTML = html;
  show('resumeSection');
}

async function pollResume(jobKey, startedAt = Date.now()) {
  clearTimeout(resumeTimer);
  if (!current || current.jobKey !== jobKey) return;
  try {
    const v = await send({ type: 'JOB_RESUME_GET', jobKey });
    if (!current || current.jobKey !== jobKey) return;
    renderResume(v);
    if (v.status === 'processing' && Date.now() - startedAt < 300000) resumeTimer = setTimeout(() => pollResume(jobKey, startedAt), 4000);
  } catch { /* the card just stays as it was */ }
}

function fail(e) {
  show('status', false);
  $('error').textContent = errorText(e.message || e);
  show('error');
}

async function poll(jobKey, startedAt) {
  if (!current || current.jobKey !== jobKey) return;
  try {
    const r = await send({ type: 'JOB_INSIGHTS_GET', jobKey });
    if (!current || current.jobKey !== jobKey) return;
    if (r.status === 'ready') return renderAnalysis(r.analysis);
    if (r.status === 'failed') return fail(new Error(r.error));
    if (r.status === 'running') {
      setStatus(r.stage);
      if (r.partial?.requirements) renderRequirements(r.partial.requirements, r.partial.counts);
    }
    if (Date.now() - startedAt > 150000) return fail(new Error('the analysis is taking too long, try again'));
    pollTimer = setTimeout(() => poll(jobKey, startedAt), 2000);
  } catch (e) { fail(e); }
}

async function load(job) {
  resetView();
  current = job;
  if (!job?.jobKey) { show('empty'); return; }
  show('empty', false);
  renderFit(job);
  setStatus('starting');
  try {
    const r = await send({ type: 'JOB_INSIGHTS_START', jobKey: job.jobKey });
    if (r.status === 'ready') return renderAnalysis(r.analysis);
    setStatus(r.stage);
    pollTimer = setTimeout(() => poll(job.jobKey, Date.now()), 2000);
  } catch (e) { fail(e); }
}

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  $('msgs').appendChild(div);
  div.scrollIntoView({ block: 'nearest' });
  return div;
}

// Thumbs up/down under each reply → admin Feedback tab (+ self-healing for thumbs-down).
function addFeedback(msgEl, traceId, userMessage, arjunReply) {
  const bar = document.createElement('div');
  bar.className = 'fb';
  const done = (text) => { bar.textContent = text; };
  const submit = async (score, comment) => {
    done('Sending…');
    try { await send({ type: 'CHAT_FEEDBACK', traceId, score, comment, userMessage, arjunReply }); done(score ? 'Thanks for the feedback.' : 'Thanks. This helps us fix it.'); }
    catch { done('Could not send feedback.'); }
  };
  const btn = (label, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  };
  bar.append(
    btn('👍', 'Helpful', () => submit(1)),
    btn('👎', 'Not helpful', () => {
      bar.textContent = '';
      const input = document.createElement('input');
      input.placeholder = 'What went wrong? (optional)';
      input.setAttribute('aria-label', 'What went wrong? (optional)');
      const go = btn('Send', 'Send feedback', () => submit(0, input.value.trim()));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
      bar.append(input, go);
      input.focus();
    }),
  );
  msgEl.insertAdjacentElement('afterend', bar);
}

$('chatForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = $('chatInput').value.trim();
  if (!q || !current) return;
  $('chatInput').value = '';
  chat.push({ role: 'user', content: q });
  addMsg('user', q);
  const pending = addMsg('assistant', 'Thinking…');
  $('chatSend').disabled = true;
  try {
    const r = await send({ type: 'JOB_CHAT', jobKey: current.jobKey, messages: chat });
    pending.textContent = r.reply;
    chat.push({ role: 'assistant', content: r.reply });
    if (r.traceId) addFeedback(pending, r.traceId, q, r.reply);
    if (r.resume) { renderResume({ status: 'processing', feedback: [] }); setTimeout(() => pollResume(current.jobKey), 1500); }
  } catch (e) {
    pending.textContent = errorText(e.message);
    chat.pop(); // drop the unanswered question so it can be asked again
  } finally {
    $('chatSend').disabled = false;
  }
});
$('chatInput').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('chatForm').requestSubmit(); }
});

chrome.storage.session.get('arjunPanelJob').then(({ arjunPanelJob }) => load(arjunPanelJob));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.arjunPanelJob) load(changes.arjunPanelJob.newValue);
});
