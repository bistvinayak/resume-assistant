'use strict';

require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');

/**
 * Fetch unread LinkedIn job alert emails from Gmail via IMAP.
 * Returns array of { job_id, title, company, jd_text, emailText, jobUrls }
 */
async function fetchLinkedInJobs() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASS,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const parsePromises = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) return reject(err);

        imap.search(['UNSEEN', ['FROM', 'jobalerts-noreply@linkedin.com']], (err, uids) => {
          if (err) return reject(err);
          if (!uids || uids.length === 0) {
            imap.end();
            return resolve([]);
          }

          console.log(`✓ Found ${uids.length} unread LinkedIn job alert(s)`);
          const fetch = imap.fetch(uids.slice(-10), { bodies: '', markSeen: true });

          fetch.on('message', (msg) => {
            const p = new Promise((res) => {
              msg.on('body', (stream) => {
                simpleParser(stream, (err, parsed) => {
                  if (err) return res(null);

                  const subject = parsed.subject || '';
                  const text = parsed.text || '';
                  const html = parsed.html || '';

                  // Extract LinkedIn job URLs from both plain text and HTML
                  const combined = text + ' ' + html;
                  const urlRegex = /https?:\/\/[^\s<>"]+linkedin.com\/(?:comm\/)?jobs\/view\/[^\s<>"&)]+/gi;
                  const rawUrls = combined.match(urlRegex) || [];
                  // Dedupe and clean
                  const jobUrls = [...new Set(rawUrls.map(u => u.split('?')[0]))];

                  // Also extract tracking URLs that redirect to LinkedIn jobs
                  const trackingRegex = /https?:\/\/[^\s<>"]*linkedin[^\s<>"]*(?:trk|jobAlert)[^\s<>"&)]+/gi;
                  const trackingUrls = combined.match(trackingRegex) || [];

                  const allUrls = [...new Set([...jobUrls, ...trackingUrls])];

                  // Extract title from subject
                  const titleMatch = subject.match(/jobs?\s+for\s+(.+?)\s+in\s+/i);
                  const title = titleMatch ? titleMatch[1].trim() : subject.slice(0, 80);

                  const companyMatch = text.match(/at\s+([A-Z][a-zA-Z\s&.,]+?)[\n\r,]/);
                  const company = companyMatch ? companyMatch[1].trim() : 'LinkedIn Alert';

                  const job_id = `linkedin_${Date.now()}_${title.toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`;

                  console.log(`· Email "${subject.slice(0,50)}" — found ${allUrls.length} job URL(s)`);

                  res({
                    job_id,
                    title,
                    company,
                    jd_text: text.slice(0, 3000),
                    emailText: text,
                    jobUrls: allUrls,
                  });
                });
              });
            });
            parsePromises.push(p);
          });

          fetch.once('error', reject);
          fetch.once('end', async () => {
            const results = await Promise.all(parsePromises);
            imap.end();
            resolve(results.filter(Boolean));
          });
        });
      });
    });

    imap.once('error', reject);
    imap.once('end', () => console.log('✓ IMAP connection closed'));
    imap.connect();
  });
}

module.exports = { fetchLinkedInJobs };
