'use strict';

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { getProfile, saveProfile, recordUncategorizedFacts, getUnmatchedFactsByUser, markFactsMatched } = require('./db');
const { extractFacts, smartMerge, scoreIngestionCoverage, classifyCustomFacts } = require('./llm');

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
    const buf = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    let text = data.text;

    // Extract hyperlink URLs from PDF annotations (pdf-parse exposes raw page data)
    try {
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      const urls = new Set();
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const annotations = await page.getAnnotations();
        for (const ann of annotations) {
          if (ann.subtype === 'Link' && ann.url) urls.add(ann.url);
        }
      }
      if (urls.size) {
        text += '\n\n--- Hyperlinks found in document ---\n' + [...urls].join('\n');
      }
    } catch (_) {
      // pdfjs-dist not available or failed — fall back to text-only
    }

    return text;
  }

  if (ext === '.docx' || ext === '.doc') {
    const textResult = await mammoth.extractRawText({ path: filePath });
    let text = textResult.value;

    // Extract hyperlinks from DOCX
    try {
      const htmlResult = await mammoth.convertToHtml({ path: filePath });
      const urls = new Set();
      const linkRegex = /href="(https?:\/\/[^"]+)"/g;
      let match;
      while ((match = linkRegex.exec(htmlResult.value)) !== null) {
        urls.add(match[1]);
      }
      if (urls.size) {
        text += '\n\n--- Hyperlinks found in document ---\n' + [...urls].join('\n');
      }
    } catch (_) {}

    return text;
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

// ── RESUME FORMAT GEOMETRY (deterministic, from actual PDF text positions) ─
// Measures real indentation from a PDF's text coordinates rather than asking
// an LLM to eyeball it — LLM vision is good at "is this bold" but unreliable
// at "how many points is this indented". Every text item's transform[4] is
// its x-position in PDF points, so bullet indent = bullet-line x minus the
// page's leftmost (margin) x. Only meaningful for PDFs — .docx/.doc templates
// don't expose absolute positions the same way, so this returns null for them.
const BULLET_CHAR_RE = /^[•\-–—▪●‣○*]\s/;

async function extractBulletIndent(filePath, ext) {
  if (ext !== '.pdf') return null;
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const buf = fs.readFileSync(filePath);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();

    // Group items into lines by y-position (rounded — items on the same
    // visual line can differ by fractions of a point).
    const lines = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x, str: item.str });
    }

    let marginX = Infinity;
    let bulletXs = [];
    for (const items of lines.values()) {
      items.sort((a, b) => a.x - b.x);
      const lineText = items.map(i => i.str).join('');
      const lineX = items[0].x;
      if (lineX < marginX) marginX = lineX;
      if (BULLET_CHAR_RE.test(lineText.trimStart())) bulletXs.push(lineX);
    }

    if (!bulletXs.length || marginX === Infinity) return null;
    const avgBulletX = bulletXs.reduce((a, b) => a + b, 0) / bulletXs.length;
    const indentPt = Math.round(avgBulletX - marginX);
    return indentPt > 0 && indentPt < 72 ? indentPt : null; // sanity bound: 0-72pt (1 inch)
  } catch (_) {
    return null; // geometry extraction is best-effort — never blocks the upload
  }
}

// ── INGESTION FUNCTIONS ───────────────────────────────────────────────────

// Text ingestion stays auto-applying — used both for the (empty-profile) onboarding
// bio and for small low-risk quick-actions like "add this keyword as a skill" that
// can't plausibly touch contact fields; gating those behind a confirmation dialog
// would be a real UX regression for something with nothing risky to confirm.
async function ingestText(text, userId = 'me', ctx = {}) {
  const partial = await extractFacts(text, { userId, ...ctx });
  return applyPartial(partial, userId, ctx);
}

async function ingestPdf(filePath, userId = 'me', ctx = {}) {
  const text = await extractTextFromFile(filePath, filePath);
  const partial = await extractFacts(text, { userId, ...ctx });
  const proposal = await computeMergeProposal(partial, userId, ctx);
  if (proposal.skipConfirmation) {
    await saveProfile(proposal.merged, userId, proposal.source);
    return proposal.merged;
  }
  return { ...proposal.merged, _pendingConfirmation: true, _diff: proposal.changesSummary || summarizeIngestionDiff(proposal.current, proposal.merged) };
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
  const extractedSummary = summarizeExtraction(partial);
  const proposal = await computeMergeProposal(partial, userId, ctx);
  let profile;
  if (proposal.skipConfirmation) {
    await saveProfile(proposal.merged, userId, proposal.source);
    profile = proposal.merged;
  } else {
    profile = { ...proposal.merged, _pendingConfirmation: true, _diff: proposal.changesSummary || summarizeIngestionDiff(proposal.current, proposal.merged) };
  }

  return {
    ...profile,
    _ingestion: {
      filesProcessed: texts.length,
      filesSkipped: errors.length,
      errors: errors.length ? errors : undefined,
    },
    _extracted: extractedSummary,
  };
}

function summarizeExtraction(partial) {
  const lines = [];
  for (const exp of (partial.experience || [])) {
    const bullets = (exp.bullets || []).map(b => typeof b === 'string' ? b : b.text || '').filter(Boolean);
    lines.push(`Experience: ${exp.title || '?'} at ${exp.company || '?'} (${exp.dates || 'no dates'}) — ${bullets.length} bullet(s)`);
    for (const b of bullets.slice(0, 3)) lines.push(`  • ${b.slice(0, 100)}`);
    if (bullets.length > 3) lines.push(`  ... +${bullets.length - 3} more`);
  }
  for (const p of (partial.projects || [])) {
    lines.push(`Project: ${p.name || '?'}`);
  }
  for (const e of (partial.education || [])) {
    lines.push(`Education: ${e.degree || '?'} — ${e.school || '?'}`);
  }
  const skills = [
    ...(partial.skills || []).map(s => typeof s === 'object' ? s.name : s),
    ...(partial.technical_skills || []).map(s => typeof s === 'object' ? s.name : s),
    ...(partial.soft_skills || []),
  ].filter(Boolean);
  if (skills.length) lines.push(`Skills extracted: ${skills.join(', ')}`);
  return lines.join('\n');
}

// ── COVERAGE DIFF ─────────────────────────────────────────────────────────

function diffCoverage(extracted, merged) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const bulletText = (b) => norm(typeof b === 'string' ? b : b.text || '');
  const items = [];
  let totalExtracted = 0;

  // Experience bullets
  for (const ext of (extracted.experience || [])) {
    const extBullets = (ext.bullets || []);
    totalExtracted += extBullets.length;
    const mergedExp = (merged.experience || []).find(m => norm(m.company) === norm(ext.company));
    if (!mergedExp) {
      for (const b of extBullets) {
        items.push({ field: 'experience', company: ext.company, value: typeof b === 'string' ? b : b.text, reason: 'entry_not_in_profile' });
      }
      continue;
    }
    const mergedBulletTexts = new Set((mergedExp.bullets || []).map(bulletText));
    for (const b of extBullets) {
      const bt = bulletText(b);
      if (bt.length < 5) continue;
      const found = mergedBulletTexts.has(bt) ||
        [...mergedBulletTexts].some(mb => mb.includes(bt.slice(0, 30)) || bt.includes(mb.slice(0, 30)));
      if (!found) {
        items.push({ field: 'experience', company: ext.company, value: typeof b === 'string' ? b : b.text, reason: 'bullet_dropped_during_merge' });
      }
    }
  }

  // Projects
  for (const p of (extracted.projects || [])) {
    totalExtracted++;
    const found = (merged.projects || []).some(mp => norm(mp.name) === norm(p.name));
    if (!found) {
      items.push({ field: 'projects', value: p.name, reason: 'project_not_in_profile' });
    }
  }

  // Education
  for (const e of (extracted.education || [])) {
    totalExtracted++;
    const found = (merged.education || []).some(me =>
      norm(me.school).includes(norm(e.school).slice(0, 8)) && norm(me.degree).includes(norm(e.degree).slice(0, 8))
    );
    if (!found) {
      items.push({ field: 'education', value: `${e.degree} — ${e.school}`, reason: 'education_not_in_profile' });
    }
  }

  // Skills
  const mergedSkillSet = new Set([
    ...(merged.skills || []).map(s => norm(typeof s === 'object' ? s.name : s)),
    ...(merged.technical_skills || []).map(s => norm(typeof s === 'object' ? s.name : s)),
    ...(merged.soft_skills || []).map(s => norm(s)),
  ]);
  const extractedSkills = [
    ...(extracted.skills || []).map(s => typeof s === 'object' ? s.name : s),
    ...(extracted.technical_skills || []).map(s => typeof s === 'object' ? s.name : s),
    ...(extracted.soft_skills || []),
  ].filter(Boolean);
  totalExtracted += extractedSkills.length;
  for (const s of extractedSkills) {
    if (!mergedSkillSet.has(norm(s))) {
      items.push({ field: 'skills', value: s, reason: 'skill_not_in_profile' });
    }
  }

  // Certifications
  for (const c of (extracted.certifications || [])) {
    totalExtracted++;
    const name = typeof c === 'string' ? c : c.name || '';
    const found = (merged.certifications || []).some(mc => norm(typeof mc === 'string' ? mc : mc.name) === norm(name));
    if (!found) {
      items.push({ field: 'certifications', value: name, reason: 'cert_not_in_profile' });
    }
  }

  return { items, totalExtracted: Math.max(totalExtracted, 1) };
}

// ── MERGE LOGIC ───────────────────────────────────────────────────────────

// Computes what a merge WOULD produce, without saving anything — the split
// exists so file-upload ingestion can show the user a proposal and require
// explicit confirmation before it touches their live profile, the same way
// the chat "Build Profile" flow already works. isEmptyProfile (first-ever
// ingestion, nothing to conflict with) still merges immediately since there's
// no existing data at risk.
async function computeMergeProposal(partial, userId = 'me', ctx = {}) {
  const current = await getProfile(userId);
  const source = ctx.source || 'ingestion';
  const conflicts = [];
  const ambiguities = partial._ambiguities || [];
  delete partial._ambiguities;

  // Durable record of this round's uncategorized facts — independent of the
  // profile JSON, so it survives edits/version pruning and stays available
  // for schema backfill even after custom_facts is consumed elsewhere.
  await recordUncategorizedFacts(userId, partial.custom_facts, source).catch(e =>
    console.error('⚠ Failed to record uncategorized facts:', e.message)
  );

  delete partial.schema_suggestions;

  let merged;
  let changesSummary = null;
  if (isEmptyProfile(current)) {
    merged = mergeProfile(current, partial, conflicts);
  } else {
    try {
      merged = await smartMerge(current, partial, { userId, ...ctx });
      // Pull this out before validateMerge, whose fallback-patch path
      // (mergeProfile(merged, current) then mergeProfile(merged, partial))
      // reconstructs the object field-by-field and isn't guaranteed to carry
      // an LLM-added key it doesn't know about through that reconstruction.
      changesSummary = merged.changes_summary || null;
      delete merged.changes_summary;
      merged = validateMerge(current, partial, merged);
      detectConflicts(current, partial, merged, conflicts);
    } catch (e) {
      console.error('Smart merge failed, falling back to programmatic:', e.message);
      merged = mergeProfile(current, partial, conflicts);
    }
  }

  const drops = diffCoverage(partial, merged);
  const mergeTraceId = merged._mergeTraceId;
  delete merged._mergeTraceId;
  delete merged.changes_summary;

  if (mergeTraceId && drops.items.length > 0) {
    scoreIngestionCoverage(mergeTraceId, drops);
  }

  merged._conflicts = conflicts.length ? conflicts : undefined;
  merged._ambiguities = ambiguities.length ? ambiguities : undefined;
  merged._drops = drops.items.length ? drops : undefined;

  // Deterministic safety net, not a replacement for the LLM's own contact_changes
  // — the LLM's list depends on it noticing every differing field on a given
  // call, and it's already missed one (a location swap went unflagged and applied
  // silently). This catches every ACTUAL field difference in code, unconditionally,
  // and is unioned with whatever the LLM found so nothing slips through either way.
  if (changesSummary && !isEmptyProfile(current)) {
    const llmFlagged = new Set((changesSummary.contact_changes || []).map(c => c.field));
    const actual = [];
    for (const field of ['email', 'phone', 'location', 'address_line1', 'address_line2', 'city', 'county', 'state', 'postal_code', 'country', 'linkedin', 'github', 'portfolio']) {
      const from = current.contact?.[field];
      const to = merged.contact?.[field];
      if (from && to && from.trim() !== to.trim() && !llmFlagged.has(field)) {
        actual.push({ field, from, to });
      }
    }
    if (actual.length) {
      changesSummary.contact_changes = [...(changesSummary.contact_changes || []), ...actual];
    }
  }

  return { current, merged, source, changesSummary, skipConfirmation: isEmptyProfile(current) };
}

async function applyPartial(partial, userId = 'me', ctx = {}) {
  const { merged, source } = await computeMergeProposal(partial, userId, ctx);
  await saveProfile(merged, userId, source);
  return merged;
}

// Human-readable diff between the current live profile and a proposed merge —
// pure comparison, no LLM call, so it's fast and exact (no risk of the summary
// itself hallucinating what changed).
function normForDiff(s) { return (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, ''); }

function summarizeIngestionDiff(current, merged) {
  const summary = { new_roles: [], updated_roles: [], new_education: [], new_activities: [], new_skills: [], new_certifications: [], contact_changes: [] };

  // Same prefix-match tolerance as education below — "Zinnia" vs "Zinnia
  // Insurance" (or any legal-suffix/typo variant) is the same employer.
  const currentRolesList = (current.experience || []).map(e => ({ key: normForDiff(e.company), role: e }));
  for (const role of (merged.experience || [])) {
    const key = normForDiff(role.company);
    const match = currentRolesList.find(c => c.key.includes(key.slice(0, 6)) || key.includes(c.key.slice(0, 6)));
    if (!match) {
      summary.new_roles.push(`${role.title || 'Role'} at ${role.company}`);
    } else if ((role.bullets || []).length > (match.role.bullets || []).length) {
      summary.updated_roles.push({ company: role.company, added_bullets: (role.bullets || []).length - (match.role.bullets || []).length });
    }
  }

  // Prefix match, not exact — a typo or trailing detail in the source resume
  // (e.g. "DIT University, Dehradun" vs "DIT University, Dehradun, UK ,India")
  // is the same school, not a new one. Same tolerance diffCoverage already
  // uses elsewhere for this exact kind of near-duplicate.
  const currentSchoolsList = (current.education || []).map(e => normForDiff(e.school));
  for (const e of (merged.education || [])) {
    const es = normForDiff(e.school);
    const isKnown = currentSchoolsList.some(cs => cs.includes(es.slice(0, 10)) || es.includes(cs.slice(0, 10)));
    if (!isKnown) summary.new_education.push(`${e.degree} — ${e.school}`);
  }

  const currentActivities = new Set((current.activities || []).map(normForDiff));
  for (const a of (merged.activities || [])) {
    if (!currentActivities.has(normForDiff(a))) summary.new_activities.push(a);
  }

  const currentCerts = new Set((current.certifications || []).map(c => normForDiff(typeof c === 'string' ? c : c.name)));
  for (const c of (merged.certifications || [])) {
    const name = typeof c === 'string' ? c : c.name;
    if (!currentCerts.has(normForDiff(name))) summary.new_certifications.push(name);
  }

  const currentSkillSet = new Set([
    ...(current.skills || []).map(s => normForDiff(typeof s === 'object' ? s.name : s)),
    ...(current.technical_skills || []).map(s => normForDiff(typeof s === 'object' ? s.name : s)),
    ...(current.soft_skills || []).map(normForDiff),
  ]);
  const mergedSkills = [
    ...(merged.skills || []).map(s => typeof s === 'object' ? s.name : s),
    ...(merged.technical_skills || []).map(s => typeof s === 'object' ? s.name : s),
    ...(merged.soft_skills || []),
  ].filter(Boolean);
  for (const s of mergedSkills) {
    if (!currentSkillSet.has(normForDiff(s))) summary.new_skills.push(s);
  }

  // Contact fields are the highest-risk category — a blind "prefer new" merge
  // can silently revert an intentionally-updated email/phone to a stale value
  // from an older resume. Always surfaced explicitly, never auto-applied.
  const cc = current.contact || {};
  const mc = merged.contact || {};
  for (const field of ['email', 'phone', 'location', 'address_line1', 'address_line2', 'city', 'county', 'state', 'postal_code', 'country']) {
    if (cc[field] && mc[field] && normForDiff(cc[field]) !== normForDiff(mc[field])) {
      summary.contact_changes.push({ field, from: cc[field], to: mc[field] });
    }
  }

  return summary;
}

function detectConflicts(current, partial, merged, conflicts) {
  // Experience: same company appearing with different titles
  const expByCompany = new Map();
  for (const e of (merged.experience || [])) {
    const c = normCompany(e.company);
    if (!c) continue;
    if (!expByCompany.has(c)) expByCompany.set(c, []);
    expByCompany.get(c).push(e);
  }
  for (const [, entries] of expByCompany) {
    if (entries.length < 2) continue;
    // Check if any pair has overlapping dates (= likely same role, not progression)
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (datesOverlap(entries[i].dates, entries[j].dates)) {
          conflicts.push({
            type: 'experience',
            existing: entries[i],
            incoming: entries[j],
            reason: `Same company "${entries[i].company}" with overlapping dates — possibly the same role with different titles`,
          });
        }
      }
    }
  }

  // Education: same school with different name formats
  const eduBySchool = new Map();
  for (const e of (merged.education || [])) {
    const s = normSchool(e.school);
    if (!s) continue;
    if (!eduBySchool.has(s)) eduBySchool.set(s, []);
    eduBySchool.get(s).push(e);
  }
  for (const [, entries] of eduBySchool) {
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (normDegree(entries[i].degree) === normDegree(entries[j].degree)) {
          conflicts.push({
            type: 'education',
            existing: entries[i],
            incoming: entries[j],
            reason: `Same school "${entries[i].school.split(',')[0]}" and degree — likely duplicate with different name format`,
          });
        }
      }
    }
  }
}

function datesOverlap(d1, d2) {
  if (!d1 || !d2) return false;
  const parseYear = (s) => {
    const m = String(s).match(/(\d{4})/g);
    return m ? m.map(Number) : [];
  };
  const y1 = parseYear(d1), y2 = parseYear(d2);
  if (!y1.length || !y2.length) return false;
  const start1 = Math.min(...y1), end1 = d1.toLowerCase().includes('present') ? 9999 : Math.max(...y1);
  const start2 = Math.min(...y2), end2 = d2.toLowerCase().includes('present') ? 9999 : Math.max(...y2);
  return start1 <= end2 && start2 <= end1;
}

function validateMerge(current, partial, merged) {
  const issues = [];
  const check = (section, keyFn) => {
    const curItems = current[section] || [];
    const mergedItems = merged[section] || [];
    if (!curItems.length) return;
    const mergedKeys = new Set(mergedItems.map(keyFn));
    const missing = curItems.filter(item => !mergedKeys.has(keyFn(item)));
    if (missing.length) issues.push({ section, missing: missing.length, total: curItems.length });
  };

  check('experience', e => `${(e.company||'').toLowerCase()}|${(e.title||'').toLowerCase()}`);
  check('projects', p => (p.name||'').toLowerCase());
  check('education', e => (e.school||'').toLowerCase());
  check('certifications', c => (typeof c === 'string' ? c : c.name || '').toLowerCase());
  check('languages', l => (typeof l === 'string' ? l : l.name || '').toLowerCase());

  if ((current.skills?.length || 0) > 0 && (merged.skills?.length || 0) < (current.skills.length * 0.5)) {
    issues.push({ section: 'skills', missing: current.skills.length - (merged.skills?.length || 0), total: current.skills.length });
  }

  // Bullet-level check: smartMerge must not drop bullets from current OR partial
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
  for (const source of [current, partial]) {
    for (const exp of (source.experience || [])) {
      const mergedExp = (merged.experience || []).find(m =>
        (m.company || '').toLowerCase() === (exp.company || '').toLowerCase() &&
        (m.title || '').toLowerCase() === (exp.title || '').toLowerCase()
      );
      if (!mergedExp) continue;
      const mergedBullets = new Set((mergedExp.bullets || []).map(b => norm(typeof b === 'string' ? b : b.text)));
      const sourceBullets = (exp.bullets || []).map(b => typeof b === 'string' ? b : b.text).filter(Boolean);
      const missing = sourceBullets.filter(b => !mergedBullets.has(norm(b)) && ![...mergedBullets].some(mb => mb.includes(norm(b).slice(0, 20))));
      if (missing.length > 0) {
        issues.push({ section: 'experience_bullets', company: exp.company, missing: missing.length, total: sourceBullets.length });
      }
    }
  }

  if (issues.length) {
    console.warn('Smart merge dropped data, patching with programmatic merge:', JSON.stringify(issues));
    merged = mergeProfile(merged, current);
    merged = mergeProfile(merged, partial);
  }

  return merged;
}

function mergeProfile(base, incoming, conflicts = null) {
  const out = JSON.parse(JSON.stringify(base));
  if (!incoming || typeof incoming !== 'object') return out;

  if (incoming.contact) {
    out.contact = { ...out.contact, ...incoming.contact };
    if (Array.isArray(out.contact.links)) {
      for (const link of out.contact.links) {
        const l = (link || '').toLowerCase();
        if (l.includes('linkedin.com') && !out.contact.linkedin) out.contact.linkedin = link;
        else if (l.includes('github.com') && !out.contact.github) out.contact.github = link;
        else if (!out.contact.portfolio && (l.includes('portfolio') || l.match(/^https?:\/\/[^/]+\.(com|io|dev|me)$/))) out.contact.portfolio = link;
      }
    }
  }
  if (incoming.summary) out.summary = incoming.summary;

  out.skills = unionCI(out.skills, incoming.skills);
  out.technical_skills = upsertTechnicalSkills(out.technical_skills || [], incoming.technical_skills);
  out.soft_skills = unionCI(out.soft_skills || [], incoming.soft_skills);

  // Cross-array skill dedup: remove from skills/soft_skills if already in technical_skills
  const techSet = new Set((out.technical_skills || []).map(s => (s.name || '').toLowerCase()));
  out.skills = (out.skills || []).filter(s => !techSet.has(s.toLowerCase()));
  out.soft_skills = (out.soft_skills || []).filter(s => !techSet.has(s.toLowerCase()));
  // Remove from skills if already in soft_skills
  const softSet = new Set((out.soft_skills || []).map(s => s.toLowerCase()));
  out.skills = out.skills.filter(s => !softSet.has(s.toLowerCase()));

  out.experience = upsertExperience(out.experience, incoming.experience, conflicts);
  out.projects = upsertProjects(out.projects, incoming.projects);
  out.education = upsertById(out.education, incoming.education, keyEdu, fuzzyMatchEducation, conflicts);
  out.certifications = upsertById(out.certifications || [], incoming.certifications, keyCert);
  out.languages = upsertById(out.languages || [], incoming.languages, keyLang);
  out.activities = unionCI(out.activities || [], incoming.activities);
  out.interests = unionCI(out.interests || [], incoming.interests);

  if (incoming.career && typeof incoming.career === 'object') {
    out.career = { ...(out.career || {}), ...incoming.career };
    if (Array.isArray(incoming.career.preferred_locations)) {
      out.career.preferred_locations = [...new Set([...(out.career.preferred_locations || []), ...incoming.career.preferred_locations])];
    }
    if (Array.isArray(incoming.career.work_permit)) {
      out.career.work_permit = [...new Set([...(out.career.work_permit || []), ...incoming.career.work_permit])];
    }
  }

  if (Array.isArray(incoming.custom_facts)) {
    const now = new Date().toISOString();
    for (const f of incoming.custom_facts) {
      const text = typeof f === 'string' ? f : (f && f.text);
      if (text && !out.custom_facts.some((x) => (x.text || x) === text)) {
        out.custom_facts.push({ text, added_at: now });
      }
    }
  }

  out.custom_sections = mergeCustomSections(out.custom_sections || [], incoming.custom_sections);

  if (!out.contact?.location && out.experience?.length) {
    const loc = out.experience.find(e => e.location)?.location;
    if (loc) out.contact = { ...out.contact, location: loc };
  }

  return out;
}

function upsertTechnicalSkills(existing = [], incoming = []) {
  if (!Array.isArray(incoming)) return existing;
  const out = [...(existing || [])];
  const index = new Map(out.map((s, i) => [(s.name || '').toLowerCase(), i]));
  for (const skill of incoming) {
    if (!skill || !skill.name) continue;
    const k = skill.name.toLowerCase();
    if (index.has(k)) {
      const prev = out[index.get(k)];
      out[index.get(k)] = {
        ...prev,
        experience: skill.experience || prev.experience,
        last_used: skill.last_used || prev.last_used,
      };
    } else {
      out.push(skill);
      index.set(k, out.length - 1);
    }
  }
  return out;
}

// Never key on the LLM-generated "id" slug — it's not stable across separate
// smartMerge calls (e.g. "zinnia" one time, "zinnia-product-manager" the
// next), so preferring it caused every re-upload to treat existing roles/
// projects as brand new and duplicate them wholesale. Company+title / name
// is the actual stable identity.
const keyExp = (e) => `${(e.company || '').toLowerCase().trim()}|${(e.title || '').toLowerCase().trim()}`;
const keyProj = (p) => (p.name || '').toLowerCase().trim();
const keyEdu = (e) => `${(e.school || '').toLowerCase()}|${(e.degree || '').toLowerCase()}`;
const keyCert = (c) => (typeof c === 'string' ? c : (c.name || '')).toLowerCase();
const keyLang = (l) => (typeof l === 'string' ? l : (l.name || '')).toLowerCase();

// Fuzzy matching: normalize to just the core name
const normCompany = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normSchool = (s) => (s || '').toLowerCase().replace(/,.*$/, '').replace(/[^a-z0-9 ]/g, '').trim();
const normDegree = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

function fuzzyMatchExperience(a, b) {
  return normCompany(a.company) === normCompany(b.company) && normCompany(a.company).length > 0;
}

function degreeLevel(degree) {
  const s = (degree || '').toLowerCase();
  if (/\b(master|m\.?tech|m\.?sc|m\.?a\b|m\.?b\.?a|mba)\b/.test(s)) return 'master';
  if (/\bphd|doctorate\b/.test(s)) return 'phd';
  if (/\b(bachelor|b\.?tech|b\.?sc|b\.?a\b|b\.?e\b)\b/.test(s)) return 'bachelor';
  return null;
}

function fuzzyMatchEducation(a, b) {
  const sa = normSchool(a.school), sb = normSchool(b.school);
  if (!(sa.length > 0 && sb.length > 0 && (sa === sb || sa.startsWith(sb) || sb.startsWith(sa)))) return false;
  // Same school is the strong signal — someone rarely has two degrees at the
  // SAME level from the same school, so only block the match when both sides
  // clearly name a DIFFERENT level (bachelor's vs master's). Same-level entries
  // worded differently ("B.Tech" vs "Bachelors of Technology") are the same
  // degree and were wrongly treated as distinct under a strict text-equality check.
  const la = degreeLevel(a.degree), lb = degreeLevel(b.degree);
  if (la && lb && la !== lb) return false;
  return true;
}

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
  const seen = new Set(result.map(b => bulletDedupKey(b.text)));
  for (const b of (incoming || []).map(normalizeBullet)) {
    const key = bulletDedupKey(b.text);
    if (!seen.has(key)) {
      result.push(b);
      seen.add(key);
    } else if (b.metric || b.impact) {
      const idx = result.findIndex(r => bulletDedupKey(r.text) === key);
      if (idx !== -1) {
        if (b.metric && !result[idx].metric) result[idx].metric = b.metric;
        if (b.impact && !result[idx].impact) result[idx].impact = b.impact;
      }
    }
  }
  return result;
}

function upsertExperience(existing = [], incoming = [], conflicts = null) {
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
      // Fuzzy match: same company, different title
      const fuzzyIdx = out.findIndex(e => fuzzyMatchExperience(e, item) && keyExp(e) !== k);
      if (fuzzyIdx !== -1 && conflicts) {
        conflicts.push({
          type: 'experience',
          existing: out[fuzzyIdx],
          incoming: item,
          reason: `Same company "${item.company}" but different title`,
        });
      }
      out.push({ ...item, bullets: (item.bullets || []).map(normalizeBullet) });
      index.set(k, out.length - 1);
    }
  }
  return out;
}

// Strips a leading label like "What it does: " / "How it's built: " / "Automation: "
// before computing the dedup key — otherwise "Converts unstructured..." and
// "What it does: Converts unstructured..." are treated as different bullets
// even though they're 95% identical, since the prefix shifts the first-40-char
// comparison window entirely.
function bulletDedupKey(text) {
  const stripped = (text || '').replace(/^[A-Z][A-Za-z0-9 &-]{2,40}[:—-]\s*/, '');
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
}

function mergeBulletArrays(a = [], b = []) {
  const out = [...(a || []).map(normalizeBullet)];
  const texts = new Set(out.map(x => bulletDedupKey(x.text)));
  for (const raw of (b || [])) {
    const bullet = normalizeBullet(raw);
    const key = bulletDedupKey(bullet.text);
    if (!texts.has(key)) {
      out.push(bullet);
      texts.add(key);
    }
  }
  return out;
}

function mergeCustomSections(existing = [], incoming = []) {
  if (!Array.isArray(incoming) || !incoming.length) return existing;
  const out = [...existing];
  const index = new Map(out.map((s, i) => [(s.category || '').toLowerCase(), i]));
  for (const section of incoming) {
    if (!section || !section.category) continue;
    const k = section.category.toLowerCase();
    if (index.has(k)) {
      const prev = out[index.get(k)];
      out[index.get(k)] = { ...prev, items: mergeBulletArrays(prev.items, section.items) };
    } else {
      out.push({ category: section.category, items: (section.items || []).map(normalizeBullet) });
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
    // "Arjun Resume AI" vs "Arjun Resume AI — AI Career Platform" are the same
    // project with a longer/shorter name — exact match alone missed this and
    // duplicated it. A shared name prefix is a near-certain same-project signal
    // (unlike experience, where same-company-different-title can be a real
    // second job) — no separate conflict path needed, just merge directly.
    let idx = index.has(k) ? index.get(k) : out.findIndex(e => {
      const ek = keyProj(e);
      return ek.length > 5 && k.length > 5 && (ek.startsWith(k.slice(0, 10)) || k.startsWith(ek.slice(0, 10)));
    });
    if (idx !== -1) {
      const prev = out[idx];
      const mergedTechStack = [...new Set([...(prev.tech_stack || []), ...(item.tech_stack || [])])];
      const mergedBullets = mergeBulletArrays(prev.bullets, item.bullets);
      out[idx] = {
        ...prev,
        ...item,
        name: item.name.length > (prev.name || '').length ? item.name : prev.name,
        outcome: item.outcome || prev.outcome,
        description: (item.description && item.description.length > (prev.description || '').length) ? item.description : prev.description,
        tech_stack: mergedTechStack.length ? mergedTechStack : (prev.tech_stack || item.tech_stack || []),
        bullets: mergedBullets.length ? mergedBullets : (prev.bullets || item.bullets || []),
      };
      index.set(keyProj(out[idx]), idx);
    } else {
      out.push(item);
      index.set(k, out.length - 1);
    }
  }
  return out;
}

function upsertById(existing = [], incoming = [], keyOf, fuzzyFn = null, conflicts = null) {
  const out = [...(existing || [])];
  const index = new Map(out.map((item, i) => [keyOf(item), i]));
  for (const item of incoming || []) {
    const k = keyOf(item);
    if (index.has(k)) {
      out[index.get(k)] = { ...out[index.get(k)], ...item };
      continue;
    }
    // Fuzzy match actually merges, not just flags-and-still-duplicates — a
    // logged "conflict" nobody resolves before the item gets pushed anyway
    // isn't a safeguard, it's a silent duplicate with a warning attached.
    const fuzzyIdx = fuzzyFn ? out.findIndex(e => fuzzyFn(e, item) && keyOf(e) !== k) : -1;
    if (fuzzyIdx !== -1) {
      const prev = out[fuzzyIdx];
      out[fuzzyIdx] = {
        ...prev,
        ...item,
        school: (item.school || '').length > (prev.school || '').length ? item.school : prev.school,
        degree: (item.degree || '').length > (prev.degree || '').length ? item.degree : prev.degree,
      };
      index.set(keyOf(out[fuzzyIdx]), fuzzyIdx);
    } else {
      out.push(item);
      index.set(k, out.length - 1);
    }
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

function resolveConflicts(profile, resolutions) {
  const out = JSON.parse(JSON.stringify(profile));

  for (const res of resolutions) {
    if (res.type === 'experience') {
      // res.keep = 'existing' | 'incoming' | 'both'
      if (res.keep === 'both') continue;
      const remove = res.keep === 'existing' ? res.incoming : res.existing;
      const keep = res.keep === 'existing' ? res.existing : res.incoming;
      out.experience = out.experience.filter(e => {
        const match = (e.company || '').toLowerCase() === (remove.company || '').toLowerCase()
          && (e.title || '').toLowerCase() === (remove.title || '').toLowerCase();
        return !match;
      });
      // Merge bullets from removed into kept entry
      const keptIdx = out.experience.findIndex(e =>
        (e.company || '').toLowerCase() === (keep.company || '').toLowerCase()
        && (e.title || '').toLowerCase() === (keep.title || '').toLowerCase()
      );
      if (keptIdx !== -1 && remove.bullets?.length) {
        out.experience[keptIdx].bullets = mergeBullets(out.experience[keptIdx].bullets, remove.bullets);
      }
    }

    if (res.type === 'education') {
      if (res.keep === 'both') continue;
      const remove = res.keep === 'existing' ? res.incoming : res.existing;
      out.education = out.education.filter(e => {
        const match = (e.school || '').toLowerCase() === (remove.school || '').toLowerCase()
          && (e.degree || '').toLowerCase() === (remove.degree || '').toLowerCase();
        return !match;
      });
    }
  }

  return out;
}

// ── SCHEMA BACKFILL ───────────────────────────────────────────────────────
// Called after an admin approves a new custom category: re-scan the durable
// uncategorized_facts store (not the mutable profile JSON — that can be
// edited or pruned) and promote matches into the newly structured section
// on each user's live profile.
async function backfillApprovedCategory(category) {
  const groups = await getUnmatchedFactsByUser();
  let profilesUpdated = 0;
  let factsReclassified = 0;

  for (const { userId, ids, texts } of groups) {
    if (!texts.length) continue;

    try {
      const matches = await classifyCustomFacts(texts, category, { userId });
      if (!matches.length) continue;

      const matchedIds = matches.map(m => ids[m.index]);
      const matchedTexts = new Set(matches.map(m => texts[m.index]));
      const newItems = matches.map(m => normalizeBullet(m.item));

      await markFactsMatched(matchedIds, category.category);

      const profile = await getProfile(userId);
      const updated = JSON.parse(JSON.stringify(profile));
      updated.custom_sections = mergeCustomSections(updated.custom_sections || [], [{ category: category.category, items: newItems }]);
      updated.custom_facts = (updated.custom_facts || []).filter(f => {
        const text = typeof f === 'string' ? f : (f && f.text);
        return !matchedTexts.has(text);
      });

      await saveProfile(updated, userId, 'schema_backfill');
      profilesUpdated++;
      factsReclassified += matches.length;
    } catch (e) {
      console.error(`⚠ Backfill failed for user ${userId} (category ${category.category}):`, e.message);
    }
  }

  return { profilesScanned: groups.length, profilesUpdated, factsReclassified };
}

module.exports = { ingestText, ingestPdf, ingestFiles, extractTextFromFile, extractBulletIndent, mergeProfile, applyDeletions, resolveConflicts, backfillApprovedCategory, ALLOWED_EXTENSIONS };
