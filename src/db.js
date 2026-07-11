'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

const PROFILE_KEY = 'me';

const EMPTY_PROFILE = {
  contact: {}, summary: '', skills: [],
  experience: [], projects: [], education: [],
  custom_facts: [],
};

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS master_profile (
      id          TEXT PRIMARY KEY,
      profile     JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS jobs (
      job_id      TEXT PRIMARY KEY,
      title       TEXT,
      company     TEXT,
      jd_text     TEXT,
      status      TEXT NOT NULL DEFAULT 'new',
      seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tailored_resume (
      id          SERIAL PRIMARY KEY,
      job_id      TEXT REFERENCES jobs(job_id),
      resume_json JSONB NOT NULL,
      file_path   TEXT,
      delivered   BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getProfile() {
  const { rows } = await pool.query('SELECT profile FROM master_profile WHERE id = $1', [PROFILE_KEY]);
  return rows.length ? { ...EMPTY_PROFILE, ...rows[0].profile } : { ...EMPTY_PROFILE };
}

async function saveProfile(profile) {
  await pool.query(
    `INSERT INTO master_profile (id, profile, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET profile = $2, updated_at = now()`,
    [PROFILE_KEY, profile]
  );
  return profile;
}

async function seenJobBefore(job) {
  const res = await pool.query(
    `INSERT INTO jobs (job_id, title, company, jd_text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job_id) DO NOTHING
     RETURNING job_id`,
    [job.job_id, job.title || null, job.company || null, job.jd_text || null]
  );
  return res.rowCount === 0;
}

async function saveTailored(jobId, resumeJson, filePath) {
  const { rows } = await pool.query(
    `INSERT INTO tailored_resume (job_id, resume_json, file_path) VALUES ($1, $2, $3) RETURNING id`,
    [jobId, resumeJson, filePath || null]
  );
  return rows[0].id;
}

async function markDelivered(tailoredId) {
  await pool.query('UPDATE tailored_resume SET delivered = true WHERE id = $1', [tailoredId]);
  await pool.query(
    `UPDATE jobs SET status = 'delivered'
      WHERE job_id = (SELECT job_id FROM tailored_resume WHERE id = $1)`,
    [tailoredId]
  );
}

module.exports = {
  pool, initSchema, getProfile, saveProfile,
  seenJobBefore, saveTailored, markDelivered, EMPTY_PROFILE,
};

if (require.main === module && process.argv.includes('--init')) {
  initSchema()
    .then(() => { console.log('✓ Schema ready'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
