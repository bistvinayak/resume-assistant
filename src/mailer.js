'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN,
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

const DEFAULT_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Build a raw RFC 2822 email message with zero or more attachments.
 */
function buildRawEmail({ from, to, subject, text, attachments = [] }) {
  const boundary = `boundary_${Date.now()}`;
  const nl = '\r\n';

  let raw =
    `From: ${from}${nl}` +
    `To: ${to}${nl}` +
    `Subject: ${subject}${nl}` +
    `MIME-Version: 1.0${nl}` +
    `Content-Type: multipart/mixed; boundary="${boundary}"${nl}${nl}`;

  // Text part
  raw +=
    `--${boundary}${nl}` +
    `Content-Type: text/plain; charset="UTF-8"${nl}${nl}` +
    `${text}${nl}${nl}`;

  // Attachment parts
  for (const { path: attachmentPath, name: attachmentName, mimeType } of attachments) {
    if (!attachmentPath || !fs.existsSync(attachmentPath)) continue;
    const fileData = fs.readFileSync(attachmentPath).toString('base64');
    raw +=
      `--${boundary}${nl}` +
      `Content-Type: ${mimeType || DEFAULT_MIME_TYPE}${nl}` +
      `Content-Transfer-Encoding: base64${nl}` +
      `Content-Disposition: attachment; filename="${attachmentName}"${nl}${nl}` +
      `${fileData}${nl}${nl}`;
  }

  raw += `--${boundary}--`;

  // Base64url encode
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendResumeEmail({ to, subject, text, attachments = [] }) {
  const from = `"${process.env.FROM_NAME || 'Resume Assistant'}" <${process.env.FROM_EMAIL}>`;
  if (!to) to = process.env.TO_EMAIL;

  const raw = buildRawEmail({ from, to, subject, text, attachments });

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  console.log(`✓ Email sent via Gmail API — message ID: ${res.data.id}`);
  return res.data;
}

module.exports = { sendResumeEmail };
