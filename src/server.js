'use strict';

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const cors = require('cors');

const { pool, initSchema, getProfile, getJobsForUser, saveProfile, getProfileVersions, restoreProfileVersion, getJobByJobId, insertJobProcessing, markJobFailed, recoverStaleJobs, saveChatFeedback, getResumeFormat, saveResumeFormat, deleteResumeFormat, requestGmailForwarding, getGmailForwardingStatus } = require('./db');
const { ingestText, ingestPdf, ingestFiles, extractTextFromFile } = require('./profile');
const { queueJob, getQueueStats } = require('./pipeline');
const { startCron, runBatch } = require('./cron');
const { authMiddleware } = require('./auth');
const { connectGmail } = require('./gmail-connect');
const { scrapeLinkedInJob } = require('./scraper');
const { renderResumeDocx } = require('./renderDocx');
const { classifyIntent, chatEnrich, mapFormFields, analyzeResumeFormat, langfuse, syncPrompts } = require('./llm');
const { mergeProfile, applyDeletions, resolveConflicts } = require('./profile');

// Normalize LinkedIn URLs to direct job view format
function normalizeJobUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!u.hostname.includes('linkedin.com')) return rawUrl;

    // Direct job view: linkedin.com/jobs/view/4437670563
    const viewMatch = u.pathname.match(/\/jobs\/view\/(\d+)/);
    if (viewMatch) return `https://www.linkedin.com/jobs/view/${viewMatch[1]}/`;

    // Collection/search pages with currentJobId param:
    // linkedin.com/jobs/collections/top-applicant/?currentJobId=4437670563
    // linkedin.com/jobs/search/?currentJobId=4437670563
    const currentJobId = u.searchParams.get('currentJobId');
    if (currentJobId) return `https://www.linkedin.com/jobs/view/${currentJobId}/`;

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

const app = express();

// CORS — allow frontend domains
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://vinayakbist.com',
    'chrome-extension://ljeplebcfpakamlgehpfmemkbmnalfdc', // Arjun autofill extension
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id'],
}));

app.use(express.json());
const upload = multer({ dest: os.tmpdir() });

// In-memory ingestion status per user (cleared on completion)
const ingestionStatus = new Map();

function langfuseCtx(req) {
  return {
    userId: req.userId,
    sessionId: req.headers['x-session-id'],
    userEmail: req.userEmail,
    userName: req.userName,
  };
}

// Serve built React frontend
app.use('/projects/arjun', express.static(path.join(__dirname, '../public')));

// SPA catch-all: serve index.html for client-side routes
app.get('/projects/arjun/*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Auth on all API routes
app.use('/api', authMiddleware);
// Keep legacy routes working too
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path.startsWith('/api')) return next();
  authMiddleware(req, res, next);
});

// ── HEALTH ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/queue/stats', authMiddleware, (_req, res) => res.json(getQueueStats()));

// ── PROFILE ───────────────────────────────────────────────────────────────
app.get(['/profile', '/api/profile'], async (req, res, next) => {
  try { res.json(await getProfile(req.userId)); } catch (e) { next(e); }
});

app.put(['/profile', '/api/profile'], async (req, res, next) => {
  try {
    const { profile } = req.body || {};
    if (!profile) return res.status(400).json({ error: 'profile required' });
    await saveProfile(profile, req.userId, 'manual_edit');
    res.json(await getProfile(req.userId));
  } catch (e) { next(e); }
});

// ── PROFILE VERSIONS ─────────────────────────────────────────────────────
app.get(['/profile/versions', '/api/profile/versions'], async (req, res, next) => {
  try { res.json(await getProfileVersions(req.userId)); } catch (e) { next(e); }
});

app.post(['/profile/restore', '/api/profile/restore'], async (req, res, next) => {
  try {
    const { version } = req.body || {};
    if (!version) return res.status(400).json({ error: 'version required' });
    const profile = await restoreProfileVersion(req.userId, version);
    res.json(profile);
  } catch (e) { next(e); }
});

app.post(['/profile/resolve-conflicts', '/api/profile/resolve-conflicts'], async (req, res, next) => {
  try {
    const { resolutions } = req.body || {};
    if (!resolutions?.length) return res.status(400).json({ error: 'resolutions required' });
    const current = await getProfile(req.userId);
    const resolved = resolveConflicts(current, resolutions);
    await saveProfile(resolved, req.userId, 'conflict_resolution');
    res.json(resolved);
  } catch (e) { next(e); }
});

app.post(['/profile/resolve-ambiguities', '/api/profile/resolve-ambiguities'], async (req, res, next) => {
  try {
    const { answers } = req.body || {};
    if (!answers?.length) return res.status(400).json({ error: 'answers required' });
    const current = await getProfile(req.userId);
    for (const { field, value } of answers) {
      if (!field || value === undefined) continue;
      const parts = field.match(/^(\w+)(?:\[(\d+)\])?\.?(.*)$/);
      if (!parts) continue;
      const [, key, idx, subkey] = parts;
      if (idx !== undefined && Array.isArray(current[key])) {
        const i = parseInt(idx);
        if (current[key][i] && subkey) {
          current[key][i][subkey] = value;
        }
      } else if (subkey && current[key]) {
        current[key][subkey] = value;
      } else {
        current[key] = value;
      }
    }
    await saveProfile(current, req.userId, 'ambiguity_resolution');
    res.json(current);
  } catch (e) { next(e); }
});

app.post(['/ingest/text', '/api/ingest/text'], async (req, res, next) => {
  try {
    if (!req.body?.text) return res.status(400).json({ error: 'text required' });
    res.json(await ingestText(req.body.text, req.userId, langfuseCtx(req)));
  } catch (e) { next(e); }
});

app.post(['/ingest/pdf', '/api/ingest/pdf'], upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    res.json(await ingestPdf(req.file.path, req.userId, langfuseCtx(req)));
  } catch (e) { next(e); }
});

// Multi-file ingestion: PDF, DOCX, TXT, JSON (up to 5 files at once)
const { ALLOWED_EXTENSIONS } = require('./profile');
const uploadMultiple = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) cb(null, true);
    else cb(new Error(`Unsupported format: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`));
  },
}).array('files', 5);

app.post(['/ingest/files', '/api/ingest/files'], (req, res, next) => {
  console.log(`→ ingest/files: ${req.userId}, content-type: ${req.headers['content-type']}`);
  uploadMultiple(req, res, (err) => {
    if (err) {
      console.error(`✗ ingest/files multer error: ${err.message}`);
      return res.status(400).json({ error: err.message });
    }
    console.log(`✓ ingest/files: ${(req.files || []).length} file(s) received`);
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'At least one file required' });

    // Step 1: Extract text from all files (fast — no LLM)
    const texts = [];
    const errors = [];
    for (const file of req.files) {
      try {
        const text = await extractTextFromFile(file.path, file.originalname);
        if (text && text.trim().length > 10) texts.push(text.trim());
      } catch (e) {
        errors.push({ file: file.originalname, error: e.message });
      }
    }

    if (!texts.length) {
      const detail = errors.length ? errors.map(e => `${e.file}: ${e.error}`).join('; ') : 'No readable text found';
      return res.status(400).json({ error: `Could not extract text from any file. ${detail}` });
    }

    // Step 2: Respond immediately with extraction results
    const status = { stage: 'processing', filesExtracted: texts.length, filesSkipped: errors.length, errors };
    ingestionStatus.set(req.userId, status);

    res.json({ processing: true, filesExtracted: texts.length, filesSkipped: errors.length, errors: errors.length ? errors : undefined });

    // Step 3: Run LLM ingestion in background
    const ctx = langfuseCtx(req);
    const userId = req.userId;
    (async () => {
      try {
        console.log(`→ ingest/files background: extracting facts for ${userId} (${texts.length} docs, ~${texts.reduce((a, t) => a + t.length, 0)} chars)`);
        const result = await ingestFiles(req.files, userId, ctx);
        const conflicts = result._conflicts || [];
        const ambiguities = result._ambiguities || [];
        const extracted = result._extracted || '';
        const drops = result._drops || null;
        delete result._conflicts;
        delete result._ambiguities;
        delete result._extracted;
        delete result._drops;
        ingestionStatus.set(userId, { stage: 'done', profile: result, conflicts, ambiguities, extracted, drops, filesExtracted: texts.length, filesSkipped: errors.length, errors });
        console.log(`✓ ingest/files background: done for ${userId}, ${conflicts.length} conflict(s), ${drops?.items?.length || 0} drop(s)`);
      } catch (e) {
        console.error(`✗ ingest/files background error: ${e.message}`);
        ingestionStatus.set(userId, { stage: 'failed', error: e.message, filesExtracted: texts.length, filesSkipped: errors.length, errors });
      }
      setTimeout(() => ingestionStatus.delete(userId), 5 * 60 * 1000);
    })();
  } catch (e) { next(e); }
});

// Poll ingestion status
app.get(['/ingest/status', '/api/ingest/status'], async (req, res) => {
  const status = ingestionStatus.get(req.userId);
  if (!status) {
    return res.json({ stage: 'idle' });
  }
  if (status.stage === 'done') {
    ingestionStatus.delete(req.userId);
    return res.json(status);
  }
  res.json(status);
});

// ── RESUME FORMAT (style reference for tailored resume rendering) ──────────
app.get(['/resume-format', '/api/resume-format'], async (req, res, next) => {
  try {
    res.json(await getResumeFormat(req.userId));
  } catch (e) { next(e); }
});

app.post(['/resume-format', '/api/resume-format'], upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const targetPages = parseInt(req.body?.target_pages, 10);
    if (!targetPages || targetPages < 1) return res.status(400).json({ error: 'target_pages (positive integer) required' });

    const text = await extractTextFromFile(req.file.path, req.file.originalname);
    if (!text || text.trim().length < 50) return res.status(400).json({ error: 'Could not read enough text from the uploaded file' });

    const styleProfile = await analyzeResumeFormat(text, targetPages, langfuseCtx(req));
    const saved = await saveResumeFormat(req.userId, {
      target_pages: targetPages,
      style_profile: styleProfile,
      source_filename: req.file.originalname,
    });
    res.json(saved);
  } catch (e) { next(e); }
});

app.delete(['/resume-format', '/api/resume-format'], async (req, res, next) => {
  try {
    await deleteResumeFormat(req.userId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── CHAT (INTENT-FIRST) ─────────────────────────────────────────────────
app.post(['/chat', '/api/chat'], async (req, res, next) => {
  try {
    const { message, mode, history: rawHistory } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });

    const history = (Array.isArray(rawHistory) ? rawHistory : [])
      .filter(m => m && m.role && m.content)
      .slice(-10);

    const ctx = langfuseCtx(req);

    // ── TAILOR MODE: job URL processing (unchanged, always needs profile) ──
    const urlMatch = message.match(/https?:\/\/[^\s]+/);
    if (urlMatch && mode !== 'profile') {
      const currentProfile = await getProfile(req.userId);
      let url = urlMatch[0].replace(/[)>\]]+$/, '');
      url = normalizeJobUrl(url);

      const linkedInMatch = url.match(/\/jobs\/view\/(\d+)/);
      const jobId = linkedInMatch
        ? `linkedin_${linkedInMatch[1]}`
        : `url_${require('crypto').createHash('sha256').update(url).digest('hex').slice(0, 16)}`;

      const existing = await getJobByJobId(jobId, req.userId);
      if (existing && existing.status === 'processing') {
        const ageMs = Date.now() - new Date(existing.seen_at).getTime();
        if (ageMs < 5 * 60 * 1000) {
          return res.json({ reply: `This job is already being processed — hang tight! You'll see the result in the Job Activity tab once it's ready.`, profile: currentProfile, duplicate: true });
        }
      }
      const isRerun = existing && (existing.status === 'delivered' || existing.status === 'processing');

      const p = currentProfile;
      const skills = (p.skills || []).slice(0, 10).join(', ') || 'none listed';
      const expCount = (p.experience || []).length;
      const projCount = (p.projects || []).length;
      const gaps = [];
      if (!p.contact?.phone) gaps.push('phone number');
      if (!p.contact?.location) gaps.push('location');
      if (!expCount) gaps.push('work experience');
      if (!projCount) gaps.push('projects');
      if (!(p.skills || []).length) gaps.push('skills');

      const profileSummaryText = `Scraping that job listing now — I'll tailor your resume and calculate an ATS score. This takes about 30-60 seconds.\n\n` +
        `While we wait, here's your profile snapshot:\n` +
        `• **Skills:** ${skills}\n` +
        `• **Experience:** ${expCount} role${expCount !== 1 ? 's' : ''}\n` +
        `• **Projects:** ${projCount}\n` +
        (gaps.length ? `\n⚠️ Your profile is missing: **${gaps.join(', ')}**. Adding these before applying will improve your ATS match.` : `\n✅ Your profile looks solid!`);

      await insertJobProcessing({ job_id: jobId, url }, req.userId);
      res.json({ reply: profileSummaryText, profile: currentProfile, scraping: true });

      (async () => {
        const t0 = Date.now();
        try {
          console.log(`→ Chat: scraping ${url} for user ${req.userId}`);
          const scraped = await scrapeLinkedInJob(url);
          console.log(`⏱ Scrape took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          if (!scraped || !scraped.jd_text) {
            console.error(`✗ Could not scrape ${url}`);
            await markJobFailed(jobId, 'Could not scrape job page — page may require login or URL is invalid');
            return;
          }
          await queueJob({ job_id: jobId, title: scraped.title || 'Unknown Role', company: scraped.company || 'Unknown Company', jd_text: scraped.jd_text, url }, req.userId, { source: 'app', force: isRerun, ...ctx });
          console.log(`⏱ Total job processing: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        } catch (e) {
          console.error('Chat job processing error:', e.message);
          await markJobFailed(jobId, e.message).catch(() => {});
        }
      })();
      return;
    }

    // ── STEP 1: INTENT GATE (with profile + history) ──────────────────
    const currentProfile = await getProfile(req.userId);
    const intent = await classifyIntent(message, currentProfile, ctx, history);
    console.log(`→ Chat intent: ${intent.intent} | in_scope: ${intent.inScope} | user: ${req.userId}`);

    // URL: profile link — save directly, no LLM needed
    if (intent.intent === 'url_profile') {
      const field = intent.contactField;
      const url = intent.url;
      const fieldLabel = { linkedin: 'LinkedIn', github: 'GitHub', portfolio: 'portfolio' }[field] || field;
      currentProfile.contact = { ...currentProfile.contact, [field]: url };
      await saveProfile(currentProfile, req.userId, 'chat_confirm');
      return res.json({ reply: `Added your ${fieldLabel} link to your profile: ${url}`, profile: currentProfile, traceId: intent._traceId });
    }

    // URL: job link in profile mode — redirect
    if (intent.intent === 'url_job') {
      return res.json({ reply: 'To tailor a resume for a job, switch to the **Tailor Resume** tab and paste the URL there. This tab is just for building your profile.', traceId: intent._traceId });
    }

    // NOT IN SCOPE (greeting, out_of_scope) — intent gate already has the reply
    if (!intent.inScope) {
      return res.json({ reply: intent.reply, traceId: intent._traceId });
    }

    // QUESTION — intent gate answered directly using profile context
    if (intent.intent === 'question' && intent.reply) {
      return res.json({ reply: intent.reply, profile: currentProfile, traceId: intent._traceId });
    }

    // ── STEP 2: IN SCOPE → chatEnrich (with full profile + history) ─
    const result = await chatEnrich(message, currentProfile, ctx, history);

    const hasExtracted = result.extracted && Object.keys(result.extracted).length > 0;
    const hasDeletions = result.deletions && Object.keys(result.deletions).length > 0;

    res.json({
      reply: result.reply,
      profile: currentProfile,
      traceId: result._traceId,
      ...(hasExtracted ? { pendingChanges: result.extracted } : {}),
      ...(hasDeletions ? { pendingDeletions: result.deletions } : {}),
    });
  } catch (e) { next(e); }
});

// ── CHAT CONFIRM ─────────────────────────────────────────────────────────
app.post(['/chat/confirm', '/api/chat/confirm'], async (req, res, next) => {
  try {
    const { changes, deletions } = req.body || {};
    if (!changes && !deletions) return res.status(400).json({ error: 'changes or deletions required' });

    let currentProfile = await getProfile(req.userId);
    if (changes && Object.keys(changes).length) {
      currentProfile = mergeProfile(currentProfile, changes);
    }
    if (deletions && Object.keys(deletions).length) {
      currentProfile = applyDeletions(currentProfile, deletions);
    }
    await saveProfile(currentProfile, req.userId, 'chat_confirm');

    res.json({ ok: true, profile: currentProfile });
  } catch (e) { next(e); }
});

// ── FEEDBACK ─────────────────────────────────────────────────────────────
app.post(['/feedback', '/api/feedback'], async (req, res, next) => {
  try {
    const { traceId, score, comment, userMessage, arjunReply, chatMode } = req.body || {};
    if (!traceId || score === undefined) return res.status(400).json({ error: 'traceId and score required' });

    langfuse.score({
      traceId,
      name: 'user-feedback',
      value: score,
      ...(comment ? { comment } : {}),
    });
    await langfuse.flushAsync();

    await saveChatFeedback({
      userId: req.userId,
      userEmail: req.userEmail,
      traceId,
      score,
      comment,
      userMessage,
      arjunReply,
      chatMode,
    }).catch(e => console.error('⚠ Failed to save chat feedback:', e.message));

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── JOBS ──────────────────────────────────────────────────────────────────
// Get all processed jobs for this user
app.get(['/jobs', '/api/jobs'], async (req, res, next) => {
  try {
    const jobs = await getJobsForUser(req.userId);
    res.json({ jobs });
  } catch (e) { next(e); }
});

// Process one job manually (legacy)
app.post(['/jobs/process', '/api/jobs/process'], async (req, res, next) => {
  try {
    const { job_id, title, company, jd_text, url } = req.body || {};
    if (!job_id) return res.status(400).json({ error: 'job_id required' });
    res.json(await queueJob({ job_id, title, company, jd_text, url }, req.userId));
  } catch (e) { next(e); }
});

// Submit a LinkedIn job URL — scrape + process
app.post(['/jobs/submit-url', '/api/jobs/submit-url'], async (req, res, next) => {
  try {
    let { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });

    url = normalizeJobUrl(url);

    // Extract job ID from URL
    const jobIdMatch = url.match(/\/jobs\/view\/(\d+)/);
    if (!jobIdMatch) return res.status(400).json({ error: 'Could not find a job ID in this URL. Use a direct job link like linkedin.com/jobs/view/4437670563' });

    const job_id = `linkedin_${jobIdMatch[1]}`;

    // Block only if actively processing right now (but not if stale > 5 min)
    const existing = await getJobByJobId(job_id, req.userId);
    if (existing && existing.status === 'processing') {
      const ageMs = Date.now() - new Date(existing.seen_at).getTime();
      if (ageMs < 5 * 60 * 1000) {
        return res.json({ ok: true, job_id, duplicate: true, message: 'This job is already being processed' });
      }
      console.log(`⚠ Stale processing job ${job_id} (${Math.round(ageMs / 1000)}s old) — allowing re-run`);
    }

    const isRerun = existing && (existing.status === 'delivered' || existing.status === 'processing');
    await insertJobProcessing({ job_id, url }, req.userId);

    res.json({ ok: true, job_id, rerun: isRerun, message: isRerun ? 'Re-tailoring with updated profile...' : 'Job queued — resume will be emailed shortly' });

    // Background: scrape + process
    (async () => {
      try {
        console.log(`→ Scraping ${url} for user ${req.userId}${isRerun ? ' (re-run)' : ''}`);
        const scraped = await scrapeLinkedInJob(url);
        if (!scraped || !scraped.jd_text) {
          console.error(`✗ Could not scrape ${url}`);
          await markJobFailed(job_id, 'Could not scrape LinkedIn job page');
          return;
        }
        await queueJob({
          job_id,
          title: scraped.title,
          company: scraped.company,
          jd_text: scraped.jd_text,
          url,
        }, req.userId, { force: isRerun });
      } catch (e) {
        console.error('submit-url background error:', e.message);
        await markJobFailed(job_id, e.message).catch(() => {});
      }
    })();
  } catch (e) { next(e); }
});

// Run Gmail batch manually
app.post(['/jobs/run-batch', '/api/jobs/run-batch'], async (req, res, next) => {
  try {
    runBatch(req.userId).catch(console.error);
    res.json({ ok: true, message: 'Batch triggered — check server logs' });
  } catch (e) { next(e); }
});

app.post(['/gmail/connect', '/api/gmail/connect'], async (req, res) => connectGmail(req, res));

// ── BROWSER EXTENSION ────────────────────────────────────────────────────
// Maps scraped job-application form fields to profile values by meaning (LLM), not string matching.
app.post('/api/extension/map-fields', async (req, res, next) => {
  try {
    const { fields, url } = req.body;
    if (!Array.isArray(fields) || !fields.length) return res.json({ mappings: [] });

    const profile = await getProfile(req.userId);
    const mappings = await mapFormFields(fields, profile, { ...langfuseCtx(req), url });
    res.json({ mappings });
  } catch (e) { next(e); }
});

// ── SPA FALLBACK ──────────────────────────────────────────────────────────
app.get(['/projects/arjun', '/projects/arjun/*'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
initSchema()
  .then(async () => {
    app.listen(PORT, () => console.log(`✓ resume-assistant listening on ${PORT}`));
    startCron();
    await syncPrompts().catch(e => console.error('⚠ prompt sync failed (non-fatal):', e.message));
    const stale = await recoverStaleJobs(10).catch(() => []);
    if (stale.length) console.log(`⚠ startup: recovered ${stale.length} stale job(s) — cron will retry them`);
  })
  .catch((e) => { console.error('startup failed:', e); process.exit(1); });

module.exports = app;
// ADD THESE ROUTES TO server.js after the existing routes
// ── ADMIN ROUTES ──────────────────────────────────────────────────────────
const {
  adminOnly, getStats, getUsers, updateUser, deleteUser, getJobs: adminGetJobs, triggerCron, getSettings, updateSettings,
  getSchemaProposalsHandler, approveSchemaProposal, rejectSchemaProposal,
  getFeedbackHandler, reviewFeedback,
  getGmailForwardingHandler, approveGmailForwarding, rejectGmailForwarding,
} = require('./admin');

app.get(['/admin/stats', '/api/admin/stats'], authMiddleware, adminOnly, getStats);
app.get(['/admin/users', '/api/admin/users'], authMiddleware, adminOnly, getUsers);
app.patch(['/admin/users/:userId', '/api/admin/users/:userId'], authMiddleware, adminOnly, updateUser);
app.delete(['/admin/users/:userId', '/api/admin/users/:userId'], authMiddleware, adminOnly, deleteUser);
app.get(['/admin/jobs', '/api/admin/jobs'], authMiddleware, adminOnly, adminGetJobs);
app.post(['/admin/cron/run', '/api/admin/cron/run'], authMiddleware, adminOnly, triggerCron);
app.get(['/admin/settings', '/api/admin/settings'], authMiddleware, adminOnly, getSettings);
app.patch(['/admin/settings', '/api/admin/settings'], authMiddleware, adminOnly, updateSettings);
app.get(['/admin/schema-proposals', '/api/admin/schema-proposals'], authMiddleware, adminOnly, getSchemaProposalsHandler);
app.post(['/admin/schema-proposals/:id/approve', '/api/admin/schema-proposals/:id/approve'], authMiddleware, adminOnly, approveSchemaProposal);
app.post(['/admin/schema-proposals/:id/reject', '/api/admin/schema-proposals/:id/reject'], authMiddleware, adminOnly, rejectSchemaProposal);
app.get(['/admin/feedback', '/api/admin/feedback'], authMiddleware, adminOnly, getFeedbackHandler);
app.patch(['/admin/feedback/:id', '/api/admin/feedback/:id'], authMiddleware, adminOnly, reviewFeedback);
app.get(['/admin/gmail-forwarding', '/api/admin/gmail-forwarding'], authMiddleware, adminOnly, getGmailForwardingHandler);
app.post(['/admin/gmail-forwarding/:userId/approve', '/api/admin/gmail-forwarding/:userId/approve'], authMiddleware, adminOnly, approveGmailForwarding);
app.post(['/admin/gmail-forwarding/:userId/reject', '/api/admin/gmail-forwarding/:userId/reject'], authMiddleware, adminOnly, rejectGmailForwarding);

// ── RESUME DOWNLOAD ────────────────────────────────────────────────────────



app.get(['/jobs/:jobId/download', '/api/jobs/:jobId/download'], authMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    const format = (req.query.format || 'docx').toLowerCase();
    const { rows } = await pool.query(
      `SELECT t.resume_json, t.file_path, t.cover_letter_text, j.title, j.company
       FROM tailored_resume t
       JOIN jobs j ON j.job_id = t.job_id
       WHERE t.job_id = $1 AND t.user_id = $2
       ORDER BY t.created_at DESC LIMIT 1`,
      [jobId, req.userId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Resume not found' });

    const { resume_json, cover_letter_text, title, company } = rows[0];
    const safe = s => String(s || 'resume').replace(/[^a-z0-9]+/gi, '_');

    if (format === 'cover_letter') {
      if (!cover_letter_text) return res.status(404).json({ error: 'No cover letter for this job' });
      const { renderCoverLetterDocx } = require('./renderCoverLetter');
      const fileName = `arjun_cover_letter_${safe(company)}_${safe(title)}.docx`;
      const filePath = require('path').join(require('os').tmpdir(), fileName);
      const paragraphs = cover_letter_text.split('\n\n');
      await renderCoverLetterDocx(resume_json, { title, company }, paragraphs, filePath);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.sendFile(filePath);
    } else if (format === 'pdf') {
      const { renderResumePdf } = require('./renderPdf');
      const fileName = `arjun_${safe(company)}_${safe(title)}.pdf`;
      const filePath = require('path').join(require('os').tmpdir(), fileName);
      const layoutOpts = resume_json._layoutOpts || { fontScale: resume_json._fontScale || 1.0 };
      await renderResumePdf(resume_json, filePath, layoutOpts);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/pdf');
      res.sendFile(filePath);
    } else {
      const fileName = `arjun_${safe(company)}_${safe(title)}.docx`;
      const filePath = require('path').join(require('os').tmpdir(), fileName);
      await renderResumeDocx(resume_json, filePath);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.sendFile(filePath);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GMAIL FORWARDING (job-alert intake) ─────────────────────────────────────
// POST /api/gmail/request-forwarding — user asks to have their forwarded job
// alerts processed. Matching is by their verified login email; needs admin
// approval (Admin > Gmail Forwarding) before it takes effect.
app.post(['/gmail/request-forwarding', '/api/gmail/request-forwarding'], authMiddleware, async (req, res, next) => {
  try {
    const request = await requestGmailForwarding(req.userId, req.userEmail);
    res.json({ ok: true, request });
  } catch (e) { next(e); }
});

app.get(['/gmail/forwarding-status', '/api/gmail/forwarding-status'], authMiddleware, async (req, res, next) => {
  try {
    res.json(await getGmailForwardingStatus(req.userId));
  } catch (e) { next(e); }
});
