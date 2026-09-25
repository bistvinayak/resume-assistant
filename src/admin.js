'use strict';

const { pool, getSchemaProposals, updateSchemaProposalStatus, setBackfillStatus, getChatFeedback, updateChatFeedbackStatus, getGmailForwardingRequests, reviewGmailForwarding, forceRequeueJob, getExtensionEvents } = require('./db');
const { runBatch } = require('./cron');
const { queueJob } = require('./pipeline');
const { scrapeLinkedInJob } = require('./scraper');
const { backfillApprovedCategory } = require('./profile');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'arjun.resumeai@gmail.com';

// Middleware: only allow admin
function adminOnly(req, res, next) {
  if (req.userEmail !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'admin only' });
  }
  next();
}

// GET /api/admin/stats
async function getStats(req, res) {
  try {
    const [users, jobs, emails, failures, failureReasons] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT user_id) as total, COUNT(DISTINCT user_id) FILTER (WHERE updated_at > now() - interval '7 days') as active_week FROM master_profile`),
      pool.query(`SELECT COUNT(*) as total, AVG(ats_score) as avg_ats, COUNT(*) FILTER (WHERE seen_at > now() - interval '1 day') as today, COUNT(*) FILTER (WHERE seen_at > now() - interval '7 days') as this_week, COUNT(*) FILTER (WHERE seen_at > now() - interval '30 days') as this_month FROM jobs WHERE status = 'delivered'`),
      pool.query(`SELECT missing_keywords FROM jobs WHERE status = 'delivered' AND missing_keywords IS NOT NULL`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'failed') as failed, COUNT(*) as attempted FROM jobs WHERE status IN ('delivered', 'failed') AND seen_at > now() - interval '30 days'`),
      pool.query(`SELECT error_reason, COUNT(*) as count FROM jobs WHERE status = 'failed' AND error_reason IS NOT NULL AND seen_at > now() - interval '30 days' GROUP BY error_reason ORDER BY count DESC LIMIT 5`),
    ]);

    // Top missing keywords
    const allMissing = emails.rows.flatMap(r => r.missing_keywords || []);
    const freq = allMissing.reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const topMissing = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const failedCount = parseInt(failures.rows[0].failed);
    const attemptedCount = parseInt(failures.rows[0].attempted);

    res.json({
      users: {
        total: parseInt(users.rows[0].total),
        active_week: parseInt(users.rows[0].active_week),
      },
      jobs: {
        total: parseInt(jobs.rows[0].total),
        today: parseInt(jobs.rows[0].today),
        this_week: parseInt(jobs.rows[0].this_week),
        this_month: parseInt(jobs.rows[0].this_month),
        avg_ats: Math.round(parseFloat(jobs.rows[0].avg_ats) || 0),
      },
      failures: {
        failed_30d: failedCount,
        attempted_30d: attemptedCount,
        rate_30d: attemptedCount > 0 ? Math.round(100 * failedCount / attemptedCount) : 0,
        topReasons: failureReasons.rows.map(r => [r.error_reason, parseInt(r.count)]),
      },
      topMissing,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/users
async function getUsers(req, res) {
  try {
    // master_profile keeps the last 3 versions per user; list each user once (latest version)
    // and count jobs separately so the join can't multiply rows.
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (user_id) user_id, profile, updated_at
        FROM master_profile
        ORDER BY user_id, version DESC, updated_at DESC
      ),
      firsts AS (
        SELECT user_id, MIN(updated_at) AS first_seen FROM master_profile GROUP BY user_id
      ),
      job_stats AS (
        SELECT user_id, COUNT(*) AS jobs_count, MAX(seen_at) AS last_job, AVG(ats_score) AS avg_ats
        FROM jobs GROUP BY user_id
      )
      SELECT
        l.user_id,
        l.profile->>'contact' AS contact_raw,
        l.updated_at,
        f.first_seen,
        l.profile->>'gmail_connected' AS gmail_connected,
        l.profile->>'daily_limit' AS daily_limit,
        l.profile->>'active' AS active,
        l.profile->>'auto_process_paused' AS auto_process_paused,
        COALESCE(j.jobs_count, 0) AS jobs_count,
        j.last_job,
        j.avg_ats
      FROM latest l
      LEFT JOIN firsts f ON f.user_id = l.user_id
      LEFT JOIN job_stats j ON j.user_id = l.user_id
      ORDER BY l.updated_at DESC
    `);

    const users = rows.map(r => {
      let contact = {};
      try { contact = JSON.parse(r.contact_raw || '{}'); } catch (e) {}
      return {
        user_id: r.user_id,
        email: contact.email || r.user_id,
        name: contact.name || 'Unknown',
        gmail_connected: r.gmail_connected === 'true',
        daily_limit: parseInt(r.daily_limit) || 10,
        active: r.active !== 'false',
        auto_process_paused: r.auto_process_paused === 'true',
        jobs_count: parseInt(r.jobs_count) || 0,
        last_job: r.last_job,
        avg_ats: Math.round(parseFloat(r.avg_ats) || 0),
        joined: r.first_seen || r.updated_at,
        last_updated: r.updated_at,
      };
    });

    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function updateUser(req, res) {
  const { userId } = req.params;
  const { active, daily_limit, auto_process_paused } = req.body;

  try {
    const updates = {};
    if (active !== undefined) updates.active = active;
    if (daily_limit !== undefined) updates.daily_limit = daily_limit;
    if (auto_process_paused !== undefined) updates.auto_process_paused = auto_process_paused;

    for (const [key, val] of Object.entries(updates)) {
      await pool.query(
        `UPDATE master_profile SET profile = jsonb_set(COALESCE(profile, '{}'), '{${key}}', $2::jsonb), updated_at = now() WHERE user_id = $1`,
        [userId, JSON.stringify(val)]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// DELETE /api/admin/users/:userId
// Every table that stores per-user rows. tailored_resume is also cleared by job_id: older rows
// can reference this user's jobs under a different user_id, and the job_id foreign key then
// blocked deleting the jobs ("violates foreign key constraint tailored_resume_job_id_fkey").
const PER_USER_TABLES = ['user_skills', 'pending_ingestions', 'resume_format', 'gmail_forwarding', 'uncategorized_facts', 'chat_feedback', 'extension_events'];

async function deleteUser(req, res) {
  const { userId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = {};
    counts.tailored_resume = (await client.query(
      'DELETE FROM tailored_resume WHERE user_id = $1 OR job_id IN (SELECT job_id FROM jobs WHERE user_id = $1)', [userId]
    )).rowCount;
    counts.jobs = (await client.query('DELETE FROM jobs WHERE user_id = $1', [userId])).rowCount;
    counts.master_profile = (await client.query('DELETE FROM master_profile WHERE user_id = $1', [userId])).rowCount;
    for (const table of PER_USER_TABLES) {
      counts[table] = (await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId])).rowCount;
    }
    await client.query('COMMIT');
    console.log(`✓ admin deleted user ${userId}: ${JSON.stringify(counts)}`);
    res.json({ ok: true, deleted: counts });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`✗ admin delete user ${userId} failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

async function getJobs(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT j.*, mp.profile->>'contact' as contact_raw
      FROM jobs j
      LEFT JOIN master_profile mp ON mp.user_id = j.user_id
      ORDER BY j.seen_at DESC
      LIMIT 100
    `);

    const jobs = rows.map(r => {
      let contact = {};
      try { contact = JSON.parse(r.contact_raw || '{}'); } catch (e) {}
      return { ...r, user_email: contact.email || r.user_id };
    });

    res.json({ jobs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/admin/jobs/:jobId/retry — force a stuck/failed job back through the
// pipeline right now, regardless of its current status. Admin override, not
// gated by the same staleness checks the automatic recovery cron uses.
async function retryJob(req, res) {
  const { jobId } = req.params;
  try {
    const job = await forceRequeueJob(jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });

    if ((!job.jd_text || job.jd_text.length < 50) && job.url) {
      const scraped = await scrapeLinkedInJob(job.url).catch(() => null);
      if (scraped?.jd_text) {
        job.jd_text = scraped.jd_text;
        job.title = scraped.title || job.title;
        job.company = scraped.company || job.company;
      }
    }
    if (!job.jd_text || job.jd_text.length < 50) {
      return res.status(400).json({ error: 'No job description text available and re-scraping the URL failed — nothing to retry with.' });
    }

    res.json({ ok: true, message: 'retry queued' });
    queueJob(job, job.user_id, { source: 'admin_retry' }).catch(e =>
      console.error(`✗ admin retry failed for ${jobId}:`, e.message)
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/admin/cron/run
async function triggerCron(req, res) {
  try {
    runBatch('me').catch(console.error);
    res.json({ ok: true, message: 'Cron triggered' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/settings
async function getSettings(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT value FROM admin_settings WHERE key = 'global_settings' LIMIT 1
    `).catch(() => ({ rows: [] }));

    res.json(rows[0]?.value || {
      global_daily_limit: 20,
      cron_paused: false,
      max_users: 100,
    });
  } catch (e) {
    res.json({ global_daily_limit: 20, cron_paused: false, max_users: 100 });
  }
}

// PATCH /api/admin/settings
async function updateSettings(req, res) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value JSONB);
      INSERT INTO admin_settings (key, value) VALUES ('global_settings', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1
    `, [req.body]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/schema-proposals
async function getSchemaProposalsHandler(req, res) {
  try {
    const proposals = await getSchemaProposals();
    res.json({ proposals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/admin/schema-proposals/:id/approve
async function approveSchemaProposal(req, res) {
  const { id } = req.params;
  try {
    const proposal = await updateSchemaProposalStatus(id, 'approved', req.userEmail);
    if (!proposal) return res.status(404).json({ error: 'proposal not found' });

    res.json({ ok: true, proposal, backfillQueued: true });

    // Backfill runs after responding — re-scans every user's uncategorized
    // custom_facts for data that now belongs to this newly approved category.
    (async () => {
      await setBackfillStatus(id, 'running');
      try {
        const result = await backfillApprovedCategory(proposal);
        console.log(`✓ Backfill for "${proposal.category}": ${result.profilesUpdated}/${result.profilesScanned} profiles updated, ${result.factsReclassified} facts reclassified`);
        await setBackfillStatus(id, `done:${result.profilesUpdated}/${result.profilesScanned} profiles, ${result.factsReclassified} facts`);
      } catch (e) {
        console.error(`✗ Backfill failed for "${proposal.category}":`, e.message);
        await setBackfillStatus(id, `failed:${e.message}`);
      }
    })();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/admin/schema-proposals/:id/reject
async function rejectSchemaProposal(req, res) {
  const { id } = req.params;
  try {
    const proposal = await updateSchemaProposalStatus(id, 'rejected', req.userEmail);
    if (!proposal) return res.status(404).json({ error: 'proposal not found' });
    res.json({ ok: true, proposal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function getFeedbackHandler(req, res) {
  try {
    const feedback = await getChatFeedback();
    res.json({ feedback });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function reviewFeedback(req, res) {
  const { id } = req.params;
  const { status, admin_note } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status required' });
  try {
    await updateChatFeedbackStatus(id, status, admin_note);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/gmail-forwarding
async function getGmailForwardingHandler(req, res) {
  try {
    const requests = await getGmailForwardingRequests();
    res.json({ requests });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/admin/gmail-forwarding/:userId/approve
async function approveGmailForwarding(req, res) {
  const { userId } = req.params;
  try {
    const request = await reviewGmailForwarding(userId, 'approved', req.userEmail);
    if (!request) return res.status(404).json({ error: 'request not found' });
    res.json({ ok: true, request });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/admin/gmail-forwarding/:userId/reject
async function rejectGmailForwarding(req, res) {
  const { userId } = req.params;
  try {
    const request = await reviewGmailForwarding(userId, 'rejected', req.userEmail);
    if (!request) return res.status(404).json({ error: 'request not found' });
    res.json({ ok: true, request });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/extension-events
async function getExtensionEventsHandler(req, res) {
  try {
    res.json(await getExtensionEvents(Math.min(Number(req.query.limit) || 100, 500)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  adminOnly, getStats, getUsers, updateUser, deleteUser, getJobs, retryJob, triggerCron, getSettings, updateSettings,
  getSchemaProposalsHandler, approveSchemaProposal, rejectSchemaProposal,
  getFeedbackHandler, reviewFeedback,
  getGmailForwardingHandler, approveGmailForwarding, rejectGmailForwarding,
  getExtensionEventsHandler,
};
