'use strict';

require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');

// Figures out which forwarding account actually relayed this message into Arjun's
// inbox. Priority order, most reliable first:
//  1. X-Forwarded-For — set by Gmail's account-level auto-forward; the visible
//     From: header stays as the original external sender (e.g. LinkedIn), but this
//     header names the account that forwarded it. Format: "original@x.com relay@y.com".
//  2. Delivered-To — the first hop's recipient, i.e. the forwarding account's own address.
//  3. From — fallback for a manually-forwarded email (composed as new mail, so From
//     really is the forwarding user's own address in that case).
function findForwarderEmail(parsed) {
  const xForwardedFor = parsed.headers.get('x-forwarded-for');
  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    const first = xForwardedFor.trim().split(/\s+/)[0];
    if (first) return first.toLowerCase();
  }

  const deliveredTo = parsed.headers.get('delivered-to');
  if (typeof deliveredTo === 'string' && deliveredTo.trim()) {
    return deliveredTo.trim().toLowerCase();
  }

  const fromAddress = parsed.from?.value?.[0]?.address;
  if (fromAddress) return fromAddress.toLowerCase();

  return null;
}

async function fetchLinkedInJobs(approvedMap = {}) {
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

        imap.search(['UNSEEN'], (err, uids) => {
          if (err) return reject(err);
          if (!uids || uids.length === 0) {
            imap.end();
            return resolve([]);
          }

          console.log(`✓ Found ${uids.length} unread email(s) in Arjun's inbox`);
          const fetch = imap.fetch(uids.slice(-20), { bodies: '', markSeen: true });

          fetch.on('message', (msg) => {
            const p = new Promise((res) => {
              msg.on('body', (stream) => {
                simpleParser(stream, (err, parsed) => {
                  if (err) return res(null);

                  const forwarderEmail = findForwarderEmail(parsed);
                  const userId = forwarderEmail ? approvedMap[forwarderEmail] : null;
                  if (!userId) {
                    console.log(`· Skipping email from/via "${forwarderEmail || 'unknown'}" — not an approved forwarding address`);
                    return res(null);
                  }

                  const subject = parsed.subject || '';
                  const text = parsed.text || '';
                  const html = parsed.html || '';
                  const combined = text + ' ' + html;

                  // Extract unique job IDs from LinkedIn URLs (works whether the mail is
                  // a direct LinkedIn alert or a forwarded/quoted copy of one).
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

                  if (!jobUrls.length) {
                    console.log(`· Skipping email "${subject.slice(0, 60)}" from ${forwarderEmail} — no job links found`);
                    return res(null);
                  }

                  const titleMatch = subject.match(/jobs?\s+for\s+(.+?)\s+in\s+/i);
                  const title = titleMatch ? titleMatch[1].trim() : subject.slice(0, 80);
                  const companyMatch = text.match(/at\s+([A-Z][a-zA-Z\s&.,]+?)[\n\r,]/);
                  const company = companyMatch ? companyMatch[1].trim() : 'LinkedIn Alert';
                  const job_id = `linkedin_${Date.now()}_${title.toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`;

                  console.log(`· Email "${subject.slice(0, 60)}" from ${forwarderEmail} (user ${userId}) — found ${jobUrls.length} job(s)`);

                  res({
                    job_id,
                    title,
                    company,
                    jd_text: text.slice(0, 3000),
                    emailText: text,
                    jobUrls,
                    userId,
                    forwarderEmail,
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
