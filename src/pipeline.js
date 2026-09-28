 'use strict';

const path = require('path');
const os = require('os');
const { getProfile, getResumeFormat, seenJobBefore, saveTailored, markDelivered, markJobFailed } = require('./db');
const { labelBullets, tailorResume, calculateAtsScore, improveResume, coverLetter, createJobTrace, langfuse } = require('./llm');
const { getSkillsForWriting } = require('./skills');
const { renderResumeDocx } = require('./renderDocx');
const { renderCoverLetterDocx } = require('./renderCoverLetter');
const { measureResumePdf } = require('./renderPdf');
const { sendResumeEmail } = require('./mailer');

const ATS_IMPROVEMENT_THRESHOLD = 95;

// ── IN-MEMORY JOB QUEUE ──────────────────────────────────────────────────
const MAX_CONCURRENT = 3;
// Hard ceiling so a job can never look endless in the UI — a normal run finishes
// in well under a minute, so 300s leaves generous headroom for real LLM latency
// while still guaranteeing every job resolves one way or the other.
const PROCESS_TIMEOUT_MS = 300 * 1000;
let running = 0;
const queue = [];
const jobStatus = new Map();

function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`Processing timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function queueJob(job, userId, opts = {}) {
  const jobId = job.job_id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Remembered so a background retry (busy AI models) runs the same request.
  if (job.job_id) {
    require('./db').saveJobOptions(job.job_id, { source: opts.source || 'app', wantCoverLetter: !!opts.wantCoverLetter, candidate_feedback: job.candidate_feedback || [] })
      .catch(() => {});
  }
  return new Promise((resolve, reject) => {
    const entry = { job, userId, opts, resolve, reject, jobId, enqueuedAt: Date.now() };
    jobStatus.set(jobId, { status: 'queued', position: queue.length + 1, enqueuedAt: entry.enqueuedAt });
    queue.push(entry);
    console.log(`📥 Queued ${job.company || jobId} (${queue.length} waiting, ${running}/${MAX_CONCURRENT} running)`);
    drainQueue();
  });
}

function drainQueue() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const entry = queue.shift();
    running++;
    // Update positions for remaining queued jobs
    queue.forEach((e, i) => {
      const s = jobStatus.get(e.jobId);
      if (s) s.position = i + 1;
    });
    jobStatus.set(entry.jobId, { status: 'running', startedAt: Date.now() });
    console.log(`🚀 Starting ${entry.job.company || entry.jobId} (${running}/${MAX_CONCURRENT} running, ${queue.length} waiting)`);

    withTimeout(
      processJob(entry.job, entry.userId, entry.opts),
      PROCESS_TIMEOUT_MS,
      () => markJobFailed(entry.jobId, `Processing timed out after ${Math.round(PROCESS_TIMEOUT_MS / 1000)}s`).catch(() => {})
    )
      .then(result => {
        jobStatus.set(entry.jobId, { status: 'done', result });
        entry.resolve(result);
      })
      .catch(err => {
        jobStatus.set(entry.jobId, { status: 'failed', error: err.message });
        entry.reject(err);
      })
      .finally(() => {
        running--;
        setTimeout(() => jobStatus.delete(entry.jobId), 5 * 60 * 1000);
        drainQueue();
      });
  }
}

function getQueueStats() {
  return { running, queued: queue.length, maxConcurrent: MAX_CONCURRENT };
}

// ── Invented-bullet guard ──────────────────────────────────────────────────
// Tailoring may reword bullets (and adopt JD terms), but every bullet must still come from a
// real profile bullet. In the Sep 2026 eval about 1 in 7 tailoring runs produced bullets with
// no source (e.g. "Leveraged payments domain experience to..."). A reworded bullet keeps most
// of its source's words; one with <30% of its words in any profile bullet is dropped.
const guardWords = (t) => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2));
function traceScore(text, sources) {
  const w = guardWords(text);
  if (!w.size) return 0;
  let best = 0;
  for (const src of sources) {
    let n = 0;
    for (const x of w) if (src.has(x)) n++;
    best = Math.max(best, n / w.size);
  }
  return best;
}
const bulletStr = (b) => (typeof b === 'string' ? b : b?.text || '');

// ── Summary guard ────────────────────────────────────────────────────────
// The summary is free text, so the model can stretch it toward the posting ("5+ years",
// "worked with research teams") in ways the bullet check never sees. Drop any sentence that
// claims more years than the profile's dates support, or that uses posting words the profile
// never mentions.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseMonth(str, isEnd) {
  const t = String(str || '').trim().toLowerCase();
  if (!t) return null;
  if (/present|current|now|ongoing/.test(t)) return new Date().getFullYear() * 12 + new Date().getMonth();
  const m = t.match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m && m[1] in MONTHS) return Number(m[2]) * 12 + MONTHS[m[1]];
  const y = t.match(/(\d{4})/);
  return y ? Number(y[1]) * 12 + (isEnd ? 11 : 0) : null;
}
// Years covered by roles (overlaps merged). titleRe limits it to matching titles.
function yearsOf(profile, titleRe = null) {
  const spans = [];
  for (const e of profile.experience || []) {
    if (titleRe && !titleRe.test(e.title || '')) continue;
    const [a, b] = String(e.dates || '').split(/\s*(?:–|—|-|to)\s*/i);
    const start = parseMonth(a, false), end = parseMonth(b || a, true);
    if (start != null && end != null && end >= start) spans.push([start, end]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let months = 0, cur = null;
  for (const sp of spans) {
    if (cur && sp[0] <= cur[1]) cur[1] = Math.max(cur[1], sp[1]);
    else { if (cur) months += cur[1] - cur[0] + 1; cur = [...sp]; }
  }
  if (cur) months += cur[1] - cur[0] + 1;
  return months / 12;
}
const SUMMARY_GENERIC = new Set('proven track record strong skilled experience experienced passionate driven ability background including across deliver delivering delivered focus focused excellent communication years building shipping product products teams team partner partnering customer customers business drive driving growth impact results complex solutions solution cross functional collaborative collaboration leader leadership hands deep expertise technical strategic roadmap roadmaps'.split(' '));
function cleanSummary(resume, profile, jdText) {
  if (!resume.summary) return [];
  const { summary: _own, ...rest } = profile;
  const profileText = JSON.stringify(rest).toLowerCase();
  const jd = String(jdText || '').toLowerCase();
  const total = yearsOf(profile);
  const pm = yearsOf(profile, /product/i);
  const removed = [];
  const sentences = resume.summary.match(/[^.!?]+[.!?]*/g) || [resume.summary];
  const kept = sentences.filter(sentence => {
    const claim = sentence.match(/(\d+)\+?\s*(?:years?|yrs?)/i);
    if (claim) {
      const limit = /product manag|\bPM\b/i.test(sentence) ? pm : total;
      if (Number(claim[1]) > Math.floor(limit + 0.05)) { removed.push(sentence.trim()); return false; }
    }
    const stuffed = (sentence.toLowerCase().match(/[a-z][a-z-]{4,}/g) || [])
      .filter(w => !SUMMARY_GENERIC.has(w) && jd.includes(w) && !profileText.includes(w.replace(/s$/, '')));
    if (stuffed.length) { removed.push(`${sentence.trim()} [${stuffed.join(', ')}]`); return false; }
    return true;
  });
  if (removed.length) resume.summary = kept.join(' ').trim() || profile.summary || '';
  return removed;
}

// Default layout: bullets render as "Label: text". The model returns the label separately so
// the bullet text stays verbatim (and traceable); prepend it once, after the trace checks.
function applyBulletLabels(resume) {
  for (const role of resume.experience || []) {
    role.bullets = (role.bullets || []).map(b => {
      if (!b || typeof b !== 'object' || !b.label) return b;
      const label = String(b.label).replace(/[:\s]+$/, '').trim();
      const text = String(b.text || '');
      const { label: _l, ...rest } = b;
      if (!label || label.split(/\s+/).length > 6 || text.toLowerCase().startsWith(label.toLowerCase())) return rest;
      return { ...rest, text: `${label}: ${text}` };
    });
  }
}

// The improve pass rewrites bullets and can drop their "Label: " prefix. Put each role's
// original label back on the rewritten bullet it most resembles.
function restoreBulletLabels(before, after) {
  const labelOf = (t) => (String(t).match(/^([A-Z][A-Za-z0-9/-]*(?:\s(?:&|[A-Za-z0-9/-]+)){0,5}):\s/) || [])[1];
  const words = (t) => new Set(String(t).toLowerCase().match(/[a-z0-9%$]+/g) || []);
  const sim = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
  for (const role of after.experience || []) {
    const orig = (before.experience || []).find(r => (r.company || '').toLowerCase() === (role.company || '').toLowerCase());
    if (!orig) continue;
    const labeled = (orig.bullets || []).map(bulletStr).filter(labelOf);
    role.bullets = (role.bullets || []).map(b => {
      const text = bulletStr(b);
      if (!text || labelOf(text)) return b;
      let best = null, score = 0;
      for (const o of labeled) { const s = sim(o.replace(/^[^:]+:\s/, ''), text); if (s > score) { score = s; best = o; } }
      if (!best || score < 0.5) return b;
      const withLabel = `${labelOf(best)}: ${text}`;
      return typeof b === 'string' ? withLabel : { ...b, text: withLabel };
    });
  }
}

// The model sometimes returns roles with no bullets, or no skills, for a weak-fit job.
// Never print an empty role or skills section: fall back to the profile's own content.
function ensureResumeCompleteness(resume, profile) {
  const fixes = [];
  for (const role of resume.experience || []) {
    if ((role.bullets || []).length) continue;
    const src = (profile.experience || []).find(e => (e.company || '').toLowerCase() === (role.company || '').toLowerCase());
    const bullets = (src?.bullets || []).map(bulletStr).filter(Boolean).slice(0, 2);
    if (bullets.length) { role.bullets = bullets.map(text => ({ text, serves: 'role coverage (patched)' })); fixes.push(`bullets for ${role.company}`); }
  }
  const groups = ['skills_product', 'skills_technical', 'skills_ai_tools'];
  if (!groups.some(k => (resume[k] || []).length)) {
    const tech = (profile.technical_skills || []).map(s => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
    const soft = (profile.soft_skills || []);
    const flat = (profile.skills || []);
    resume.skills_technical = (tech.length ? tech : flat).slice(0, 10);
    if (soft.length) resume.skills_product = soft.slice(0, 8);
    if (resume.skills_technical.length || (resume.skills_product || []).length) fixes.push('skills');
  }
  return fixes;
}

// Default layout expects "Label: text" on every experience bullet. If the model skipped any,
// ask for them in one short call (labels only, text untouched).
const HAS_LABEL = /^[A-Z][A-Za-z0-9/-]*(?:\s(?:&|[A-Za-z0-9/-]+)){0,5}:\s/;
async function ensureBulletLabels(resume, trace) {
  const refs = [];
  for (const role of resume.experience || []) (role.bullets || []).forEach((b, i) => refs.push({ role, i, text: bulletStr(b) }));
  const missing = refs.filter(r => r.text && !HAS_LABEL.test(r.text));
  if (!missing.length) return 0;
  const labels = await labelBullets(missing.map(r => r.text), trace);
  let added = 0;
  missing.forEach((r, k) => {
    const label = labels[k];
    if (!label || label.split(/\s+/).length > 6) return;
    const b = r.role.bullets[r.i];
    const text = `${label}: ${r.text}`;
    r.role.bullets[r.i] = typeof b === 'string' ? text : { ...b, text };
    added++;
  });
  return added;
}

// Page count the candidate asked for in the side-panel chat ("one page", "keep it to 2 pages").
// The latest mention wins. null when they never said.
const PAGE_WORDS = { one: 1, single: 1, '1': 1, two: 2, '2': 2, three: 3, '3': 3 };
function pagesFromFeedback(feedback) {
  let pages = null;
  for (const f of Array.isArray(feedback) ? feedback : []) {
    const t = String(typeof f === 'string' ? f : f?.text || '').toLowerCase();
    const m = t.match(/\b(one|single|two|three|[123])[\s-]*(?:page|pager)s?\b/);
    if (m) pages = PAGE_WORDS[m[1]];
  }
  return pages;
}

function dropUntraceableBullets(resume, profile) {
  const sources = (profile.experience || []).flatMap(e => (e.bullets || []).map(bulletStr))
    .concat((profile.projects || []).flatMap(p => [p.description, p.outcome, ...(p.bullets || []).map(bulletStr)]))
    .filter(Boolean).map(guardWords);
  const dropped = [];
  for (const role of resume.experience || []) {
    const kept = (role.bullets || []).filter(b => {
      const ok = traceScore(bulletStr(b), sources) >= 0.3;
      if (!ok) dropped.push(bulletStr(b));
      return ok;
    });
    if (!kept.length && (role.bullets || []).length) {
      // Never leave a role empty: fall back to that role's own profile bullets.
      const src = (profile.experience || []).find(e => (e.company || '').toLowerCase() === (role.company || '').toLowerCase());
      role.bullets = (src?.bullets || []).slice(0, 2).map(b => ({ text: bulletStr(b), serves: 'role coverage (guard)' }));
    } else {
      role.bullets = kept;
    }
  }
  return dropped;
}

function validateResumeContent(resume, profile) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const resumeCompanies = new Set((resume.experience || []).map(e => norm(e.company)));
  const missingRoles = [];
  const thinRoles = [];

  for (const exp of (profile.experience || [])) {
    const company = norm(exp.company);
    if (!company) continue;
    if (!resumeCompanies.has(company)) {
      missingRoles.push(exp.company);
    } else {
      const resumeRole = (resume.experience || []).find(e => norm(e.company) === company);
      if (resumeRole && (resumeRole.bullets || []).length <= 1) {
        thinRoles.push(exp.company);
      }
    }
  }

  return { missingRoles, thinRoles };
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

function dedupBullets(resume) {
  let removed = 0;
  for (const exp of (resume.experience || [])) {
    const bullets = exp.bullets || [];
    if (bullets.length <= 1) continue;

    const words = (text) => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
    const overlap = (a, b) => {
      const setA = words(a), setB = words(b);
      const intersection = [...setA].filter(w => setB.has(w)).length;
      const smaller = Math.min(setA.size, setB.size);
      return smaller > 0 ? intersection / smaller : 0;
    };

    const keep = new Set(bullets.map((_, i) => i));
    for (let i = 0; i < bullets.length; i++) {
      if (!keep.has(i)) continue;
      const textA = typeof bullets[i] === 'string' ? bullets[i] : (bullets[i].text || '');
      for (let j = i + 1; j < bullets.length; j++) {
        if (!keep.has(j)) continue;
        const textB = typeof bullets[j] === 'string' ? bullets[j] : (bullets[j].text || '');
        if (overlap(textA, textB) > 0.7) {
          const dropIdx = textA.length >= textB.length ? j : i;
          keep.delete(dropIdx);
          removed++;
          if (dropIdx === i) break;
        }
      }
    }

    if (keep.size < bullets.length) {
      exp.bullets = bullets.filter((_, i) => keep.has(i));
    }
  }
  return removed;
}

function expandResume(resume, profile, aggression) {
  let changed = false;
  const maxAdd = aggression === 'heavy' ? 6 : aggression === 'medium' ? 4 : 3;
  const maxBullets = aggression === 'heavy' ? 99 : aggression === 'medium' ? 10 : 7;

  for (const resumeExp of (resume.experience || [])) {
    const profileExp = (profile.experience || []).find(p =>
      norm(p.company) === norm(resumeExp.company) && norm(p.title) === norm(resumeExp.title)
    ) || (profile.experience || []).find(p => norm(p.company) === norm(resumeExp.company));
    if (!profileExp) continue;

    const currentCount = (resumeExp.bullets || []).length;
    if (currentCount >= maxBullets) continue;

    const profileBullets = (profileExp.bullets || []).map(b => typeof b === 'string' ? b : b.text || '');
    const resumeBulletTexts = new Set((resumeExp.bullets || []).map(b =>
      norm(typeof b === 'string' ? b : b.text || '')
    ));

    const missing = profileBullets.filter(bt => !resumeBulletTexts.has(norm(bt)));
    const slotsAvailable = Math.min(maxAdd, maxBullets - currentCount);
    if (missing.length > 0 && slotsAvailable > 0) {
      const toAdd = missing.slice(0, slotsAvailable);
      resumeExp.bullets = [...(resumeExp.bullets || []), ...toAdd.map(t => ({ text: t, serves: 'additional role detail' }))];
      changed = true;
    }
  }

  for (const resumeProj of (resume.projects || [])) {
    const profileProj = (profile.projects || []).find(p =>
      norm(p.name) === norm(resumeProj.name)
    );
    if (profileProj) {
      const desc = (profileProj.description || '').replace(/[.\s]+$/, '');
      const outcome = (profileProj.outcome || '').replace(/[.\s]+$/, '');
      // Outcomes often restate the description ("…in under 60 seconds. AI solution design
      // generation in under 60 seconds."); only append one that adds something new.
      const words = (t) => new Set(t.toLowerCase().match(/[a-z0-9$%+]+/g) || []);
      const dw = words(desc), ow = [...words(outcome)];
      const novel = ow.filter(w => !dw.has(w)).length / Math.max(1, ow.length);
      const parts = [desc, novel >= 0.5 ? outcome : ''].filter(Boolean);
      const fullDesc = parts.join('. ') + '.';
      if (fullDesc.length > (resumeProj.description || '').length) {
        resumeProj.description = fullDesc;
        changed = true;
      }
      if (profileProj.tags && profileProj.tags.length && !resumeProj.tags) {
        resumeProj.tags = profileProj.tags;
        changed = true;
      }
      if (Array.isArray(profileProj.tech_stack) && profileProj.tech_stack.length && !resumeProj.tech_stack) {
        resumeProj.tech_stack = profileProj.tech_stack;
        changed = true;
      }
      if (profileProj.url && !resumeProj.url) {
        resumeProj.url = profileProj.url;
        changed = true;
      }
    }
  }

  return changed;
}

// Removes ONE piece of content per call, least valuable first, so the page-fit loop can
// re-measure after each cut and stop as soon as the resume fits. Returns false when there is
// nothing left it is willing to cut. Order: filler bullets, bullets without numbers (older
// roles first), extra projects, optional sections, long skill lists, older roles' extra
// bullets, education details, older company descriptions, the last project.
const HAS_METRIC = /\$[\d,.]+|\d+%|\d+[KMB]\+|\d{2,}/;
// How much a piece of text speaks to the job: share of its content words the posting uses.
const REL_STOP = new Set('the and for with from that this into over across our your their was were are has have had its using used by to of in on at as an or be we you they it'.split(' '));
// Lowercased content words, singularised ("agents" -> "agent"), keeping short terms like AI, LLM.
function relWords(text) {
  return (String(text || '').toLowerCase().match(/[a-z][a-z0-9+#]*/g) || [])
    .filter(w => w.length >= 2 && !REL_STOP.has(w))
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}
function jdRelevance(text, jdWords) {
  const w = relWords(text);
  if (!w.length || !jdWords.size) return 0;
  return w.filter(x => jdWords.has(x)).length / Math.sqrt(w.length);
}
function tightenResume(resume, jdText = '') {
  const roles = resume.experience || [];
  const older = [...roles].reverse(); // resumes list newest first
  const text = (b) => (typeof b === 'string' ? b : (b?.text || ''));
  const drop = (arr, i) => { arr.splice(i, 1); return true; };
  const jdWords = new Set(relWords(jdText));
  // Index of the least job-relevant item among arr[from..] matching keep() (-1 if none).
  // The tailoring model tags each bullet with the job requirement it serves (a semantic match);
  // that ranks first, word overlap with the posting breaks ties.
  const FILLER = /^(additional role detail|role coverage|general relevance)/i;
  const semantic = (item) => (item && typeof item === 'object' && item.serves && !FILLER.test(item.serves) ? 10 : 0);
  const leastRelevant = (arr, from, textOf, keep = () => true) => {
    let best = -1, score = Infinity;
    for (let i = from; i < arr.length; i++) {
      if (!keep(arr[i])) continue;
      const sc = semantic(arr[i]) + jdRelevance(`${textOf(arr[i])} ${arr[i]?.serves || ''}`, jdWords);
      if (sc < score) { score = sc; best = i; }
    }
    return best;
  };

  // 1. Patched/filler bullets
  for (const r of older) {
    const i = (r.bullets || []).findIndex(b => ['additional role detail', 'role coverage (patched)'].includes(b?.serves));
    if (i >= 0 && r.bullets.length > 2) return drop(r.bullets, i);
  }
  // 2. Bullets without numbers, beyond 2 per role, older roles first
  for (const r of older) {
    const bs = r.bullets || [];
    if (bs.length <= 2) continue;
    const i = leastRelevant(bs, 0, text, b => !HAS_METRIC.test(text(b)));
    if (i >= 0) return drop(bs, i);
  }
  // 3. Projects beyond 2
  const projText = (p) => `${p.name} ${p.description} ${(p.tech_stack || []).join(' ')}`;
  if ((resume.projects || []).length > 2) return drop(resume.projects, leastRelevant(resume.projects, 0, projText));
  // 4. Optional sections
  for (const k of ['interests', 'activities']) if ((resume[k] || []).length) { resume[k] = []; return true; }
  if ((resume.certifications || []).length > 2) return drop(resume.certifications, resume.certifications.length - 1);
  // 5. Long skill lists (keep the first, most relevant, 8 per group)
  for (const k of ['skills_technical', 'skills_product', 'skills_ai_tools']) {
    if ((resume[k] || []).length > 8) { resume[k] = resume[k].slice(0, resume[k].length - 2); return true; }
  }
  // 6. Any bullet beyond 3 per role, then beyond 2, older roles first
  for (const cap of [3, 2]) {
    for (const r of older) if ((r.bullets || []).length > cap) return drop(r.bullets, leastRelevant(r.bullets, 0, text));
    // (cap never goes below 2)
  }
  // 7. Education honors/GPA lines
  for (const e of resume.education || []) {
    if (e.gpa) { delete e.gpa; return true; }
    if (e.honors) { delete e.honors; return true; }
  }
  // 8. Company descriptions, oldest role first (keep the most recent one)
  for (const r of older.slice(0, -1)) if (r.tagline) { r.tagline = ''; return true; }
  // 9. Projects down to one, then the oldest roles down to one bullet
  if ((resume.projects || []).length > 1) return drop(resume.projects, leastRelevant(resume.projects, 0, projText));
  // Never below 2 bullets per role (the approved resume skill's floor).
  if ((resume.certifications || []).length) { resume.certifications = []; return true; }
  return false;
}

function pickLayoutOpts(pages, lastPageFill) {
  if (pages === 1) return { fontScale: 1.0, lineGap: 1.5, sectionGap: 0.6, roleGap: 0.3 };

  if (lastPageFill >= 70) return { fontScale: 1.0, lineGap: 1.5, sectionGap: 0.6, roleGap: 0.3 };
  if (lastPageFill >= 55) return { fontScale: 1.0, lineGap: 2.0, sectionGap: 0.7, roleGap: 0.35 };
  if (lastPageFill >= 40) return { fontScale: 1.03, lineGap: 2.5, sectionGap: 0.8, roleGap: 0.4 };
  if (lastPageFill >= 25) return { fontScale: 1.05, lineGap: 2.5, sectionGap: 0.9, roleGap: 0.45 };
  return { fontScale: 1.08, lineGap: 3.0, sectionGap: 1.0, roleGap: 0.5 };
}

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 2000;

async function withRetry(fn, label, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) throw e;
      const wait = BASE_DELAY_MS * Math.pow(2, attempt);
      console.log(`  ↻ ${label} attempt ${attempt + 1}/${retries + 1} failed: ${e.message}. Retrying in ${wait}ms...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function processJob(job, userId = 'me', { source = 'app', sessionId, userEmail, userName, force = false, wantCoverLetter = false } = {}) {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  if (!force) {
    const alreadySeen = await seenJobBefore(job, userId);
    if (alreadySeen) return { skipped: true };
  }

  if (!job.jd_text || job.jd_text.trim().length < 50) {
    console.log(`· Skipping ${job.job_id} — no JD`);
    return { skipped: true };
  }

  const trace = createJobTrace(job, { userId, sessionId, userEmail, userName });
  const profile = await getProfile(userId);
  const resumeFormat = await getResumeFormat(userId).catch(() => null);
  // Per-user playbooks (career profile, cover-letter story, writing voice); null until generated.
  const skills = await getSkillsForWriting(userId).catch(() => null);

  const askedPages = pagesFromFeedback(job.candidate_feedback);
  const formatForJob = { ...(resumeFormat || {}), target_pages: askedPages || resumeFormat?.target_pages || 1 };
  if (askedPages) console.log(`📄 Candidate asked for ${askedPages} page(s)`);

  // Step 1: Tailor resume — LLM selects + reframes all relevant bullets
  let resume, tailoringNotes, jdRequirements;
  try {
    console.log(`⏱ [${elapsed()}] Starting tailor...`);
    const tailorResult = await withRetry(
      () => tailorResume(profile, job, trace, formatForJob, skills),
      `tailor:${job.company}`
    );
    console.log(`⏱ [${elapsed()}] Tailor complete`);
    tailoringNotes = tailorResult.tailoring_notes || [];
    jdRequirements = tailorResult.jd_requirements || [];
    delete tailorResult.tailoring_notes;
    delete tailorResult.jd_requirements;
    resume = tailorResult;
  } catch (e) {
    await markJobFailed(job.job_id, `Tailoring failed after retries: ${e.message}`);
    throw e;
  }

  // Step 1.5: Content integrity — patch any dropped roles
  const stretched = cleanSummary(resume, profile, job.jd_text);
  if (stretched.length) {
    console.warn(`⚠ Dropped ${stretched.length} summary sentence(s) not supported by the profile: ${stretched.map(x => `"${x.slice(0, 80)}"`).join(', ')}`);
    langfuse.score({ traceId: trace.id, name: 'summary-sentences-dropped', value: stretched.length });
  }
  const invented = dropUntraceableBullets(resume, profile);
  if (invented.length) {
    console.warn(`⚠ Dropped ${invented.length} bullet(s) not traceable to the profile: ${invented.map(b => `"${b.slice(0, 60)}"`).join(', ')}`);
    langfuse.score({ traceId: trace.id, name: 'untraceable-bullets-dropped', value: invented.length });
  }

  const integrityIssues = validateResumeContent(resume, profile);
  if (integrityIssues.missingRoles.length) {
    console.warn(`⚠ Tailoring dropped ${integrityIssues.missingRoles.length} role(s): ${integrityIssues.missingRoles.join(', ')} — patching`);
    for (const role of integrityIssues.missingRoles) {
      const profileRole = profile.experience.find(e => (e.company || '').toLowerCase() === role.toLowerCase());
      if (profileRole) {
        const bullets = (profileRole.bullets || []).slice(0, 2).map(b => {
          const text = typeof b === 'string' ? b : b.text || '';
          return { text, serves: 'role coverage (patched)' };
        });
        resume.experience.push({
          company: profileRole.company,
          tagline: profileRole.company_description || '',
          title: profileRole.title,
          location: profileRole.location || '',
          dates: profileRole.dates || '',
          bullets,
        });
      }
    }
  }
  if (integrityIssues.thinRoles.length) {
    console.log(`ℹ Thin roles (≤1 bullet): ${integrityIssues.thinRoles.join(', ')}`);
  }

  // Step 1.51: "Label: text" bullets for the default layout (before page measurement)
  applyBulletLabels(resume);
  const completed = ensureResumeCompleteness(resume, profile);
  if (completed.length) console.warn(`⚠ Filled empty resume parts from the profile: ${completed.join(', ')}`);
  // Only for the default layout, or an uploaded one that uses labeled bullets.
  if (!resumeFormat?.style_profile || resumeFormat.style_profile.bold_label_bullets) {
    const added = await ensureBulletLabels(resume, trace).catch(e => { console.warn(`⚠ bullet labels skipped: ${e.message.slice(0, 80)}`); return 0; });
    if (added) console.log(`🏷 Added labels to ${added} bullet(s)`);
  }

  // Step 1.52: Dedup — remove near-duplicate bullets within the same role
  const dedupCount = dedupBullets(resume);
  if (dedupCount > 0) {
    console.log(`✂ Deduped ${dedupCount} near-duplicate bullet(s)`);
  }

  // Links in the reference layout's order: LinkedIn, GitHub, then personal site/others.
  if (Array.isArray(resume.contact?.links)) {
    const rank = (l) => { const u = String(typeof l === 'string' ? l : l?.url || ''); return /linkedin/i.test(u) ? 0 : /github/i.test(u) ? 1 : 2; };
    resume.contact.links = [...resume.contact.links].sort((a, b) => rank(a) - rank(b));
  }

  // Step 1.55: Enrich projects — always merge outcomes from profile
  for (const resumeProj of (resume.projects || [])) {
    const firstWord = (n) => norm(String(n || '').split(/[:\s-]/)[0]);
    const profileProj = (profile.projects || []).find(p => norm(p.name) === norm(resumeProj.name))
      || (profile.projects || []).find(p => firstWord(p.name) && firstWord(p.name) === firstWord(resumeProj.name));
    if (profileProj) {
      const desc = (profileProj.description || '').replace(/[.\s]+$/, '');
      const outcome = (profileProj.outcome || '').replace(/[.\s]+$/, '');
      const parts = [desc, outcome].filter(Boolean);
      const fullDesc = parts.join('. ') + '.';
      // A rewritten description may not add claims (seen: "Claude Code for AI-enhanced safety
      // scoring" when Claude Code was only the build tool). Any content word the profile's
      // project never mentions sends it back to the profile's own description.
      const known = JSON.stringify(profileProj).toLowerCase();
      const added = (String(resumeProj.description || '').toLowerCase().match(/[a-z][a-z-]{4,}/g) || [])
        .filter(w => !SUMMARY_GENERIC.has(w) && !known.includes(w.replace(/s$/, '')) && !['built', 'using', 'integrating', 'integrates', 'powered', 'enables', 'based'].includes(w));
      if (added.length || fullDesc.length > (resumeProj.description || '').length) {
        if (added.length) console.warn(`⚠ Project "${resumeProj.name}": reverted description (unsupported: ${[...new Set(added)].slice(0, 5).join(', ')})`);
        resumeProj.description = fullDesc;
      }
      if (profileProj.tags && profileProj.tags.length && !resumeProj.tags) {
        resumeProj.tags = profileProj.tags;
      }
      if (Array.isArray(profileProj.tech_stack) && profileProj.tech_stack.length && !resumeProj.tech_stack) {
        resumeProj.tech_stack = profileProj.tech_stack;
      }
      if (profileProj.url && !resumeProj.url) {
        resumeProj.url = profileProj.url;
      }
    }
  }

  // Step 1.57: Education keeps the profile's major, honors and GPA (tailoring only returns
  // school, degree and dates, which dropped "Artificial Intelligence for Business" etc.).
  for (const e of (resume.education || [])) {
    const src = (profile.education || []).find(pe => norm(pe.school) === norm(e.school));
    if (!src) continue;
    for (const k of ['major', 'honors', 'gpa', 'location']) if (!e[k] && src[k]) e[k] = src[k];
  }

  // Step 1.6: Measure → expand/tighten → pick layout
  let layoutOpts = { fontScale: 1.0, lineGap: 1.5, sectionGap: 0.6, roleGap: 0.3 };
  if (resumeFormat?.style_profile?.section_order) layoutOpts.sectionOrder = resumeFormat.style_profile.section_order;
  if (resumeFormat?.style_profile?.heading_case) layoutOpts.headingCase = resumeFormat.style_profile.heading_case;
  if (resumeFormat?.style_profile?.bullet_indent_pt) layoutOpts.bulletIndent = resumeFormat.style_profile.bullet_indent_pt;
  if (resumeFormat?.style_profile?.role_header_style) layoutOpts.roleHeaderStyle = resumeFormat.style_profile.role_header_style;
  if (resumeFormat?.style_profile?.company_case) layoutOpts.companyCase = resumeFormat.style_profile.company_case;
  // Page target: what the candidate asked for in the chat, else their uploaded layout's
  // count, else 1 page (the default layout is a one-pager).
  const targetPages = formatForJob.target_pages;

  try {
    let m = await measureResumePdf(resume, layoutOpts);
    console.log(`📐 Initial: ${m.pages} page(s), last page ${m.lastPageFill}% filled`);

    if (targetPages) {
      // A saved format pins an explicit page count — converge on it instead of the
      // reactive fill-based heuristic below. Bounded iterations since expand/tighten
      // can run out of profile content to add/remove before hitting the exact target.
      let iterations = 0;
      const MAX_TARGET_ITERATIONS = 25; // tightenResume removes one small piece per call
      while (m.pages !== targetPages && iterations < MAX_TARGET_ITERATIONS) {
        const changed = m.pages < targetPages
          ? expandResume(resume, profile, (targetPages - m.pages) >= 2 ? 'heavy' : 'medium')
          : tightenResume(resume, job.jd_text);
        if (!changed) {
          console.log(`↕ Stopped at ${m.pages}/${targetPages} target pages — no more content to ${m.pages < targetPages ? 'add' : 'trim'}`);
          break;
        }
        m = await measureResumePdf(resume, layoutOpts);
        iterations++;
        console.log(`📐 [target ${targetPages}pg, iteration ${iterations}] ${m.pages} page(s), ${m.lastPageFill}% filled`);
      }

      // Hitting the target page count isn't the finish line by itself — a page
      // that's only 73-78% full has real, already-vetted content sitting unused
      // in the profile (bullets the tailoring pass didn't select, fuller project
      // descriptions) that could occupy that space instead of leaving it blank.
      // Pull it in a few bullets at a time, only keeping each step if it doesn't
      // push the page count past the target — this never invents anything, it
      // only surfaces real profile content expandResume() already knows is there.
      const TARGET_FILL_FLOOR = 93; // skill: fill until bottom whitespace is under ~35pt
      const MAX_FILL_ITERATIONS = 8;
      if (m.pages === targetPages && m.lastPageFill < TARGET_FILL_FLOOR) {
        let fillIterations = 0;
        while (m.lastPageFill < TARGET_FILL_FLOOR && fillIterations < MAX_FILL_ITERATIONS) {
          const snapshot = JSON.parse(JSON.stringify(resume));
          const changed = expandResume(resume, profile, 'light');
          if (!changed) {
            console.log(`↕ Fill-up stopped at ${m.lastPageFill}% — no more unused profile content`);
            break;
          }
          const trial = await measureResumePdf(resume, layoutOpts);
          if (trial.pages > targetPages) {
            Object.assign(resume, snapshot); // this step would've pushed past the target page — discard it
            console.log(`↕ Fill-up stopped at ${m.lastPageFill}% — next addition would overflow to ${trial.pages} pages`);
            break;
          }
          m = trial;
          fillIterations++;
          console.log(`📐 [fill-up ${fillIterations}] ${m.pages} page(s), ${m.lastPageFill}% filled`);
        }
      }

      // Content-trimming ran out before hitting the target — the remaining lever
      // is shrinking font/spacing, which nothing in this pipeline ever attempted.
      // Especially worth it when the overflow is tiny (near-0% on the extra page):
      // that's a case where a barely-perceptible font reduction is a much better
      // trade than either cutting more real content or leaving a page that's
      // almost entirely blank.
      if (m.pages > targetPages) {
        // Floor at 0.9x, not lower — base bullet text is 10pt, so 0.9x is the
        // smallest step that keeps body text at the 9pt ATS/human-readability
        // floor most resume style guides use. A 0.85x step (8.5pt body, ~7.65pt
        // on dates/contact) reads as visibly cramped and undersized once printed
        // or reviewed by a human, even though the underlying text layer — which
        // is all an ATS parser actually reads — is identical at any scale.
        // Body is 9.5pt; 0.95x keeps it at ~9pt, the readability floor.
        const shrinkSteps = [0.97, 0.95];
        for (const scale of shrinkSteps) {
          const shrunk = {
            ...layoutOpts,
            fontScale: scale,
            lineGap: 1.5 * scale,
            sectionGap: 0.6 * scale,
            roleGap: 0.3 * scale,
          };
          const trial = await measureResumePdf(resume, shrunk);
          console.log(`📐 [shrink-to-fit ${scale}x] ${trial.pages} page(s), ${trial.lastPageFill}% filled`);
          if (trial.pages <= targetPages) {
            layoutOpts = shrunk;
            m = trial;
            break;
          }
        }
      }
    } else {
      // Gap #5: 1-page underuse — if 1 page at <75%, pull more content
      if (m.pages === 1 && m.lastPageFill < 75) {
        console.log(`↕ 1-page at ${m.lastPageFill}% — expanding to use space`);
        expandResume(resume, profile, 'medium');
        m = await measureResumePdf(resume, layoutOpts);
        console.log(`📐 After 1-page expand: ${m.pages} page(s), ${m.lastPageFill}% filled`);
      }

      // Gap #2/#3: Multi-page underfill — aggressive expand based on how empty the last page is
      if (m.pages > 1 && m.lastPageFill < 60) {
        const aggression = m.lastPageFill < 30 ? 'heavy' : m.lastPageFill < 50 ? 'medium' : 'light';
        console.log(`↕ Page ${m.pages} at ${m.lastPageFill}% — ${aggression} expand`);
        expandResume(resume, profile, aggression);
        m = await measureResumePdf(resume, layoutOpts);
        console.log(`📐 After expand: ${m.pages} page(s), ${m.lastPageFill}% filled`);
      }

      // Gap #1: Tighten — if content spills to an extra page with <40% fill, trim back
      if (m.pages > 2 && m.lastPageFill < 40) {
        console.log(`✂ ${m.pages} pages, last at ${m.lastPageFill}% — tightening`);
        tightenResume(resume, job.jd_text);
        m = await measureResumePdf(resume, layoutOpts);
        console.log(`📐 After tighten: ${m.pages} page(s), ${m.lastPageFill}% filled`);
      }
    }

    // Gap #4: Pick layout opts — font scale, line spacing, section spacing. Only for
    // the reactive (no explicit target) path — it's expand-only (fontScale >= 1.0),
    // which would undo the shrink-to-fit step above if applied after a target was set.
    if (!targetPages) {
      layoutOpts = { ...layoutOpts, ...pickLayoutOpts(m.pages, m.lastPageFill) };
      if (layoutOpts.fontScale !== 1.0 || layoutOpts.lineGap !== 1.5) {
        m = await measureResumePdf(resume, layoutOpts);
        console.log(`📐 Layout tuned (font ${layoutOpts.fontScale}, lineGap ${layoutOpts.lineGap}): ${m.pages} page(s), ${m.lastPageFill}% filled`);
      }
    }
  } catch (e) {
    console.error(`⚠ Page measurement failed (using defaults): ${e.message}`);
  }

  // Step 2: ATS score
  let ats;
  try {
    console.log(`⏱ [${elapsed()}] Starting ATS score...`);
    ats = await withRetry(
      () => calculateAtsScore(resume, job, trace),
      `ats:${job.company}`
    );
    console.log(`⏱ [${elapsed()}] ATS score complete`);
  } catch (e) {
    console.error(`⚠ ATS scoring failed, proceeding without score: ${e.message}`);
    ats = { score: 0, matched_keywords: [], missing_keywords: [], summary: 'Scoring unavailable' };
  }

  console.log(`✓ ATS Score for ${job.company}: ${ats.score}/100`);

  // Step 3: Improvement pass (if ATS below threshold)
  let improved = false;
  let substitutions = [];
  if (ats.score > 0 && ats.score < ATS_IMPROVEMENT_THRESHOLD) {
    console.log(`⏱ [${elapsed()}] Starting improvement pass...`);
    try {
      const improveResult = await withRetry(
        () => improveResume(resume, job, ats, trace, tailoringNotes, jdRequirements, skills),
        `improve:${job.company}`,
        1
      );
      const improvedResume = improveResult.resume || improveResult;
      const inventedByImprove = dropUntraceableBullets(improvedResume, profile);
      restoreBulletLabels(resume, improvedResume);
      ensureResumeCompleteness(improvedResume, profile);
      cleanSummary(improvedResume, profile, job.jd_text);
      if (inventedByImprove.length) console.warn(`⚠ Improve pass: dropped ${inventedByImprove.length} untraceable bullet(s)`);
      substitutions = improveResult.substitutions || [];

      console.log(`⏱ [${elapsed()}] Improvement done, re-scoring...`);
      const improvedAts = await withRetry(
        () => calculateAtsScore(improvedResume, job, trace),
        `ats-improved:${job.company}`,
        1
      );
      console.log(`⏱ [${elapsed()}] Improved ATS: ${improvedAts.score}/100`);
      if (substitutions.length) {
        console.log(`↳ ${substitutions.length} synonym substitution(s):`);
        substitutions.forEach(s => console.log(`  "${s.original_phrase}" → "${s.new_phrase}" (JD: ${s.jd_keyword})`));
      }
      if (improvedAts.score > ats.score) {
        resume = improvedResume;
        ats = improvedAts;
        improved = true;
      } else {
        substitutions = [];
      }
    } catch (e) {
      console.error(`⚠ Improvement pass failed (using original resume): ${e.message}`);
    }
  }

  // Store render options on resume JSON for download route
  resume._layoutOpts = layoutOpts;

  // Step 4: Render .docx
  console.log(`⏱ [${elapsed()}] Rendering .docx...`);
  const safe = (s) => String(s || 'x').replace(/[^a-z0-9]+/gi, '_');
  const fileName = `resume_${safe(job.company)}_${safe(job.title)}.docx`;
  const filePath = path.join(os.tmpdir(), fileName);
  try {
    await withRetry(
      () => renderResumeDocx(resume, filePath, layoutOpts),
      `render:${job.company}`,
      1
    );
  } catch (e) {
    await markJobFailed(job.job_id, `Rendering failed: ${e.message}`);
    throw e;
  }

  // Step 4.5: Cover letter — opt-in only. The user checks "Also generate a
  // cover letter" at submission time; cron (Gmail-forwarded alerts) never
  // sets this, since no one's there to ask and it'd be unnecessary LLM spend
  // on every 2-hour batch.
  let coverLetterText = null;
  let coverLetterFilePath = null;
  if (wantCoverLetter) {
    try {
      console.log(`⏱ [${elapsed()}] Writing cover letter...`);
      const paragraphs = await withRetry(
        () => coverLetter(resume, job, trace, profile, skills),
        `cover-letter:${job.company}`,
        1
      );
      if (paragraphs.length) {
        coverLetterText = paragraphs.join('\n\n');
        const coverLetterFileName = `cover_letter_${safe(job.company)}_${safe(job.title)}.docx`;
        coverLetterFilePath = path.join(os.tmpdir(), coverLetterFileName);
        await renderCoverLetterDocx(resume, job, paragraphs, coverLetterFilePath);
      }
      console.log(`⏱ [${elapsed()}] Cover letter done`);
    } catch (e) {
      console.error(`⚠ Cover letter failed (resume still proceeds): ${e.message}`);
    }
  }

  // Step 5: Save & deliver
  const metadata = { ...ats, improved, substitutions, tailoring_notes: tailoringNotes, jd_requirements: jdRequirements, layoutOpts };
  const tailoredId = await saveTailored(job.job_id, resume, filePath, userId, coverLetterText, coverLetterFilePath);
  await markDelivered(tailoredId, job.job_id, metadata);

  if (source === 'cron') {
    // Explicit delivery address wins — a user may forward job alerts from one
    // account (e.g. personal Gmail) but want the tailored resume sent to another
    // (e.g. a school email they actually apply from). Falls back to contact.email
    // for anyone who hasn't set this.
    const userEmail = profile.delivery_email || profile.contact?.email || null;
    const attachments = [{ path: filePath, name: fileName, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }];
    if (coverLetterFilePath) {
      attachments.push({ path: coverLetterFilePath, name: path.basename(coverLetterFilePath), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }
    try {
      await sendResumeEmail({
        to: userEmail,
        subject: `[ATS ${ats.score}/100] ${job.title} @ ${job.company}`,
        text: buildEmailBody({ job, ats, improved, substitutions }),
        attachments,
      });
      console.log(`✓ Resume emailed to ${userEmail || 'default TO_EMAIL'}`);
    } catch (e) {
      console.error(`⚠ Email failed for ${job.job_id} (resume still saved): ${e.message}`);
    }
  } else {
    console.log(`· Skipping email — job submitted in-app, user can download from Job Activity`);
  }

  console.log(`⏱ [${elapsed()}] Pipeline complete for ${job.company}`);
  trace.update({ output: { ats_score: ats.score, improved, substitutions_count: substitutions.length, resume_file: fileName, layoutOpts, jd_requirements_count: jdRequirements.length } });

  return { skipped: false, filePath, coverLetterFilePath, tailoredId, atsScore: ats.score, improved, substitutions, tailoringNotes, jdRequirements, layoutOpts };
}

function buildEmailBody({ job, ats, improved, substitutions }) {
  let body = `
RESUME ASSISTANT — TAILORED RESUME
====================================

Role:     ${job.title}
Company:  ${job.company}
${job.url ? `Job URL:  ${job.url}` : ''}

ATS MATCH SCORE: ${ats.score}/100 ${improved ? '(improved)' : ''}
${ats.summary}

Matched Keywords:
${(ats.matched_keywords || []).map((k) => `  - ${k}`).join('\n')}

Missing Keywords:
${(ats.missing_keywords || []).map((k) => `  - ${k}`).join('\n')}`;

  if (substitutions && substitutions.length > 0) {
    body += `\n\nSynonym Substitutions Applied:
${substitutions.map((s) => `  - "${s.original_phrase}" -> "${s.new_phrase}"\n    (JD keyword: ${s.jd_keyword})`).join('\n')}

These substitutions use JD terminology where your existing
experience is semantically equivalent. No new facts were added.`;
  }

  body += `\n\n====================================
Tailored resume attached as .docx
Generated by Resume Assistant`;

  return body.trim();
}

module.exports = { tightenResume, pagesFromFeedback, ensureBulletLabels, restoreBulletLabels, ensureResumeCompleteness, applyBulletLabels, cleanSummary, yearsOf, processJob, queueJob, getQueueStats, dropUntraceableBullets };
