'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
});

const EMPTY_PROFILE = {
  contact: {}, summary: '', skills: [],
  experience: [], projects: [], education: [],
  certifications: [], languages: [], activities: [], interests: [],
  custom_facts: [], custom_sections: [],
};

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS master_profile (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL DEFAULT 'me',
      profile     JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS jobs (
      job_id      TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL DEFAULT 'me',
      title       TEXT,
      company     TEXT,
      jd_text     TEXT,
      url         TEXT,
      ats_score   INTEGER,
      improved    BOOLEAN DEFAULT false,
      matched_keywords  JSONB DEFAULT '[]',
      missing_keywords  JSONB DEFAULT '[]',
      status      TEXT NOT NULL DEFAULT 'new',
      seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tailored_resume (
      id          SERIAL PRIMARY KEY,
      job_id      TEXT REFERENCES jobs(job_id),
      user_id     TEXT NOT NULL DEFAULT 'me',
      resume_json JSONB NOT NULL,
      file_path   TEXT,
      delivered   BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Add user_id columns if they don't exist (migration for existing tables)
    DO $$ BEGIN
      ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'me';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'me';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS url TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_score INTEGER;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS improved BOOLEAN DEFAULT false;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS matched_keywords JSONB DEFAULT '[]';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS missing_keywords JSONB DEFAULT '[]';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS substitutions JSONB DEFAULT '[]';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tailoring_notes JSONB DEFAULT '[]';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS jd_requirements JSONB DEFAULT '[]';
      ALTER TABLE tailored_resume ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'me';
    EXCEPTION WHEN others THEN NULL; END $$;

    CREATE INDEX IF NOT EXISTS idx_master_profile_user ON master_profile(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_tailored_user ON tailored_resume(user_id);

    -- Profile versioning: add version column and change PK to support multiple rows
    DO $$ BEGIN
      ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS change_source TEXT DEFAULT 'unknown';
    EXCEPTION WHEN others THEN NULL; END $$;

    -- Schema proposals: agentic discovery of new profile field types, admin-approved
    CREATE TABLE IF NOT EXISTS schema_proposals (
      id              SERIAL PRIMARY KEY,
      category        TEXT NOT NULL UNIQUE,
      display_name    TEXT NOT NULL,
      description     TEXT,
      example_fields  JSONB DEFAULT '[]',
      sample_data     JSONB DEFAULT '[]',
      status          TEXT NOT NULL DEFAULT 'pending',
      proposed_count  INTEGER NOT NULL DEFAULT 1,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at     TIMESTAMPTZ,
      reviewed_by     TEXT,
      backfill_status TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_schema_proposals_status ON schema_proposals(status);

    -- Durable store for facts extraction couldn't fit into the schema. Append-only —
    -- survives profile edits and version pruning, so schema backfill always has
    -- something reliable to scan, independent of what's currently in master_profile.
    CREATE TABLE IF NOT EXISTS uncategorized_facts (
      id                SERIAL PRIMARY KEY,
      user_id           TEXT NOT NULL,
      text              TEXT NOT NULL,
      source            TEXT DEFAULT 'ingestion',
      matched_category  TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      matched_at        TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_uncategorized_facts_user ON uncategorized_facts(user_id);
    CREATE INDEX IF NOT EXISTS idx_uncategorized_facts_unmatched ON uncategorized_facts(matched_category) WHERE matched_category IS NULL;

    CREATE TABLE IF NOT EXISTS chat_feedback (
      id            SERIAL PRIMARY KEY,
      user_id       TEXT NOT NULL,
      user_email    TEXT,
      trace_id      TEXT NOT NULL,
      score         INTEGER NOT NULL,
      comment       TEXT,
      user_message  TEXT,
      arjun_reply   TEXT,
      chat_mode     TEXT,
      status        TEXT NOT NULL DEFAULT 'open',
      admin_note    TEXT,
      reviewed_at   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_chat_feedback_status ON chat_feedback(status);
  `);
}

async function getProfile(userId = 'me') {
  const { rows } = await pool.query(
    'SELECT profile FROM master_profile WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [userId]
  );
  const profile = rows.length ? { ...EMPTY_PROFILE, ...rows[0].profile } : { ...EMPTY_PROFILE };
  profile._onboarded = rows.length > 0;
  return profile;
}

async function saveProfile(profile, userId = 'me', source = 'unknown') {
  // Hard guardrail — not a prompt request. No matter what produced this profile
  // object (extraction, chat, smart_merge, or a future code path), any
  // custom_sections category that isn't actually approved gets demoted to
  // custom_facts and queued for review, right here, before anything persists.
  await enforceApprovedCustomSections(profile);

  // Get current version number
  const { rows: verRows } = await pool.query(
    'SELECT COALESCE(MAX(version), 0) AS max_ver FROM master_profile WHERE user_id = $1',
    [userId]
  );
  const nextVersion = (verRows[0]?.max_ver || 0) + 1;

  // Insert new version
  await pool.query(
    `INSERT INTO master_profile (id, user_id, profile, updated_at, version, change_source)
     VALUES ($1, $2, $3, now(), $4, $5)
     ON CONFLICT (id) DO UPDATE SET profile = $3, updated_at = now(), version = $4, change_source = $5`,
    [`${userId}_v${nextVersion}`, userId, profile, nextVersion, source]
  );

  // Keep only the last 3 versions — delete older ones
  await pool.query(
    `DELETE FROM master_profile
     WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM master_profile WHERE user_id = $1 ORDER BY version DESC LIMIT 3
     )`,
    [userId]
  );

  return profile;
}

async function getProfileVersions(userId = 'me') {
  const { rows } = await pool.query(
    `SELECT version, updated_at, change_source,
       jsonb_array_length(COALESCE(profile->'experience', '[]')) AS exp_count,
       jsonb_array_length(COALESCE(profile->'skills', '[]')) AS skills_count,
       jsonb_array_length(COALESCE(profile->'projects', '[]')) AS projects_count,
       jsonb_array_length(COALESCE(profile->'certifications', '[]')) AS certs_count,
       length(COALESCE(profile->>'summary', '')) AS summary_len
     FROM master_profile WHERE user_id = $1
     ORDER BY version DESC LIMIT 3`,
    [userId]
  );
  return rows;
}

async function restoreProfileVersion(userId, version) {
  const { rows } = await pool.query(
    'SELECT profile FROM master_profile WHERE user_id = $1 AND version = $2',
    [userId, version]
  );
  if (!rows.length) throw new Error(`Version ${version} not found`);
  await saveProfile(rows[0].profile, userId, `restore_v${version}`);
  return { ...EMPTY_PROFILE, ...rows[0].profile };
}

async function seenJobBefore(job, userId = 'me') {
  const res = await pool.query(
    `INSERT INTO jobs (job_id, user_id, title, company, jd_text, url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (job_id) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, jobs.title),
       company = COALESCE(EXCLUDED.company, jobs.company),
       jd_text = COALESCE(EXCLUDED.jd_text, jobs.jd_text),
       url = COALESCE(EXCLUDED.url, jobs.url)
     WHERE jobs.status = 'processing'
     RETURNING job_id`,
    [job.job_id, userId, job.title || null, job.company || null, job.jd_text || null, job.url || null]
  );
  return res.rowCount === 0;
}

async function saveTailored(jobId, resumeJson, filePath, userId = 'me') {
  const { rows } = await pool.query(
    `INSERT INTO tailored_resume (job_id, user_id, resume_json, file_path) VALUES ($1, $2, $3, $4) RETURNING id`,
    [jobId, userId, resumeJson, filePath || null]
  );
  return rows[0].id;
}

async function markDelivered(tailoredId, jobId, atsData) {
  await pool.query('UPDATE tailored_resume SET delivered = true WHERE id = $1', [tailoredId]);
  await pool.query(
    `UPDATE jobs SET
      status = 'delivered',
      ats_score = $2,
      matched_keywords = $3,
      missing_keywords = $4,
      improved = $5,
      substitutions = $6,
      tailoring_notes = $7,
      jd_requirements = $8
     WHERE job_id = $1`,
    [
      jobId,
      atsData?.score || null,
      JSON.stringify(atsData?.matched_keywords || []),
      JSON.stringify(atsData?.missing_keywords || []),
      atsData?.improved || false,
      JSON.stringify(atsData?.substitutions || []),
      JSON.stringify(atsData?.tailoring_notes || []),
      JSON.stringify(atsData?.jd_requirements || []),
    ]
  );
}

async function getJobByJobId(jobId, userId = 'me') {
  const { rows } = await pool.query(
    `SELECT j.*, t.file_path, t.created_at AS resume_created_at
     FROM jobs j
     LEFT JOIN tailored_resume t ON t.job_id = j.job_id AND t.user_id = j.user_id AND t.delivered = true
     WHERE j.job_id = $1 AND j.user_id = $2
     LIMIT 1`,
    [jobId, userId]
  );
  return rows.length ? rows[0] : null;
}

async function insertJobProcessing(job, userId = 'me') {
  const res = await pool.query(
    `INSERT INTO jobs (job_id, user_id, title, company, url, status)
     VALUES ($1, $2, $3, $4, $5, 'processing')
     ON CONFLICT (job_id) DO UPDATE SET status = 'processing', seen_at = now()
     WHERE jobs.status IN ('failed', 'delivered')
     RETURNING job_id`,
    [job.job_id, userId, job.title || null, job.company || null, job.url || null]
  );
  return res.rowCount > 0;
}

async function markJobFailed(jobId, reason) {
  await pool.query(
    `UPDATE jobs SET status = 'failed', jd_text = COALESCE(jd_text, $2) WHERE job_id = $1`,
    [jobId, reason || 'Scraping failed']
  );
}

async function recoverStaleJobs(minutes = 10) {
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'failed', jd_text = COALESCE(jd_text, 'Timed out — processing took too long or server restarted')
     WHERE status = 'processing' AND seen_at < now() - interval '1 minute' * $1
     RETURNING job_id, user_id, title, company, jd_text, url`,
    [minutes]
  );
  return rows;
}

async function getJobsForUser(userId = 'me', limit = 50) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (j.job_id) j.*, t.created_at AS resume_created_at, t.file_path
     FROM jobs j
     LEFT JOIN tailored_resume t ON t.job_id = j.job_id AND t.user_id = j.user_id AND t.delivered = true
     WHERE j.user_id = $1
     ORDER BY j.job_id, t.created_at DESC NULLS LAST`,
    [userId]
  );
  rows.sort((a, b) => new Date(b.seen_at) - new Date(a.seen_at));
  return rows.slice(0, limit);
}

// ── SCHEMA PROPOSALS (agentic profile schema discovery) ────────────────

function normalizeCategory(category) {
  return String(category || '').trim().toLowerCase().replace(/\s+/g, '_');
}

async function upsertSchemaProposal({ category, displayName, description, exampleFields, sampleData }) {
  const key = normalizeCategory(category);
  if (!key) return;

  const label = displayName || category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const { rows } = await pool.query('SELECT id, status, sample_data FROM schema_proposals WHERE category = $1', [key]);

  if (!rows.length) {
    await pool.query(
      `INSERT INTO schema_proposals (category, display_name, description, example_fields, sample_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [key, label, description || null, JSON.stringify(exampleFields || []), JSON.stringify(sampleData ? [sampleData] : [])]
    );
    return;
  }

  if (rows[0].status === 'pending') {
    const samples = [...(rows[0].sample_data || []), ...(sampleData ? [sampleData] : [])].slice(-5);
    await pool.query(
      `UPDATE schema_proposals SET proposed_count = proposed_count + 1, sample_data = $2 WHERE id = $1`,
      [rows[0].id, JSON.stringify(samples)]
    );
  } else if (rows[0].status === 'rejected') {
    const samples = [...(rows[0].sample_data || []), ...(sampleData ? [sampleData] : [])].slice(-5);
    await pool.query(
      `UPDATE schema_proposals SET status = 'pending', proposed_count = proposed_count + 1, sample_data = $2, reviewed_at = NULL, reviewed_by = NULL WHERE id = $1`,
      [rows[0].id, JSON.stringify(samples)]
    );
    console.log(`↻ Re-opened rejected schema proposal "${key}" — new evidence from another user`);
  }
}

async function getSchemaProposals(status = null) {
  const { rows } = status
    ? await pool.query('SELECT * FROM schema_proposals WHERE status = $1 ORDER BY created_at DESC', [status])
    : await pool.query('SELECT * FROM schema_proposals ORDER BY created_at DESC');
  return rows;
}

async function getApprovedCategories() {
  const { rows } = await pool.query(
    `SELECT category, display_name, description, example_fields FROM schema_proposals WHERE status = 'approved'`
  );
  return rows;
}

async function updateSchemaProposalStatus(id, status, reviewedBy) {
  const { rows } = await pool.query(
    `UPDATE schema_proposals SET status = $2, reviewed_at = now(), reviewed_by = $3 WHERE id = $1 RETURNING *`,
    [id, status, reviewedBy || null]
  );
  return rows[0] || null;
}

// Code-level guardrail (not prompt-level): strip any custom_sections category
// that isn't actually approved in the DB, right before a profile is persisted.
// Mutates `profile` in place. Prompt instructions alone proved insufficient —
// the model filed an unapproved category directly into custom_sections twice
// despite explicit instructions not to, so this is enforced deterministically.
async function enforceApprovedCustomSections(profile) {
  const sections = profile.custom_sections || [];
  if (!sections.length) return;

  const { rows: approved } = await pool.query(`SELECT category FROM schema_proposals WHERE status = 'approved'`);
  const approvedKeys = new Set(approved.map(r => r.category));

  const kept = [];
  const demoted = [];
  for (const section of sections) {
    if (approvedKeys.has(normalizeCategory(section.category))) kept.push(section);
    else demoted.push(section);
  }
  if (!demoted.length) return;

  const now = new Date().toISOString();
  profile.custom_facts = profile.custom_facts || [];
  for (const section of demoted) {
    for (const item of (section.items || [])) {
      const text = typeof item === 'string' ? item : (item && item.text);
      if (text && !profile.custom_facts.some(f => (typeof f === 'string' ? f : f.text) === text)) {
        profile.custom_facts.push({ text, added_at: now });
      }
    }
    const sample = section.items?.[0];
    await upsertSchemaProposal({
      category: section.category,
      description: 'Guardrail: extraction filed this directly into custom_sections without an approved category. Demoted to custom_facts and queued here for review.',
      exampleFields: [],
      sampleData: sample ? (typeof sample === 'string' ? sample : sample.text) : null,
    }).catch(e => console.error('⚠ Guardrail failed to queue demoted category:', e.message));
  }
  profile.custom_sections = kept;
  console.warn(`⚠ custom_sections guardrail: demoted ${demoted.length} unapproved categor${demoted.length === 1 ? 'y' : 'ies'} (${demoted.map(s => s.category).join(', ')})`);
}

async function setBackfillStatus(id, status) {
  await pool.query('UPDATE schema_proposals SET backfill_status = $2 WHERE id = $1', [id, status]);
}

// ── UNCATEGORIZED FACTS (durable store, independent of profile edits) ──

async function recordUncategorizedFacts(userId, facts, source = 'ingestion') {
  if (!facts?.length) return;
  for (const f of facts) {
    const text = typeof f === 'string' ? f : (f && f.text);
    if (!text) continue;
    // Dedup: skip if this exact text is already on record for this user (matched or not)
    const { rows } = await pool.query(
      'SELECT id FROM uncategorized_facts WHERE user_id = $1 AND text = $2 LIMIT 1',
      [userId, text]
    );
    if (rows.length) continue;
    await pool.query(
      'INSERT INTO uncategorized_facts (user_id, text, source) VALUES ($1, $2, $3)',
      [userId, text, source]
    );
  }
}

async function getUnmatchedFactsByUser() {
  const { rows } = await pool.query(
    `SELECT user_id, array_agg(id ORDER BY id) AS ids, array_agg(text ORDER BY id) AS texts
     FROM uncategorized_facts WHERE matched_category IS NULL GROUP BY user_id`
  );
  return rows.map(r => ({ userId: r.user_id, ids: r.ids, texts: r.texts }));
}

async function saveChatFeedback({ userId, userEmail, traceId, score, comment, userMessage, arjunReply, chatMode }) {
  await pool.query(
    `INSERT INTO chat_feedback (user_id, user_email, trace_id, score, comment, user_message, arjun_reply, chat_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, userEmail || null, traceId, score, comment || null, userMessage || null, arjunReply || null, chatMode || null]
  );
}

async function getChatFeedback(status = null) {
  const { rows } = status
    ? await pool.query('SELECT * FROM chat_feedback WHERE status = $1 ORDER BY created_at DESC', [status])
    : await pool.query('SELECT * FROM chat_feedback ORDER BY created_at DESC');
  return rows;
}

async function updateChatFeedbackStatus(id, status, adminNote) {
  await pool.query(
    'UPDATE chat_feedback SET status = $1, admin_note = $2, reviewed_at = now() WHERE id = $3',
    [status, adminNote || null, id]
  );
}

async function markFactsMatched(ids, category) {
  if (!ids?.length) return;
  await pool.query(
    'UPDATE uncategorized_facts SET matched_category = $2, matched_at = now() WHERE id = ANY($1::int[])',
    [ids, category]
  );
}

module.exports = {
  pool, initSchema, getProfile, saveProfile,
  getProfileVersions, restoreProfileVersion,
  seenJobBefore, saveTailored, markDelivered,
  getJobsForUser, getJobByJobId, insertJobProcessing, markJobFailed, recoverStaleJobs,
  upsertSchemaProposal, getSchemaProposals, getApprovedCategories, updateSchemaProposalStatus, setBackfillStatus,
  recordUncategorizedFacts, getUnmatchedFactsByUser, markFactsMatched,
  saveChatFeedback, getChatFeedback, updateChatFeedbackStatus,
  EMPTY_PROFILE,
};

if (require.main === module && process.argv.includes('--init')) {
  initSchema()
    .then(() => { console.log('✓ Schema ready'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
