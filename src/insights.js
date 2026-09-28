// Job insights for the extension side panel: what a job asks for, how the profile meets each
// requirement, and what to do about it.
//
//   extract_job_requirements (free model)  →  requirements + key terms
//   Jev, one choice question per requirement →  strong / partial / none, with confidence
//   code                                     →  wording check + action per requirement
//   explain_job_fit (free model)            →  summary, strengths, watch-outs, next steps
//
// Jev's labels are final; the written explanation may only explain them.

const { makeTrace, askJson, getPrompt, langfuse } = require('./llm');
const { compactProfile } = require('./jev');
const { assessReqs } = require('./fitEngine');

const MAX_REQUIREMENTS = 8;
const UNSURE_BELOW = 0.5; // Jev confidence under this → "unsure", the user judges it
// "none" keeps its label down to a lower confidence: in the eval, every "none" answer at
// 0.42-0.45 confidence matched the hand label (MLflow, retail), while "unsure" hid that.
const UNSURE_BELOW_NONE = 0.35;
const WORDING_OK_SHARE = 0.5; // share of a requirement's key terms the profile must already use

function cleanRequirements(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .map(r => ({
      text: String(r?.text || '').trim().slice(0, 160),
      level: r?.level === 'preferred' ? 'preferred' : 'required',
      keyTerms: (Array.isArray(r?.key_terms) ? r.key_terms : [])
        .map(t => String(t).trim()).filter(t => t.length > 1).slice(0, 3),
    }))
    .filter(r => r.text && !seen.has(r.text.toLowerCase()) && seen.add(r.text.toLowerCase()))
    .slice(0, MAX_REQUIREMENTS);
}

// A key term counts as present when every significant word of it appears in the profile
// (so "platform product management" matches a profile that says "platform" and "product management").
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ');
const stem = (w) => w.replace(/(ing|ers|er|es|s)$/, '');
function termPresent(term, profileText) {
  const words = norm(term).split(/\s+/).filter(w => w.length > 2 || /\d/.test(w));
  return words.length > 0 && words.every(w => profileText.includes(stem(w)));
}

function wording(req, profileText) {
  const present = req.keyTerms.filter(t => termPresent(t, profileText));
  const absent = req.keyTerms.filter(t => !present.includes(t));
  return { present, absent, share: req.keyTerms.length ? present.length / req.keyTerms.length : 1 };
}

// status drives the badge and the explanation: strong | wording_gap | partial | none | unsure
function statusFor(row) {
  if (row.confidence < (row.evidence === 'none' ? UNSURE_BELOW_NONE : UNSURE_BELOW)) return 'unsure';
  if (row.evidence === 'strong') return row.wording.share >= WORDING_OK_SHARE ? 'strong' : 'wording_gap';
  return row.evidence; // partial | none
}

async function extractRequirements(check, trace) {
  const { text: system, langfusePrompt } = await getPrompt('extract_job_requirements', {
    job_title: check.title || '',
    company: check.company || '',
    job_description: String(check.description || '').slice(0, 15000),
  });
  const out = await askJson(system, 'Extract the requirements.', 'extract_job_requirements', trace, langfusePrompt, [], undefined, null, 2000);
  const reqs = cleanRequirements(out.requirements);
  if (reqs.length < 2) throw new Error('could not extract requirements from this posting');
  return reqs;
}

async function explain(check, profile, rows, trace) {
  const fit = check.fit || {};
  const fitSummary = fit.overallFit
    ? `overall ${fit.overallFit.percent}% (${fit.overallFit.label}, confidence ${Math.round(fit.overallFit.confidence * 100)}%); skills ${fit.skills?.percent}%; domain ${fit.domain?.percent}% (${fit.domain?.label}); seniority ${fit.seniority?.value}`
    : 'not available';
  const { text: system, langfusePrompt } = await getPrompt('explain_job_fit', {
    job_title: check.title || '',
    company: check.company || '',
    fit_summary: fitSummary,
    requirements_json: JSON.stringify(rows.map(r => ({
      requirement: r.text, level: r.level, status: r.status,
      confidence: Math.round(r.confidence * 100) / 100,
      job_terms_missing_from_profile: r.wording.absent,
    }))),
    profile_json: JSON.stringify(compactProfile(profile)),
    job_description: String(check.description || '').slice(0, 8000),
  });
  const out = await askJson(system, 'Write the analysis.', 'explain_job_fit', trace, langfusePrompt, [], undefined, null, 3000);
  const list = (v) => (Array.isArray(v) ? v : []);
  return enforceLabels(rows, {
    summary: String(out.summary || '').trim(),
    strengths: list(out.strengths).filter(s => s?.requirement && s?.evidence),
    watchOuts: list(out.watch_outs).filter(w => w?.requirement && (w?.why || w?.what_to_do)),
    nextSteps: list(out.next_steps).map(String).filter(Boolean).slice(0, 3),
  });
}

// Jev's labels are final, so the written analysis can't contradict them: a "strength" must be a
// strong requirement, and every weaker requirement gets a watch-out even if the model skipped it.
const words = (s) => new Set(norm(s).split(/\s+/).filter(w => w.length > 2));
function rowFor(rows, text) {
  const a = words(text);
  let best = null, bestScore = 0;
  for (const r of rows) {
    const b = words(r.text);
    const shared = [...a].filter(w => b.has(w)).length;
    const score = shared / Math.max(1, Math.min(a.size, b.size));
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 0.5 ? best : null;
}
const FALLBACK = {
  none: { why: 'Nothing in your profile shows this.', what_to_do: 'If you have done this, add it to your profile; otherwise treat it as a stretch.' },
  partial: { why: 'Your profile shows related experience, but not this exactly.', what_to_do: 'Lead with your closest related work when you describe your experience.' },
  unsure: { why: "Arjun couldn't tell from your profile.", what_to_do: 'Judge this one yourself against your experience.' },
  wording_gap: { why: 'You have this, but your profile describes it in different words than the job.', what_to_do: "Use the job's terms when you describe this experience." },
};
// Eligibility (visa, citizenship, clearance, work authorization) is the popup's separate check,
// so the written analysis never discusses it: drop any sentence that does.
const ELIGIBILITY = /visa|sponsor|h-1b|citizen|green card|clearance|work authori[sz]|immigration/i;
const dropEligibility = (text) => String(text || '').split(/(?<=[a-z0-9)%\]+#][.!?])\s+/).filter(t => !ELIGIBILITY.test(t)).join(' ').trim();

function enforceLabels(rows, x) {
  x = {
    ...x,
    summary: dropEligibility(x.summary),
    strengths: x.strengths.map(s => ({ ...s, evidence: dropEligibility(s.evidence) })).filter(s => s.evidence && !ELIGIBILITY.test(s.requirement)),
    watchOuts: x.watchOuts.map(w => ({ ...w, why: dropEligibility(w.why), what_to_do: dropEligibility(w.what_to_do) })).filter(w => !ELIGIBILITY.test(w.requirement) && (w.why || w.what_to_do)),
    nextSteps: x.nextSteps.map(dropEligibility).filter(Boolean),
  };
  const strengths = x.strengths.filter(s => ['strong', 'wording_gap'].includes(rowFor(rows, s.requirement)?.status)).slice(0, 4);
  const watchOuts = x.watchOuts.filter(w => rowFor(rows, w.requirement)?.status !== 'strong');
  for (const r of rows) {
    if (r.status === 'strong' || watchOuts.some(w => rowFor([r], w.requirement))) continue;
    const f = FALLBACK[r.status];
    watchOuts.push({ requirement: r.text, why: r.status === 'wording_gap' && r.wording?.absent?.length ? `${f.why} The job says: ${r.wording.absent.join(', ')}.` : f.why, what_to_do: f.what_to_do });
  }
  const rank = { none: 0, partial: 1, unsure: 2, wording_gap: 3 };
  const levelRank = (w) => (rowFor(rows, w.requirement)?.level === 'required' ? 0 : 1);
  watchOuts.sort((a, b) => levelRank(a) - levelRank(b) || (rank[rowFor(rows, a.requirement)?.status] ?? 9) - (rank[rowFor(rows, b.requirement)?.status] ?? 9));
  return { ...x, strengths, watchOuts: watchOuts.slice(0, 8) };
}

// onStage(stage, partial) lets the caller expose progress while this runs.
// engine: from fitEngine.resolveFitEngine (Jev with the user's key, or the free model).
async function analyzeJob(profile, check, ctx = {}, onStage = () => {}, engine = null) {
  const trace = makeTrace('job_insights', ctx, { url: check.url || '', jobKey: check.job_key, title: check.title, company: check.company });
  const job = { title: check.title, company: check.company, url: check.url, text: check.description };
  try {
    onStage('requirements');
    const reqs = await extractRequirements(check, trace);

    onStage('matching');
    const assessed = await assessReqs(profile, job, reqs, trace, engine);
    const profileText = norm(JSON.stringify(compactProfile(profile)));
    const rows = assessed.map(r => {
      const row = { ...r, wording: wording(r, profileText) };
      return { ...row, status: statusFor(row) };
    });
    const counts = rows.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {});
    onStage('explaining', { requirements: rows, counts });

    const explanation = await explain(check, profile, rows, trace);
    trace.update({ output: { counts, explanation } });
    return { requirements: rows, counts, explanation, traceId: trace.id, generatedAt: new Date().toISOString() };
  } finally {
    await langfuse.flushAsync().catch(() => {});
  }
}

// Follow-up chat in the side panel. Stateless: the panel sends the recent turns each time and
// nothing is stored (chat messages are never persisted). Context is the saved Jev analysis.
async function chatAboutJob(profile, check, analysis, messages, ctx = {}, resumeState = 'No resume has been made for this job yet.') {
  const trace = makeTrace('job_fit_chat', ctx, { jobKey: check.job_key, title: check.title, company: check.company });
  try {
    const turns = (Array.isArray(messages) ? messages : [])
      .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-8)
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
    const last = turns.pop();
    if (!last || last.role !== 'user') throw Object.assign(new Error('no_question'), { status: 400 });
    const { text: system, langfusePrompt } = await getPrompt('job_fit_chat', {
      job_title: check.title || '',
      company: check.company || '',
      analysis_json: JSON.stringify({
        fit: check.fit ? { overall: check.fit.overallFit, skills: check.fit.skills, domain: check.fit.domain, seniority: check.fit.seniority } : null,
        requirements: (analysis.requirements || []).map(r => ({ requirement: r.text, level: r.level, status: r.status, confidence: r.confidence })),
        summary: analysis.explanation?.summary, strengths: analysis.explanation?.strengths, watch_outs: analysis.explanation?.watchOuts,
      }),
      profile_json: JSON.stringify(compactProfile(profile)),
      job_description: String(check.description || '').slice(0, 8000),
      resume_state: resumeState,
    });
    const out = await askJson(system, last.content, 'job_fit_chat', trace, langfusePrompt, turns, undefined, null, 1200);
    const reply = String(out.reply || '').trim();
    if (!reply) throw new Error('empty reply');
    const action = ['tailor_resume', 'revise_resume'].includes(out.action) ? out.action : 'none';
    const feedback = String(out.feedback || '').trim().slice(0, 500);
    trace.update({ output: { reply, action, feedback } });
    return { reply, action, feedback, coverLetter: out.cover_letter === true, traceId: trace.id };
  } finally {
    await langfuse.flushAsync().catch(() => {});
  }
}

module.exports = { analyzeJob, chatAboutJob, explain, enforceLabels, cleanRequirements, statusFor, wording, termPresent };
