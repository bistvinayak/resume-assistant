'use strict';

const cron = require('node-cron');
const { processJob } = require('./pipeline');
const { fetchLinkedInJobs } = require('./gmail');
const { scrapeLinkedInJob } = require('./scraper');

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

      const result = await processJob(job, userId, { source: 'cron' });
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
  console.log('✓ cron scheduled (every 2 hours)');
}

module.exports = { startCron, runBatch };
