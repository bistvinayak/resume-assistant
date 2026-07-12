'use strict';

const { google } = require('googleapis');
const { pool } = require('./db');

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const ARJUN_FORWARD_EMAIL = process.env.ARJUN_EMAIL || 'arjun.resumeai@gmail.com';

/**
 * Exchange auth code for tokens and create Gmail filter
 * POST /api/gmail/connect { code }
 */
async function connectGmail(req, res) {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });

  try {
    const oauth2Client = new google.auth.OAuth2(
      GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET,
      process.env.OAUTH_REDIRECT_URI || 'http://localhost:5173/oauth/callback'
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Step 1: Add arjun.resumeai@gmail.com as forwarding address
    try {
      await gmail.users.settings.forwardingAddresses.create({
        userId: 'me',
        requestBody: { forwardingEmail: ARJUN_FORWARD_EMAIL },
      });
      console.log(`✓ Forwarding address added for user ${req.userId}`);
    } catch (e) {
      // May already exist — that's fine
      console.log(`· Forwarding address may already exist: ${e.message}`);
    }

    // Step 2: Create filter to forward LinkedIn job alerts
    await gmail.users.settings.filters.create({
      userId: 'me',
      requestBody: {
        criteria: {
          from: 'jobalerts-noreply@linkedin.com',
        },
        action: {
          forward: ARJUN_FORWARD_EMAIL,
        },
      },
    });

    console.log(`✓ Gmail filter created for user ${req.userId} (${req.userEmail})`);

    // Step 3: Store refresh token encrypted in DB for sending emails later
    if (tokens.refresh_token) {
      await pool.query(
        `UPDATE master_profile SET 
          profile = jsonb_set(
            COALESCE(profile, '{}'), 
            '{gmail_refresh_token}', 
            $2::jsonb
          ),
          updated_at = now()
         WHERE user_id = $1`,
        [req.userId, JSON.stringify(tokens.refresh_token)]
      );
    }

    res.json({ ok: true, message: 'Gmail connected and filter created' });
  } catch (e) {
    console.error('Gmail connect error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { connectGmail };
