'use strict';

const puppeteer = require('puppeteer');

/**
 * Extract all LinkedIn job URLs from email text.
 * LinkedIn alert emails contain URLs like:
 * https://www.linkedin.com/jobs/view/XXXXXXXXX
 * or tracking URLs that redirect to job pages
 */
function extractJobUrls(emailText) {
  const urlRegex = /https?:\/\/[^\s<>"]+linkedin\.com\/jobs\/view\/[^\s<>"&]+/gi;
  const matches = emailText.match(urlRegex) || [];
  // Dedupe
  return [...new Set(matches)];
}

/**
 * Use Puppeteer to open a LinkedIn job URL and scrape the full JD.
 * Returns { title, company, location, jd_text, url }
 */
async function scrapeLinkedInJob(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for job content to load
    await page.waitForSelector('.job-view-layout, .jobs-details, .job-details-jobs-unified-top-card__job-title', {
      timeout: 10000,
    }).catch(() => {}); // don't fail if selector not found

    const jobData = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerText.trim() : '';
      };

      // Try multiple selectors for title
      const title =
        getText('.job-details-jobs-unified-top-card__job-title') ||
        getText('.topcard__title') ||
        getText('h1');

      // Try multiple selectors for company
      const company =
        getText('.job-details-jobs-unified-top-card__company-name') ||
        getText('.topcard__org-name-link') ||
        getText('.topcard__flavor--black-link');

      // Location
      const location =
        getText('.job-details-jobs-unified-top-card__bullet') ||
        getText('.topcard__flavor--bullet');

      // Full job description
      const jd =
        getText('.jobs-description__content') ||
        getText('.description__text') ||
        getText('.job-view-layout');

      return { title, company, location, jd_text: jd.slice(0, 4000) };
    });

    return { ...jobData, url };
  } catch (e) {
    console.error(`✗ Scrape failed for ${url}:`, e.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Given email text, extract all job URLs and scrape each one.
 * Returns array of job objects.
 */
async function scrapeJobsFromEmail(emailText, fallbackTitle, fallbackCompany) {
  const urls = extractJobUrls(emailText);

  if (urls.length === 0) {
    console.log('· No LinkedIn job URLs found in email, using email text as JD');
    return null; // caller will fall back to email text
  }

  console.log(`✓ Found ${urls.length} job URL(s) in email, scraping...`);
  const results = [];

  for (const url of urls.slice(0, 3)) { // max 3 per email
    const job = await scrapeLinkedInJob(url);
    if (job && job.jd_text) {
      results.push(job);
    }
  }

  return results.length > 0 ? results : null;
}

module.exports = { scrapeJobsFromEmail, scrapeLinkedInJob, extractJobUrls };
