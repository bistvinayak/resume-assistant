'use strict';

const fs = require('fs');
const pdfParse = require('pdf-parse');
const { getProfile, saveProfile } = require('./db');
const { extractFacts } = require('./llm');

async function ingestText(text) {
  const partial = await extractFacts(text);
  return applyPartial(partial);
}

async function ingestPdf(filePath) {
  const data = await pdfParse(fs.readFileSync(filePath));
  const partial = await extractFacts(data.text);
  return applyPartial(partial);
}

async function applyPartial(partial) {
  const current = await getProfile();
  const merged = mergeProfile(current, partial);
  await saveProfile(merged);
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

  if (Array.isArray(incoming.custom_facts)) {
    const now = new Date().toISOString();
    for (const f of incoming.custom_facts) {
      const text = typeof f === 'string' ? f : (f && f.text);
      if (text && !out.custom_facts.some((x) => (x.text || x) === text)) {
        out.custom_facts.push({ text, added_at: now });
      }
    }
  }
  return out;
}

const keyExp = (e) => (e.id || `${(e.company || '').toLowerCase()}|${(e.title || '').toLowerCase()}`);
const keyProj = (p) => (p.id || (p.name || '').toLowerCase());
const keyEdu = (e) => `${(e.school || '').toLowerCase()}|${(e.degree || '').toLowerCase()}`;

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

module.exports = { ingestText, ingestPdf, mergeProfile };
