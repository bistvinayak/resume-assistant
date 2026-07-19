 'use strict';

const path = require('path');
const os = require('os');
const { getProfile, seenJobBefore, saveTailored, markDelivered, markJobFailed } = require('./db');
const { tailorResume, fitResume, calculateAtsScore, improveResume, createJobTrace } = require('./llm');
const { renderResumeDocx } = require('./renderDocx');
const { measureResumePdf } = require('./renderPdf');
const { sendResumeEmail } = require('./mailer');

const ATS_IMPROVEMENT_THRESHOLD = 95;

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

async function processJob(job, userId = 'me', { source = 'app', sessionId, userEmail, userName, force = false } = {}) {
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

  // Step 1: Tailor resume (retryable — LLM call)
  let resume, tailoringNotes;
  try {
    const tailorResult = await withRetry(
      () => tailorResume(profile, job, trace),
      `tailor:${job.company}`
    );
    tailoringNotes = tailorResult.tailoring_notes || [];
    delete tailorResult.tailoring_notes;
    resume = tailorResult;
  } catch (e) {
    await markJobFailed(job.job_id, `Tailoring failed after retries: ${e.message}`);
    throw e;
  }

  // Step 1.5: Content integrity check — verify resume content traces back to profile
  const integrityIssues = validateResumeContent(resume, profile);
  if (integrityIssues.missingRoles.length) {
    console.warn(`⚠ Tailoring dropped ${integrityIssues.missingRoles.length} role(s): ${integrityIssues.missingRoles.join(', ')} — patching`);
    for (const role of integrityIssues.missingRoles) {
      const profileRole = profile.experience.find(e => (e.company || '').toLowerCase() === role.toLowerCase());
      if (profileRole) {
        const bullets = (profileRole.bullets || []).slice(0, 2).map(b => typeof b === 'string' ? b : b.text || '');
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

  // Step 1.6: Page-fit loop — measure rendered PDF, adjust if needed
  try {
    const measurement = await measureResumePdf(resume);
    console.log(`📐 Page measurement for ${job.company}: ${measurement.pages} page(s), last page ${measurement.lastPageFill}% filled`);

    if (measurement.directive) {
      console.log(`↕ Page fit: ${measurement.directive} (${measurement.pages} pages, ${measurement.lastPageFill}% fill)`);
      const fitted = await withRetry(
        () => fitResume(resume, measurement.directive, profile, job, trace),
        `fit:${job.company}`,
        1
      );
      const verify = await measureResumePdf(fitted);
      console.log(`📐 After fit: ${verify.pages} page(s), last page ${verify.lastPageFill}% filled`);

      if (!verify.needsAdjustment || verify.pages === 1) {
        resume = fitted;
      } else {
        console.log(`⚠ Fit adjustment didn't fully resolve — using best result`);
        resume = fitted;
      }
    }
  } catch (e) {
    console.error(`⚠ Page-fit check failed (using original tailoring): ${e.message}`);
  }

  // Step 2: ATS score (retryable, degrades gracefully)
  let ats;
  try {
    ats = await withRetry(
      () => calculateAtsScore(resume, job, trace),
      `ats:${job.company}`
    );
  } catch (e) {
    console.error(`⚠ ATS scoring failed, proceeding without score: ${e.message}`);
    ats = { score: 0, matched_keywords: [], missing_keywords: [], summary: 'Scoring unavailable' };
  }

  console.log(`✓ ATS Score for ${job.company}: ${ats.score}/100`);

  // Step 3: Improvement pass (optional, already fault-tolerant)
  let improved = false;
  let substitutions = [];
  if (ats.score > 0 && ats.score < ATS_IMPROVEMENT_THRESHOLD) {
    console.log(`↑ Score ${ats.score} < ${ATS_IMPROVEMENT_THRESHOLD} — running improvement pass...`);
    try {
      const improveResult = await withRetry(
        () => improveResume(resume, job, ats, trace),
        `improve:${job.company}`,
        1
      );
      const improvedResume = improveResult.resume || improveResult;
      substitutions = improveResult.substitutions || [];

      const improvedAts = await withRetry(
        () => calculateAtsScore(improvedResume, job, trace),
        `ats-improved:${job.company}`,
        1
      );
      console.log(`✓ Improved ATS: ${improvedAts.score}/100`);
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

  // Step 4: Render (retryable — file system)
  const safe = (s) => String(s || 'x').replace(/[^a-z0-9]+/gi, '_');
  const fileName = `resume_${safe(job.company)}_${safe(job.title)}.docx`;
  const filePath = path.join(os.tmpdir(), fileName);
  try {
    await withRetry(
      () => renderResumeDocx(resume, filePath),
      `render:${job.company}`,
      1
    );
  } catch (e) {
    await markJobFailed(job.job_id, `Rendering failed: ${e.message}`);
    throw e;
  }

  // Step 5: Save & deliver
  const tailoredId = await saveTailored(job.job_id, resume, filePath, userId);
  await markDelivered(tailoredId, job.job_id, { ...ats, improved, substitutions, tailoring_notes: tailoringNotes });

  if (source === 'cron') {
    const userEmail = profile.contact?.email || null;
    try {
      await sendResumeEmail({
        to: userEmail,
        subject: `[ATS ${ats.score}/100] ${job.title} @ ${job.company}`,
        text: buildEmailBody({ job, ats, improved, substitutions }),
        attachmentPath: filePath,
        attachmentName: fileName,
      });
      console.log(`✓ Resume emailed to ${userEmail || 'default TO_EMAIL'}`);
    } catch (e) {
      console.error(`⚠ Email failed for ${job.job_id} (resume still saved): ${e.message}`);
    }
  } else {
    console.log(`· Skipping email — job submitted in-app, user can download from Job Activity`);
  }

  trace.update({ output: { ats_score: ats.score, improved, substitutions_count: substitutions.length, resume_file: fileName } });

  return { skipped: false, filePath, tailoredId, atsScore: ats.score, improved, substitutions, tailoringNotes };
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

module.exports = { processJob };
