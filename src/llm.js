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

async function askJson(system, user, generationName, trace) {
  const generation = trace.generation({
    name: generationName,
    model: MODEL,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
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

function createJobTrace(job) {
  return langfuse.trace({
    name: 'process_job',
    metadata: {
      job_id: job.job_id,
      title: job.title,
      company: job.company,
      url: job.url || null,
    },
  });
}

const PROFILE_SCHEMA = `
Return ONLY JSON matching this shape (omit fields you found nothing for):
{
  "contact": { "name": "", "email": "", "phone": "", "location": "", "links": [] },
  "summary": "",
  "skills": [],
  "experience": [ { "id": "slug", "company": "", "title": "", "location": "", "dates": "", "bullets": [] } ],
  "projects": [ { "id": "slug", "name": "", "description": "", "tags": [] } ],
  "education": [ { "school": "", "degree": "", "dates": "" } ],
  "custom_facts": []
}`;

async function extractFacts(rawText) {
  const trace = langfuse.trace({ name: 'extract_facts' });
  const system = 'You extract career facts from text into a structured profile. Only use information explicitly present in the text. ' + PROFILE_SCHEMA;
  return askJson(system, `Extract facts from:\n\n"""${rawText}"""`, 'extract_facts', trace);
}

async function tailorResume(profile, job, trace) {
  const system =
    'You are a senior resume writer. Build a tailored resume using ONLY facts from the candidate profile.\n\n' +
    'RULES:\n' +
    '- Never invent experience, employers, dates, or metrics\n' +
    '- Where a JD keyword is semantically equivalent to existing experience, rephrase that bullet to use the JD\'s exact terminology. If unsure, keep original wording\n' +
    '- Total experience = 70% of resume space: most recent role 50% (6-7 bullets), second role 29% (4 bullets), third role 21% (2-3 bullets)\n' +
    '- Always keep bullets with specific metrics ($, %, numbers)\n' +
    '- Summary: 2-3 sentences tuned to this specific job\n' +
    '- Skills: most relevant first, max 15, grouped as: Product | Technical & Analytics | AI & Tools\n' +
    '- Keep company tagline (one italic line)\n\n' +
    'Return ONLY JSON:\n' +
    `{
      "contact": { "name":"", "email":"", "phone":"", "location":"", "links":[] },
      "summary": "",
      "skills_product": [],
      "skills_technical": [],
      "skills_ai_tools": [],
      "experience": [ { "company":"", "tagline":"", "title":"", "location":"", "dates":"", "bullets":[] } ],
      "projects": [ { "name":"", "description":"" } ],
      "education": [ { "school":"", "degree":"", "dates":"" } ]
    }`;

  const user =
    `TARGET JOB:\nTitle: ${job.title}\nCompany: ${job.company}\nURL: ${job.url || 'N/A'}\n` +
    `Description:\n${job.jd_text}\n\n` +
    `CANDIDATE PROFILE:\n${JSON.stringify(profile)}`;

  return askJson(system, user, 'tailor_resume', trace);
}

/**
 * One improvement pass — rephrase bullets using missing JD keywords
 * where semantically equivalent experience exists. No hallucination.
 */
async function improveResume(resume, job, ats, trace) {
  const system =
    'You previously tailored a resume and got an ATS score below target.\n' +
    'Your task: improve the resume by incorporating missing keywords WHERE semantically equivalent experience already exists in the resume.\n\n' +
    'STRICT RULES:\n' +
    '- Only rephrase existing bullets — never add new facts, experiences, or metrics\n' +
    '- Only use a missing keyword if the candidate genuinely has that experience under a different name\n' +
    '- If no equivalent exists, leave the bullet unchanged\n' +
    '- This is ONE iteration only — return your best attempt\n\n' +
    'Return ONLY JSON with TWO keys:\n' +
    '1. "resume" — the improved resume (same structure as input)\n' +
    '2. "substitutions" — array of changes you made, each with:\n' +
    '   { "jd_keyword": "the keyword from the JD", "original_phrase": "what the candidate had", "new_phrase": "what you changed it to", "bullet_context": "which bullet/role this was in" }\n' +
    '   Only include actual changes, not unchanged bullets.\n';

  const user =
    `CURRENT ATS SCORE: ${ats.score}/100\n` +
    `MISSING KEYWORDS: ${(ats.missing_keywords || []).join(', ')}\n\n` +
    `JOB DESCRIPTION:\n${job.jd_text}\n\n` +
    `CURRENT RESUME:\n${JSON.stringify(resume)}`;

  return askJson(system, user, 'improve_resume', trace);
}

async function calculateAtsScore(resume, job, trace) {
  const system =
    'You are an ATS analyzer. Compare the resume to the job description.\n' +
    'Return ONLY JSON:\n' +
    '{\n' +
    '  "score": <0-100 integer>,\n' +
    '  "matched_keywords": ["keyword1"],\n' +
    '  "missing_keywords": ["keyword1"],\n' +
    '  "summary": "one sentence"\n' +
    '}';

  const user =
    `JOB: ${job.title} @ ${job.company}\n` +
    `JOB DESCRIPTION:\n${job.jd_text}\n\n` +
    `FULL RESUME:\n${JSON.stringify(resume)}`;

  return askJson(system, user, 'ats_score', trace);
}

async function chatEnrich(userMessage, currentProfile) {
  const trace = langfuse.trace({ name: 'chat_enrich' });

  const system = `You are Arjun, an AI career assistant. Your ONLY job is to help the user build their career profile by extracting facts from what they tell you. You do NOT process job URLs, analyze job descriptions, or tailor resumes — that happens in a separate tab.

STEP 1 — EXTRACT: Pull every career fact from the user's message into structured JSON.
STEP 2 — REPLY: Write a short reply (2-3 sentences max).

CRITICAL REPLY RULES:
- If "extracted" has ANY data: your reply MUST start by naming what you indexed ("Indexed your PM role at Flipkart", "Added Python and SQL to your skills"). Be specific. NEVER say "didn't catch", "couldn't find", or "not sure what to extract" when extracted is non-empty.
- If "extracted" is empty (greeting, question, off-topic): reply helpfully and suggest what to add next.
- Always end with ONE specific follow-up question about the biggest gap in their profile.

WHAT TO ASK ABOUT (priority order):
1. Missing contact info (phone, location, LinkedIn URL)
2. Thin experience (roles with no bullets, missing dates/location)
3. Missing skills
4. Missing projects or certifications
5. Missing education details

IF THE USER SENDS A JOB URL: Do NOT process it. Reply: "To tailor a resume for a job, switch to the **Tailor Resume** tab and paste the URL there. This tab is just for building your profile."

Return ONLY JSON:
{
  "extracted": ${PROFILE_SCHEMA.trim()},
  "reply": "Your response"
}

If nothing was extractable, return "extracted": {}.`;

  const user = `CURRENT PROFILE:\n${JSON.stringify(currentProfile)}\n\nUSER MESSAGE:\n${userMessage}`;

  return askJson(system, user, 'chat_enrich', trace);
}

async function chatJobAnalysis(currentProfile, job) {
  const trace = langfuse.trace({ name: 'chat_job_analysis' });

  const system = `You are Arjun, an AI career assistant. The user wants to apply for a job. Analyze their profile against the job description.

Return ONLY JSON:
{
  "ats_score": <0-100 integer estimating how well their profile matches>,
  "matched_keywords": ["keyword1", "keyword2"],
  "missing_keywords": ["keyword1", "keyword2"],
  "strengths": ["strength1", "strength2"],
  "gaps": ["gap1", "gap2"],
  "reply": "A friendly 3-5 sentence analysis: mention the ATS score, top strengths for this role, key gaps to address, and offer to tailor their resume for this job. Be specific about what's missing."
}`;

  const user = `JOB:\nTitle: ${job.title}\nCompany: ${job.company}\nDescription:\n${job.jd_text}\n\nCANDIDATE PROFILE:\n${JSON.stringify(currentProfile)}`;

  return askJson(system, user, 'chat_job_analysis', trace);
}

module.exports = { extractFacts, tailorResume, improveResume, calculateAtsScore, createJobTrace, chatEnrich, chatJobAnalysis };
