'use strict';

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { getProfile, saveProfile } = require('./db');
const { extractFacts, smartMerge } = require('./llm');

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.txt', '.json']);

function normalizeBullet(b) {
  if (typeof b === 'string') return { text: b, metric: null, impact: null };
  return { text: b.text || '', metric: b.metric || null, impact: b.impact || null };
}

function isEmptyProfile(profile) {
  return !profile.summary
    && !(profile.skills?.length)
    && !(profile.experience?.length)
    && !(profile.projects?.length)
    && !(profile.education?.length);
}

// ── TEXT EXTRACTION BY FORMAT ─────────────────────────────────────────────

async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported format: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
  }

  if (ext === '.pdf') {
    const data = await pdfParse(fs.readFileSync(filePath));
    return data.text;
  }

  if (ext === '.docx' || ext === '.doc') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.json') {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.experience || parsed.skills || parsed.contact) {
      return JSON.stringify(parsed);
    }
    return raw;
  }

  throw new Error(`Cannot read format: ${ext}`);
}

// ── INGESTION FUNCTIONS ───────────────────────────────────────────────────

async function ingestText(text, userId = 'me', ctx = {}) {
  const partial = await extractFacts(text, { userId, ...ctx });
  return applyPartial(partial, userId, ctx);
}

async function ingestPdf(filePath, userId = 'me', ctx = {}) {
  const text = await extractTextFromFile(filePath, filePath);
  const partial = await extractFacts(text, { userId, ...ctx });
  return applyPartial(partial, userId, ctx);
}

async function ingestFiles(files, userId = 'me', ctx = {}) {
  const texts = [];
  const errors = [];

  for (const file of files) {
    try {
      const text = await extractTextFromFile(file.path, file.originalname);
      if (text && text.trim().length > 10) {
        texts.push(text.trim());
      }
    } catch (e) {
      errors.push({ file: file.originalname, error: e.message });
    }
  }

  if (!texts.length) {
    const detail = errors.length
      ? errors.map(e => `${e.file}: ${e.error}`).join('; ')
      : 'No readable text found';
    throw new Error(`Could not extract text from any file. ${detail}`);
  }

  const combined = texts.length === 1
    ? texts[0]
    : texts.map((t, i) => `--- Document ${i + 1} ---\n${t}`).join('\n\n');

  const partial = await extractFacts(combined, { userId, ...ctx });
  const profile = await applyPartial(partial, userId, ctx);

  return {
    ...profile,
    _ingestion: {
      filesProcessed: texts.length,
      filesSkipped: errors.length,
      errors: errors.length ? errors : undefined,
    },
  };
}

// ── MERGE LOGIC ───────────────────────────────────────────────────────────

async function applyPartial(partial, userId = 'me', ctx = {}) {
  const current = await getProfile(userId);

  let merged;
  if (isEmptyProfile(current)) {
    merged = mergeProfile(current, partial);
  } else {
    try {
      merged = await smartMerge(current, partial, { userId, ...ctx });
    } catch (e) {
      console.error('Smart merge failed, falling back to programmatic:', e.message);
      merged = mergeProfile(current, partial);
    }
  }

  await saveProfile(merged, userId);
  return merged;
}

function mergeProfile(base, incoming) {
  const out = JSON.parse(JSON.stringify(base));
  if (!incoming || typeof incoming !== 'object') return out;

  if (incoming.contact) out.contact = { ...out.contact, ...incoming.contact };
  if (incoming.summary) out.summary = incoming.summary;

  out.skills = unionCI(out.skills, incoming.skills);
  out.experience = upsertExperience(out.experience, incoming.experience);
  out.projects = upsertProjects(out.projects, incoming.projects);
  out.education = upsertById(out.education, incoming.education, keyEdu);
  out.certifications = upsertById(out.certifications || [], incoming.certifications, keyCert);
  out.languages = upsertById(out.languages || [], incoming.languages, keyLang);
  out.activities = unionCI(out.activities || [], incoming.activities);
  out.interests = unionCI(out.interests || [], incoming.interests);

  if (Array.isArray(incoming.custom_facts)) {
    const now = new Date().toISOString();
    for (const f of incoming.custom_facts) {
      const text = typeof f === 'string' ? f : (f && f.text);
      if (text && !out.custom_facts.some((x) => (x.text || x) === text)) {
        out.custom_facts.push({ text, added_at: now });
      }
    }
  }

  if (!out.contact?.location && out.experience?.length) {
    const loc = out.experience.find(e => e.location)?.location;
    if (loc) out.contact = { ...out.contact, location: loc };
  }

  return out;
}

const keyExp = (e) => (e.id || `${(e.company || '').toLowerCase()}|${(e.title || '').toLowerCase()}`);
const keyProj = (p) => (p.id || (p.name || '').toLowerCase());
const keyEdu = (e) => `${(e.school || '').toLowerCase()}|${(e.degree || '').toLowerCase()}`;
const keyCert = (c) => (typeof c === 'string' ? c : (c.name || '')).toLowerCase();
const keyLang = (l) => (typeof l === 'string' ? l : (l.name || '')).toLowerCase();

function unionCI(a = [], b = []) {
  const seen = new Set((a || []).map((s) => String(s).toLowerCase()));
  const out = [...(a || [])];
  for (const item of b || []) {
    if (!seen.has(String(item).toLowerCase())) { out.push(item); seen.add(String(item).toLowerCase()); }
  }
  return out;
}

function mergeBullets(existing, incoming) {
  const result = (existing || []).map(normalizeBullet);
  const seen = new Set(result.map(b => b.text.toLowerCase().trim()));
  for (const b of (incoming || []).map(normalizeBullet)) {
    if (!seen.has(b.text.toLowerCase().trim())) {
      result.push(b);
      seen.add(b.text.toLowerCase().trim());
    } else if (b.metric || b.impact) {
      const idx = result.findIndex(r => r.text.toLowerCase().trim() === b.text.toLowerCase().trim());
      if (idx !== -1) {
        if (b.metric && !result[idx].metric) result[idx].metric = b.metric;
        if (b.impact && !result[idx].impact) result[idx].impact = b.impact;
      }
    }
  }
  return result;
}

function upsertExperience(existing = [], incoming = []) {
  const out = [...(existing || [])];
  const index = new Map(out.map((item, i) => [keyExp(item), i]));
  for (const item of incoming || []) {
    const k = keyExp(item);
    if (index.has(k)) {
      const prev = out[index.get(k)];
      out[index.get(k)] = {
        ...prev,
        ...item,
        bullets: mergeBullets(prev.bullets, item.bullets),
        company_description: item.company_description || prev.company_description,
      };
    } else {
      out.push({ ...item, bullets: (item.bullets || []).map(normalizeBullet) });
      index.set(k, out.length - 1);
    }
  }
  return out;
}

function upsertProjects(existing = [], incoming = []) {
  const out = [...(existing || [])];
  const index = new Map(out.map((item, i) => [keyProj(item), i]));
  for (const item of incoming || []) {
    const k = keyProj(item);
    if (index.has(k)) {
      const prev = out[index.get(k)];
      out[index.get(k)] = {
        ...prev,
        ...item,
        outcome: item.outcome || prev.outcome,
        description: (item.description && item.description.length > (prev.description || '').length) ? item.description : prev.description,
      };
    } else {
      out.push(item);
      index.set(k, out.length - 1);
    }
  }
  return out;
}

function upsertById(existing = [], incoming = [], keyOf) {
  const out = [...(existing || [])];
  const index = new Map(out.map((item, i) => [keyOf(item), i]));
  for (const item of incoming || []) {
    const k = keyOf(item);
    if (index.has(k)) out[index.get(k)] = { ...out[index.get(k)], ...item };
    else { out.push(item); index.set(k, out.length - 1); }
  }
  return out;
}

function applyDeletions(profile, deletions) {
  const out = JSON.parse(JSON.stringify(profile));
  if (!deletions || typeof deletions !== 'object') return out;

  if (deletions.clear_summary) out.summary = '';

  if (Array.isArray(deletions.skills) && deletions.skills.length) {
    const remove = new Set(deletions.skills.map(s => s.toLowerCase()));
    out.skills = (out.skills || []).filter(s => !remove.has(s.toLowerCase()));
  }

  if (Array.isArray(deletions.experience_ids) && deletions.experience_ids.length) {
    const remove = new Set(deletions.experience_ids.map(s => s.toLowerCase()));
    out.experience = (out.experience || []).filter(e =>
      !remove.has((e.company || '').toLowerCase()) && !remove.has((e.id || '').toLowerCase())
    );
  }

  if (Array.isArray(deletions.project_ids) && deletions.project_ids.length) {
    const remove = new Set(deletions.project_ids.map(s => s.toLowerCase()));
    out.projects = (out.projects || []).filter(p =>
      !remove.has((p.name || '').toLowerCase()) && !remove.has((p.id || '').toLowerCase())
    );
  }

  if (Array.isArray(deletions.certifications) && deletions.certifications.length) {
    const remove = new Set(deletions.certifications.map(s => s.toLowerCase()));
    out.certifications = (out.certifications || []).filter(c => {
      const name = typeof c === 'string' ? c : c.name || '';
      return !remove.has(name.toLowerCase());
    });
  }

  if (Array.isArray(deletions.education_ids) && deletions.education_ids.length) {
    const remove = new Set(deletions.education_ids.map(s => s.toLowerCase()));
    out.education = (out.education || []).filter(e =>
      !remove.has((e.school || '').toLowerCase())
    );
  }

  if (Array.isArray(deletions.languages) && deletions.languages.length) {
    const remove = new Set(deletions.languages.map(s => s.toLowerCase()));
    out.languages = (out.languages || []).filter(l => {
      const name = typeof l === 'string' ? l : l.name || '';
      return !remove.has(name.toLowerCase());
    });
  }

  return out;
}

module.exports = { ingestText, ingestPdf, ingestFiles, extractTextFromFile, mergeProfile, applyDeletions, ALLOWED_EXTENSIONS };
