 'use strict';

const path = require('path');
const os = require('os');
const { getProfile, getResumeFormat, seenJobBefore, saveTailored, markDelivered, markJobFailed } = require('./db');
const { tailorResume, calculateAtsScore, improveResume, coverLetter, createJobTrace } = require('./llm');
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
      const parts = [desc, outcome].filter(Boolean);
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

function tightenResume(resume, targetPages) {
  let changed = false;
  const experience = resume.experience || [];

  const removable = [];
  for (const exp of experience) {
    const bullets = exp.bullets || [];
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const serves = typeof b === 'object' ? b.serves : '';
      if (serves === 'additional role detail' || serves === 'role coverage (patched)') {
        removable.push({ exp, idx: i, priority: 0 });
      }
    }
  }

  for (const exp of [...experience].reverse()) {
    const bullets = exp.bullets || [];
    if (bullets.length <= 2) continue;
    for (let i = bullets.length - 1; i >= 2; i--) {
      const b = bullets[i];
      const text = typeof b === 'string' ? b : (b.text || '');
      const hasMetric = /\$[\d,.]+|\d+%|\d+[KMB]\+/.test(text);
      if (!hasMetric && !removable.some(r => r.exp === exp && r.idx === i)) {
        removable.push({ exp, idx: i, priority: 1 });
      }
    }
  }

  removable.sort((a, b) => a.priority - b.priority);

  for (const { exp, idx } of removable) {
    if ((exp.bullets || []).length <= 2) continue;
    exp.bullets.splice(idx, 1);
    changed = true;
  }

  return changed;
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

  // Step 1: Tailor resume — LLM selects + reframes all relevant bullets
  let resume, tailoringNotes, jdRequirements;
  try {
    console.log(`⏱ [${elapsed()}] Starting tailor...`);
    const tailorResult = await withRetry(
      () => tailorResume(profile, job, trace, resumeFormat),
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

  // Step 1.52: Dedup — remove near-duplicate bullets within the same role
  const dedupCount = dedupBullets(resume);
  if (dedupCount > 0) {
    console.log(`✂ Deduped ${dedupCount} near-duplicate bullet(s)`);
  }

  // Step 1.55: Enrich projects — always merge outcomes from profile
  for (const resumeProj of (resume.projects || [])) {
    const profileProj = (profile.projects || []).find(p => norm(p.name) === norm(resumeProj.name));
    if (profileProj) {
      const desc = (profileProj.description || '').replace(/[.\s]+$/, '');
      const outcome = (profileProj.outcome || '').replace(/[.\s]+$/, '');
      const parts = [desc, outcome].filter(Boolean);
      const fullDesc = parts.join('. ') + '.';
      if (fullDesc.length > (resumeProj.description || '').length) {
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

  // Step 1.6: Measure → expand/tighten → pick layout
  let layoutOpts = { fontScale: 1.0, lineGap: 1.5, sectionGap: 0.6, roleGap: 0.3 };
  if (resumeFormat?.style_profile?.section_order) layoutOpts.sectionOrder = resumeFormat.style_profile.section_order;
  if (resumeFormat?.style_profile?.heading_case) layoutOpts.headingCase = resumeFormat.style_profile.heading_case;
  if (resumeFormat?.style_profile?.bullet_indent_pt) layoutOpts.bulletIndent = resumeFormat.style_profile.bullet_indent_pt;
  if (resumeFormat?.style_profile?.role_header_style) layoutOpts.roleHeaderStyle = resumeFormat.style_profile.role_header_style;
  if (resumeFormat?.style_profile?.company_case) layoutOpts.companyCase = resumeFormat.style_profile.company_case;
  const targetPages = resumeFormat?.target_pages || null;

  try {
    let m = await measureResumePdf(resume, layoutOpts);
    console.log(`📐 Initial: ${m.pages} page(s), last page ${m.lastPageFill}% filled`);

    if (targetPages) {
      // A saved format pins an explicit page count — converge on it instead of the
      // reactive fill-based heuristic below. Bounded iterations since expand/tighten
      // can run out of profile content to add/remove before hitting the exact target.
      let iterations = 0;
      const MAX_TARGET_ITERATIONS = 4;
      while (m.pages !== targetPages && iterations < MAX_TARGET_ITERATIONS) {
        const changed = m.pages < targetPages
          ? expandResume(resume, profile, (targetPages - m.pages) >= 2 ? 'heavy' : 'medium')
          : tightenResume(resume, targetPages);
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
      const TARGET_FILL_FLOOR = 85;
      const MAX_FILL_ITERATIONS = 3;
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
        const shrinkSteps = [0.95, 0.9];
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
        tightenResume(resume, m.pages - 1);
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
        () => improveResume(resume, job, ats, trace, tailoringNotes, jdRequirements),
        `improve:${job.company}`,
        1
      );
      const improvedResume = improveResult.resume || improveResult;
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
        () => coverLetter(resume, job, trace, profile),
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

module.exports = { processJob, queueJob, getQueueStats };
