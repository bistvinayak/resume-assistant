'use strict';

require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');

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
                  const combined = text + ' ' + html;

                  // Extract unique job IDs from LinkedIn URLs
                  const jobIds = new Set();
                  const jobUrls = [];
                  const pattern = /linkedin\.com(?:\/comm)?\/jobs\/view\/(\d+)/g;
                  let match;
                  while ((match = pattern.exec(combined)) !== null) {
                    const jobId = match[1];
                    if (!jobIds.has(jobId)) {
                      jobIds.add(jobId);
                      jobUrls.push('https://www.linkedin.com/jobs/view/' + jobId);
                    }
                  }

                  const titleMatch = subject.match(/jobs?\s+for\s+(.+?)\s+in\s+/i);
                  const title = titleMatch ? titleMatch[1].trim() : subject.slice(0, 80);
                  const companyMatch = text.match(/at\s+([A-Z][a-zA-Z\s&.,]+?)[\n\r,]/);
                  const company = companyMatch ? companyMatch[1].trim() : 'LinkedIn Alert';
                  const job_id = `linkedin_${Date.now()}_${title.toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`;

                  console.log(`· Email "${subject.slice(0, 60)}" — found ${jobUrls.length} job(s)`);

                  res({
                    job_id,
                    title,
                    company,
                    jd_text: text.slice(0, 3000),
                    emailText: text,
                    jobUrls,
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
