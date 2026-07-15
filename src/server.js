'use strict';

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const cors = require('cors');

const { pool, initSchema, getProfile, getJobsForUser, saveProfile, getJobByJobId, insertJobProcessing, markJobFailed } = require('./db');
const { ingestText, ingestPdf } = require('./profile');
const { processJob } = require('./pipeline');
const { startCron, runBatch } = require('./cron');
const { authMiddleware } = require('./auth');
const { connectGmail } = require('./gmail-connect');
const { scrapeLinkedInJob } = require('./scraper');
const { renderResumeDocx } = require('./renderDocx');
const { chatEnrich, langfuse, syncPrompts } = require('./llm');
const { mergeProfile, applyDeletions } = require('./profile');

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
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
}));

app.use(express.json());
const upload = multer({ dest: os.tmpdir() });

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

// ── PROFILE ───────────────────────────────────────────────────────────────
app.get(['/profile', '/api/profile'], async (req, res, next) => {
  try { res.json(await getProfile(req.userId)); } catch (e) { next(e); }
});

app.put(['/profile', '/api/profile'], async (req, res, next) => {
  try {
    const { profile } = req.body || {};
    if (!profile) return res.status(400).json({ error: 'profile required' });
    await saveProfile(profile, req.userId);
    res.json(await getProfile(req.userId));
  } catch (e) { next(e); }
});

app.post(['/ingest/text', '/api/ingest/text'], async (req, res, next) => {
  try {
    if (!req.body?.text) return res.status(400).json({ error: 'text required' });
    res.json(await ingestText(req.body.text, req.userId));
  } catch (e) { next(e); }
});

app.post(['/ingest/pdf', '/api/ingest/pdf'], upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    res.json(await ingestPdf(req.file.path, req.userId));
  } catch (e) { next(e); }
});

// ── CHAT ENRICH ──────────────────────────────────────────────────────────
app.post(['/chat', '/api/chat'], async (req, res, next) => {
  try {
    const { message, mode } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });

    const currentProfile = await getProfile(req.userId);

    // Detect any job URL — but only process if mode is 'tailor' (not 'profile')
    const urlMatch = message.match(/https?:\/\/[^\s]+/);
    if (urlMatch && mode !== 'profile') {
      let url = urlMatch[0].replace(/[)>\]]+$/, '');

      // Normalize LinkedIn URLs — extract the actual job view URL
      url = normalizeJobUrl(url);

      const jobId = `url_${Buffer.from(url).toString('base64url').slice(0, 40)}`;

      // Check if this job is currently being processed
      const existing = await getJobByJobId(jobId, req.userId);
      if (existing && existing.status === 'processing') {
        return res.json({
          reply: `This job is already being processed — hang tight! You'll see the result in the Job Activity tab once it's ready.`,
          profile: currentProfile,
          duplicate: true,
        });
      }
      // delivered or failed — allow re-tailoring (profile may have changed)

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

      const profileSummary = `Scraping that job listing now — I'll tailor your resume and calculate an ATS score. This takes about 30-60 seconds.\n\n` +
        `While we wait, here's your profile snapshot:\n` +
        `• **Skills:** ${skills}\n` +
        `• **Experience:** ${expCount} role${expCount !== 1 ? 's' : ''}\n` +
        `• **Projects:** ${projCount}\n` +
        (gaps.length ? `\n⚠️ Your profile is missing: **${gaps.join(', ')}**. Adding these before applying will improve your ATS match.` : `\n✅ Your profile looks solid!`);

      // Insert job as 'processing' immediately so it's visible
      await insertJobProcessing({ job_id: jobId, url }, req.userId);

      res.json({ reply: profileSummary, profile: currentProfile, scraping: true });

      (async () => {
        try {
          console.log(`→ Chat: scraping ${url} for user ${req.userId}`);
          const scraped = await scrapeLinkedInJob(url);
          if (!scraped || !scraped.jd_text) {
            console.error(`✗ Could not scrape ${url}`);
            await markJobFailed(jobId, 'Could not scrape job page — page may require login or URL is invalid');
            return;
          }
          await processJob({
            job_id: jobId,
            title: scraped.title || 'Unknown Role',
            company: scraped.company || 'Unknown Company',
            jd_text: scraped.jd_text,
            url,
          }, req.userId);
        } catch (e) {
          console.error('Chat job processing error:', e.message);
          await markJobFailed(jobId, e.message).catch(() => {});
        }
      })();
      return;
    }

    const result = await chatEnrich(message, currentProfile);

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
    await saveProfile(currentProfile, req.userId);

    res.json({ ok: true, profile: currentProfile });
  } catch (e) { next(e); }
});

// ── FEEDBACK ─────────────────────────────────────────────────────────────
app.post(['/feedback', '/api/feedback'], async (req, res, next) => {
  try {
    const { traceId, score, comment } = req.body || {};
    if (!traceId || score === undefined) return res.status(400).json({ error: 'traceId and score required' });

    langfuse.score({
      traceId,
      name: 'user-feedback',
      value: score,
      ...(comment ? { comment } : {}),
    });
    await langfuse.flushAsync();

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
    res.json(await processJob({ job_id, title, company, jd_text, url }, req.userId));
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

    // Block only if actively processing right now
    const existing = await getJobByJobId(job_id, req.userId);
    if (existing && existing.status === 'processing') {
      return res.json({ ok: true, job_id, duplicate: true, message: 'This job is already being processed' });
    }

    await insertJobProcessing({ job_id, url }, req.userId);

    res.json({ ok: true, job_id, message: 'Job queued — resume will be emailed shortly' });

    // Background: scrape + process
    (async () => {
      try {
        console.log(`→ Scraping ${url} for user ${req.userId}`);
        const scraped = await scrapeLinkedInJob(url);
        if (!scraped || !scraped.jd_text) {
          console.error(`✗ Could not scrape ${url}`);
          await markJobFailed(job_id, 'Could not scrape LinkedIn job page');
          return;
        }
        await processJob({
          job_id,
          title: scraped.title,
          company: scraped.company,
          jd_text: scraped.jd_text,
          url,
        }, req.userId);
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
  })
  .catch((e) => { console.error('startup failed:', e); process.exit(1); });

module.exports = app;
// ADD THESE ROUTES TO server.js after the existing routes
// ── ADMIN ROUTES ──────────────────────────────────────────────────────────
const { adminOnly, getStats, getUsers, updateUser, deleteUser, getJobs: adminGetJobs, triggerCron, getSettings, updateSettings } = require('./admin');

app.get(['/admin/stats', '/api/admin/stats'], authMiddleware, adminOnly, getStats);
app.get(['/admin/users', '/api/admin/users'], authMiddleware, adminOnly, getUsers);
app.patch(['/admin/users/:userId', '/api/admin/users/:userId'], authMiddleware, adminOnly, updateUser);
app.delete(['/admin/users/:userId', '/api/admin/users/:userId'], authMiddleware, adminOnly, deleteUser);
app.get(['/admin/jobs', '/api/admin/jobs'], authMiddleware, adminOnly, adminGetJobs);
app.post(['/admin/cron/run', '/api/admin/cron/run'], authMiddleware, adminOnly, triggerCron);
app.get(['/admin/settings', '/api/admin/settings'], authMiddleware, adminOnly, getSettings);
app.patch(['/admin/settings', '/api/admin/settings'], authMiddleware, adminOnly, updateSettings);

// ── RESUME DOWNLOAD ────────────────────────────────────────────────────────



app.get(['/jobs/:jobId/download', '/api/jobs/:jobId/download'], authMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    const format = (req.query.format || 'docx').toLowerCase();
    const { rows } = await pool.query(
      `SELECT t.resume_json, t.file_path, j.title, j.company
       FROM tailored_resume t
       JOIN jobs j ON j.job_id = t.job_id
       WHERE t.job_id = $1 AND t.user_id = $2
       ORDER BY t.created_at DESC LIMIT 1`,
      [jobId, req.userId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Resume not found' });

    const { resume_json, title, company } = rows[0];
    const safe = s => String(s || 'resume').replace(/[^a-z0-9]+/gi, '_');

    if (format === 'pdf') {
      const { renderResumePdf } = require('./renderPdf');
      const fileName = `arjun_${safe(company)}_${safe(title)}.pdf`;
      const filePath = require('path').join(require('os').tmpdir(), fileName);
      await renderResumePdf(resume_json, filePath);
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

// ── GMAIL VERIFY ───────────────────────────────────────────────────────────
// POST /api/gmail/verify — user claims they set up filter, we mark it pending
app.post(['/gmail/verify', '/api/gmail/verify'], authMiddleware, async (req, res) => {
  try {
    await pool.query(
      `UPDATE master_profile SET 
        profile = jsonb_set(COALESCE(profile, '{}'), '{gmail_filter_pending}', 'true'),
        updated_at = now()
       WHERE user_id = $1`,
      [req.userId]
    );
    res.json({ ok: true, message: 'Marked as pending — will verify on next email received' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
