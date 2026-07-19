'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const EMPTY_PROFILE = {
  contact: {}, summary: '', skills: [],
  experience: [], projects: [], education: [],
  certifications: [], languages: [], activities: [], interests: [],
  custom_facts: [],
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
      tailoring_notes = $7
     WHERE job_id = $1`,
    [
      jobId,
      atsData?.score || null,
      JSON.stringify(atsData?.matched_keywords || []),
      JSON.stringify(atsData?.missing_keywords || []),
      atsData?.improved || false,
      JSON.stringify(atsData?.substitutions || []),
      JSON.stringify(atsData?.tailoring_notes || []),
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

module.exports = {
  pool, initSchema, getProfile, saveProfile,
  getProfileVersions, restoreProfileVersion,
  seenJobBefore, saveTailored, markDelivered,
  getJobsForUser, getJobByJobId, insertJobProcessing, markJobFailed, recoverStaleJobs,
  EMPTY_PROFILE,
};

if (require.main === module && process.argv.includes('--init')) {
  initSchema()
    .then(() => { console.log('✓ Schema ready'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
