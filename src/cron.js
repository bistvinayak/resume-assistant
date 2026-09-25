'use strict';

const cron = require('node-cron');
const { queueJob } = require('./pipeline');
const { fetchLinkedInJobs } = require('./gmail');
const { scrapeLinkedInJob } = require('./scraper');
const { sendAcknowledgmentEmail } = require('./mailer');
const { recoverStaleJobs, insertJobProcessing, getApprovedForwardingMap, getProfile } = require('./db');

async function runBatch() {
  console.log(`⏱  cron: checking forwarded job alert emails...`);
  let emailJobs = [];

  try {
    const approvedMap = await getApprovedForwardingMap();
    emailJobs = await fetchLinkedInJobs(approvedMap);
    console.log(`✓ found ${emailJobs.length} matched email(s)`);
  } catch (e) {
    console.error('✗ Gmail fetch failed:', e.message);
    return;
  }

  // Acknowledge receipt immediately, per email — before scraping/tailoring even starts.
  for (const email of emailJobs) {
    sendAcknowledgmentEmail({ to: email.forwarderEmail, jobTitle: email.title, company: email.company })
      .catch(e => console.error(`⚠ Acknowledgment email failed for ${email.forwarderEmail}: ${e.message}`));
  }

  // Flatten: one job per URL, carrying the matched userId through
  const jobsToProcess = [];
  for (const email of emailJobs) {
    const urls = email.jobUrls || [];
    if (urls.length === 0) {
      jobsToProcess.push({
        job_id: email.job_id,
        title: email.title,
        company: email.company,
        jd_text: email.jd_text,
        url: null,
        userId: email.userId,
      });
    } else {
      for (const url of urls) {
        const jobId = url.match(/\/jobs\/view\/(\d+)/)?.[1] || Date.now();
        jobsToProcess.push({
          job_id: `linkedin_${jobId}_${(email.userId || 'me').slice(0, 8)}`,
          title: email.title,
          company: email.company,
          jd_text: '',
          url,
          userId: email.userId,
        });
      }
    }
  }

  console.log(`✓ ${jobsToProcess.length} job(s) to process`);

  for (const job of jobsToProcess) {
    try {
      // Per-user kill switch — settable by the user in their Dashboard or by
      // an admin — for pausing automatic resume generation from forwarded
      // Gmail alerts without having to revoke forwarding approval entirely.
      const profile = await getProfile(job.userId).catch(() => null);
      if (profile?.auto_process_paused) {
        console.log(`· auto-processing paused for user ${job.userId}, skipping ${job.job_id}`);
        continue;
      }

      if (job.url) {
        const scraped = await scrapeLinkedInJob(job.url);
        if (scraped && scraped.jd_text) {
          job.title = scraped.title || job.title;
          job.company = scraped.company || job.company;
          job.jd_text = scraped.jd_text;
        } else {
          console.log(`· Scrape failed for ${job.url}, skipping`);
          continue;
        }
      }

      const result = await queueJob(job, job.userId, { source: 'cron' });
      console.log(result.skipped
        ? `· skipped ${job.job_id}`
        : `✓ ${job.company} — ${job.title} [ATS: ${result.atsScore}/100${result.improved ? ' improved' : ''}]`
      );
    } catch (e) {
      console.error(`✗ ${job.job_id}:`, e.message);
    }
  }
}

// Retries queued uploads for about an hour (12 × 5 min), applying them with the same merge +
// dedupe path as a live upload. The user was told it would appear automatically.
const MAX_PENDING_ATTEMPTS = 12;
let pendingRunning = false;
async function processPendingIngestions() {
  if (pendingRunning) return;
  pendingRunning = true;
  try {
    const { getDuePendingIngestions, markPendingIngestion } = require('./db');
    const { ingestText } = require('./profile');
    for (const item of await getDuePendingIngestions(5)) {
      try {
        await ingestText(item.text, item.user_id, { userId: item.user_id, source: 'queued_upload' });
        await markPendingIngestion(item.id, { status: 'done', incrementAttempts: true });
        console.log(`✓ queued upload ${item.id} for ${item.user_id} added to profile`);
      } catch (e) {
        const status = item.attempts + 1 >= MAX_PENDING_ATTEMPTS ? 'failed' : 'pending';
        await markPendingIngestion(item.id, { status, error: e.message, incrementAttempts: true });
        console.error(`✗ queued upload ${item.id} attempt ${item.attempts + 1} failed${status === 'failed' ? ' (giving up)' : ''}: ${e.message.slice(0, 160)}`);
      }
    }
  } finally {
    pendingRunning = false;
  }
}

function startCron() {
  cron.schedule('0 */2 * * *', () => runBatch());
  // Self-healing agents: turn disliked chats and extension problems into proposals (hourly).
  cron.schedule('17 * * * *', () => require('./healing').runSelfHealing().catch(e => console.error('self-healing run failed:', e.message)));

  // Nightly database backup (scripts/backup-db.sh, 7 days kept in ~/backups).
  cron.schedule('30 3 * * *', () => {
    require('child_process').execFile('bash', [require('path').join(__dirname, '..', 'scripts', 'backup-db.sh')], (err, stdout, stderr) => {
      if (err) console.error(`✗ nightly backup failed: ${(stderr || err.message).trim()}`);
      else console.log(`✓ nightly ${stdout.trim()}`);
    });
  });

  // Finish uploads that failed while the AI provider was down (see pending_ingestions).
  cron.schedule('*/5 * * * *', () => processPendingIngestions().catch(e => console.error('pending ingestion run failed:', e.message)));

  cron.schedule('*/5 * * * *', async () => {
    const recovered = await recoverStaleJobs(10).catch(() => []);
    if (!recovered.length) return;
    console.log(`⚠ recovered ${recovered.length} stale job(s) — retrying`);
    for (const job of recovered) {
      if ((!job.jd_text || job.jd_text.length < 50) && job.url) {
        console.log(`  ↻ ${job.company} — no usable JD text, re-scraping ${job.url}`);
        const scraped = await scrapeLinkedInJob(job.url).catch(() => null);
        if (scraped?.jd_text) {
          job.jd_text = scraped.jd_text;
          job.title = scraped.title || job.title;
          job.company = scraped.company || job.company;
        }
      }
      if (!job.jd_text || job.jd_text.length < 50) {
        console.log(`  · ${job.company} — still no JD text, staying failed`);
        continue;
      }
      try {
        console.log(`  ↻ retrying ${job.company} - ${job.title}`);
        await insertJobProcessing({ job_id: job.job_id, url: job.url }, job.user_id);
        await queueJob(job, job.user_id, { source: 'recovery' });
        console.log(`  ✓ ${job.company} recovered successfully`);
      } catch (e) {
        console.error(`  ✗ ${job.company} retry failed: ${e.message}`);
      }
    }
  });
  console.log('✓ cron scheduled (jobs every 2h, stale recovery every 5min)');
}

module.exports = { processPendingIngestions, startCron, runBatch };
