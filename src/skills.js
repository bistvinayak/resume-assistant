'use strict';

// Per-user skills: markdown playbooks generated from each user's profile (career profile,
// cover-letter story, writing voice), modeled on the owner's own Claude skills. They steer
// resume tailoring and cover letters (see skillsBlock in llm.js), refresh in the background
// when the profile changes, and export as Claude-compatible SKILL.md folders.
//
// Generated text is personal; the methodology below is shared by everyone and appended in
// code so it never drifts between users or regenerations.

const { getProfile, getProfileVersion, profileEvents, getUserSkills, setUserSkillStatus, saveUserSkill, saveUserSkillNotes, getResumeFormat } = require('./db');
const { generateSkill } = require('./llm');

const SHARED = {
  career_profile: `## Relevance Scoring Engine (applies to every resume)

Nothing on a resume is fixed. Every bullet and project in the bank above is scored against the target role, and the resume is filled from the top of the ranked list until the page is full.

**Step 1: Set the requirement list.** With a job posting, extract its top 5 requirements in the posting's own words. Without one, use the matching list under "Default requirement lists".

**Step 2: Score each item out of 10.**

| Component | Points | How to score |
|---|---|---|
| Requirement match | 0-5 | 1 point per requirement the item genuinely evidences (verbatim or true semantic match, never stretched) |
| Impact | 0-3 | 3 = quantified business or user outcome ($, %, users). 2 = quantified scale or technical result. 1 = qualitative only |
| Recency | 0-2 | Current or most recent role 2, previous role 1, older 0 |

**Step 3: Select.** Take items scoring 6+ first, highest score first within each role. Items scoring 5 fill remaining space. Every role keeps at least its two best items so no role disappears.

## ATS keyword matching

1. Extract the posting's skills, tools and competency phrases verbatim.
2. Check which already appear verbatim in the draft.
3. For each missing keyword, look it up in the Keyword evidence map. **Equivalent** phrasings may be swapped to the posting's exact wording. **Related** phrasings are never swapped automatically; flag them as a judgment call.
4. Never add a keyword that no bullet or project evidences. Anything under Known gaps stays off the resume.
5. Metrics are sacred: never drop, round or inflate a number from Verified metrics.`,

  cover_letter: `## How to write the letter (applies to every cover letter)

**Analyze first.** Identify the 2-4 requirements the employer cares most about and the company's own language. Pick the 2-3 strongest evidence stories above that match them. Use personal story material only when its "Fits when" matches this company or role.

**Structure** (250-400 words, 3-5 paragraphs, one page):
1. **Opening**: name the role and give a genuine, specific reason for interest. Never open with "I am writing to apply for" or "I am excited to apply for". Lead with a connection to the company's work, a relevant result or the candidate's motivation.
2. **Body (1-2 paragraphs)**: match the strongest evidence to the employer's top needs. Every claim carries a specific example or result. Tell the story behind the resume's best lines instead of restating them.
3. **Why this company**: one or two sentences showing real knowledge of the company. Skip it if nothing genuine is available.
4. **Close**: confident, brief, forward-looking. No passive phrasing such as "I hope you will consider me".

**Style.** First person, active verbs, prose only (no bullets). Vary sentence length. Address a named person if known, otherwise "Dear Hiring Manager". Banned: "team player", "detail-oriented", "self-starter", "passionate about" without evidence, "dynamic", "proven track record", "I believe I would be a great fit". Never invent experience, skills, metrics or credentials.`,

  writing_voice: `## Rules for sounding human (applies to all writing)

- No em dashes. Split the sentence, or use a comma, colon or parentheses instead.
- No reflexive groups of three adjectives.
- No filler openers such as "Additionally", "Furthermore" or "Moreover", and no hedges such as "It's important to note that".
- No "It's not just X, it's Y" constructions.
- Vary sentence length, and stop when the point is made. No summary restatements.`,
};

const SKILLS = {
  career_profile: {
    title: 'Career profile',
    folder: 'arjun-career-profile',
    description: (name) => `${name}'s verified career facts, bullet bank, metrics and keyword evidence, with the relevance scoring and ATS matching rules. Use whenever writing, tailoring or reviewing ${name}'s resume or job application materials.`,
  },
  cover_letter: {
    title: 'Cover letter story',
    folder: 'arjun-cover-letter',
    description: (name) => `${name}'s personal story material, strongest achievement stories and cover-letter writing rules. Use whenever writing or reviewing a cover letter or application essay for ${name}.`,
  },
  writing_voice: {
    title: 'Writing voice',
    folder: 'arjun-writing-voice',
    description: (name) => `How ${name} writes, with preferred phrasing and rules for avoiding AI-sounding text. Use for any resume, cover letter, email or post written in ${name}'s voice.`,
  },
};
const SKILL_NAMES = Object.keys(SKILLS);

// Only what the playbooks need. No contact details or self-identification reach the model.
function profileForSkill(p) {
  const { contact = {}, self_identification, delivery_email, auto_process_paused, _onboarded, ...rest } = p;
  return { name: contact.name || '', location: contact.location || '', ...rest };
}

function composeSkill(skill, row) {
  if (!row?.content) return null;
  let text = `${row.content.trim()}\n\n${SHARED[skill]}`;
  if (row.user_notes?.trim()) {
    text += `\n\n## Candidate corrections (take priority over everything above)\n\n${row.user_notes.trim()}`;
  }
  return text;
}

// ── Generation + background refresh ─────────────────────────────────────
const inFlight = new Map();   // userId -> Promise
const rerun = new Set();      // userIds whose profile changed mid-generation
const timers = new Map();     // userId -> debounce timer

async function generateUserSkills(userId, { only = SKILL_NAMES } = {}) {
  const profile = await getProfile(userId);
  if (!profile._onboarded) return;
  const version = await getProfileVersion(userId);
  const existing = await getUserSkills(userId);
  const input = profileForSkill(profile);

  await Promise.all(only.map(async (skill) => {
    await setUserSkillStatus(userId, skill, 'generating');
    try {
      const { content, model } = await generateSkill(skill, input, existing[skill]?.user_notes, { userId });
      await saveUserSkill(userId, skill, { content, profileVersion: version, model });
    } catch (e) {
      // Previous content (if any) stays usable; the UI shows the failure and a retry button.
      await setUserSkillStatus(userId, skill, 'failed', e.message.slice(0, 900));
    }
  }));
}

function runRefresh(userId, opts) {
  if (inFlight.has(userId)) { rerun.add(userId); return inFlight.get(userId); }
  const p = generateUserSkills(userId, opts)
    .catch(e => console.error(`skills refresh failed for ${userId}:`, e.message))
    .finally(() => {
      inFlight.delete(userId);
      if (rerun.delete(userId)) scheduleRefresh(userId);
    });
  inFlight.set(userId, p);
  return p;
}

// Debounced: a burst of profile edits (chat confirms, multi-file ingest) triggers one run.
function scheduleRefresh(userId, delayMs = 45_000) {
  clearTimeout(timers.get(userId));
  timers.set(userId, setTimeout(() => { timers.delete(userId); runRefresh(userId); }, delayMs));
}

profileEvents.on('saved', (userId) => scheduleRefresh(userId));

// ── Reads ───────────────────────────────────────────────────────────────
async function isStale(userId, rows) {
  const version = await getProfileVersion(userId);
  return SKILL_NAMES.some(k => !rows[k]?.content || (rows[k].profile_version || 0) < version);
}

// Composed skill texts for the writing pipeline. Uses what exists now (even if slightly out
// of date) and kicks off a refresh in the background when stale, so a job never waits on it.
async function getSkillsForWriting(userId) {
  const rows = await getUserSkills(userId).catch(() => ({}));
  if (await isStale(userId, rows).catch(() => false)) {
    if (!inFlight.has(userId) && !timers.has(userId)) scheduleRefresh(userId, 0);
  }
  const out = {};
  for (const k of SKILL_NAMES) out[k] = composeSkill(k, rows[k]);
  return Object.values(out).some(Boolean) ? out : null;
}

async function getSkillsView(userId) {
  const rows = await getUserSkills(userId);
  const version = await getProfileVersion(userId);
  const generating = inFlight.has(userId);
  return {
    generating,
    skills: SKILL_NAMES.map(k => {
      const r = rows[k] || {};
      return {
        id: k,
        title: SKILLS[k].title,
        status: generating && r.status !== 'ready' ? 'generating' : (r.status || 'pending'),
        content: r.content || null,
        shared_rules: SHARED[k],
        user_notes: r.user_notes || '',
        model: r.model || null,
        error: r.status === 'failed' ? r.error : null,
        updated_at: r.updated_at || null,
        stale: !!r.content && (r.profile_version || 0) < version,
      };
    }),
  };
}

async function updateSkillNotes(userId, skill, notes) {
  if (!SKILLS[skill]) throw Object.assign(new Error('unknown_skill'), { status: 400 });
  await saveUserSkillNotes(userId, skill, String(notes || '').slice(0, 4000));
  // Corrections should show up in the generated text too, not only in the appended section.
  runRefresh(userId, { only: [skill] });
}

// ── Claude export ───────────────────────────────────────────────────────
function resumeFormatSkill(name, rf) {
  const sp = rf.style_profile || {};
  const lines = [
    `# Resume Format: ${name}`,
    '',
    `Layout preferences taken from ${name}'s own resume template${rf.source_filename ? ` (${rf.source_filename})` : ''}. Apply them whenever producing a resume for ${name}.`,
    '',
  ];
  if (rf.target_pages) lines.push(`- **Length:** ${rf.target_pages} page${rf.target_pages > 1 ? 's' : ''}`);
  if (sp.section_order?.length) lines.push(`- **Section order:** ${sp.section_order.join(', ')}`);
  if (sp.heading_case) lines.push(`- **Headings:** ${sp.heading_case}`);
  if (sp.role_header_style) lines.push(`- **Role header layout:** ${sp.role_header_style}`);
  if (sp.company_case) lines.push(`- **Company names:** ${sp.company_case}`);
  if (sp.density) lines.push(`- **Bullet density:** ${sp.density}`);
  if (sp.notes) lines.push('', sp.notes);
  if (sp.bold_label_bullets && sp.example_bullets?.length) {
    lines.push('', 'Bullets start with a bold functional label. Examples:', ...sp.example_bullets.map(b => `- ${b}`));
  }
  return lines.join('\n');
}

function skillFile(folder, description, body) {
  const desc = description.replace(/\s+/g, ' ').replace(/"/g, "'");
  return { path: `${folder}/SKILL.md`, data: `---\nname: ${folder}\ndescription: "${desc}"\n---\n\n${body.trim()}\n` };
}

async function buildSkillsExport(userId) {
  const profile = await getProfile(userId);
  const name = profile.contact?.name || 'the candidate';
  const rows = await getUserSkills(userId);
  const files = [];
  for (const k of SKILL_NAMES) {
    const text = composeSkill(k, rows[k]);
    if (text) files.push(skillFile(SKILLS[k].folder, SKILLS[k].description(name), text));
  }
  const rf = await getResumeFormat(userId).catch(() => null);
  if (rf?.style_profile) {
    files.push(skillFile('arjun-resume-format', `${name}'s preferred resume layout and length. Use whenever producing or formatting a resume for ${name}.`, resumeFormatSkill(name, rf)));
  }
  if (!files.length) return null;
  files.push({
    path: 'README.md',
    data: `# ${name}'s Arjun skills\n\nGenerated by Arjun from your profile on ${new Date().toISOString().slice(0, 10)}.\n\nEach folder is one Claude skill. In Claude, open Settings > Capabilities > Skills and upload each folder as a .zip, or copy the folders into ~/.claude/skills/ for Claude Code.\n`,
  });
  return zip(files);
}

// Minimal ZIP writer (stored, no compression). Skill files are a few KB of text, so a
// dependency isn't worth it.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8');
    const data = Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

module.exports = { getSkillsForWriting, getSkillsView, updateSkillNotes, runRefresh, buildSkillsExport, SKILL_NAMES, profileForSkill, composeSkill, zip };
