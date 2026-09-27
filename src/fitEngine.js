// Which engine answers the job-fit questions, and the free-model version of it.
//
//   user added their own TypeSafe key  → Jev, billed to the user
//   admin account (ADMIN_EMAIL)        → Jev with the server's key
//   everyone else                      → a free OpenRouter model, same questions and output shape
//
// The free engine asks the same questions (QUESTIONS / EVIDENCE in jev.js) and converts its
// answers into Jev's shape, so the popup, side panel, visa rule and insights work unchanged.

const { makeTrace, askJson, getPrompt, langfuse } = require('./llm');
const { assessJobFit, assessRequirements, buildJevRequest, compactProfile, fitResult, QUESTIONS, EVIDENCE } = require('./jev');

const FREE_MODEL_LABEL = 'free AI model (OpenRouter)';
const CONFIDENCE = { low: 0.45, medium: 0.7, high: 0.9 };
const conf = (c) => CONFIDENCE[String(c || '').toLowerCase()] ?? 0.45;

function questionsText() {
  return Object.entries(QUESTIONS).map(([id, q]) => {
    const kind = q.type === 'score' ? 'score' : q.type === 'choice' ? 'choice' : 'yes/no';
    const opts = q.type === 'score'
      ? q.criteria.map((c, i) => `  level ${i}: ${c}`).join('\n')
      : Object.entries(q.criteria).map(([k, v]) => `  ${q.type === 'noul' ? (k === 'true' ? 'yes' : 'no') : k}: ${v}`).join('\n');
    return `- id "${id}" (${kind}): ${q.instructions.replace(/`/g, '')}\n${opts}`;
  }).join('\n');
}

// Free-model answers → Jev answer shape.
function toJevAnswers(raw) {
  const out = {};
  for (const [id, q] of Object.entries(QUESTIONS)) {
    const r = raw?.[id] || {};
    if (q.type === 'score') {
      const max = q.criteria.length - 1;
      const level = Math.min(max, Math.max(0, Math.round(Number(r.level) || 0)));
      out[id] = {
        type: 'score', score: level, confidence: conf(r.confidence),
        legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])),
        probabilities: { [String(level)]: 1 },
      };
    } else if (q.type === 'choice') {
      const keys = Object.keys(q.criteria);
      // Unknown answers fall back to the most conservative option with low confidence.
      const safe = id === 'sponsorship' ? 'not_mentioned' : keys.includes('good_match') ? 'good_match' : keys[0];
      const choice = keys.includes(r.choice) ? r.choice : safe;
      out[id] = { type: 'choice', choice, confidence: keys.includes(r.choice) ? conf(r.confidence) : 0.3, probabilities: { [choice]: 1 } };
    } else {
      const c = conf(r.confidence);
      out[id] = { type: 'noul', noul: String(r.answer).toLowerCase() === 'yes' ? c : 1 - c };
    }
  }
  return out;
}

async function assessJobFitFree(profile, job, ctx = {}) {
  const { state } = buildJevRequest(profile, job);
  const trace = makeTrace('job_fit', ctx, { url: job.url || '', jobId: job.jobId || '', source: job.source || 'unknown', engine: 'openrouter', descriptionChars: state.job_posting.description.length });
  try {
    const { text: system, langfusePrompt } = await getPrompt('fit_check_free', {
      questions: questionsText(),
      candidate_json: JSON.stringify(state.candidate),
      job_json: JSON.stringify(state.job_posting),
    });
    const t0 = Date.now();
    const raw = await askJson(system, 'Answer the questions.', 'fit_check_free', trace, langfusePrompt, [], undefined, null, 1500);
    return fitResult(toJevAnswers(raw), FREE_MODEL_LABEL, Date.now() - t0, null);
  } finally {
    await langfuse.flushAsync().catch(() => {});
  }
}

async function assessRequirementsFree(profile, job, requirements, trace) {
  const { text: system, langfusePrompt } = await getPrompt('requirements_check_free', {
    requirements: requirements.map((r, i) => `${i + 1}. ${r.text}`).join('\n'),
    candidate_json: JSON.stringify(compactProfile(profile)),
    job_title: job.title || '', company: job.company || '',
  });
  const raw = await askJson(system, 'Judge each requirement.', 'requirements_check_free', trace, langfusePrompt, [], undefined, null, 1500);
  const byIndex = new Map((Array.isArray(raw?.results) ? raw.results : []).map(x => [Number(x.index), x]));
  return requirements.map((r, i) => {
    const x = byIndex.get(i + 1) || {};
    const evidence = Object.keys(EVIDENCE).includes(x.evidence) ? x.evidence : 'none';
    const confidence = Object.keys(EVIDENCE).includes(x.evidence) ? conf(x.confidence) : 0.3; // missing answer → "unsure"
    return { ...r, evidence, confidence, probabilities: { [evidence]: 1 } };
  });
}

// Decide per request. getUserJevKey returns the user's decrypted key or null.
async function resolveFitEngine({ userId, userEmail }, getUserJevKey) {
  const own = await getUserJevKey(userId).catch(() => null);
  if (own) return { engine: 'jev', apiKey: own, keySource: 'user' };
  const admin = process.env.ADMIN_EMAIL || 'arjun.resumeai@gmail.com';
  const owners = [admin, ...(process.env.JEV_OWNER_EMAILS || '').split(',')].map(e => e.trim().toLowerCase()).filter(Boolean);
  if (process.env.TYPESAFE_API_KEY && owners.includes(String(userEmail || '').toLowerCase())) {
    return { engine: 'jev', apiKey: process.env.TYPESAFE_API_KEY, keySource: 'owner' };
  }
  return { engine: 'openrouter' };
}

function assessFit(profile, job, ctx, engine) {
  return engine?.engine === 'jev' ? assessJobFit(profile, job, ctx, { apiKey: engine.apiKey }) : assessJobFitFree(profile, job, ctx);
}
function assessReqs(profile, job, requirements, trace, engine) {
  return engine?.engine === 'jev' ? assessRequirements(profile, job, requirements, trace, { apiKey: engine.apiKey }) : assessRequirementsFree(profile, job, requirements, trace);
}

module.exports = { resolveFitEngine, assessFit, assessReqs, assessJobFitFree, assessRequirementsFree, toJevAnswers, questionsText, FREE_MODEL_LABEL };
