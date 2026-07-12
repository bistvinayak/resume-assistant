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
      ALTER TABLE tailored_resume ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'me';
    EXCEPTION WHEN others THEN NULL; END $$;

    CREATE INDEX IF NOT EXISTS idx_master_profile_user ON master_profile(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_tailored_user ON tailored_resume(user_id);
  `);
}

async function getProfile(userId = 'me') {
  const { rows } = await pool.query(
    'SELECT profile FROM master_profile WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [userId]
  );
  return rows.length ? { ...EMPTY_PROFILE, ...rows[0].profile } : { ...EMPTY_PROFILE };
}

async function saveProfile(profile, userId = 'me') {
  await pool.query(
    `INSERT INTO master_profile (id, user_id, profile, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET profile = $3, updated_at = now()`,
    [userId, userId, profile]
  );
  return profile;
}

async function seenJobBefore(job, userId = 'me') {
  const res = await pool.query(
    `INSERT INTO jobs (job_id, user_id, title, company, jd_text, url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (job_id) DO NOTHING
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
      improved = $5
     WHERE job_id = $1`,
    [
      jobId,
      atsData?.score || null,
      JSON.stringify(atsData?.matched_keywords || []),
      JSON.stringify(atsData?.missing_keywords || []),
      atsData?.improved || false,
    ]
  );
}

async function getJobsForUser(userId = 'me', limit = 50) {
  const { rows } = await pool.query(
    `SELECT j.*, t.created_at, t.file_path
     FROM jobs j
     LEFT JOIN tailored_resume t ON t.job_id = j.job_id AND t.user_id = j.user_id
     WHERE j.user_id = $1 AND j.status = 'delivered'
     ORDER BY t.created_at DESC NULLS LAST
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

module.exports = {
  pool, initSchema, getProfile, saveProfile,
  seenJobBefore, saveTailored, markDelivered,
  getJobsForUser, EMPTY_PROFILE,
};

if (require.main === module && process.argv.includes('--init')) {
  initSchema()
    .then(() => { console.log('✓ Schema ready'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
