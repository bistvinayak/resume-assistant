'use strict';

const { pool, getSchemaProposals, updateSchemaProposalStatus, setBackfillStatus } = require('./db');
const { runBatch } = require('./cron');
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
    const [users, jobs, emails] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT user_id) as total, COUNT(DISTINCT user_id) FILTER (WHERE updated_at > now() - interval '7 days') as active_week FROM master_profile`),
      pool.query(`SELECT COUNT(*) as total, AVG(ats_score) as avg_ats, COUNT(*) FILTER (WHERE seen_at > now() - interval '1 day') as today, COUNT(*) FILTER (WHERE seen_at > now() - interval '7 days') as this_week, COUNT(*) FILTER (WHERE seen_at > now() - interval '30 days') as this_month FROM jobs WHERE status = 'delivered'`),
      pool.query(`SELECT missing_keywords FROM jobs WHERE status = 'delivered' AND missing_keywords IS NOT NULL`),
    ]);

    // Top missing keywords
    const allMissing = emails.rows.flatMap(r => r.missing_keywords || []);
    const freq = allMissing.reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const topMissing = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);

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
      topMissing,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/users
async function getUsers(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT 
        mp.user_id,
        mp.profile->>'contact' as contact_raw,
        mp.updated_at,
        mp.profile->>'gmail_connected' as gmail_connected,
        mp.profile->>'daily_limit' as daily_limit,
        mp.profile->>'active' as active,
        COUNT(j.job_id) as jobs_count,
        MAX(j.seen_at) as last_job,
        AVG(j.ats_score) as avg_ats
      FROM master_profile mp
      LEFT JOIN jobs j ON j.user_id = mp.user_id
      GROUP BY mp.user_id, mp.profile, mp.updated_at
      ORDER BY mp.updated_at DESC
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
        jobs_count: parseInt(r.jobs_count) || 0,
        last_job: r.last_job,
        avg_ats: Math.round(parseFloat(r.avg_ats) || 0),
        joined: r.updated_at,
      };
    });

    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// PATCH /api/admin/users/:userId
async function updateUser(req, res) {
  const { userId } = req.params;
  const { active, daily_limit } = req.body;

  try {
    const updates = {};
    if (active !== undefined) updates.active = active;
    if (daily_limit !== undefined) updates.daily_limit = daily_limit;

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
async function deleteUser(req, res) {
  const { userId } = req.params;
  try {
    await pool.query('DELETE FROM tailored_resume WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM jobs WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM master_profile WHERE user_id = $1', [userId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/jobs
async function getJobs(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT j.*, mp.profile->>'contact' as contact_raw
      FROM jobs j
      LEFT JOIN master_profile mp ON mp.user_id = j.user_id
      WHERE j.status = 'delivered'
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

module.exports = {
  adminOnly, getStats, getUsers, updateUser, deleteUser, getJobs, triggerCron, getSettings, updateSettings,
  getSchemaProposalsHandler, approveSchemaProposal, rejectSchemaProposal,
};
