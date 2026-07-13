'use strict';

const { google } = require('googleapis');
const { pool } = require('./db');

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const ARJUN_FORWARD_EMAIL = process.env.ARJUN_EMAIL || 'arjun.resumeai@gmail.com';
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'http://localhost:5173/oauth/callback';

/**
 * Exchange auth code for tokens, try to create Gmail filter,
 * fall back gracefully if restricted scope blocks it.
 * POST /api/gmail/connect { code }
 */
async function connectGmail(req, res) {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });

  try {
    const oauth2Client = new google.auth.OAuth2(
      GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET,
      OAUTH_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    let filterCreated = false;
    let filterError = null;

    // Try to create filter (may fail if gmail.settings.basic is restricted)
    try {
      // Step 1: Add forwarding address
      await gmail.users.settings.forwardingAddresses.create({
        userId: 'me',
        requestBody: { forwardingEmail: ARJUN_FORWARD_EMAIL },
      });

      // Step 2: Create filter
      await gmail.users.settings.filters.create({
        userId: 'me',
        requestBody: {
          criteria: { from: 'jobalerts-noreply@linkedin.com' },
          action: { forward: ARJUN_FORWARD_EMAIL },
        },
      });

      filterCreated = true;
      console.log(`✓ Gmail filter created for user ${req.userId} (${req.userEmail})`);
    } catch (e) {
      filterError = e.message;
      console.log(`· Auto-filter failed (${e.message}) — user will need manual setup`);
    }

    // Store refresh token regardless
    if (tokens.refresh_token) {
      await pool.query(
        `UPDATE master_profile SET 
          profile = jsonb_set(COALESCE(profile, '{}'), '{gmail_connected}', 'true'),
          updated_at = now()
         WHERE user_id = $1`,
        [req.userId]
      );
    }

    // Send onboarding completion email
    if (tokens.access_token) {
      await sendOnboardingEmail(gmail, req.userEmail, filterCreated);
    }

    res.json({
      ok: true,
      filterCreated,
      filterError: filterCreated ? null : filterError,
      manualSetupNeeded: !filterCreated,
      message: filterCreated
        ? 'Gmail connected — filter created automatically'
        : 'Gmail connected — manual filter setup required',
    });
  } catch (e) {
    console.error('Gmail connect error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

/**
 * Send onboarding completion email to user
 */
async function sendOnboardingEmail(gmail, userEmail, filterCreated) {
  try {
    const subject = filterCreated
      ? '✅ Arjun is set up — your resume machine is running'
      : '👋 Welcome to Arjun — one quick step to complete setup';

    const body = filterCreated
      ? `Hi there,

You're all set! Here's what Arjun will do for you:

🔄 Every 2 hours: Read your LinkedIn job alerts
🤖 Scrape the full job description
✍️  Tailor your resume using your profile
📊 Calculate ATS match score (target: 95/100)
📧 Email you the tailored .docx resume

You can also submit any LinkedIn job URL manually at:
https://vinayakbist.com/projects/arjun/dashboard

If you want to update your profile anytime, just visit the dashboard.

— Arjun`
      : `Hi there,

Welcome to Arjun! Your profile is saved.

To enable auto-mode (get tailored resumes every 2 hours), 
set up a Gmail filter in 2 minutes:

1. Open Gmail → Settings → Filters → Create new filter
2. From: jobalerts-noreply@linkedin.com
3. Action: Forward to ${ARJUN_FORWARD_EMAIL}
4. Click Create filter

Once done, Arjun will automatically process every LinkedIn job alert.

You can also submit any LinkedIn job URL manually at:
https://vinayakbist.com/projects/arjun/dashboard

— Arjun`;

    const raw = buildEmail(
      `"Arjun — AI Resume" <${ARJUN_FORWARD_EMAIL}>`,
      userEmail,
      subject,
      body
    );

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    console.log(`✓ Onboarding email sent to ${userEmail}`);
  } catch (e) {
    console.error('Onboarding email failed:', e.message);
  }
}

function buildEmail(from, to, subject, text) {
  const nl = '\r\n';
  const raw =
    `From: ${from}${nl}` +
    `To: ${to}${nl}` +
    `Subject: ${subject}${nl}` +
    `MIME-Version: 1.0${nl}` +
    `Content-Type: text/plain; charset="UTF-8"${nl}${nl}` +
    text;
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = { connectGmail };
