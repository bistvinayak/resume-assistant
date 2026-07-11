'use strict';

require('dotenv').config();
const nodemailer = require('nodemailer');

async function sendResumeEmail({ subject, text, attachmentPath, attachmentName }) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.verify();
  return transport.sendMail({
    from: `"${process.env.FROM_NAME || 'Resume Assistant'}" <${process.env.FROM_EMAIL}>`,
    to: process.env.TO_EMAIL,
    subject,
    text,
    attachments: [{ filename: attachmentName, path: attachmentPath }],
  });
}

module.exports = { sendResumeEmail };
