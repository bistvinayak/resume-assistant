'use strict';

const cron = require('node-cron');
const { processJob } = require('./pipeline');
const { fetchLinkedInJobs } = require('./gmail');
const { scrapeLinkedInJob } = require('./scraper');

async function runBatch() {
  console.log('⏱  cron: checking LinkedIn job alert emails...');
  let emailJobs = [];

  try {
    emailJobs = await fetchLinkedInJobs();
    console.log(`✓ found ${emailJobs.length} email(s) with job alerts`);
  } catch (e) {
    console.error('✗ Gmail fetch failed:', e.message);
    return;
  }

  // Flatten: one job object per URL across all emails
  const jobsToProcess = [];
  for (const email of emailJobs) {
    const urls = email.jobUrls || [];
    if (urls.length === 0) {
      // No URLs — use email text as fallback (one job per email)
      jobsToProcess.push({
        job_id: email.job_id,
        title: email.title,
        company: email.company,
        jd_text: email.jd_text,
        url: null,
      });
    } else {
      // One job per URL
      for (const url of urls) {
        const jobId = url.match(/\/jobs\/view\/(\d+)/)?.[1] || Date.now();
        jobsToProcess.push({
          job_id: `linkedin_${jobId}`,
          title: email.title, // will be overridden after scrape
          company: email.company, // will be overridden after scrape
          jd_text: '', // will be filled after scrape
          url,
        });
      }
    }
  }

  console.log(`✓ ${jobsToProcess.length} individual job(s) to process`);

  for (const job of jobsToProcess) {
    try {
      // Scrape full JD for this specific job
      if (job.url) {
        console.log(`· Scraping: ${job.url}`);
        const scraped = await scrapeLinkedInJob(job.url);
        if (scraped && scraped.jd_text) {
          job.title = scraped.title || job.title;
          job.company = scraped.company || job.company;
          job.jd_text = scraped.jd_text;
          console.log(`✓ Scraped JD for ${job.company} — ${job.jd_text.length} chars`);
        } else {
          console.log(`· Scrape failed for ${job.url}, skipping`);
          continue;
        }
      }

      const result = await processJob(job);
      console.log(result.skipped
        ? `· skipped ${job.job_id} (already processed)`
        : `✓ processed ${job.company} — ${job.title} [ATS: ${result.atsScore}/100]`
      );
    } catch (e) {
      console.error(`✗ ${job.job_id}:`, e.message);
    }
  }
}

function startCron() {
  cron.schedule('0 */2 * * *', runBatch);
  console.log('✓ cron scheduled (every 2 hours)');
}

module.exports = { startCron, runBatch };
