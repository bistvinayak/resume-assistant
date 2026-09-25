'use strict';

// End-to-end AI eval for Arjun. Runs the real prompts (pulled from Langfuse, as production
// does) and real model calls on synthetic fixtures, then scores every stage with
// deterministic checks.
//
//   npm run eval                     # free models (Nemotron), all stages
//   npm run eval -- --models=prod    # whatever OPENROUTER_* env vars / defaults production uses
//   npm run eval -- --only=extract,visa,form
//
// Writes evals/results/<run-id>/{report.md,results.json}. Never touches the database:
// db.js is replaced with in-memory stubs before anything loads it.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const MODELS = args.models || 'free';
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const want = (stage) => !ONLY || ONLY.has(stage);
const RUN_ID = `eval-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (MODELS === 'free') {
  const FREE = 'nvidia/nemotron-3-super-120b-a12b:free';
  process.env.OPENROUTER_MODEL = FREE;
  process.env.OPENROUTER_WRITING_MODEL = FREE;
  process.env.OPENROUTER_FORM_FILL_MODEL = FREE;
  process.env.OPENROUTER_FORM_FILL_FALLBACK_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
}

// ── Stub the database so evals never read or write it ─────────────────────
let memProfile = null;
const dbPath = require.resolve('../src/db');
const noop = async () => {};
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  // In-memory profile for the merge stage (upload, then upload a reworded version).
  exports: new Proxy({
    profileEvents: new EventEmitter(), getApprovedCategories: async () => [], EMPTY_PROFILE: {},
    getProfile: async () => {
      const p = memProfile ? JSON.parse(JSON.stringify(memProfile)) : { contact: {}, summary: '', skills: [], experience: [], projects: [], education: [], certifications: [], languages: [], activities: [], interests: [], custom_facts: [], custom_sections: [], self_identification: {} };
      p._onboarded = !!memProfile;
      return p;
    },
    saveProfile: async (p) => { memProfile = JSON.parse(JSON.stringify(p)); return p; },
  }, {
    get: (t, k) => (k in t ? t[k] : noop),
  }),
};

const { extractFacts, tailorResume, calculateAtsScore, improveResume, coverLetter, createJobTrace, mapFormFields, generateSkill, langfuse } = require('../src/llm');
const { assessJobFit } = require('../src/jev');
const { ingestText } = require('../src/profile');
const { dropUntraceableBullets } = require('../src/pipeline');
const { profileForSkill, composeSkill, SKILL_NAMES } = require('../src/skills');
const fx = require('./fixtures');
const C = require('./checks');

const ctx = { userId: 'eval-harness', sessionId: RUN_ID };
const results = [];   // { stage, subject, checks[], ms, error }
const timings = {};

async function timed(stage, fn) {
  const t0 = Date.now();
  try { return await fn(); }
  finally { (timings[stage] ??= []).push(Date.now() - t0); }
}
async function retry(fn, attempts = 2) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { last = e; }
  }
  throw last;
}
function record(stage, subject, checks, extra = {}) {
  results.push({ stage, subject, checks, ...extra });
  const passed = checks.filter(c => c.pass).length;
  const mark = extra.error ? '✗' : passed === checks.length ? '✓' : '△';
  console.log(`${mark} ${stage.padEnd(14)} ${subject.padEnd(34)} ${extra.error ? 'ERROR ' + extra.error.slice(0, 90) : `${passed}/${checks.length}`}`);
}
function recordError(stage, subject, e) {
  record(stage, subject, [{ name: 'ran without error', pass: false, detail: e.message.slice(0, 200) }], { error: e.message });
}
async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

(async () => {
  console.log(`Arjun eval ${RUN_ID} · models: ${MODELS === 'free' ? 'free (Nemotron)' : 'production config'}\n`);
  const t0 = Date.now();
  const profiles = {};
  const skills = {};

  // 1. Profile extraction
  await Promise.all(Object.entries(fx.candidates).map(async ([key, c]) => {
    try {
      const p = await timed('extract', () => retry(() => extractFacts(c.resume, ctx)));
      delete p._ambiguities;
      profiles[key] = p;
      if (want('extract')) record('extract', key, C.extraction(p, c.expect));
    } catch (e) { recordError('extract', key, e); }
  }));

  // 1b. Second upload merges into the first without duplicating (the path that broke at 3+ uploads)
  if (want('merge')) {
    try {
      memProfile = null;
      const first = await timed('merge', () => retry(() => ingestText(fx.candidates.priya.resume, 'eval-merge', ctx)));
      const before = JSON.parse(JSON.stringify(first));
      const after = await timed('merge', () => retry(() => ingestText(fx.priyaV2.resume, 'eval-merge', ctx)));
      record('merge', 'priya v1 → reworded v2', C.merge(before, after, fx.priyaV2.expect, [...fx.candidates.priya.expect.metrics, '300']));
    } catch (e) { recordError('merge', 'priya v1 → reworded v2', e); }
  }

  // 2. Per-user skills
  if (want('skills') || want('pipeline')) {
    await Promise.all(Object.keys(profiles).map(async (key) => {
      skills[key] = {};
      await Promise.all(SKILL_NAMES.map(async (name) => {
        try {
          const { content, model } = await timed('skills', () => generateSkill(name, profileForSkill(profiles[key]), null, ctx));
          skills[key][name] = composeSkill(name, { content });
          if (want('skills')) record('skills', `${key} / ${name}`, C.skill(name, content, profiles[key], fx.candidates[key].resume), { model });
        } catch (e) { recordError('skills', `${key} / ${name}`, e); }
      }));
    }));
  }

  // 3. Resume + cover letter pipeline (mirrors pipeline.js processJob, minus rendering)
  const atsByPair = {};
  if (want('pipeline')) {
    await pool(fx.pairs.filter(p => profiles[p.candidate]), 2, async (pair) => {
      const profile = profiles[pair.candidate];
      const job = { ...fx.jobs[pair.job], job_id: `${RUN_ID}-${pair.job}` };
      const label = `${pair.candidate} → ${pair.job}`;
      const trace = createJobTrace(job, ctx);
      const userSkills = skills[pair.candidate] && Object.values(skills[pair.candidate]).some(Boolean) ? skills[pair.candidate] : null;
      let resume;
      try {
        const t = await timed('tailor', () => retry(() => tailorResume(profile, job, trace, null, userSkills)));
        const { tailoring_notes: notes = [], jd_requirements: reqs = [] } = t;
        delete t.tailoring_notes; delete t.jd_requirements;
        resume = t;
        // Score the raw model output (model quality), then apply production's invented-bullet guard.
        const rawBullets = (resume.experience || []).flatMap(e => (e.bullets || []).map(b => (typeof b === 'string' ? b : b.text)));
        const dropped = dropUntraceableBullets(JSON.parse(JSON.stringify(resume)), profile);
        record('tailor', label, C.tailoring(resume, profile, pair.forbidden), { rawBullets, guardDropped: dropped });
        dropUntraceableBullets(resume, profile);
        if (dropped.length) console.log(`  (guard dropped ${dropped.length} untraceable bullet(s) for ${label})`);

        let ats = await timed('ats', () => retry(() => calculateAtsScore(resume, job, trace)));
        const initial = ats.score;
        let improved = false;
        if (ats.score > 0 && ats.score < 95) {
          try {
            const r = await timed('improve', () => improveResume(resume, job, ats, trace, notes, reqs, userSkills));
            const candidate = r.resume || r;
            dropUntraceableBullets(candidate, profile);
            const ats2 = await timed('ats', () => calculateAtsScore(candidate, job, trace));
            if (ats2.score > ats.score) { resume = candidate; ats = ats2; improved = true; }
          } catch (e) { console.log(`  (improve pass failed for ${label}: ${e.message.slice(0, 80)})`); }
        }
        atsByPair[label] = { initial, final: ats.score, improved, fit: pair.fit, candidate: pair.candidate };
        if (improved) record('improve', label, C.tailoring(resume, profile, pair.forbidden), { ats: `${initial} → ${ats.score}` });
      } catch (e) { recordError('tailor', label, e); return; }

      try {
        const paragraphs = await timed('cover_letter', () => retry(() => coverLetter(resume, job, trace, profile, userSkills), 1));
        record('cover_letter', label, C.coverLetter(paragraphs, job, profile), { sample: paragraphs[0]?.slice(0, 220), paragraphs });
      } catch (e) { recordError('cover_letter', label, e); }
    });

    // Good-fit jobs should score higher than the bad-fit job for the same candidate.
    const orderChecks = [];
    for (const cand of Object.keys(fx.candidates)) {
      const mine = Object.entries(atsByPair).filter(([, v]) => v.candidate === cand);
      const good = mine.filter(([, v]) => v.fit === 'good');
      const bad = mine.filter(([, v]) => v.fit === 'bad');
      for (const [g, gv] of good) for (const [b, bv] of bad) orderChecks.push({ name: `ATS ranks ${g} above ${b}`, pass: gv.final > bv.final, detail: `${gv.final} vs ${bv.final}` });
    }
    if (orderChecks.length) record('ats', 'fit ordering', orderChecks, { scores: atsByPair });
  }

  // 4. Jev: visa verdicts + fit ordering
  if (want('visa') && profiles.priya) {
    const visaChecks = await Promise.all(fx.visaCases.map(async (vc) => {
      try {
        const r = await timed('jev', () => assessJobFit(profiles.priya, { title: 'Senior PM', text: fx.visaBase + vc.text }));
        return { name: `${vc.name} → ${vc.expect}`, pass: r.visa.status === vc.expect, detail: `${r.visa.status} (${r.visa.reason}, ${r.visa.confidence.toFixed(2)})` };
      } catch (e) { return { name: `${vc.name} → ${vc.expect}`, pass: false, detail: e.message.slice(0, 120) }; }
    }));
    record('jev_visa', 'labeled postings', visaChecks);

    const fitChecks = [];
    for (const cand of Object.keys(profiles)) {
      const mine = fx.pairs.filter(p => p.candidate === cand);
      const scores = {};
      for (const p of mine) {
        try { scores[p.job] = (await timed('jev', () => assessJobFit(profiles[cand], { ...fx.jobs[p.job], text: fx.jobs[p.job].jd_text }))).overallFit.percent; } catch { /* reported below */ }
      }
      for (const g of mine.filter(p => p.fit === 'good')) for (const b of mine.filter(p => p.fit === 'bad')) {
        fitChecks.push({ name: `${cand}: ${g.job} fits better than ${b.job}`, pass: scores[g.job] > scores[b.job], detail: `${scores[g.job]}% vs ${scores[b.job]}%` });
      }
      for (const g of mine.filter(p => p.fit === 'good')) fitChecks.push({ name: `${cand}: ${g.job} scores ≥ 60%`, pass: scores[g.job] >= 60, detail: `${scores[g.job]}%` });
    }
    record('jev_fit', 'fit ordering', fitChecks);
  }

  // 5. Extension autofill
  if (want('form') && profiles[fx.form.candidate]) {
    try {
      const t = Date.now();
      const { mappings, model } = await timed('form_fill', () => mapFormFields(fx.form.fields, profiles[fx.form.candidate], ctx));
      const ms = Date.now() - t;
      record('form_fill', 'greenhouse-style form', [...C.formFill(mappings, fx.form), { name: 'finishes under 30 s (CloudFront limit)', pass: ms < 30000, detail: `${(ms / 1000).toFixed(1)} s` }], { model });
    } catch (e) { recordError('form_fill', 'greenhouse-style form', e); }
  }

  await langfuse.flushAsync().catch(() => {});

  // ── Report ─────────────────────────────────────────────────────────────
  const totalMs = Date.now() - t0;
  const byStage = {};
  for (const r of results) {
    const s = (byStage[r.stage] ??= { passed: 0, total: 0, errors: 0 });
    s.passed += r.checks.filter(c => c.pass).length;
    s.total += r.checks.length;
    if (r.error) s.errors++;
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const allPassed = results.reduce((n, r) => n + r.checks.filter(c => c.pass).length, 0);
  const allTotal = results.reduce((n, r) => n + r.checks.length, 0);

  let md = `# Arjun eval ${RUN_ID}\n\nModels: **${MODELS}** · Duration: ${(totalMs / 60000).toFixed(1)} min · Overall: **${allPassed}/${allTotal} checks (${pct(allPassed, allTotal)}%)**\n\n`;
  md += `| Stage | Checks passed | Errors | Median latency |\n|---|---|---|---|\n`;
  for (const [stage, s] of Object.entries(byStage)) {
    const tk = { jev_visa: 'jev', jev_fit: 'jev', improve: 'improve' }[stage] || stage;
    md += `| ${stage} | ${s.passed}/${s.total} (${pct(s.passed, s.total)}%) | ${s.errors} | ${timings[tk] ? (med(timings[tk]) / 1000).toFixed(1) + ' s' : '-'} |\n`;
  }
  md += `\n## Failures\n\n`;
  const fails = results.flatMap(r => r.checks.filter(c => !c.pass).map(c => `- **${r.stage}** · ${r.subject} · ${c.name}${c.detail ? `: ${c.detail}` : ''}`));
  md += fails.length ? fails.join('\n') + '\n' : 'None.\n';
  md += `\n## All results\n\n`;
  for (const r of results) {
    md += `### ${r.stage} · ${r.subject}${r.model ? ` (${r.model})` : ''}${r.ats ? ` · ATS ${r.ats}` : ''}\n\n`;
    for (const c of r.checks) md += `- ${c.pass ? '✅' : '❌'} ${c.name}${c.detail ? ` · ${c.detail}` : ''}\n`;
    if (r.sample) md += `\n> ${r.sample}…\n`;
    md += '\n';
  }

  const dir = path.join(__dirname, 'results', RUN_ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.md'), md);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ runId: RUN_ID, models: MODELS, totalMs, byStage, timings, atsByPair, results, profiles }, null, 2));

  console.log(`\nOverall ${allPassed}/${allTotal} (${pct(allPassed, allTotal)}%) in ${(totalMs / 60000).toFixed(1)} min`);
  for (const [stage, s] of Object.entries(byStage)) console.log(`  ${stage.padEnd(14)} ${s.passed}/${s.total}${s.errors ? `  (${s.errors} errored)` : ''}`);
  console.log(`\nReport: ${path.relative(process.cwd(), path.join(dir, 'report.md'))}`);
  process.exit(0);
})().catch(e => { console.error('eval crashed:', e); process.exit(1); });
