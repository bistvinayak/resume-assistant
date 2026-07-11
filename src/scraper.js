'use strict';

const puppeteer = require('puppeteer');

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
        '--single-process',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Click "more" / "Show more" to expand full JD
    await page.evaluate(() => {
      const moreBtn = document.querySelector(
        '.show-more-less-html__button, .jobs-description__footer-button, button[aria-label="Click to see more description"]'
      );
      if (moreBtn) moreBtn.click();
    });

    await new Promise(r => setTimeout(r, 1000)); // wait for expansion

    const jobData = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
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

    return { ...jobData, url };
  } catch (e) {
    console.error(`✗ Scrape failed for ${url}:`, e.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Given job URLs from email, scrape each one for full JD.
 * Returns array of job objects or null if nothing scraped.
 */
async function scrapeJobsFromEmail(emailText, jobUrls, fallbackTitle, fallbackCompany) {
  const urls = jobUrls && jobUrls.length > 0 ? jobUrls : [];

  if (urls.length === 0) {
    console.log('· No LinkedIn job URLs found in email, using email text as JD');
    return null;
  }

  console.log(`✓ Scraping ${urls.length} job URL(s) from email...`);
  const results = [];

  for (const url of urls.slice(0, 3)) {
    const job = await scrapeLinkedInJob(url);
    if (job && job.jd_text) {
      results.push(job);
    }
  }

  return results.length > 0 ? results : null;
}

module.exports = { scrapeJobsFromEmail, scrapeLinkedInJob };
