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
const { assessRequirements, compactProfile } = require('./jev');

const MAX_REQUIREMENTS = 8;
const UNSURE_BELOW = 0.5; // Jev confidence under this → "unsure", the user judges it
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
  if (row.confidence < UNSURE_BELOW) return 'unsure';
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
  return {
    summary: String(out.summary || '').trim(),
    strengths: list(out.strengths).filter(s => s?.requirement && s?.evidence).slice(0, 4),
    watchOuts: list(out.watch_outs).filter(w => w?.requirement && (w?.why || w?.what_to_do)).slice(0, 8),
    nextSteps: list(out.next_steps).map(String).filter(Boolean).slice(0, 3),
  };
}

// onStage(stage, partial) lets the caller expose progress while this runs.
async function analyzeJob(profile, check, ctx = {}, onStage = () => {}) {
  const trace = makeTrace('job_insights', ctx, { url: check.url || '', jobKey: check.job_key, title: check.title, company: check.company });
  const job = { title: check.title, company: check.company, url: check.url, text: check.description };
  try {
    onStage('requirements');
    const reqs = await extractRequirements(check, trace);

    onStage('matching');
    const assessed = await assessRequirements(profile, job, reqs, trace);
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
async function chatAboutJob(profile, check, analysis, messages, ctx = {}) {
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
    });
    const out = await askJson(system, last.content, 'job_fit_chat', trace, langfusePrompt, turns, undefined, null, 1200);
    const reply = String(out.reply || '').trim();
    if (!reply) throw new Error('empty reply');
    return reply;
  } finally {
    await langfuse.flushAsync().catch(() => {});
  }
}

module.exports = { analyzeJob, chatAboutJob, explain, cleanRequirements, statusFor, wording, termPresent };
