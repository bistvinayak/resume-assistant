'use strict';

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const cors = require('cors');

const { initSchema, getProfile, getJobsForUser } = require('./db');
const { ingestText, ingestPdf } = require('./profile');
const { processJob } = require('./pipeline');
const { startCron, runBatch } = require('./cron');
const { authMiddleware } = require('./auth');
const { connectGmail } = require('./gmail-connect');
const { scrapeLinkedInJob } = require('./scraper');

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
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });

    // Extract job ID from URL
    const jobIdMatch = url.match(/\/jobs\/view\/(\d+)/);
    if (!jobIdMatch) return res.status(400).json({ error: 'invalid LinkedIn job URL' });

    const job_id = `linkedin_${jobIdMatch[1]}`;

    // Respond immediately, process in background
    res.json({ ok: true, job_id, message: 'Job queued — resume will be emailed shortly' });

    // Background: scrape + process
    (async () => {
      try {
        console.log(`→ Scraping ${url} for user ${req.userId}`);
        const scraped = await scrapeLinkedInJob(url);
        if (!scraped || !scraped.jd_text) {
          console.error(`✗ Could not scrape ${url}`);
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
  .then(() => {
    app.listen(PORT, () => console.log(`✓ resume-assistant listening on ${PORT}`));
    startCron();
  })
  .catch((e) => { console.error('startup failed:', e); process.exit(1); });

module.exports = app;
