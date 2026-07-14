'use strict';

const puppeteer = require('puppeteer');

function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
  });
}

function isLinkedIn(url) {
  return /linkedin\.com/i.test(url);
}

async function scrapeLinkedIn(page) {
  await page.evaluate(() => {
    const moreBtn = document.querySelector(
      '.show-more-less-html__button, .jobs-description__footer-button, button[aria-label="Click to see more description"]'
    );
    if (moreBtn) moreBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  return page.evaluate(() => {
    const getText = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.innerText.trim() : '';
    };

    const title =
      getText('.job-details-jobs-unified-top-card__job-title') ||
      getText('.topcard__title') ||
      getText('h1');

    const company =
      getText('.job-details-jobs-unified-top-card__company-name') ||
      getText('.topcard__org-name-link') ||
      getText('.topcard__flavor--black-link');

    const location =
      getText('.job-details-jobs-unified-top-card__bullet') ||
      getText('.topcard__flavor--bullet');

    const jd =
      getText('.jobs-description__content') ||
      getText('.jobs-description') ||
      getText('.description__text') ||
      getText('.job-view-layout');

    return { title, company, location, jd_text: jd.slice(0, 4000) };
  });
}

async function scrapeGeneric(page) {
  await new Promise(r => setTimeout(r, 2000));

  return page.evaluate(() => {
    const getText = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.innerText.trim() : '';
    };
    const getMeta = (name) => {
      const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
      return el ? el.getAttribute('content')?.trim() : '';
    };

    const title =
      getText('h1') ||
      getMeta('og:title') ||
      document.title || '';

    const company =
      getText('[data-testid="company-name"]') ||
      getText('.company-name') ||
      getText('.employer-name') ||
      getMeta('og:site_name') || '';

    const location =
      getText('[data-testid="job-location"]') ||
      getText('.location') || '';

    // Try common job description containers first
    const jdSelectors = [
      '.job-description', '.jobDescriptionContent', '.job-details',
      '[data-testid="job-description"]', '.description', '.posting-requirements',
      '#job-description', '#jobDescriptionText', '.job_description',
      '[class*="jobDescription"]', '[class*="job-description"]',
      'article', 'main', '[role="main"]',
    ];

    let jd = '';
    for (const sel of jdSelectors) {
      jd = getText(sel);
      if (jd && jd.length > 100) break;
    }

    // Fallback: grab full page text
    if (!jd || jd.length < 100) {
      jd = document.body.innerText || '';
    }

    return { title, company, location, jd_text: jd.slice(0, 6000) };
  });
}

async function scrapeJobPage(url) {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const jobData = isLinkedIn(url)
      ? await scrapeLinkedIn(page)
      : await scrapeGeneric(page);

    return { ...jobData, url };
  } catch (e) {
    console.error(`✗ Scrape failed for ${url}:`, e.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// Keep the old name as an alias for backward compatibility
const scrapeLinkedInJob = scrapeJobPage;

async function scrapeJobsFromEmail(emailText, jobUrls, fallbackTitle, fallbackCompany) {
  const urls = jobUrls && jobUrls.length > 0 ? jobUrls : [];

  if (urls.length === 0) {
    console.log('· No job URLs found in email, using email text as JD');
    return null;
  }

  console.log(`✓ Scraping ${urls.length} job URL(s) from email...`);
  const results = [];

  for (const url of urls.slice(0, 3)) {
    const job = await scrapeJobPage(url);
    if (job && job.jd_text) {
      results.push(job);
    }
  }

  return results.length > 0 ? results : null;
}

module.exports = { scrapeJobsFromEmail, scrapeLinkedInJob, scrapeJobPage };
