'use strict';

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const os = require('os');

const { initSchema, getProfile } = require('./db');
const { ingestText, ingestPdf } = require('./profile');
const { processJob } = require('./pipeline');
const { startCron, runBatch } = require('./cron');

const app = express();
app.use(express.json());
const upload = multer({ dest: os.tmpdir() });

// Simple shared-secret auth on everything except /health.
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.header('x-api-key');
  if (!process.env.API_KEY || key === process.env.API_KEY) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// View the current master profile.
app.get('/profile', async (_req, res, next) => {
  try { res.json(await getProfile()); } catch (e) { next(e); }
});

// Ingest a free-text fact:  { "text": "I now know Kubernetes" }
app.post('/ingest/text', async (req, res, next) => {
  try {
    if (!req.body || !req.body.text) return res.status(400).json({ error: 'text required' });
    res.json(await ingestText(req.body.text));
  } catch (e) { next(e); }
});

// Ingest a resume PDF (multipart form field name: "file").
app.post('/ingest/pdf', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    res.json(await ingestPdf(req.file.path));
  } catch (e) { next(e); }
});

// Tailor + render + email for one job.
// Body: { job_id, title, company, jd_text }
app.post('/jobs/process', async (req, res, next) => {
  try {
    const { job_id, title, company, jd_text } = req.body || {};
    if (!job_id) return res.status(400).json({ error: 'job_id required' });
    res.json(await processJob({ job_id, title, company, jd_text }));
  } catch (e) { next(e); }
});

// Manually trigger Gmail batch (no need to wait for cron).
app.post('/jobs/run-batch', async (req, res, next) => {
  try {
    await runBatch();
    res.json({ ok: true, message: 'Batch triggered — check server logs' });
  } catch (e) { next(e); }
});

// Error handler.
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
