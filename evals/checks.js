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

module.exports = { merge, extraction, skill, tailoring, coverLetter, formFill, numbers, overlap };
