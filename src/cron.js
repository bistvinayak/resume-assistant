'use strict';

const cron = require('node-cron');
const { queueJob } = require('./pipeline');
const { fetchLinkedInJobs } = require('./gmail');
const { scrapeLinkedInJob } = require('./scraper');
const { recoverStaleJobs, insertJobProcessing } = require('./db');

async function runBatch(userId = 'me') {
  console.log(`⏱  cron: checking LinkedIn job alert emails for ${userId}...`);
  let emailJobs = [];

  try {
    emailJobs = await fetchLinkedInJobs();
    console.log(`✓ found ${emailJobs.length} email(s)`);
  } catch (e) {
    console.error('✗ Gmail fetch failed:', e.message);
    return;
  }

  // Flatten: one job per URL
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
      });
    } else {
      for (const url of urls) {
        const jobId = url.match(/\/jobs\/view\/(\d+)/)?.[1] || Date.now();
        jobsToProcess.push({
          job_id: `linkedin_${jobId}`,
          title: email.title,
          company: email.company,
          jd_text: '',
          url,
        });
      }
    }
  }

  console.log(`✓ ${jobsToProcess.length} job(s) to process`);

  for (const job of jobsToProcess) {
    try {
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

      const result = await queueJob(job, userId, { source: 'cron' });
      console.log(result.skipped
        ? `· skipped ${job.job_id}`
        : `✓ ${job.company} — ${job.title} [ATS: ${result.atsScore}/100${result.improved ? ' improved' : ''}]`
      );
    } catch (e) {
      console.error(`✗ ${job.job_id}:`, e.message);
    }
  }
}

function startCron() {
  cron.schedule('0 */2 * * *', () => runBatch('me'));
  cron.schedule('*/5 * * * *', async () => {
    const recovered = await recoverStaleJobs(10).catch(() => []);
    if (!recovered.length) return;
    console.log(`⚠ recovered ${recovered.length} stale job(s) — retrying those with JD text`);
    for (const job of recovered) {
      if (!job.jd_text || job.jd_text.length < 50) {
        console.log(`  · ${job.company} — no JD text, staying failed`);
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

module.exports = { startCron, runBatch };
