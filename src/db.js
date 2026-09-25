'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { EventEmitter } = require('events');

// Emits 'saved' (userId, version) after every profile write, so derived data (user skills)
// can refresh without db.js depending on the LLM layer.
const profileEvents = new EventEmitter();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
});

const EMPTY_PROFILE = {
  contact: {}, summary: '', skills: [], about_me: '', delivery_email: '', auto_process_paused: false,
  experience: [], projects: [], education: [],
  certifications: [], languages: [], activities: [], interests: [],
  custom_facts: [], custom_sections: [], self_identification: {},
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
      ALTER TABLE tailored_resume ADD COLUMN IF NOT EXISTS cover_letter_text TEXT;
      ALTER TABLE tailored_resume ADD COLUMN IF NOT EXISTS cover_letter_file_path TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error_reason TEXT;
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

    -- Per-user opt-in to have forwarded job-alert emails processed. Admin-gated —
    -- matching is by the user's verified login email (Firebase already proves ownership),
    -- so no separate email-confirmation flow is needed, just the approval step.
    CREATE TABLE IF NOT EXISTS gmail_forwarding (
      user_id      TEXT PRIMARY KEY,
      email        TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at  TIMESTAMPTZ,
      reviewed_by  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gmail_forwarding_status ON gmail_forwarding(status);

    -- Per-user resume style reference: an uploaded template's inferred section order/
    -- heading style plus a target page count, applied when rendering future tailored resumes.
    CREATE TABLE IF NOT EXISTS resume_format (
      user_id         TEXT PRIMARY KEY,
      target_pages    INTEGER,
      style_profile   JSONB,
      source_filename TEXT,
      template_text   TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE resume_format ADD COLUMN IF NOT EXISTS template_text TEXT;

    -- One row per browser-extension field-mapping request, success or failure, so the
    -- admin Extension tab can show the latest retrievals and why any of them failed.
    CREATE TABLE IF NOT EXISTS extension_events (
      id            SERIAL PRIMARY KEY,
      user_id       TEXT NOT NULL,
      user_email    TEXT,
      url           TEXT,
      host          TEXT,
      fields_count  INTEGER NOT NULL DEFAULT 0,
      mapped_count  INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL,
      model         TEXT,
      error         TEXT,
      duration_ms   INTEGER,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_extension_events_created ON extension_events(created_at DESC);

    -- Per-user "skills": markdown playbooks generated from the user's profile (career profile,
    -- cover-letter story, writing voice) that steer resume/cover-letter writing, and can be
    -- exported as Claude skills. user_notes are the user's own corrections — they survive
    -- regeneration and take priority over generated text.
    -- Uploads whose AI extraction failed (provider down/overloaded). The text is kept and a
    -- cron job finishes them when the AI recovers, so an upload is never lost.
    CREATE TABLE IF NOT EXISTS pending_ingestions (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      text        TEXT NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'pending',
      last_error  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_pending_ingestions_status ON pending_ingestions(status);

    -- Self-healing: agents turn failure signals (disliked chats, extension failures) into
    -- proposals an admin accepts or rejects. Accepted prompt rules live in prompt_rules and are
    -- appended to that prompt at runtime (reversible: toggle active off).
    ALTER TABLE extension_events ADD COLUMN IF NOT EXISTS unmapped JSONB;
    ALTER TABLE chat_feedback ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS improvement_proposals (
      id              SERIAL PRIMARY KEY,
      source          TEXT NOT NULL,
      kind            TEXT NOT NULL,
      fingerprint     TEXT UNIQUE,
      title           TEXT NOT NULL,
      diagnosis       TEXT,
      evidence        JSONB DEFAULT '{}',
      target_prompt   TEXT,
      proposed_rule   TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      model           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at     TIMESTAMPTZ,
      reviewed_by     TEXT
    );
    CREATE TABLE IF NOT EXISTS prompt_rules (
      id           SERIAL PRIMARY KEY,
      prompt_name  TEXT NOT NULL,
      rule         TEXT NOT NULL,
      active       BOOLEAN NOT NULL DEFAULT true,
      proposal_id  INTEGER,
      created_by   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_skills (
      user_id          TEXT NOT NULL,
      skill            TEXT NOT NULL,
      content          TEXT,
      previous_content TEXT,
      user_notes       TEXT,
      profile_version  INTEGER,
      status           TEXT NOT NULL DEFAULT 'pending',
      model            TEXT,
      error            TEXT,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, skill)
    );
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

  profileEvents.emit('saved', userId, nextVersion);
  return profile;
}

async function getProfileVersion(userId = 'me') {
  const { rows } = await pool.query('SELECT COALESCE(MAX(version), 0) AS v FROM master_profile WHERE user_id = $1', [userId]);
  return rows[0]?.v || 0;
}

// ── PENDING INGESTIONS ────────────────────────────────────────────────────
async function addPendingIngestion(userId, text, error) {
  const { rows } = await pool.query(
    `INSERT INTO pending_ingestions (user_id, text, last_error) VALUES ($1, $2, $3) RETURNING id`,
    [userId, text, String(error || '').slice(0, 1000)]
  );
  return rows[0].id;
}

async function getDuePendingIngestions(limit = 5) {
  const { rows } = await pool.query(
    `SELECT id, user_id, text, attempts FROM pending_ingestions
     WHERE status = 'pending' ORDER BY updated_at ASC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getPendingIngestionCount(userId) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM pending_ingestions WHERE user_id = $1 AND status = 'pending'`, [userId]);
  return rows[0]?.n || 0;
}

async function markPendingIngestion(id, { status, error = null, incrementAttempts = false }) {
  await pool.query(
    `UPDATE pending_ingestions SET status = $2, last_error = COALESCE($3, last_error),
       attempts = attempts + $4, updated_at = now() WHERE id = $1`,
    [id, status, error ? String(error).slice(0, 1000) : null, incrementAttempts ? 1 : 0]
  );
}

// ── SELF-HEALING PROPOSALS ────────────────────────────────────────────────
async function insertProposal(p) {
  const { rows } = await pool.query(
    `INSERT INTO improvement_proposals (source, kind, fingerprint, title, diagnosis, evidence, target_prompt, proposed_rule, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (fingerprint) DO NOTHING RETURNING id`,
    [p.source, p.kind, p.fingerprint, p.title, p.diagnosis, JSON.stringify(p.evidence || {}), p.target_prompt || null, p.proposed_rule || null, p.model || null]
  );
  return rows[0]?.id || null;
}

async function listProposals({ status, source } = {}) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (source) { params.push(source); where.push(`source = $${params.length}`); }
  const { rows } = await pool.query(`SELECT * FROM improvement_proposals ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200`, params);
  return rows;
}

async function getProposal(id) {
  const { rows } = await pool.query('SELECT * FROM improvement_proposals WHERE id = $1', [id]);
  return rows[0] || null;
}

async function setProposalStatus(id, status, reviewer, proposedRule) {
  const { rows } = await pool.query(
    `UPDATE improvement_proposals SET status = $2, reviewed_at = now(), reviewed_by = $3,
       proposed_rule = COALESCE($4, proposed_rule) WHERE id = $1 RETURNING *`,
    [id, status, reviewer || null, proposedRule || null]
  );
  return rows[0] || null;
}

async function addPromptRule(promptName, rule, proposalId, createdBy) {
  const { rows } = await pool.query(
    `INSERT INTO prompt_rules (prompt_name, rule, proposal_id, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
    [promptName, rule, proposalId || null, createdBy || null]
  );
  return rows[0];
}

async function listPromptRules() {
  const { rows } = await pool.query('SELECT * FROM prompt_rules ORDER BY created_at DESC');
  return rows;
}

async function getActivePromptRules() {
  const { rows } = await pool.query('SELECT prompt_name, rule FROM prompt_rules WHERE active ORDER BY created_at');
  return rows;
}

async function setPromptRuleActive(id, active) {
  const { rows } = await pool.query('UPDATE prompt_rules SET active = $2 WHERE id = $1 RETURNING *', [id, !!active]);
  return rows[0] || null;
}

async function getUnanalyzedNegativeFeedback(limit = 10) {
  const { rows } = await pool.query(
    `SELECT id, user_message, arjun_reply, comment, chat_mode, created_at FROM chat_feedback
     WHERE score = 0 AND analyzed_at IS NULL ORDER BY created_at ASC LIMIT $1`, [limit]);
  return rows;
}

async function markFeedbackAnalyzed(id) {
  await pool.query('UPDATE chat_feedback SET analyzed_at = now() WHERE id = $1', [id]);
}

// Per-site problem summary for the extension analyzer: failed, slow (>30 s) or <50% filled,
// with the field labels the mapper left unfilled.
async function getExtensionProblemsBySite(days = 14) {
  const { rows } = await pool.query(`
    SELECT host,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE duration_ms > 30000)::int AS slow,
      COUNT(*) FILTER (WHERE fields_count > 0 AND mapped_count::float / fields_count < 0.5)::int AS low_fill,
      ROUND(AVG(CASE WHEN fields_count > 0 THEN mapped_count::numeric / fields_count END) * 100)::int AS fill_pct,
      MAX(fields_count)::int AS max_fields,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT LEFT(error, 200)), NULL) AS errors,
      COALESCE(jsonb_agg(unmapped) FILTER (WHERE unmapped IS NOT NULL), '[]') AS unmapped_lists
    FROM extension_events
    WHERE created_at > now() - ($1 || ' days')::interval AND host IS NOT NULL
    GROUP BY host
    HAVING COUNT(*) FILTER (WHERE status = 'failed' OR duration_ms > 30000 OR (fields_count > 0 AND mapped_count::float / fields_count < 0.5)) > 0
    ORDER BY COUNT(*) DESC`, [String(days)]);
  return rows;
}

// ── USER SKILLS ───────────────────────────────────────────────────────────
async function getUserSkills(userId) {
  const { rows } = await pool.query(
    `SELECT skill, content, user_notes, profile_version, status, model, error, updated_at
     FROM user_skills WHERE user_id = $1`,
    [userId]
  );
  return Object.fromEntries(rows.map(r => [r.skill, r]));
}

async function setUserSkillStatus(userId, skill, status, error = null) {
  await pool.query(
    `INSERT INTO user_skills (user_id, skill, status, error, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, skill) DO UPDATE SET status = $3, error = $4, updated_at = now()`,
    [userId, skill, status, error]
  );
}

async function saveUserSkill(userId, skill, { content, profileVersion, model }) {
  await pool.query(
    `INSERT INTO user_skills (user_id, skill, content, profile_version, model, status, error, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'ready', NULL, now())
     ON CONFLICT (user_id, skill) DO UPDATE SET
       previous_content = user_skills.content, content = $3, profile_version = $4, model = $5,
       status = 'ready', error = NULL, updated_at = now()`,
    [userId, skill, content, profileVersion, model]
  );
}

async function saveUserSkillNotes(userId, skill, notes) {
  await pool.query(
    `INSERT INTO user_skills (user_id, skill, user_notes, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, skill) DO UPDATE SET user_notes = $3, updated_at = now()`,
    [userId, skill, notes || null]
  );
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

async function saveTailored(jobId, resumeJson, filePath, userId = 'me', coverLetterText = null, coverLetterFilePath = null) {
  const { rows } = await pool.query(
    `INSERT INTO tailored_resume (job_id, user_id, resume_json, file_path, cover_letter_text, cover_letter_file_path)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [jobId, userId, resumeJson, filePath || null, coverLetterText, coverLetterFilePath]
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
    `SELECT j.*, t.file_path, t.cover_letter_file_path, t.created_at AS resume_created_at
     FROM jobs j
     LEFT JOIN tailored_resume t ON t.job_id = j.job_id AND t.user_id = j.user_id AND t.delivered = true
     WHERE j.job_id = $1 AND j.user_id = $2
     LIMIT 1`,
    [jobId, userId]
  );
  return rows.length ? rows[0] : null;
}

// Powers "why this bullet, not that one" follow-up questions in the Apply-to-
// Job chat — pulls the actual tailoring reasoning (per-bullet "serves", ATS
// keyword matches, tailoring notes) for whatever job the user most recently
// had tailored, so the question-answering step has real context instead of
// just the general profile.
async function getMostRecentDeliveredJob(userId = 'me') {
  const { rows } = await pool.query(
    `SELECT j.job_id, j.title, j.company, j.ats_score, j.matched_keywords, j.missing_keywords,
            j.tailoring_notes, j.jd_requirements, j.improved, j.substitutions, t.resume_json
     FROM jobs j
     JOIN tailored_resume t ON t.job_id = j.job_id AND t.user_id = j.user_id AND t.delivered = true
     WHERE j.user_id = $1 AND j.status = 'delivered'
     ORDER BY t.created_at DESC LIMIT 1`,
    [userId]
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
    `UPDATE jobs SET status = 'failed', error_reason = $2 WHERE job_id = $1`,
    [jobId, reason || 'Scraping failed']
  );
}

// Admin override — force a job (regardless of current status) back into
// 'processing' so it can be re-queued through the pipeline. Unlike
// recoverStaleJobs (which only touches genuinely-stale jobs), this is an
// explicit human action and skips that guard.
async function forceRequeueJob(jobId) {
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'processing', seen_at = now(), error_reason = NULL WHERE job_id = $1 RETURNING *`,
    [jobId]
  );
  return rows[0] || null;
}

async function recoverStaleJobs(minutes = 10) {
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'failed', error_reason = 'Timed out — processing took too long or server restarted'
     WHERE status = 'processing' AND seen_at < now() - interval '1 minute' * $1
     RETURNING job_id, user_id, title, company, jd_text, url`,
    [minutes]
  );
  return rows;
}

async function getJobsForUser(userId = 'me', limit = 50) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (j.job_id) j.*, t.created_at AS resume_created_at, t.file_path, t.cover_letter_file_path
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

async function requestGmailForwarding(userId, email) {
  const { rows } = await pool.query(
    `INSERT INTO gmail_forwarding (user_id, email, status, requested_at)
     VALUES ($1, $2, 'pending', now())
     ON CONFLICT (user_id) DO UPDATE SET email = $2, status = 'pending', requested_at = now(), reviewed_at = NULL, reviewed_by = NULL
     RETURNING *`,
    [userId, email]
  );
  return rows[0];
}

async function getGmailForwardingStatus(userId) {
  const { rows } = await pool.query('SELECT * FROM gmail_forwarding WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

async function getGmailForwardingRequests(status = null) {
  const { rows } = status
    ? await pool.query('SELECT * FROM gmail_forwarding WHERE status = $1 ORDER BY requested_at DESC', [status])
    : await pool.query('SELECT * FROM gmail_forwarding ORDER BY requested_at DESC');
  return rows;
}

async function reviewGmailForwarding(userId, status, reviewedBy) {
  const { rows } = await pool.query(
    `UPDATE gmail_forwarding SET status = $2, reviewed_at = now(), reviewed_by = $3 WHERE user_id = $1 RETURNING *`,
    [userId, status, reviewedBy || null]
  );
  return rows[0] || null;
}

async function getApprovedForwardingMap() {
  const { rows } = await pool.query(`SELECT user_id, email FROM gmail_forwarding WHERE status = 'approved'`);
  const map = {};
  for (const r of rows) map[r.email.toLowerCase()] = r.user_id;
  return map;
}

async function getResumeFormat(userId = 'me') {
  const { rows } = await pool.query(
    'SELECT target_pages, style_profile, source_filename, template_text, updated_at FROM resume_format WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

async function saveResumeFormat(userId = 'me', { target_pages, style_profile, source_filename, template_text }) {
  await pool.query(
    `INSERT INTO resume_format (user_id, target_pages, style_profile, source_filename, template_text, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       target_pages = $2, style_profile = $3, source_filename = $4, template_text = $5, updated_at = now()`,
    [userId, target_pages, style_profile, source_filename, template_text || null]
  );
  return getResumeFormat(userId);
}

async function deleteResumeFormat(userId = 'me') {
  await pool.query('DELETE FROM resume_format WHERE user_id = $1', [userId]);
}

async function logExtensionEvent({ userId, userEmail, url, fieldsCount, mappedCount, status, model, error, durationMs, unmapped }) {
  let host = null;
  try { host = url ? new URL(url).hostname : null; } catch { /* malformed page URL */ }
  await pool.query(
    `INSERT INTO extension_events (user_id, user_email, url, host, fields_count, mapped_count, status, model, error, duration_ms, unmapped)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [userId, userEmail || null, url || null, host, fieldsCount || 0, mappedCount || 0, status, model || null, error || null, durationMs ?? null, unmapped ? JSON.stringify(unmapped) : null]
  );
}

// Admin Extension observability. Every filter is optional; the summary, breakdowns and daily
// series are computed over the same filtered set as the event list.
async function getExtensionEvents(filters = {}) {
  const where = [];
  const params = [];
  const p = (value) => { params.push(value); return `$${params.length}`; };
  const RANGES = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
  if (RANGES[filters.range]) where.push(`created_at > now() - interval '${RANGES[filters.range]}'`);
  if (filters.status === 'failed') where.push(`status = 'failed'`);
  if (filters.status === 'success') where.push(`status = 'success' AND error IS NULL`);
  if (filters.status === 'fallback') where.push(`status = 'success' AND error IS NOT NULL`);
  if (filters.user) { const v = p(filters.user); where.push(`(user_email = ${v} OR user_id = ${v})`); }
  if (filters.host) where.push(`host = ${p(filters.host)}`);
  if (filters.model) where.push(`model = ${p(filters.model)}`);
  if (filters.q) { const v = p(`%${filters.q}%`); where.push(`(error ILIKE ${v} OR url ILIKE ${v} OR host ILIKE ${v})`); }
  if (filters.problems === 'true' || filters.problems === true) {
    where.push(`(status = 'failed' OR duration_ms > 30000 OR (fields_count > 0 AND mapped_count::float / fields_count < 0.5))`);
  }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Number(filters.limit) || 200, 1000);

  const [events, summary, byHost, byUser, byModel, daily, facets] = await Promise.all([
    pool.query(`SELECT * FROM extension_events ${W} ORDER BY created_at DESC LIMIT ${limit}`, params),
    pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'success' AND error IS NOT NULL)::int AS fallback,
        COUNT(*) FILTER (WHERE duration_ms > 30000)::int AS over_30s,
        ROUND(AVG(CASE WHEN fields_count > 0 THEN mapped_count::numeric / fields_count END) * 100)::int AS fill_pct,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_ms)::int AS p90_ms,
        COUNT(DISTINCT user_id)::int AS users,
        MAX(created_at) FILTER (WHERE status = 'success') AS last_success_at,
        MAX(created_at) FILTER (WHERE status = 'failed') AS last_failure_at
      FROM extension_events ${W}`, params),
    pool.query(`
      SELECT host, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        ROUND(AVG(CASE WHEN fields_count > 0 THEN mapped_count::numeric / fields_count END) * 100)::int AS fill_pct,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms
      FROM extension_events ${W} GROUP BY host ORDER BY total DESC LIMIT 15`, params),
    pool.query(`
      SELECT COALESCE(user_email, user_id) AS user, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        MAX(created_at) AS last_seen
      FROM extension_events ${W} GROUP BY 1 ORDER BY total DESC LIMIT 15`, params),
    pool.query(`
      SELECT COALESCE(model, 'unknown') AS model, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms
      FROM extension_events ${W} GROUP BY 1 ORDER BY total DESC`, params),
    pool.query(`
      SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM extension_events ${W} GROUP BY 1 ORDER BY 1 DESC LIMIT 30`, params),
    pool.query(`
      SELECT
        ARRAY(SELECT DISTINCT COALESCE(user_email, user_id) FROM extension_events ORDER BY 1) AS users,
        ARRAY(SELECT DISTINCT host FROM extension_events WHERE host IS NOT NULL ORDER BY 1) AS hosts,
        ARRAY(SELECT DISTINCT model FROM extension_events WHERE model IS NOT NULL ORDER BY 1) AS models`),
  ]);
  const sm = summary.rows[0];
  return {
    events: events.rows,
    summary: {
      ...sm,
      success_rate: sm.total ? Math.round(((sm.total - sm.failed) / sm.total) * 100) : null,
      // kept for the tab badge
      total_24h: sm.total, failed_24h: sm.failed,
    },
    by_host: byHost.rows, by_user: byUser.rows, by_model: byModel.rows,
    daily: daily.rows.reverse(),
    facets: facets.rows[0],
  };
}

module.exports = {
  pool, initSchema, getProfile, saveProfile, getProfileVersion, profileEvents,
  getUserSkills, setUserSkillStatus, saveUserSkill, saveUserSkillNotes,
  addPendingIngestion, getDuePendingIngestions, getPendingIngestionCount, markPendingIngestion,
  insertProposal, listProposals, getProposal, setProposalStatus, addPromptRule, listPromptRules, getActivePromptRules, setPromptRuleActive,
  getUnanalyzedNegativeFeedback, markFeedbackAnalyzed, getExtensionProblemsBySite,
  getProfileVersions, restoreProfileVersion,
  seenJobBefore, saveTailored, markDelivered,
  getJobsForUser, getJobByJobId, getMostRecentDeliveredJob, insertJobProcessing, markJobFailed, recoverStaleJobs, forceRequeueJob,
  upsertSchemaProposal, getSchemaProposals, getApprovedCategories, updateSchemaProposalStatus, setBackfillStatus,
  recordUncategorizedFacts, getUnmatchedFactsByUser, markFactsMatched,
  saveChatFeedback, getChatFeedback, updateChatFeedbackStatus,
  getResumeFormat, saveResumeFormat, deleteResumeFormat,
  logExtensionEvent, getExtensionEvents,
  requestGmailForwarding, getGmailForwardingStatus, getGmailForwardingRequests, reviewGmailForwarding, getApprovedForwardingMap,
  EMPTY_PROFILE,
};

if (require.main === module && process.argv.includes('--init')) {
  initSchema()
    .then(() => { console.log('✓ Schema ready'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
