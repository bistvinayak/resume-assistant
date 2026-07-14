'use strict';

const fs = require('fs');
const pdfParse = require('pdf-parse');
const { getProfile, saveProfile } = require('./db');
const { extractFacts } = require('./llm');

async function ingestText(text, userId = 'me') {
  const partial = await extractFacts(text);
  return applyPartial(partial, userId);
}

async function ingestPdf(filePath, userId = 'me') {
  const data = await pdfParse(fs.readFileSync(filePath));
  const partial = await extractFacts(data.text);
  return applyPartial(partial, userId);
}

async function applyPartial(partial, userId = 'me') {
  const current = await getProfile(userId);
  const merged = mergeProfile(current, partial);
  await saveProfile(merged, userId);
  return merged;
}

function mergeProfile(base, incoming) {
  const out = JSON.parse(JSON.stringify(base));
  if (!incoming || typeof incoming !== 'object') return out;

  if (incoming.contact) out.contact = { ...out.contact, ...incoming.contact };
  if (incoming.summary) out.summary = incoming.summary;

  out.skills = unionCI(out.skills, incoming.skills);
  out.experience = upsertById(out.experience, incoming.experience, keyExp);
  out.projects = upsertById(out.projects, incoming.projects, keyProj);
  out.education = upsertById(out.education, incoming.education, keyEdu);
  out.certifications = upsertById(out.certifications || [], incoming.certifications, keyCert);
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

  // Fallback: if contact location is missing, use the most recent job's location
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

function unionCI(a = [], b = []) {
  const seen = new Set((a || []).map((s) => String(s).toLowerCase()));
  const out = [...(a || [])];
  for (const item of b || []) {
    if (!seen.has(String(item).toLowerCase())) { out.push(item); seen.add(String(item).toLowerCase()); }
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

  return out;
}

module.exports = { ingestText, ingestPdf, mergeProfile, applyDeletions };
