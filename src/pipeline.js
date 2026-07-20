 'use strict';

const path = require('path');
const os = require('os');
const { getProfile, seenJobBefore, saveTailored, markDelivered, markJobFailed } = require('./db');
const { tailorResume, calculateAtsScore, improveResume, createJobTrace } = require('./llm');
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

function expandResume(resume, profile) {
  let changed = false;
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

  for (const resumeExp of (resume.experience || [])) {
    const profileExp = (profile.experience || []).find(p =>
      norm(p.company) === norm(resumeExp.company) && norm(p.title) === norm(resumeExp.title)
    ) || (profile.experience || []).find(p => norm(p.company) === norm(resumeExp.company));

    if (!profileExp) continue;

    const profileBullets = (profileExp.bullets || []).map(b => typeof b === 'string' ? b : b.text || '');
    const resumeBulletTexts = new Set((resumeExp.bullets || []).map(b =>
      norm(typeof b === 'string' ? b : b.text || '')
    ));

    const missing = profileBullets.filter(bt => !resumeBulletTexts.has(norm(bt)));
    if (missing.length > 0 && (resumeExp.bullets || []).length <= 5) {
      const toAdd = missing.slice(0, 3);
      resumeExp.bullets = [...(resumeExp.bullets || []), ...toAdd.map(t => ({ text: t, serves: 'additional role detail' }))];
      changed = true;
    }
  }

  for (const resumeProj of (resume.projects || [])) {
    const profileProj = (profile.projects || []).find(p =>
      norm(p.name) === norm(resumeProj.name)
    );
    if (profileProj) {
      const profileDesc = [profileProj.description, profileProj.outcome].filter(Boolean).join('. ');
      if (profileDesc.length > (resumeProj.description || '').length) {
        resumeProj.description = profileDesc;
        changed = true;
      }
    }
  }

  return changed;
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

  // Step 1: Tailor resume — LLM selects + reframes all relevant bullets
  let resume, tailoringNotes, jdRequirements;
  try {
    const tailorResult = await withRetry(
      () => tailorResume(profile, job, trace),
      `tailor:${job.company}`
    );
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

  // Step 1.55: Enrich projects — always merge outcomes from profile (regardless of page fill)
  for (const resumeProj of (resume.projects || [])) {
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    const profileProj = (profile.projects || []).find(p => norm(p.name) === norm(resumeProj.name));
    if (profileProj) {
      const parts = [profileProj.description, profileProj.outcome].filter(Boolean);
      const fullDesc = parts.join('. ');
      if (fullDesc.length > (resumeProj.description || '').length) {
        resumeProj.description = fullDesc;
      }
      if (profileProj.tags && profileProj.tags.length && !resumeProj.tags) {
        resumeProj.tags = profileProj.tags;
      }
    }
  }

  // Step 1.6: Deterministic page-fill — measure, expand if content spills past a page boundary
  let fontScale = 1.0;
  try {
    let measurement = await measureResumePdf(resume, { fontScale });
    console.log(`📐 Page measurement for ${job.company}: ${measurement.pages} page(s), last page ${measurement.lastPageFill}% filled`);

    if (measurement.pages > 1 && measurement.lastPageFill < 60) {
      console.log(`↕ Spills to page ${measurement.pages} at ${measurement.lastPageFill}% — expanding to fill`);

      const expanded = expandResume(resume, profile);
      if (expanded) {
        measurement = await measureResumePdf(resume, { fontScale });
        console.log(`📐 After content expand: ${measurement.pages} page(s), ${measurement.lastPageFill}% filled`);
      }

      if (measurement.pages > 1 && measurement.lastPageFill < 55) {
        fontScale = 1.05;
        measurement = await measureResumePdf(resume, { fontScale });
        console.log(`📐 Font scale 1.05: ${measurement.pages} page(s), ${measurement.lastPageFill}% filled`);
      }

      if (measurement.pages > 1 && measurement.lastPageFill < 50) {
        fontScale = 1.08;
        measurement = await measureResumePdf(resume, { fontScale });
        console.log(`📐 Font scale 1.08: ${measurement.pages} page(s), ${measurement.lastPageFill}% filled`);
      }
    }
  } catch (e) {
    console.error(`⚠ Page measurement failed (using original): ${e.message}`);
  }

  // Step 2: ATS score
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

  // Step 3: Improvement pass (if ATS below threshold)
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

  // Store render options on resume JSON for download route
  if (fontScale !== 1.0) resume._fontScale = fontScale;

  // Step 4: Render .docx
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
  const metadata = { ...ats, improved, substitutions, tailoring_notes: tailoringNotes, jd_requirements: jdRequirements, fontScale };
  const tailoredId = await saveTailored(job.job_id, resume, filePath, userId);
  await markDelivered(tailoredId, job.job_id, metadata);

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

  trace.update({ output: { ats_score: ats.score, improved, substitutions_count: substitutions.length, resume_file: fileName, fontScale, jd_requirements_count: jdRequirements.length } });

  return { skipped: false, filePath, tailoredId, atsScore: ats.score, improved, substitutions, tailoringNotes, jdRequirements, fontScale };
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
