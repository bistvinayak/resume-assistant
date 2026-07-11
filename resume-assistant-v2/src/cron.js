'use strict';

const cron = require('node-cron');
const { processJob } = require('./pipeline');
const { fetchLinkedInJobs } = require('./gmail');

async function runBatch() {
  console.log('⏱  cron: checking LinkedIn job alert emails...');
  let jobs = [];

  try {
    jobs = await fetchLinkedInJobs();
    console.log(`✓ found ${jobs.length} new job alert(s)`);
  } catch (e) {
    console.error('✗ Gmail fetch failed:', e.message);
    return;
  }

  for (const job of jobs) {
    try {
      const result = await processJob(job);
      console.log(result.skipped ? `· skipped ${job.job_id}` : `✓ processed ${job.job_id}`);
    } catch (e) {
      console.error(`✗ ${job.job_id}:`, e.message);
    }
  }
}

function startCron() {
  // Every 2 hours
  cron.schedule('0 */2 * * *', runBatch);
  console.log('✓ cron scheduled (every 2 hours)');
}

module.exports = { startCron, runBatch };
