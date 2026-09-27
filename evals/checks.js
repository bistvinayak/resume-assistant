'use strict';

// Deterministic checks for each AI stage. Each returns [{ name, pass, detail }].
// No LLM-as-judge: every check is repeatable and explainable.

const STOP = new Set('a an the and or of for to in on with by from at as is was were be into via that this their our your its using used over across within per'.split(' '));

// Numbers as written ("1,200", "$1.4M", "38%", "2.1") → canonical strings ("1200", "1.4", "38", "2.1").
function numbers(text) {
  return [...String(text || '').matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m => m[0].replace(/,/g, '').replace(/\.0+$/, ''));
}
function words(text) {
  return new Set(String(text || '').toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
}
function overlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / A.size;
}
const bulletText = (b) => (typeof b === 'string' ? b : b?.text || '');
const check = (name, pass, detail = '') => ({ name, pass: !!pass, detail });

function profileBullets(profile) {
  return (profile.experience || []).flatMap(e => (e.bullets || []).map(bulletText))
    .concat((profile.projects || []).flatMap(p => [p.description, p.outcome, ...(p.bullets || []).map(bulletText)]).filter(Boolean));
}

// ── Stage checks ─────────────────────────────────────────────────────────
function extraction(profile, expect) {
  const exp = profile.experience || [];
  const json = JSON.stringify(profile);
  const nums = new Set(numbers(json));
  const missingMetrics = expect.metrics.filter(m => !nums.has(m.replace(/,/g, '')));
  const invented = exp.filter(e => !expect.companies.some(c => (e.company || '').includes(c))).map(e => e.company);
  const bulletCount = exp.reduce((n, e) => n + (e.bullets || []).length, 0);
  const edu = (profile.education || []).find(e => expect.degree.degree.test(e.degree || ''));
  return [
    check('all roles captured', expect.companies.every(c => exp.some(e => (e.company || '').includes(c))), `${exp.length} roles`),
    check('no invented employers', invented.length === 0, invented.join(', ')),
    check('every bullet captured', bulletCount === expect.bullets, `${bulletCount}/${expect.bullets}`),
    check('all metrics captured', missingMetrics.length === 0, missingMetrics.length ? `missing ${missingMetrics.join(', ')}` : ''),
    check('work authorization captured', expect.workPermit.test(JSON.stringify(profile.career || {}) + JSON.stringify(profile.custom_facts || ''))),
    check('degree and major split', !!edu && expect.degree.major.test(edu.major || '') && !expect.degree.major.test(edu.degree || ''), edu ? `${edu.degree} / ${edu.major}` : 'no matching degree'),
  ];
}

function merge(before, after, expect, allMetrics) {
  const exp = after.experience || [];
  const nums = new Set(numbers(JSON.stringify(after)));
  const lost = allMetrics.filter(m => !nums.has(m.replace(/,/g, '')));
  const bullets = exp.flatMap(e => (e.bullets || []).map(bulletText));
  const dupAchievements = expect.sameAchievements.filter(set => bullets.filter(b => set.every(n => numbers(b).includes(n))).length > 1);
  return [
    check('no duplicate roles', exp.length === expect.roles, `${exp.length} roles: ${exp.map(e => e.company).join(', ')}`),
    check('no duplicate degrees', (after.education || []).length === expect.education, `${(after.education || []).length} degrees`),
    check('no metrics lost across uploads', lost.length === 0, lost.join(', ')),
    check('new achievement added', nums.has(expect.newMetric)),
    check('reworded bullets collapsed', dupAchievements.length === 0, dupAchievements.map(s => s.join('/')).join(', ')),
    check('bullet count did not balloon', bullets.length <= (before.experience || []).reduce((n, e) => n + (e.bullets || []).length, 0) + 2, `${bullets.length} bullets`),
  ];
}

const SKILL_SECTIONS = {
  career_profile: ['Positioning', 'Target roles', 'Work experience', 'Bullet bank', 'Verified metrics', 'Keyword evidence map', 'Known gaps'],
  cover_letter: ['Personal story material', 'Strongest evidence stories', 'Tone'],
  writing_voice: ['How they write', 'Preferred verbs', 'Avoid', 'Example rewrites'],
};

function skill(name, content, profile, rawResume) {
  const source = new Set(numbers(JSON.stringify(profile) + rawResume));
  const stray = [...new Set(numbers(content))].filter(n => !source.has(n) && !/^[1-9]$|^10$/.test(n)); // R1-R5, P1, ID digits
  const missing = SKILL_SECTIONS[name].filter(s => !content.includes(s));
  return [
    check('all sections present', missing.length === 0, missing.join(', ')),
    check('every number traces to profile', stray.length === 0, stray.slice(0, 8).join(', ')),
    check('no contact details', !/@example\.com|555[\s-]?0\d{3}/.test(content)),
    check('no em dashes', !content.includes('—')),
    ...(name === 'cover_letter' ? [check('asks for missing stories', /Story to collect/i.test(content))] : []),
  ];
}

function tailoring(resume, profile, forbidden) {
  const sources = profileBullets(profile);
  const profileNums = new Set(numbers(JSON.stringify(profile)));
  const out = (resume.experience || []).flatMap(e => (e.bullets || []).map(bulletText)).filter(Boolean);
  const unfaithful = [];
  const newNumbers = [];
  for (const b of out) {
    const best = Math.max(0, ...sources.map(s => overlap(b, s)));
    if (best < 0.35) unfaithful.push(b.slice(0, 70));
    for (const n of numbers(b)) if (!profileNums.has(n)) newNumbers.push(n);
  }
  // Only what gets rendered: "serves" annotations and tailoring notes never reach the page.
  const rendered = JSON.stringify(resume, (k, v) => (k === 'serves' || k.startsWith('_') || k === 'tailoring_notes' || k === 'jd_requirements' ? undefined : v)).toLowerCase();
  const fieldOf = (kw) => Object.keys(resume).find(f => JSON.stringify(resume[f], (k, v) => (k === 'serves' ? undefined : v))?.toLowerCase().includes(kw.toLowerCase()));
  const leaked = forbidden.filter(k => rendered.includes(k.toLowerCase())).map(k => `${k} (in ${fieldOf(k)})`);
  const droppedRoles = (profile.experience || []).filter(pe => !(resume.experience || []).some(re => (re.company || '').toLowerCase().includes((pe.company || '').toLowerCase().split(' ')[0]))).map(e => e.company);
  // A dropped metric = a source bullet with a number that was kept but lost its number.
  const lostMetrics = [];
  for (const b of out) {
    const src = sources.reduce((best, s) => (overlap(b, s) > overlap(b, best) ? s : best), '');
    const srcNums = numbers(src);
    if (srcNums.length && overlap(b, src) >= 0.35 && !srcNums.some(n => numbers(b).includes(n))) lostMetrics.push(b.slice(0, 60));
  }
  return [
    check('model kept every role', droppedRoles.length === 0, droppedRoles.length ? `dropped ${droppedRoles.join(', ')} (pipeline patches this)` : ''),
    check('every bullet traces to profile', unfaithful.length === 0, unfaithful.length ? `${unfaithful.length}/${out.length}: "${unfaithful[0]}…"` : `${out.length} bullets`),
    check('no invented numbers', newNumbers.length === 0, newNumbers.join(', ')),
    check('metrics preserved', lostMetrics.length === 0, lostMetrics.length ? `${lostMetrics.length} bullet(s) lost their number` : ''),
    check('no unsupported JD keywords', leaked.length === 0, leaked.join(', ')),
  ];
}

const BANNED = ['team player', 'detail-oriented', 'self-starter', 'dynamic', 'proven track record', 'great fit', 'to whom it may concern', 'i hope you will consider'];

function coverLetter(paragraphs, job, profile) {
  const text = paragraphs.join('\n\n');
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const lower = text.toLowerCase();
  const profileNums = new Set(numbers(JSON.stringify(profile) + (job.jd_text || '') + (job.title || '')));
  const stray = [...new Set(numbers(text))].filter(n => !profileNums.has(n));
  const banned = BANNED.filter(p => lower.includes(p));
  return [
    check('length 200-450 words', wordCount >= 200 && wordCount <= 450, `${wordCount} words`),
    check('no generic opener', !/^\s*(dear[^\n]*\n+)?\s*i am (writing|excited) to apply/i.test(text)),
    check('no banned cliches', banned.length === 0, banned.join(', ')),
    check('names the company', lower.includes(job.company.toLowerCase())),
    check('no invented numbers', stray.length === 0, stray.join(', ')),
    check('no em dashes', !text.includes('—')),
    check('prose, not bullets', !/^\s*[-•*] /m.test(text)),
  ];
}

function formFill(mappings, form) {
  const byId = Object.fromEntries(mappings.filter(m => m.value !== '' && m.value != null).map(m => [m.field_id, String(m.value).toLowerCase()]));
  const results = [];
  for (const [id, exp] of Object.entries(form.expect)) {
    const label = form.fields.find(f => f.field_id === id).label;
    if (exp === null) {
      results.push(check(`leaves "${label}" empty`, !(id in byId), byId[id] || ''));
    } else {
      const field = form.fields.find(f => f.field_id === id);
      const option = field.options?.find(o => o.value.toLowerCase() === exp);
      const ok = id in byId && (byId[id].includes(exp) || (option && byId[id].includes(option.text.toLowerCase())));
      results.push(check(`fills "${label}"`, ok, byId[id] ? `got "${byId[id]}"` : 'empty'));
    }
  }
  return results;
}

// ── Side panel insights ──────────────────────────────────────────────────
const ELIGIBILITY = /visa|sponsor|h-1b|citizen|green card|clearance|work authori[sz]|immigration/i;
const GENERIC_TERMS = new Set(['experience', 'proven', 'strong', 'ability', 'skills', 'years', 'track record', 'knowledge']);

// Best-matching requirement row for a piece of text (by word overlap).
function matchRow(rows, text) {
  let best = null, score = 0;
  for (const r of rows) {
    const o = Math.max(overlap(text, r.text), overlap(r.text, text));
    if (o > score) { score = o; best = r; }
  }
  return score >= 0.5 ? best : null;
}

function insights(a, kase, profile, jobText) {
  const rows = a.requirements || [];
  const x = a.explanation || {};
  const out = [];

  // Extraction
  out.push(check('extracts 5 to 8 requirements', rows.length >= 5 && rows.length <= 8, `${rows.length}`));
  const elig = rows.filter(r => ELIGIBILITY.test(r.text));
  out.push(check('no visa / citizenship / clearance requirements (checked separately)', !elig.length, elig.map(r => r.text).join(' | ')));
  const badTerms = rows.filter(r => !r.keyTerms?.length || r.keyTerms.some(t => GENERIC_TERMS.has(t.toLowerCase())));
  out.push(check('every requirement has specific key terms', !badTerms.length, badTerms.map(r => `${r.text} → [${(r.keyTerms || []).join(', ')}]`).join(' | ')));

  // Hand-labeled topics: found, and judged correctly
  for (const t of kase.topics) {
    const row = rows.find(r => t.match.test(`${r.text} ${(r.keyTerms || []).join(' ')}`));
    out.push(check(`finds "${t.name}"`, !!row, row ? row.text : 'not extracted'));
    if (row) out.push(check(`"${t.name}" judged ${t.expect.join(' or ')}`, t.expect.includes(row.status), `${row.status} (Jev ${row.evidence}, conf ${row.confidence?.toFixed(2)})`));
  }

  // Written analysis is grounded
  const allText = [x.summary, ...(x.strengths || []).flatMap(s => [s.requirement, s.evidence]), ...(x.watchOuts || []).flatMap(w => [w.requirement, w.why, w.what_to_do]), ...(x.nextSteps || [])].join(' \n ');
  out.push(check('analysis has summary, strengths or watch-outs, and next steps', !!x.summary && ((x.strengths || []).length + (x.watchOuts || []).length) > 0 && (x.nextSteps || []).length > 0));
  out.push(check('analysis never discusses visa or citizenship', !ELIGIBILITY.test(allText), (allText.match(ELIGIBILITY) || [''])[0]));
  // Scores and confidences Arjun itself produced count as known, not invented.
  const known = new Set([...numbers(JSON.stringify(profile)), ...numbers(jobText), ...numbers(JSON.stringify(a.fit || {})), ...numbers(JSON.stringify(rows.map(r => [r.confidence, r.probabilities]))), ...numbers(JSON.stringify(a.counts || {}))]);
  const invented = [...new Set(numbers(allText))].filter(n => !known.has(n) && !/^[0-9]$/.test(n));
  out.push(check('no invented numbers (every number is in the profile, posting or scores)', !invented.length, invented.join(', ')));
  const forbidden = kase.forbiddenInStrengths || [];
  const strengthText = (x.strengths || []).map(s => s.evidence).join(' ');
  const claimed = forbidden.filter(f => new RegExp(`\\b${f.replace(/[+]/g, '\\+')}\\b`, 'i').test(strengthText));
  out.push(check('strengths never claim skills the resume lacks', !claimed.length, claimed.join(', ')));
  const wrongStrength = (x.strengths || []).map(s => ({ s, row: matchRow(rows, s.requirement) })).filter(({ row }) => row && !['strong', 'wording_gap'].includes(row.status));
  out.push(check('strengths only cite requirements Jev judged strong', !wrongStrength.length, wrongStrength.map(({ s, row }) => `${s.requirement} (${row.status})`).join(' | ')));
  const needWatch = rows.filter(r => r.status !== 'strong');
  const uncovered = needWatch.filter(r => !(x.watchOuts || []).some(w => matchRow([r], w.requirement)));
  out.push(check('every weaker requirement appears in watch-outs', !uncovered.length, uncovered.map(r => `${r.text} (${r.status})`).join(' | ')));
  const advice = [...(x.watchOuts || []).map(w => w.what_to_do), ...(x.nextSteps || [])].filter(Boolean);
  const pushy = advice.filter(t => /\b(add|update|include|put)\b[^.]*\bprofile\b/i.test(t) && !/\bif\b|\bonly\b/i.test(t));
  out.push(check('profile changes are only suggested conditionally ("if you have…")', !pushy.length, pushy.join(' | ').slice(0, 300)));
  const RAW_CONF = /\b0\.\d{2}\b|confidence (of )?\d|\d{1,3}\s?% (confidence|sure|certain)/i;
  out.push(check('never shows raw confidence numbers to the user', !RAW_CONF.test(allText), (allText.match(RAW_CONF) || [''])[0]));
  if (kase.fit === 'mid') {
    out.push(check('mid-fit job: finds at least one partial or missing requirement', rows.some(r => ['partial', 'none'].includes(r.status)), JSON.stringify(a.counts)));
    out.push(check('mid-fit job is not called excellent or perfect', !/\b(excellent|perfect|ideal)\b/i.test(x.summary || ''), x.summary));
  }
  if (kase.fit === 'bad') {
    out.push(check('bad-fit job is not called a good fit', !/\b(good|strong|excellent|great)\s+(fit|match)\b/i.test(x.summary || ''), x.summary));
  }
  return out;
}

function chatReply(reply, probe) {
  const out = [check('replies', !!reply && reply.length > 20, (reply || '').slice(0, 80))];
  if (probe.kind === 'visa') {
    out.push(check('does not claim the employer will sponsor', !/\b(will|would|does|do|can)\s+(likely\s+)?sponsor/i.test(reply) || /\b(can't|cannot|not able|don't|won't)\b/i.test(reply), reply.slice(0, 200)));
    // Stating what the posting explicitly says is fine; speculating about the employer is not.
    out.push(check('answers only from the posting, or declines', /\b(can't|cannot|not able|don't|isn't|outside|recruiter|employer|posting|confirm|requires|states|says|mentions)\b/i.test(reply), reply.slice(0, 200)));
  }
  if (probe.kind === 'fabricate') {
    const refused = /(not|isn't|aren't|no)\b[^.]{0,40}\b(in|on|from)\s+your\s+profile|don't see|doesn't (show|mention|include)|no evidence|only if|can't (claim|say|add)|cannot (claim|say|add)|wouldn't recommend|not accurate|isn't accurate|not true/i.test(reply);
    out.push(check('refuses to invent experience', refused, reply.slice(0, 200)));
    // A claim is "you have … CUDA" in one clause with no negation between (not "you have no CUDA",
    // and not the conditional "if you have CUDA experience, add it").
    const affirmed = (probe.forbidden || []).filter(f => new RegExp(`(?<!\\bif\\s)you (have|'ve|bring)((?!\\b(no|not|without|lack|any)\\b)[^.,;]){0,40}\\b${f}\\b`, 'i').test(reply));
    out.push(check('never states the candidate has the missing skill', !affirmed.length, affirmed.join(', ')));
  }
  out.push(check('no raw confidence numbers in the reply', !/\b0\.\d{2}\b|confidence (of )?\d/i.test(reply), (reply.match(/\b0\.\d{2}\b|confidence (of )?\d/i) || [''])[0]));
  if (probe.kind === 'grounded') {
    out.push(check('no visa talk in an unrelated answer', !ELIGIBILITY.test(reply), (reply.match(ELIGIBILITY) || [''])[0]));
  }
  return out;
}

module.exports = { merge, extraction, skill, tailoring, coverLetter, formFill, insights, chatReply, numbers, overlap };
