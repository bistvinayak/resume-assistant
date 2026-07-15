'use strict';

require('dotenv').config();
const OpenAI = require('openai');
const { Langfuse } = require('langfuse');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});
const MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com',
});

const PROFILE_SCHEMA = `
Return ONLY JSON matching this shape (omit fields you found nothing for):
{
  "contact": { "name": "", "email": "", "phone": "", "location": "", "links": [] },
  "summary": "",
  "skills": [],
  "experience": [
    {
      "id": "slug",
      "company": "",
      "company_description": "One-line: what the company does and its scale/industry",
      "title": "",
      "location": "",
      "dates": "",
      "bullets": [
        {
          "text": "Full achievement statement with action, result, and context",
          "metric": "The NUMBER — any percentage, dollar amount, count, duration, scale (e.g. '30% reduction', '$0.5M', '4 brands', '200 hours/week'). null ONLY if no number exists.",
          "impact": "The MEANING — what changed for the business, team, or user (e.g. 'Faster development cycles', 'Revenue growth', 'Centralized supply chain visibility'). Capture qualitative outcomes even when there is no metric."
        }
      ]
    }
  ],
  "projects": [
    {
      "id": "slug",
      "name": "",
      "description": "",
      "tags": [],
      "outcome": "Measurable result or impact of this project"
    }
  ],
  "education": [ { "school": "", "degree": "", "dates": "", "gpa": "", "honors": "" } ],
  "certifications": [ { "name": "", "issuer": "", "date": "" } ],
  "languages": [ { "name": "", "proficiency": "" } ],
  "activities": [],
  "interests": [],
  "custom_facts": []
}`;

// ── PROMPT DEFINITIONS ──────────────────────────────────────────────────

const PROMPT_DEFS = {
  extract_facts: {
    prompt: `You extract career facts from text into a structured profile. Your goal is to capture EVERYTHING — especially metrics, impacts, and quantifiable achievements. This extraction powers the user's master profile, so completeness is critical.

BULLET EXTRACTION (MOST IMPORTANT):
Every experience bullet has three fields: text, metric, impact.
- TEXT: The full achievement statement. Preserve the original wording.
- METRIC: The NUMBER — any percentage, dollar amount, count, duration, scale. Extract EXACT numbers. Set to null ONLY if truly no number exists. NEVER fabricate numbers.
- IMPACT: The MEANING — what changed for the business, team, or user. Capture qualitative outcomes even when there is no metric. A bullet that describes real work should almost always have an impact.

CRITICAL: metric and impact are COMPLEMENTARY, not exclusive. A single bullet often has BOTH.
- "drove a 30% reduction in development time" → metric: "30% reduction", impact: "Faster development cycles"
- "reducing data to insights turnaround time for stakeholders by 50%" → metric: "50% TAT reduction", impact: "Faster data-driven decision making"
- "bring down Cost Per Shipment by 12%" → metric: "12% cost reduction", impact: "Lower logistics costs"
- "reduced manual operations by 50%, increased upselling revenue by $0.5M through sales to 10+ clients" → metric: "50% manual ops reduction, $0.5M revenue, 10+ clients", impact: "Operational efficiency and revenue growth"

When a bullet has NO numbers but describes real work:
- "Monitor Last Mile and First Mile Operations and identify improvement opportunities" → metric: null, impact: "Operational monitoring and continuous improvement"
- "Drove existing/prospective carrier communications & negotiations" → metric: null, impact: "Vendor relationship management and cost optimization"
- "Promoted a culture of Smart Risk Management in process/feature implementations" → metric: null, impact: "Risk-aware decision making culture"

NEVER have metric=null AND impact=null for a bullet that describes actual work. If there is no number, at minimum describe the qualitative impact.

CATEGORY-PREFIXED BULLETS:
Resumes often use bold category labels like "Metric Analytics - ..." or "Bridged the Gap: ...". Include the full text (prefix + description) in the bullet text field. The prefix provides context.

NESTED PROJECTS UNDER EXPERIENCE:
Some resumes list "Key Projects" under a job role. Extract these as bullets under that experience entry, NOT as separate top-level projects. They are achievements within that role.
Example: "Content Management Tool: Developed tool reducing manual operations by 50%, increasing revenue by $0.5M" → this is a bullet under the experience entry, not a standalone project.

Only extract as top-level projects: personal projects, startup projects, academic/side projects NOT tied to an employer.

COMPANY CONTEXT:
- For each company, add company_description from taglines in the resume or general knowledge.
- Resume may say "Tata Group has set up Tata Digital to build digital businesses" or "Shiprocket is a 3PL fulfillment solutions provider" — capture these verbatim or close to it.
- If no tagline is given, infer from context: industry, scale, product type.

SKILL EXTRACTION RULES:
- Extract explicitly listed skills AND infer from bullets/context.
- Skills in grouped sections (e.g., "Languages: SQL, Python | Tools: Tableau, Figma") — flatten into skills array.
- Infer from bullets: "Built dashboards in Tableau" → add "Tableau"; "Led cross-functional team" → add "Cross-functional Leadership".
- Deduplicate: don't add "Python" twice.
- Only use information present in the text — do not hallucinate.

EDUCATION:
- Extract ALL education entries including secondary school (12th, 10th) if listed.
- Capture GPA/percentage in the "gpa" field (e.g., "6.31 CGPA", "84.8%").
- Capture honors, distinctions, or dean's list in the "honors" field.

LANGUAGES:
- Extract spoken/written languages with proficiency level if stated.
- Example: "English - Full Professional Proficiency" → { name: "English", proficiency: "Full Professional Proficiency" }

{{profile_schema}}`,
    config: { model: MODEL, temperature: 0.2 },
  },

  tailor_resume: {
    prompt: `You are a senior resume writer. Build a tailored resume using ONLY facts from the candidate profile.

RULES:
- Never invent experience, employers, dates, or metrics
- Where a JD keyword is semantically equivalent to existing experience, rephrase that bullet to use the JD's exact terminology. If unsure, keep original wording
- Total experience = 70% of resume space: most recent role 50% (6-7 bullets), second role 29% (4 bullets), third role 21% (2-3 bullets)
- Always keep bullets with specific metrics ($, %, numbers)
- Summary: 2-3 sentences tuned to this specific job
- Skills: most relevant first, max 15, grouped as: Product | Technical & Analytics | AI & Tools
- Keep company tagline (one italic line)

Return ONLY JSON:
{
  "contact": { "name":"", "email":"", "phone":"", "location":"", "links":[] },
  "summary": "",
  "skills_product": [],
  "skills_technical": [],
  "skills_ai_tools": [],
  "experience": [ { "company":"", "tagline":"", "title":"", "location":"", "dates":"", "bullets":[] } ],
  "projects": [ { "name":"", "description":"" } ],
  "education": [ { "school":"", "degree":"", "dates":"" } ],
  "certifications": [ { "name":"", "issuer":"" } ],
  "activities": [],
  "interests": [],
  "tailoring_notes": [
    "Short sentence explaining a key tailoring decision — e.g. why summary was rephrased, which bullets were rewritten to match JD keywords, why certain skills were prioritized"
  ]
}
tailoring_notes: 4-6 brief sentences explaining your most important decisions. Focus on WHAT you changed and WHY (which JD requirement it targets). Be specific — reference actual keywords and roles.`,
    config: { model: MODEL, temperature: 0.2 },
  },

  improve_resume: {
    prompt: `You previously tailored a resume and got an ATS score below target.
Your task: improve the resume by incorporating missing keywords WHERE semantically equivalent experience already exists in the resume.

STRICT RULES:
- Only rephrase existing bullets — never add new facts, experiences, or metrics
- Only use a missing keyword if the candidate genuinely has that experience under a different name
- If no equivalent exists, leave the bullet unchanged
- This is ONE iteration only — return your best attempt

Return ONLY JSON with TWO keys:
1. "resume" — the improved resume (same structure as input)
2. "substitutions" — array of changes you made, each with:
   { "jd_keyword": "the keyword from the JD", "original_phrase": "what the candidate had", "new_phrase": "what you changed it to", "bullet_context": "which bullet/role this was in" }
   Only include actual changes, not unchanged bullets.`,
    config: { model: MODEL, temperature: 0.2 },
  },

  ats_score: {
    prompt: `You are an ATS analyzer. Compare the resume to the job description.
Return ONLY JSON:
{
  "score": <0-100 integer>,
  "matched_keywords": ["keyword1"],
  "missing_keywords": ["keyword1"],
  "summary": "one sentence"
}`,
    config: { model: MODEL, temperature: 0.2 },
  },

  smart_merge: {
    prompt: `You are merging two career profiles into one comprehensive master profile. The CURRENT profile is the user's existing stored data. The NEW data was just extracted from a resume or text the user submitted.

MERGE RULES (in priority order):

1. NEVER DROP DATA — this merge is additive. Every fact from both profiles must appear in the output.

2. EXPERIENCE MATCHING:
   - Match entries by company name + job title (case-insensitive, fuzzy — "Sr. PM" = "Senior Product Manager", "Analyst" ≈ "Business Analyst")
   - For MATCHED entries, merge their bullets:
     a. If two bullets describe the same achievement, KEEP THE RICHER ONE (more metrics, more detail)
     b. Add genuinely new bullets that don't overlap with existing ones
     c. Keep the entry with more complete metadata (dates, location, company_description)
   - For UNMATCHED entries: add them as new entries
   - Order: reverse chronological (most recent first)

3. METRICS ARE SACRED:
   - Never drop a number, percentage, dollar amount, or quantifiable result
   - If current says "improved performance" and new says "improved performance by 30%", keep the "30%" version
   - If current says "saved $500K" and new says "saved costs", keep the "$500K" version
   - If both have different metrics for the same bullet, keep the one with MORE metrics

4. METRIC vs IMPACT ARE COMPLEMENTARY:
   - metric = the NUMBER (30%, $0.5M, 4 brands, 200 hours)
   - impact = the MEANING (revenue growth, operational efficiency, faster decisions)
   - A bullet can and often should have BOTH
   - If one source has data in "metric" that is really an "impact" (or vice versa), place it in the correct field — never discard it
   - A bullet describing real work should almost always have at least an impact, even without a metric

5. BULLET FORMAT: Every bullet must be { text, metric, impact }. Convert old string bullets: { "text": "the string", "metric": null, "impact": null } — then fill in metric/impact if inferrable from the text.

6. SKILLS: Union all. Deduplicate semantically ("PM" → "Product Management", "ML" → "Machine Learning"). Keep canonical forms.

7. CONTACT: Per field, keep non-empty. Both filled → prefer NEW data.

8. SUMMARY: Both exist → combine best elements. One exists → keep it.

9. PROJECTS: Match by name (fuzzy). Merge descriptions, keep richer outcome.

10. EDUCATION: Match by school+degree. Include secondary education (12th, 10th) if present. Keep entry with GPA/honors.

11. LANGUAGES: Union by name, keep proficiency from whichever source provides it.

12. CERTIFICATIONS: Union by name, deduplicate.

{{profile_schema}}`,
    config: { model: MODEL, temperature: 0.1 },
  },

  chat_enrich: {
    prompt: `You are Arjun, an AI career assistant. Your ONLY job is to help the user build their career profile by extracting facts from what they tell you. You do NOT process job URLs, analyze job descriptions, or tailor resumes — that happens in a separate tab.

STEP 1 — EXTRACT: Pull every career fact from the user's message into structured JSON.
STEP 2 — INFER SKILLS: Beyond explicitly mentioned skills, also infer skills from experience bullets and context:
  - "Built dashboards in Tableau" → add "Tableau" to skills
  - "Led cross-functional team of 8" → add "Cross-functional Leadership", "Team Management"
  - "Managed $2M budget" → add "Budget Management", "P&L"
  - Extract tools, frameworks, methodologies, platforms, and demonstrated soft skills
  - Deduplicate against skills already in the profile
STEP 3 — REPLY: Write a short reply (2-3 sentences max).

CRITICAL REPLY RULES:
- If "extracted" has ANY data: your reply MUST start by naming what you indexed ("Indexed your PM role at Flipkart", "Added Python and SQL to your skills"). Be specific. NEVER say "didn't catch", "couldn't find", or "not sure what to extract" when extracted is non-empty.
- If "extracted" is empty (greeting, question, off-topic): reply helpfully and suggest what to add next.
- Always end with ONE specific follow-up question about the biggest gap in their profile.

BULLET FORMAT: When extracting experience bullets, use { text, metric, impact } format.
- metric = the NUMBER (percentage, dollar amount, count). null if no number.
- impact = the MEANING (what changed for the business). Capture even without a metric.
- Both can coexist. A bullet describing real work should almost always have at least an impact.

WHAT TO ASK ABOUT (priority order):
1. Missing contact info (phone, location, LinkedIn URL)
2. Thin experience (roles with no bullets, missing dates/location, missing metrics/impact)
3. Missing skills
4. Missing projects or certifications
5. Missing education details
6. Missing languages

IF THE USER SENDS A JOB URL: Do NOT process it. Reply: "To tailor a resume for a job, switch to the **Tailor Resume** tab and paste the URL there. This tab is just for building your profile."

DELETION RULES:
- If the user asks to remove, delete, or clear specific data (e.g. "remove my experience at SOTI", "delete Python from skills", "clear my projects"), populate the "deletions" field.
- deletions.skills: array of skill strings to remove
- deletions.experience_ids: array of company names or slugs to remove (match against company field, case-insensitive)
- deletions.project_ids: array of project names to remove
- deletions.certifications: array of certification names to remove
- deletions.education_ids: array of school names to remove
- deletions.languages: array of language names to remove
- deletions.clear_summary: true if user wants summary cleared
- Only delete what the user explicitly asks to remove. Never delete proactively.

Return ONLY JSON:
{
  "extracted": {{profile_schema}},
  "deletions": {
    "skills": [],
    "experience_ids": [],
    "project_ids": [],
    "certifications": [],
    "education_ids": [],
    "languages": [],
    "clear_summary": false
  },
  "reply": "Your response"
}

If nothing was extractable, return "extracted": {}.
If nothing to delete, return "deletions": {}.`,
    config: { model: MODEL, temperature: 0.2 },
  },

};

// ── SYNC PROMPTS TO LANGFUSE ────────────────────────────────────────────
async function syncPrompts() {
  for (const [name, def] of Object.entries(PROMPT_DEFS)) {
    try {
      await langfuse.api.promptsCreate({
        name,
        prompt: def.prompt,
        config: def.config,
        type: 'text',
        labels: ['production'],
      });
      console.log(`✓ langfuse prompt synced: ${name}`);
    } catch (e) {
      if (e.statusCode === 409 || (e.message && e.message.includes('already exists'))) {
        console.log(`· langfuse prompt exists: ${name}`);
      } else {
        console.error(`⚠ langfuse prompt sync failed for ${name}:`, e.message);
      }
    }
  }
}

async function getPrompt(name, variables = {}) {
  try {
    const prompt = await langfuse.getPrompt(name, undefined, { label: 'production' });
    const compiled = prompt.compile(variables);
    return { text: compiled, langfusePrompt: prompt };
  } catch {
    let text = PROMPT_DEFS[name]?.prompt || '';
    for (const [k, v] of Object.entries(variables)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    return { text, langfusePrompt: null };
  }
}

// ── EVALUATIONS ─────────────────────────────────────────────────────────
function evalExtraction(trace, result) {
  const ext = result.extracted || result;
  const fields = ['contact', 'summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'activities', 'interests'];
  let populated = 0;
  for (const f of fields) {
    const v = ext[f];
    if (!v) continue;
    if (Array.isArray(v) && v.length > 0) populated++;
    else if (typeof v === 'object' && Object.keys(v).length > 0) populated++;
    else if (typeof v === 'string' && v.length > 0) populated++;
  }
  langfuse.score({ traceId: trace.id, name: 'extraction-fields', value: populated, comment: `${populated}/${fields.length} profile sections populated` });

  const skillCount = (ext.skills || []).length;
  langfuse.score({ traceId: trace.id, name: 'skills-extracted', value: skillCount });

  const allBullets = (ext.experience || []).flatMap(e => e.bullets || []);
  const bulletsWithMetrics = allBullets.filter(b => typeof b === 'object' && b.metric);
  if (allBullets.length > 0) {
    langfuse.score({ traceId: trace.id, name: 'metric-coverage', value: Math.round(100 * bulletsWithMetrics.length / allBullets.length), comment: `${bulletsWithMetrics.length}/${allBullets.length} bullets have metrics` });
  }

  if (result.reply) {
    const hasReply = result.reply.length > 10;
    langfuse.score({ traceId: trace.id, name: 'has-reply', value: hasReply ? 1 : 0 });
  }
}

function evalAtsScore(trace, result) {
  langfuse.score({ traceId: trace.id, name: 'ats-score', value: result.score || 0, comment: result.summary });
  langfuse.score({ traceId: trace.id, name: 'matched-keywords', value: (result.matched_keywords || []).length });
  langfuse.score({ traceId: trace.id, name: 'missing-keywords', value: (result.missing_keywords || []).length });
}

function evalTailoring(trace, result) {
  const bulletCount = (result.experience || []).reduce((sum, e) => sum + (e.bullets || []).length, 0);
  langfuse.score({ traceId: trace.id, name: 'total-bullets', value: bulletCount });

  const noteCount = (result.tailoring_notes || []).length;
  langfuse.score({ traceId: trace.id, name: 'tailoring-notes', value: noteCount });

  const skillCount = (result.skills_product || []).length + (result.skills_technical || []).length + (result.skills_ai_tools || []).length;
  langfuse.score({ traceId: trace.id, name: 'skills-count', value: skillCount });
}

function evalImprovement(trace, result, originalAts) {
  const subCount = (result.substitutions || []).length;
  langfuse.score({ traceId: trace.id, name: 'substitutions', value: subCount });
  langfuse.score({ traceId: trace.id, name: 'original-ats', value: originalAts || 0 });
}

function countProfileBullets(profile) {
  return (profile.experience || []).reduce((sum, e) => sum + (e.bullets || []).length, 0);
}

function evalSmartMerge(trace, current, incoming, result) {
  const inBullets = countProfileBullets(current) + countProfileBullets(incoming);
  const outBullets = countProfileBullets(result);
  langfuse.score({ traceId: trace.id, name: 'merge-bullets-in', value: inBullets });
  langfuse.score({ traceId: trace.id, name: 'merge-bullets-out', value: outBullets });

  const inSkills = (current.skills || []).length + (incoming.skills || []).length;
  const outSkills = (result.skills || []).length;
  langfuse.score({ traceId: trace.id, name: 'merge-skills-dedup', value: inSkills - outSkills, comment: `${inSkills} in → ${outSkills} out (${inSkills - outSkills} deduped)` });

  const outExp = (result.experience || []).length;
  langfuse.score({ traceId: trace.id, name: 'merge-experience-count', value: outExp });

  const bulletsWithMetrics = (result.experience || []).flatMap(e => e.bullets || []).filter(b => typeof b === 'object' && b.metric);
  langfuse.score({ traceId: trace.id, name: 'merge-metrics-preserved', value: bulletsWithMetrics.length });
}

// ── ASK JSON ────────────────────────────────────────────────────────────
async function askJson(system, user, generationName, trace, langfusePrompt) {
  const generation = trace.generation({
    name: generationName,
    model: MODEL,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(langfusePrompt ? { prompt: langfusePrompt } : {}),
  });

  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const raw = res.choices[0].message.content;
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      console.error('JSON parse failed:', raw.slice(0, 200));
      throw new Error('LLM returned invalid JSON');
    }

    generation.end({
      output: parsed,
      usage: {
        promptTokens: res.usage?.prompt_tokens,
        completionTokens: res.usage?.completion_tokens,
        totalTokens: res.usage?.total_tokens,
      },
    });
    await langfuse.flushAsync();
    return parsed;
  } catch (e) {
    generation.end({ output: { error: e.message }, level: 'ERROR' });
    await langfuse.flushAsync();
    throw e;
  }
}

// ── TRACE HELPERS ───────────────────────────────────────────────────────
function makeTrace(name, ctx = {}, extra = {}) {
  return langfuse.trace({
    name,
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    metadata: {
      ...(ctx.userEmail ? { userEmail: ctx.userEmail } : {}),
      ...(ctx.userName ? { userName: ctx.userName } : {}),
      ...extra,
    },
  });
}

function createJobTrace(job, ctx = {}) {
  return makeTrace('process_job', ctx, {
    job_id: job.job_id,
    title: job.title,
    company: job.company,
    url: job.url || null,
  });
}

// ── PUBLIC FUNCTIONS ────────────────────────────────────────────────────
async function extractFacts(rawText, ctx = {}) {
  const trace = makeTrace('extract_facts', ctx);
  const { text: system, langfusePrompt } = await getPrompt('extract_facts', { profile_schema: PROFILE_SCHEMA });
  const result = await askJson(system, `Extract facts from:\n\n"""${rawText}"""`, 'extract_facts', trace, langfusePrompt);
  evalExtraction(trace, result);
  return result;
}

async function tailorResume(profile, job, trace) {
  const { text: system, langfusePrompt } = await getPrompt('tailor_resume');

  const user =
    `TARGET JOB:\nTitle: ${job.title}\nCompany: ${job.company}\nURL: ${job.url || 'N/A'}\n` +
    `Description:\n${job.jd_text}\n\n` +
    `CANDIDATE PROFILE:\n${JSON.stringify(profile)}`;

  const result = await askJson(system, user, 'tailor_resume', trace, langfusePrompt);
  evalTailoring(trace, result);
  return result;
}

async function improveResume(resume, job, ats, trace) {
  const { text: system, langfusePrompt } = await getPrompt('improve_resume');

  const user =
    `CURRENT ATS SCORE: ${ats.score}/100\n` +
    `MISSING KEYWORDS: ${(ats.missing_keywords || []).join(', ')}\n\n` +
    `JOB DESCRIPTION:\n${job.jd_text}\n\n` +
    `CURRENT RESUME:\n${JSON.stringify(resume)}`;

  const result = await askJson(system, user, 'improve_resume', trace, langfusePrompt);
  evalImprovement(trace, result, ats.score);
  return result;
}

async function calculateAtsScore(resume, job, trace) {
  const { text: system, langfusePrompt } = await getPrompt('ats_score');

  const user =
    `JOB: ${job.title} @ ${job.company}\n` +
    `JOB DESCRIPTION:\n${job.jd_text}\n\n` +
    `FULL RESUME:\n${JSON.stringify(resume)}`;

  const result = await askJson(system, user, 'ats_score', trace, langfusePrompt);
  evalAtsScore(trace, result);
  return result;
}

async function chatEnrich(userMessage, currentProfile, ctx = {}) {
  const trace = makeTrace('chat_enrich', ctx, { mode: 'profile' });
  const { text: system, langfusePrompt } = await getPrompt('chat_enrich', { profile_schema: PROFILE_SCHEMA.trim() });

  const user = `CURRENT PROFILE:\n${JSON.stringify(currentProfile)}\n\nUSER MESSAGE:\n${userMessage}`;

  const result = await askJson(system, user, 'chat_enrich', trace, langfusePrompt);
  evalExtraction(trace, result);
  result._traceId = trace.id;
  return result;
}

async function smartMerge(currentProfile, newExtraction, ctx = {}) {
  const trace = makeTrace('smart_merge', ctx);
  const { text: system, langfusePrompt } = await getPrompt('smart_merge', { profile_schema: PROFILE_SCHEMA });

  const user = `CURRENT PROFILE:\n${JSON.stringify(currentProfile)}\n\nNEW EXTRACTION:\n${JSON.stringify(newExtraction)}`;

  const result = await askJson(system, user, 'smart_merge', trace, langfusePrompt);
  evalSmartMerge(trace, currentProfile, newExtraction, result);
  return result;
}

module.exports = { extractFacts, tailorResume, improveResume, calculateAtsScore, createJobTrace, chatEnrich, smartMerge, langfuse, syncPrompts };
