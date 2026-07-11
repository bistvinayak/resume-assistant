'use strict';

require('dotenv').config();
const OpenAI = require('openai');
const { Langfuse } = require('langfuse');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});
const MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

// Langfuse client
const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com',
});

async function askJson(system, user, traceName, traceMetadata = {}) {
  const trace = langfuse.trace({
    name: traceName,
    metadata: traceMetadata,
  });

  const generation = trace.generation({
    name: traceName,
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

    let parsed; try { parsed = JSON.parse(res.choices[0].message.content); } catch(e) { console.error("JSON parse failed:", res.choices[0].message.content.slice(0,200)); throw new Error("LLM returned invalid JSON"); }

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
}
Rules: "id" is a short lowercase slug (e.g. "exp_zinnia"). Put anything that does
not fit a known field into custom_facts as a plain string. Do NOT invent facts.`;

async function extractFacts(rawText) {
  const system =
    'You extract career facts from text into a structured profile. ' +
    'Only use information explicitly present in the text. ' + PROFILE_SCHEMA;
  return askJson(
    system,
    `Extract facts from the following:\n\n"""${rawText}"""`,
    'extract_facts'
  );
}

async function tailorResume(profile, job) {
  const system =
    'You are a senior resume writer. Build a tailored resume for the target job using ONLY ' +
    'facts present in the candidate profile. Never invent experience, employers, ' +
    'dates, or metrics. You may reorder, select, and rephrase existing bullets to ' +
    'emphasise relevance to the job.\n\n' +
    'SPACE ALLOCATION RULES (strictly follow):\n' +
    '- Total experience section = 70% of resume space\n' +
    '- Most recent role = 50% of experience space (6-7 bullets, prioritise metric-heavy bullets)\n' +
    '- Second role = 29% of experience space (4 bullets)\n' +
    '- Third role = 21% of experience space (2-3 bullets)\n' +
    '- Always keep bullets with specific metrics ($, %, numbers)\n' +
    '- Summary: 2-3 sentences max, tuned to the job\n' +
    '- Skills: most relevant first, max 15 skills\n' +
    '- Keep company tagline (one italic line under company/title)\n\n' +
    'Return ONLY JSON of this shape:\n' +
    `{
      "contact": { "name":"", "email":"", "phone":"", "location":"", "links":[] },
      "summary": "2-3 sentence summary tuned to the job",
      "skills_ranked": ["most relevant first, max 15"],
      "experience": [ { 
        "company": "", 
        "tagline": "one line company description italicised",
        "title": "", 
        "location": "",
        "dates": "", 
        "bullets": [] 
      } ],
      "projects": [ { "name":"", "description":"" } ],
      "education": [ { "school":"", "degree":"", "dates":"" } ]
    }`;

  const user =
    `TARGET JOB:\nTitle: ${job.title}\nCompany: ${job.company}\nURL: ${job.url || 'N/A'}\n` +
    `Description:\n${job.jd_text || '(only title/company available)'}\n\n` +
    `CANDIDATE PROFILE (JSON):\n${JSON.stringify(profile)}`;

  return askJson(system, user, 'tailor_resume', {
    job_id: job.job_id,
    company: job.company,
    title: job.title,
  });
}

/**
 * Calculate ATS match score between resume and job description.
 * Returns { score: 0-100, matched_keywords: [], missing_keywords: [], summary: "" }
 */
async function calculateAtsScore(resume, job) {
  const system =
    'You are an ATS (Applicant Tracking System) analyzer. ' +
    'Compare the resume to the job description and return ONLY JSON:\n' +
    '{\n' +
    '  "score": <0-100 integer>,\n' +
    '  "matched_keywords": ["keyword1", "keyword2"],\n' +
    '  "missing_keywords": ["keyword1", "keyword2"],\n' +
    '  "summary": "one sentence explanation of the score"\n' +
    '}';

  const user =
    `JOB TITLE: ${job.title}\nCOMPANY: ${job.company}\n` +
    `JOB DESCRIPTION:\n${job.jd_text || ''}\n\n` +
    `FULL RESUME (JSON):\n${JSON.stringify(resume)}`;

  return askJson(system, user, 'ats_score', {
    job_id: job.job_id,
    company: job.company,
    title: job.title,
  });
}

module.exports = { extractFacts, tailorResume, calculateAtsScore };
