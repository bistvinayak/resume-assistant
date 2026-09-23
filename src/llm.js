'use strict';

require('dotenv').config();
const OpenAI = require('openai');
const { Langfuse } = require('langfuse');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  timeout: 60_000,
  maxRetries: 0,
});
const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-3.7-flash';
// Resume-writing steps (tailor/improve) get a stronger model — the prose quality and
// strict "select+reframe, never invent" constraint matter more here than in extraction/scoring.
const WRITING_MODEL = process.env.OPENROUTER_WRITING_MODEL || 'google/gemini-3.7-flash';
// Browser-extension form mapping is low-stakes (structured field->value matching, not resume
// prose) and can run on OpenRouter's free tier without hurting output quality that matters.
// Free models keep getting retired (z-ai/glm-5.2:free, then minimax/minimax-m3:free) —
// nemotron-3-super is the current free pick.
const FORM_FILL_MODEL = process.env.OPENROUTER_FORM_FILL_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';
// Free-tier models share a rate-limited upstream pool and can 429 or disappear, so the
// fallback is the paid main MODEL (stable, never retired) rather than a second free model.
// One form-fill call costs a fraction of a cent there.
const FORM_FILL_FALLBACK_MODEL = process.env.OPENROUTER_FORM_FILL_FALLBACK_MODEL || MODEL;

const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com',
});

const { getApprovedCategories, upsertSchemaProposal } = require('./db');

async function formatApprovedCategories() {
  const categories = await getApprovedCategories().catch(() => []);
  if (!categories.length) {
    return 'KNOWN CUSTOM CATEGORIES: none yet — propose new categories per the RULES below.';
  }
  const lines = categories.map(c =>
    `- ${c.category}: ${c.description || c.display_name}${(c.example_fields || []).length ? ` Fields: ${c.example_fields.join(', ')}` : ''}`
  );
  return `KNOWN CUSTOM CATEGORIES (file matching data here instead of proposing new ones):\n${lines.join('\n')}`;
}

const PROFILE_SCHEMA = `
Return ONLY JSON matching this shape (omit fields you found nothing for):
{
  "contact": { "name": "", "email": "", "phone": "", "location": "", "address_line1": "", "address_line2": "", "city": "", "state": "", "postal_code": "", "country": "", "linkedin": "", "github": "", "portfolio": "" },
  "summary": "",
  "technical_skills": [
    {
      "name": "Skill name (e.g. SQL, Tableau, Python, Figma, JIRA)",
      "experience": "Duration if known (e.g. '5 Years', '2 Years'). null if unknown.",
      "last_used": "Year last used (e.g. '2025'). null if unknown."
    }
  ],
  "soft_skills": ["Leadership", "Communication", "Cross-functional Collaboration", "Stakeholder Management"],
  "skills": ["Flat array: ALL skill names (both technical and soft) for backward compat"],
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
      "url": "Project URL if available. null otherwise.",
      "description": "One-line summary of WHAT the project is (not HOW it works)",
      "tech_stack": ["Language/tool/framework used — e.g. React, Python, PostgreSQL, OpenAI API, AWS"],
      "tags": ["Domain tags — e.g. AI, E-commerce, Analytics"],
      "bullets": [
        {
          "text": "Specific achievement, design decision, or technical detail",
          "metric": "Number if any — null otherwise",
          "impact": "What changed — null otherwise"
        }
      ],
      "outcome": "Measurable result or impact of this project"
    }
  ],
  "education": [ { "school": "", "degree": "Degree type only, e.g. 'Master of Science', 'Bachelor of Technology' — no major", "major": "Field of study, e.g. 'Artificial Intelligence for Business', 'Computer Science'. If the source lists degree and major together (e.g. 'Master of Science, Artificial Intelligence for Business'), split them into these two separate fields rather than keeping the major inside the degree string.", "dates": "", "gpa": "", "honors": "" } ],
  "certifications": [ { "name": "", "issuer": "", "date": "", "validity": "" } ],
  "languages": [ { "name": "", "proficiency": "", "read": true, "write": true, "speak": true } ],
  "career": {
    "current_industry": "",
    "department": "",
    "current_role": "",
    "total_experience": "e.g. '5 Years 6 Months'",
    "notice_period": "e.g. '15 Days or less'",
    "preferred_locations": [],
    "work_permit": [],
    "desired_job_type": ""
  },
  "self_identification": {
    "gender": "",
    "hispanic_latino": "",
    "race_ethnicity": "",
    "veteran_status": "",
    "disability_status": ""
  },
  "activities": [],
  "interests": [],
  "custom_sections": [
    {
      "category": "machine-readable snake_case key matching one of the KNOWN CUSTOM CATEGORIES below",
      "items": [
        { "text": "the fact/achievement", "metric": "number if any, else null", "impact": "meaning if any, else null" }
      ]
    }
  ],
  "custom_facts": [],
  "schema_suggestions": [
    {
      "category": "short_snake_case_name",
      "display_name": "Human-Readable Label",
      "description": "One sentence: what this section captures",
      "example_fields": ["field1", "field2"],
      "sample_data": "Verbatim text from the resume"
    }
  ]
}

SKILL CLASSIFICATION RULES:
- technical_skills: Programming languages, tools, frameworks, platforms, databases, analytics tools, methodologies (SQL, Python, Tableau, JIRA, Agile, REST APIs, Figma, Power BI, etc.)
- soft_skills: Interpersonal, communication, organizational, leadership abilities (Leadership, Stakeholder Management, Cross-functional Collaboration, Problem Solving, Negotiation, etc.)
- skills: Flat union of ALL skill names from both categories (for backward compatibility)
- Infer skills from bullets: "Led cross-functional team" → soft_skills: "Cross-functional Leadership"; "Built dashboards in Tableau" → technical_skills: { name: "Tableau" }`;

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

NESTED PROJECTS / SUB-POINTS UNDER EXPERIENCE:
Some resumes list "Key Projects" or product names under a job role. Extract EACH sub-point as its OWN separate bullet under that experience entry. They are individual achievements within that role, NOT one combined bullet.

Example resume structure:
  "Key Projects:
   • Price Monitor – Developed real-time pricing tool, reduced response time by 40%
   • Brand Protector – Built brand monitoring system serving 4 brands
   • Content Management Tool – Reduced manual ops by 50%, $0.5M revenue"

Extract as THREE separate bullets:
  { text: "Price Monitor – Developed real-time pricing tool, reduced response time by 40%", metric: "40% response time reduction", impact: "Faster pricing decisions" }
  { text: "Brand Protector – Built brand monitoring system serving 4 brands", metric: "4 brands", impact: "Brand protection at scale" }
  { text: "Content Management Tool – Reduced manual ops by 50%, $0.5M revenue", metric: "50% ops reduction, $0.5M revenue", impact: "Operational efficiency and revenue growth" }

NEVER combine sub-points into a single bullet. NEVER skip sub-points because they seem similar. Each named project/product is a distinct achievement.

Only extract as top-level projects: personal projects, startup projects, academic/side projects NOT tied to an employer.

PROJECT EXTRACTION RULES:
- "description" = one sentence of WHAT the project is (the elevator pitch). NOT the full technical detail.
- "tech_stack" = every language, framework, tool, API, cloud service mentioned or inferable from the project description. e.g. ["React", "Node.js", "Express", "PostgreSQL", "OpenAI API", "AWS EC2", "S3", "CloudFront", "Puppeteer"]
- "tags" = 2-4 domain-level tags. e.g. ["AI", "Career Tech", "Automation"]
- "bullets" = specific achievements, design decisions, or technical details as structured bullet objects (same format as experience bullets: text, metric, impact)
- "outcome" = measurable result. If no number, describe the qualitative outcome.
- Keep description SHORT. Put the details in bullets. Tools in tech_stack. Domain in tags.

COMPANY CONTEXT:
- For each company, add company_description from taglines in the resume or general knowledge.
- Resume may say "Tata Group has set up Tata Digital to build digital businesses" or "Shiprocket is a 3PL fulfillment solutions provider" — capture these verbatim or close to it.
- If no tagline is given, infer from context: industry, scale, product type.

SKILL EXTRACTION RULES:
- Split skills into technical_skills (with experience/last_used metadata when available) and soft_skills (flat strings).
- Also populate the flat "skills" array with ALL skill names from both categories.
- technical_skills: tools, programming languages, frameworks, platforms, databases, analytics tools, methodologies (SQL, Python, Tableau, JIRA, Agile, REST APIs, Figma, etc.)
- soft_skills: interpersonal, communication, organizational, leadership (Stakeholder Management, Cross-functional Collaboration, Problem Solving, Negotiation, etc.)
- Extract explicitly listed skills AND infer from bullets/context.
- Skills in grouped sections (e.g., "Languages: SQL, Python | Tools: Tableau, Figma") — classify into the right category.
- Infer from bullets: "Built dashboards in Tableau" → technical_skills: { name: "Tableau" }; "Led cross-functional team" → soft_skills: "Cross-functional Leadership".
- Deduplicate within each category.
- Only use information present in the text — do not hallucinate.

CAREER METADATA:
- Extract career preferences if present: current industry, department, notice period, preferred locations, work permit, total experience, desired job type.
- These are typically found in Naukri/LinkedIn profile exports or when the user mentions them in conversation.

CONTACT — ONLINE PROFILES:
- Extract LinkedIn, GitHub, portfolio URLs into their dedicated contact fields (linkedin, github, portfolio).
- If links are in a generic "links" array, move them to the appropriate named field.

EDUCATION:
- Extract ALL education entries including secondary school (12th, 10th) if listed.
- Capture GPA/percentage in the "gpa" field (e.g., "6.31 CGPA", "84.8%").
- Capture honors, distinctions, or dean's list in the "honors" field.

LANGUAGES:
- Extract spoken/written languages with proficiency level if stated.
- Example: "English - Full Professional Proficiency" → { name: "English", proficiency: "Full Professional Proficiency" }

DYNAMIC CUSTOM SECTIONS (data that doesn't fit the fixed schema):
Resumes sometimes contain whole sections that don't map to any field above — Publications, Patents, Awards, Speaking Engagements, References, Volunteer Work, Test Scores, etc.

{{approved_categories}}

"custom_sections" is a RESTRICTED field. You may ONLY add an entry to it if its "category" key is an EXACT, VERBATIM match to one of the category keys listed under KNOWN CUSTOM CATEGORIES above. You are NEVER allowed to invent a category name and place it in custom_sections — not even one that seems obviously correct (e.g. "awards", "patents", "publications"). If the KNOWN CUSTOM CATEGORIES list says "none yet", then custom_sections MUST be an empty array in your output, with no exceptions, regardless of what the resume contains.

RULES:
1. If the data matches one of the KNOWN CUSTOM CATEGORIES above (exact key match), file it under "custom_sections" using that EXACT category key, with items as { text, metric, impact } (same convention as bullets).
2. For EVERYTHING ELSE that doesn't fit a hardcoded field above AND doesn't match an approved category, do TWO things — this is the ONLY path for novel data, there is no shortcut into custom_sections:
   a. Capture the raw text in "custom_facts" (so nothing is lost)
   b. Propose it as a new category by adding an entry to "schema_suggestions":
      { "category": "short snake_case name, e.g. 'patents'", "display_name": "Human label, e.g. 'Patents'", "description": "one sentence describing what this section captures", "example_fields": ["field names you'd want captured, e.g. patent_number, status, date"], "sample_data": "the actual text you found, verbatim" }
3. Only propose a new category for a genuine SECTION of the resume (multiple related facts), not a single one-off fact — those belong in custom_facts alone, with no schema_suggestions entry.
4. Never propose a category that duplicates a hardcoded field (skills, education, certifications, languages, etc.) or an already-known custom category.

Example: resume has an "Awards & Recognition" section, and KNOWN CUSTOM CATEGORIES says "none yet".
✗ WRONG: custom_sections: [{ category: "awards_recognition", items: [...] }]  ← invented a category, skipped review
✓ CORRECT: custom_facts: ["Won Employee of the Quarter, Q3 2024", ...], schema_suggestions: [{ category: "awards_recognition", display_name: "Awards & Recognition", description: "...", example_fields: ["title","issuer","date"], sample_data: "Won Employee of the Quarter, Q3 2024" }]

AMBIGUITY DETECTION:
After extraction, review what you extracted and flag anything you are NOT confident about. Return an "ambiguities" array alongside the profile fields. Each ambiguity is an object:
{ "field": "experience[0].title", "value": "PM", "question": "Is this Product Manager or Project Manager?", "options": ["Product Manager", "Project Manager"] }

Flag these situations:
- Ambiguous abbreviations: "PM", "SE", "BA", "EM", "IC" — could mean multiple things
- Missing dates: experience or education entry with no start/end date
- Unclear company: abbreviated or unrecognizable company name
- Vague metrics: "significantly increased", "greatly improved" with no number
- Role vs project ambiguity: can't tell if something is a job role or a side project
- Overlapping or impossible date ranges
- Skill categorization uncertainty: unsure if a skill is technical or soft
- Missing degree level: education entry where degree type is unclear

Each ambiguity must have: field (JSON path to the extracted field), value (what you extracted), question (what to ask the user).
Optionally include: options (array of likely answers for multiple choice).

If everything is clear and complete, return an empty ambiguities array.

Return "ambiguities" and "schema_suggestions" as top-level arrays alongside the profile fields (both empty arrays if none). If everything fits the known schema and known custom categories, return an empty schema_suggestions array.

{{profile_schema}}`,
    config: { model: MODEL, temperature: 0.2 },
  },

  tailor_resume: {
    prompt: `You are a resume relevance engine. Your job is to SELECT the most relevant content from a candidate's profile for a specific job, REFRAME it to align with JD keywords, and EXPLAIN why each bullet was chosen.

PROCESS:
1. EXTRACT JD REQUIREMENTS — Identify 8-15 key requirements from the job description (skills, responsibilities, outcomes, domain knowledge).
2. SCORE EVERY PROFILE BULLET — For each bullet, ask: "Does this demonstrate experience relevant to any JD requirement?"
3. SELECT ALL RELEVANT BULLETS — Include every bullet that matches at least one requirement. Be GREEDY — more relevant content is always better. Page fit is handled separately by the system, not by you.
4. REFRAME — For each JD requirement a bullet serves, check whether the JD uses specific terminology for it (a tool name, methodology, framework, or phrase — e.g. "Jira", "OKRs", "root cause analysis"). If the candidate's bullet already describes that same underlying work under different wording, use the JD's exact term instead of a generic paraphrase — this is what actually moves ATS matching, not loose rewording. Only do this where the match is genuine: the candidate's real experience must already contain that concept, just phrased differently. Never introduce a JD term the bullet's underlying work doesn't actually support — that's inventing a qualification, not reframing one. Preserve the core fact, metric, and impact either way.
5. ANNOTATE — For each selected bullet, add a "serves" field naming which JD requirement it addresses.

CONTENT INTEGRITY RULES:
- Every bullet in the output MUST trace back to a specific bullet in the profile
- You may rephrase "Spearheaded a centralized Content Management Tool" → "Led development of a centralized Content Management Tool" (same fact, JD-aligned wording)
- You may adopt the JD's own terminology when it's a genuine match: candidate's "coordinated daily team check-ins" + JD says "Daily Standups" → "Led Daily Standups" (same real activity, JD's exact term)
- You may NOT rephrase "Built 4 separate analytics products" → "Owned analytics suite" (lost the detail)
- You may NOT adopt a JD term the bullet doesn't actually support — e.g. do not write "led Kubernetes migration" onto a bullet that never mentions containers or infrastructure work, even if Kubernetes is in the JD
- Sub-point bullets (e.g. "Price Monitor — ...", "Brand Protector — ...") are distinct achievements. Each one is its own bullet. NEVER collapse them.
- If the profile says "$0.5M revenue" the resume must say "$0.5M revenue", not "significant revenue"
- NEVER invent new bullets, combine two bullets into one, or summarize multiple achievements
- NEVER drop a metric ($, %, number) — metrics are sacred

WHAT TO INCLUDE:
- ALL experience roles from the profile — never drop a role entirely, regardless of page target.
- Target page count for this resume: {{target_pages}}.
  - If the target is 1 page: be SELECTIVE, not greedy. For each role, include only the 2-3 bullets with the strongest concrete impact (a real metric, dollar figure, or standout outcome) that also connect to a JD requirement. If a role has several JD-relevant bullets, pick the ones with numbers over the ones without — a resume that covers fewer JD keywords but reads as dense with real impact beats one that's exhaustive but padded with generic activity. This is a hard constraint, not a preference: content that doesn't fit this selectivity gets left out, not squeezed in with smaller fonts later.
  - If the target is more than 1 page, or not specified: be GREEDY — include every JD-relevant bullet. For highly relevant roles: up to 10 bullets. For somewhat relevant roles: 3-6 bullets, prioritizing ones with metrics. For roles with minimal JD overlap: 2-3 bullets minimum.
- Bullets with specific metrics that match JD requirements always get priority.
- Contact: use exactly what the profile has (name, email, phone, location, links)

SUMMARY: 2-3 sentences. Reuse profile facts. Tune to JD but do not fabricate.

SKILLS: Select from profile skills, reorder with JD-relevant first. Max 15. Group as: Product | Technical & Analytics | AI & Tools

PROJECTS: Include ALL projects from the profile. For each project:
- Copy name exactly from the profile
- "description": 1-2 sentences — what the project does + the most JD-relevant technical detail. Use tech_stack and bullets from the profile to compose this.
- "tech_stack": copy from the profile's tech_stack array. Reorder with JD-relevant tools first.
- "tags": copy from the profile's tags array
- "url": copy from the profile if present
- Do NOT invent project details — only use what the profile provides
- Projects demonstrate initiative and technical depth. A flat one-liner wastes space.

COMPANY TAGLINE: Copy verbatim from the profile's company_description field.

═══ FEW-SHOT EXAMPLE ═══

JD requirement: "Experience building and scaling data analytics products"

Profile bullet: { "text": "Owned a four-module analytics suite (Price Monitor, Brand Protector, Content Protector, Growth Accelerator) across 200+ marketplaces", "metric": "200+ marketplaces", "impact": "E-commerce analytics at scale" }

✓ CORRECT output bullet:
{ "text": "Owned a four-module analytics suite (Price Monitor, Brand Protector, Content Protector, Growth Accelerator) across 200+ marketplaces", "serves": "building and scaling data analytics products" }
→ Kept nearly verbatim — it directly matches the requirement. Metric "200+" preserved.

JD requirement: "Drive product roadmap and prioritization"

Profile bullet: { "text": "Spearheaded product roadmap for e-commerce analytics platform, defining quarterly OKRs and feature prioritization across 4 product lines", "metric": "4 product lines", "impact": "Strategic product direction" }

✓ CORRECT output bullet:
{ "text": "Drove product roadmap and prioritization for e-commerce analytics platform, defining quarterly OKRs across 4 product lines", "serves": "product roadmap and prioritization" }
→ "Spearheaded" → "Drove" to match JD keyword. Core fact and metric preserved.

✗ WRONG output bullet:
{ "text": "Led strategic product planning and roadmap execution" }
→ Lost the metric "4 product lines", lost "quarterly OKRs", generic rewrite.

═══ END EXAMPLE ═══

Return ONLY JSON:
{
  "jd_requirements": ["requirement1", "requirement2"],
  "contact": { "name":"", "email":"", "phone":"", "location":"", "links":[] },
  "summary": "",
  "skills_product": [],
  "skills_technical": [],
  "skills_ai_tools": [],
  "experience": [ { "company":"", "tagline":"", "title":"", "location":"", "dates":"", "bullets":[ { "text":"bullet text", "serves":"which JD requirement" } ] } ],
  "projects": [ { "name":"", "description":"", "tech_stack":[], "tags":[], "url":"" } ],
  "education": [ { "school":"", "degree":"", "dates":"" } ],
  "certifications": [ { "name":"", "issuer":"" } ],
  "activities": [],
  "interests": [],
  "tailoring_notes": [
    "Short sentence explaining a key tailoring decision"
  ]
}
tailoring_notes: 4-6 sentences. For each note: which profile bullet you reframed, what JD keyword you targeted, and what you changed. Be specific.`,
    config: { model: MODEL, temperature: 0.1 },
  },

  improve_resume: {
    prompt: `You previously tailored a resume and got an ATS score below target.
Your task: improve the resume by incorporating missing keywords WHERE semantically equivalent experience already exists in the resume.

You're given MISSING KEYWORD PLACEMENT below — an analysis of exactly which existing bullet (if any) each missing keyword could genuinely attach to. For process/methodology keywords, trust that diagnosis: where it names a bullet, that's your starting point for a rephrase. Where it says no fit exists, leave that keyword alone — do not go looking for a workaround elsewhere in the resume. For PROPER-NOUN keywords (see rule below), don't just trust the diagnosis — independently re-check it yourself before using it, since this is the category most likely to get fabricated.

You're also given this candidate's TAILORING NOTES and JD REQUIREMENTS from the original tailoring pass — the same read of the job's priorities used to build this resume. Stay consistent with that read rather than re-deriving your own.

STRICT RULES:
- Only rephrase existing bullets — never add new facts, experiences, or metrics
- Only use a missing keyword where MISSING KEYWORD PLACEMENT names a genuine fit
- If a keyword has no fit, leave every bullet touching that topic unchanged
- A missing keyword that is a PROPER NOUN may ONLY be added if that exact term (or an unambiguous abbreviation) already appears verbatim somewhere else in CURRENT RESUME below. This category includes obvious brand names ("Jira", "AWS", "Azure", "Salesforce") AND named methodologies/frameworks that read as plain lowercase phrases but are actually a specific named approach the candidate would need to have specifically studied or practiced — e.g. "Working Backwards" (Amazon's PM methodology), "Jobs to be Done"/"JTBD", "Design Thinking", "Blue Ocean Strategy", "RICE", "OKRs", "SAFe". The test: would claiming this keyword require the candidate to have specifically named/studied/certified in THIS THING, not just done work that happens to overlap with what it describes? If yes, treat it as a proper noun. Check verbatim presence yourself against the actual resume text; do not take MISSING KEYWORD PLACEMENT's word for it. A bullet describing the same TYPE of work ("cloud microservices" for "AWS", "identifying customer needs" for "Working Backwards", "managing sprint backlogs" for "Jira") is NOT grounds to add the proper noun — that invents a fact the candidate never confirmed, no matter how plausible the connection sounds. Generic process descriptions that aren't a named methodology (e.g. "Go-To-Market", "root cause analysis") can still match on process alone.
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

For each missing keyword, also diagnose WHERE it could plausibly go: scan the resume's existing bullets for one that describes genuinely equivalent experience under different wording. This isn't a guess — only name a bullet if the underlying experience is really there. If nothing in the resume is a genuine fit, say so explicitly rather than forcing a match.

A missing keyword that is a PROPER NOUN needs a hard, mechanical check. This category is broader than it first looks — it's not just tools with obvious brand capitalization ("Jira", "Salesforce", "AWS"), it also includes NAMED METHODOLOGIES/FRAMEWORKS that read as ordinary lowercase phrases but are actually a specific named approach a candidate would need to have specifically studied or practiced — e.g. "Working Backwards" (Amazon's PM methodology), "Jobs to be Done" / "JTBD", "Design Thinking", "Blue Ocean Strategy", "Lean Six Sigma", "RICE", "OKRs", "SAFe" — as well as certifications and cloud providers ("AWS", "Azure", "PMP"). The test: would claiming this keyword require the candidate to have specifically named/studied/certified in THIS THING, as opposed to just having done work that happens to overlap with what it describes? If yes, it's a proper noun for this purpose. Only name a bullet as a genuine fit for a proper-noun keyword if that EXACT term (or an unambiguous abbreviation) already appears verbatim somewhere else in the resume. A bullet merely describing the same TYPE of work — "managing sprint backlogs" for "Jira", "cloud microservices" for "AWS", "identifying customer needs" for "Working Backwards" — is NOT a genuine fit; the candidate never confirmed using that specific named thing, and attaching it anyway is fabrication, not rewording, even though the underlying work sounds related. Generic process descriptions that aren't a named methodology (e.g. "Go-To-Market", "root cause analysis", "sprint planning") can still match on process alone, as before. When genuinely unsure, treat it as a proper noun — the cost of a missed match is lower than the cost of a fabricated qualification.

Return ONLY JSON:
{
  "score": <0-100 integer>,
  "matched_keywords": ["keyword1"],
  "missing_keywords": ["keyword1"],
  "missing_keyword_context": [
    { "keyword": "keyword1", "best_fit_bullet": "the existing bullet text this could attach to, or null if no genuine fit exists anywhere in the resume", "role": "which company/role that bullet is under, or null", "reason": "why this bullet is a genuine (not forced) fit, or why nothing fits" }
  ],
  "summary": "one sentence"
}`,
    config: { model: MODEL, temperature: 0.2 },
  },

  smart_merge: {
    prompt: `You are merging two career profiles into one comprehensive master profile. The CURRENT profile is the user's existing stored data. The NEW data was just extracted from a resume or text the user submitted.

MERGE RULES (in priority order):

1. NEVER DROP DATA — this merge is additive. Every fact from both profiles must appear in the output.

2. EXPERIENCE MATCHING:
   - Match entries by company name + job title (case-insensitive, fuzzy):
     • Titles: "Sr. PM" = "Senior Product Manager", "Analyst" ≈ "Business Analyst"
     • Company names: treat legal-entity suffixes and shortened/expanded forms as the SAME company — "Zinnia" = "Zinnia Insurance" = "Zinnia Inc." = "Zinnia, LLC". If one name is a prefix/substring of the other, or they differ only by a corporate suffix (Inc, LLC, Ltd, Corp, Group, Insurance, Technologies, etc.), that is the same employer, not two different ones — same rule applies to location differences (e.g. an office/HQ address change) and to dates that are adjacent-but-not-overlapping (a role that continued past what an earlier resume listed, e.g. "Apr 2025–Aug 2025" now shown as "Apr 2025–Present").
     • Only treat two entries at the same-ish time as genuinely different employers when the names are actually unrelated (e.g. "Zinnia" vs "Tata Digital") — do not invent a distinction from formatting differences.
   - For MATCHED entries, merge their bullets:
     a. If two bullets describe the same achievement, KEEP THE RICHER ONE (more metrics, more detail)
     b. Add genuinely new bullets that don't overlap with existing ones
     c. Keep the entry with more complete metadata (dates, location, company_description)
   - For UNMATCHED entries: add them as new entries
   - Order: reverse chronological (most recent first)
   - SUB-POINTS / NESTED PROJECTS: Bullets that begin with a product or project name (e.g. "Price Monitor – ...", "Brand Protector – ...", "Growth Accelerator – ...") are INDIVIDUAL achievements. Rules:
     • They are NOT duplicates of each other — "Price Monitor" and "Brand Protector" are different products
     • They are NOT duplicates of a parent bullet (e.g. "Owned a four-module analytics suite") — the parent is a summary, the sub-points are the details. KEEP BOTH.
     • A parent bullet + its sub-points must ALL appear in the output. The sub-points add detail the parent lacks.
     • Similarly, category-prefixed bullets like "Product Strategy & Roadmap Ownership: ..." and "Quality Audit & Compliance: ..." are distinct bullets — different category prefix = different bullet, even if both are under the same role.
     • When in doubt: if two bullets have different opening words before a colon or dash, they are DIFFERENT bullets. Keep both.

EXAMPLE — merging experience bullets correctly:
CURRENT profile has:
  { company: "Acme Corp", title: "PM", bullets: [
    { text: "Owned a four-module analytics suite across 200+ marketplaces", metric: "200+ marketplaces", impact: "..." }
  ]}
NEW extraction has:
  { company: "Acme Corp", title: "PM", bullets: [
    { text: "Owned a four-module analytics suite across 200+ marketplaces", metric: "200+ marketplaces", impact: "..." },
    { text: "Price Monitor — real-time price tracking, MAP-policy violations", metric: null, impact: "Price enforcement" },
    { text: "Brand Protector — automated unauthorized-seller removal across 200+ marketplaces", metric: "200+ marketplaces", impact: "Brand protection" },
    { text: "Content Protector — multi-daily PDP scans against source-of-truth systems", metric: null, impact: "Content integrity" },
    { text: "Growth Accelerator — unified 1P+3P analytics dashboard", metric: null, impact: "Analytics consolidation" }
  ]}
CORRECT merged output: ALL 5 bullets (the parent + 4 sub-points). The sub-points are NOT duplicates of the parent.
WRONG: dropping sub-points because "the parent bullet already covers the suite"

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

6. SKILLS (three arrays):
   - technical_skills: Union by name (case-insensitive). Deduplicate semantically ("PM" → "Product Management"). Keep richer metadata (experience, last_used) from whichever source has it.
   - soft_skills: Union, deduplicate semantically. Keep canonical forms.
   - skills: Flat union of ALL skill names from both categories. Backward compat.

7. CONTACT: Per field, keep non-empty. Both filled → prefer NEW data. Move linkedin/github/portfolio URLs from generic "links" array into dedicated fields.

8. SUMMARY: Both exist → combine best elements. One exists → keep it.

9. PROJECTS: Match by name (fuzzy). Merge descriptions (keep shorter, punchier one-liner), keep richer outcome. Preserve project URLs. MERGE tech_stack arrays (union, dedup). MERGE bullets arrays (dedup by text, keep richer version with metrics/impact).

10. EDUCATION: Match by school+degree. Include secondary education (12th, 10th) if present. Keep entry with GPA/honors/major — degree and major are separate fields (degree = "Master of Science", major = "Artificial Intelligence for Business", not combined into one string).

11. LANGUAGES: Union by name, keep richer proficiency and read/write/speak flags.

12. CERTIFICATIONS: Union by name, deduplicate. Keep issuer, date, validity from whichever source has them.

13. CAREER: Merge per field, prefer NEW data. Keep notice_period, preferred_locations, work_permit, total_experience, etc.

14. CUSTOM_SECTIONS: Match by category key (exact string match). For matched categories, union items by text (dedup, keep richer metric/impact). For categories only in one source, include as-is. NEVER drop a custom_sections category or item — this is where non-standard resume sections live (Publications, Patents, Awards, etc.) and losing them is as bad as losing an experience bullet.

15. CHANGES SUMMARY: This runs before the user sees the merge, so they can review it before it's applied to their profile. Add a top-level "changes_summary" key (sibling to the profile fields above) using your OWN semantic judgment of what's genuinely new vs. what's the same fact worded differently — not a string comparison. "DIT University, Dehradun" and "DIT University, Dehradun, UK ,India" are the SAME school (a typo, not a new entry); "Zinnia" and "Zinnia Insurance" are the SAME employer. Only list something as new if it's actually new information.
{
  "changes_summary": {
    "new_roles": ["Title at Company — only roles that don't exist in CURRENT PROFILE at all"],
    "updated_roles": [{ "company": "", "added_bullets": 0 }],
    "new_education": ["Degree — School — only if this school+degree isn't already represented in CURRENT PROFILE under any wording"],
    "new_activities": [""],
    "new_certifications": [""],
    "new_skills": [""],
    "contact_changes": [{ "field": "email|phone|location", "from": "value in CURRENT PROFILE", "to": "value in the merged result" }]
  }
}

{{profile_schema}}`,
    config: { model: MODEL, temperature: 0.1 },
  },

  chat_enrich: {
    prompt: `You are Arjun, an AI career assistant. Your ONLY job is to help the user build their career profile by extracting facts from what they tell you. You do NOT process job URLs, analyze job descriptions, or tailor resumes — that happens in a separate tab.

STEP 1 — CHECK FOR AMBIGUITY: Before extracting, check if the message has unclear context:
- Which company/role does a bullet belong to? If the user mentions a company name that could be their employer OR a client/partner/platform, ASK.
  Example: "Owned end-to-end product delivery for enterprise payment platform integration with Paymentus" → Is Paymentus your employer, or a platform you integrated with at another company?
- If the user describes work but doesn't specify a company or role, and they have multiple roles in their profile, ASK which one it belongs to.
- If the user mentions a title but no company, ASK.
- If dates or timeline are unclear and could overlap with existing entries, ASK.

When ambiguity exists: set "extracted" to {} (empty), set "needs_clarification" to true, and use "reply" to ask your clarifying question. Be specific about what's unclear. Do NOT guess — a wrong placement corrupts the profile.

STEP 2 — EXTRACT: If context is clear, pull every career fact from the user's message into structured JSON. Match new bullets to EXISTING experience entries in the profile by company+title when possible. Only create a new experience entry if the company/role is genuinely new.
STEP 3 — INFER SKILLS: Beyond explicitly mentioned skills, also infer from bullets and context:
  - "Built dashboards in Tableau" → technical_skills: { name: "Tableau" }
  - "Led cross-functional team of 8" → soft_skills: "Cross-functional Leadership", "Team Management"
  - "Managed $2M budget" → soft_skills: "Budget Management"; technical_skills if tools mentioned
  - Split into technical_skills (tools, platforms, languages, frameworks) and soft_skills (interpersonal, leadership, organizational)
  - Deduplicate against skills already in the profile
STEP 4 — REPLY: Write a short reply (2-3 sentences max).

CRITICAL REPLY RULES:
- If "extracted" has ANY data: your reply MUST start by naming what you indexed ("Indexed your PM role at Flipkart", "Added Python and SQL to your skills"). Be specific. Mention WHERE you placed the data (which company/role). NEVER say "didn't catch", "couldn't find", or "not sure what to extract" when extracted is non-empty.
- If "needs_clarification" is true: your reply should ask the clarifying question clearly. Give options when possible ("Is this under your role at Zinnia, or is Paymentus a separate employer?").
- If "extracted" is empty and no clarification needed (greeting, question, off-topic): reply helpfully and suggest what to add next.
- Always end with ONE specific follow-up question about the biggest gap in their profile (unless you're already asking a clarifying question).

BULLET FORMAT: When extracting experience bullets, use { text, metric, impact } format.
- metric = the NUMBER (percentage, dollar amount, count). null if no number.
- impact = the MEANING (what changed for the business). Capture even without a metric.
- Both can coexist. A bullet describing real work should almost always have at least an impact.

GRAMMAR & POLISH:
- If the user's input is rough, informal, or has grammar issues, clean it up into professional resume language BEFORE extracting.
- Example: "i did product roadmap stuff at zinnia and handled api things" → extract as: "Owned product roadmap and led API integration strategy"
- Always use strong action verbs (Owned, Led, Drove, Spearheaded, Architected, Reduced, Delivered).
- If you polish the text significantly, mention what you improved in your reply: "I've polished your bullets into resume-ready language."
- If the input is already well-written, extract as-is — don't over-edit.

WHAT TO ASK ABOUT (priority order):
1. Ambiguous context (which company/role does this belong to?)
2. Missing contact info (phone, location, LinkedIn URL)
3. Thin experience (roles with no bullets, missing dates/location, missing metrics/impact)
4. Missing skills
5. Missing projects or certifications
6. Missing education details
7. Missing languages

URL HANDLING:
- JOB URLs (linkedin.com/jobs/*, indeed.com/*, naukri.com/job-listings/*, or any URL clearly pointing to a job posting): Do NOT process. Reply: "To tailor a resume for a job, switch to the **Tailor Resume** tab and paste the URL there. This tab is just for building your profile."
- PROFILE/PORTFOLIO URLs: Extract them into the appropriate contact field:
  - linkedin.com/in/* → extracted.contact.linkedin (the full URL)
  - github.com/* → extracted.contact.github (the full URL)
  - gitlab.com/* → extracted.contact.github (the full URL)
  - Any other personal website/portfolio URL → extracted.contact.portfolio (the full URL)
  - Reply: "Added your [LinkedIn/GitHub/portfolio] link to your profile."

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
  "needs_clarification": false,
  "reply": "Your response"
}

If nothing was extractable, return "extracted": {}.
If nothing to delete, return "deletions": {}.
If asking a clarifying question, set "needs_clarification": true and "extracted": {}.`,
    config: { model: MODEL, temperature: 0.2 },
  },

  intent_classify: {
    prompt: `You are the intent gate for Arjun, an AI career profile builder. Your job: decide if the user's message is within Arjun's scope, and respond accordingly.

You will receive the user's CURRENT PROFILE as context, and — when the user is discussing a resume that was just tailored for a specific job — a MOST RECENT TAILORED RESUME block with the actual bullets used and WHY each was selected. Use whichever is relevant to answer directly and specifically, not generically.

Arjun's scope:
- Adding/updating career info: experience, skills, education, certifications, projects, contact details, summary, languages, achievements
- Removing/deleting profile data
- Questions about their profile, the system, or career-related advice
- Questions about a just-tailored resume — "why this bullet and not that one", "why is this keyword missing", "why this ATS score" — answer using the MOST RECENT TAILORED RESUME context when it's provided, citing the actual bullet/keyword/score, not a generic explanation
- Responding to a previous clarifying question
- Greetings and acknowledgements

NOT in Arjun's scope:
- General knowledge, trivia, news, opinions
- Coding help, debugging, math, science questions
- Creative writing, jokes, stories, poems
- Weather, sports, entertainment, politics, religion
- Medical, legal, financial advice (non-career)
- Any request unrelated to building a career profile

Return ONLY JSON:
{
  "intent": "add_info|delete|question|greeting|clarify|out_of_scope",
  "in_scope": true/false,
  "reply": "Required if in_scope is false (greeting/out_of_scope). Also required for 'question' intent — answer directly using the profile. null only for add_info/delete/clarify."
}

Rules:
- add_info, delete, clarify: in_scope is true, reply is null — the extraction stage will handle it.
- question: in_scope is true, but reply directly using the profile context (e.g. "You have 3 skills listed: X, Y, Z"). No extraction needed.
- greeting: in_scope is false, reply with a warm welcome and ask what they'd like to add to their profile.
- out_of_scope: in_scope is false, reply politely explaining Arjun only helps with career profiles.
- When in doubt, lean toward in_scope with intent add_info — let the extraction stage handle ambiguity.`,
    config: { model: MODEL, temperature: 0.1 },
  },

  classify_custom_facts: {
    prompt: `A new custom profile category was just approved: {{category_display_name}} ({{category_key}}).
Description: {{category_description}}
Expected fields: {{category_fields}}

Below is a list of raw, uncategorized facts previously extracted from this user's resume (they were dumped here because no matching category existed yet). Find any that belong to this category and structure them.

RULES:
- Only select facts that clearly belong to this category. When unsure, leave it out — do not force a fit.
- For each match, produce a structured item: { text, metric, impact } — same convention as experience bullets. metric = the number if any, impact = the meaning. Both null is fine if the fact has neither.
- Return the ORIGINAL INDEX (0-based, matching the input list order) of each fact you matched, so the caller can remove matched facts from the uncategorized list.

Return ONLY JSON:
{
  "matches": [
    { "index": 0, "item": { "text": "", "metric": null, "impact": null } }
  ]
}

If nothing matches, return { "matches": [] }.`,
    config: { model: MODEL, temperature: 0.1 },
  },

  map_form_fields: {
    prompt: `You map job-application form fields to a candidate's profile data, using MEANING not keyword matching. A field labeled "Legal first name" must match the same profile value as one labeled "Given name" — do not rely on exact string overlap.

TODAY'S DATE: {{today}}

CANDIDATE PROFILE:
{{profile_json}}

For each form field below (label, placeholder, name/id attribute, input type, and — for select/radio/checkbox — the available options), decide:
1. Does this field correspond to something in the profile? If yes, which value should fill it.
2. For select/radio/checkbox fields, pick the OPTION VALUE (exact string from the options list) that best matches the profile data — do not invent an option that isn't listed.
3. How confident are you (0-1). Below 0.6, still return your best guess but the caller will not auto-fill it.

Common field meanings to recognize regardless of exact wording: full/first/last name, email, phone, LinkedIn URL, GitHub/portfolio URL, current company, current title, years of experience, work authorization (career.work_permit) / visa sponsorship status, desired salary, availability/start date, highest education level, school/university, degree, graduation year, cover letter, referral source. Voluntary self-identification (gender, Hispanic/Latino, race/ethnicity, veteran status, disability status) maps to the dedicated self_identification.* fields — ONLY fill these if that exact sub-field is explicitly populated in the profile, otherwise skip; never infer or guess demographic data from a name, photo, or anything else.

Mailing address fields are their own category, distinct from the general "location" field — map each to its specific profile.contact sub-field, not to the general location string: "Address line 1" / "Street address" → contact.address_line1, "Address line 2" / "Unit, suite, etc." → contact.address_line2, "City" → contact.city, "Postal/Zip code" → contact.postal_code, "Country/Region" → contact.country, "Province/State" → contact.state. If a form only has a single generic "Location" or "City" field with no separate address-line/postal-code fields, that one can use contact.location instead.

Education fields need derived values, not just copied ones — use the candidate's most recent/highest education entry unless the form clearly asks about a different one:
- "Education level" (usually a select: High School / Associate's / Bachelor's / Master's / Doctorate, etc.) — derive this from education[].degree text (e.g. "Master of Science" → "Master's", "Bachelor of Technology" → "Bachelor's") and pick the closest matching OPTION from the field's own options list. Don't skip this just because the profile has no field literally called "education level."
- "Major" / "Field of study" — use education[].major. "First major" → the highest/most recent entry's major. "Second major" or "Minor" — only fill if the profile actually lists more than one concurrent field of study for that entry; otherwise skip, don't force the same major into both fields.
- "Are you currently a student?" / "Currently enrolled" — derive from whether the highest education entry's dates extend to or past TODAY'S DATE above (an end date in the future, or text like "Present"/"Current"/"Ongoing") → answer yes/true; a dates range fully in the past → no/false. Pick whichever option text the field actually offers (e.g. "Yes"/"No", "true"/"false").

Account-credential fields ("Password", "New Password", "Confirm/Verify Password", "Verify New Password", "PIN") must NEVER be filled — always skip these regardless of confidence, even if a value superficially resembles one in the profile. There is no password in the candidate's profile and none should ever be invented or reused for this purpose. "Email Address" / "Email" on the same account-creation form still maps normally to contact.email.

Skip (do not include in the output) any field that has no reasonable match in the profile — do not force a fill. Never fabricate a value that isn't in the profile.

FORM FIELDS:
{{form_fields_json}}

Return ONLY JSON:
{
  "mappings": [
    { "field_id": "the id you were given for this field", "value": "the value to fill", "confidence": 0.0-1.0, "profile_path": "e.g. contact.email" }
  ]
}`,
    config: { model: FORM_FILL_MODEL, temperature: 0.1 },
  },

  analyze_resume_format: {
    prompt: `You analyze a resume that a candidate uploaded as a STYLE REFERENCE — not to extract their career facts (that already happens elsewhere), but to describe its visual/structural presentation so a different candidate's resume can be rendered in a similar style.

If a file is attached, actually look at it — real bold/weight, real spacing, real visual hierarchy — rather than guessing from the text alone. If no file is attached, infer as best you can from the text below.

The candidate also gave a target page count: {{target_pages}}.

Look at:
- SECTION ORDER: the order sections actually appear in (e.g. does Skills come before or after Experience? Is a Projects section present and where?)
- HEADING CASE: are section headings ALL CAPS or Title Case?
- DENSITY: are bullets terse one-liners, or longer/more detailed? Is the resume visually dense or spacious?
- BULLET STRUCTURE: do bullets start with a bold functional/skill label followed by a colon or dash before the description (e.g. "Root-Cause Analysis: Investigated...")? Or are they plain sentences with no label?
- ROLE HEADER LAYOUT (for each experience/education entry, look at the first two lines): does the COMPANY/SCHOOL name appear on its own line first (often bold/caps, sometimes with a location), with the job TITLE/DEGREE and dates on the line below it? Or is it a single line like "Title, Company — dates"? Also note whether the company/school name is rendered in ALL CAPS or as normally written.

Only describe what you can actually observe — do not invent structure that isn't there. This analysis runs once and gets reused on every future resume for this candidate, so capture enough concrete detail to be useful without needing to re-look at the file.

RESUME TEXT (fallback if no file attached):
{{template_text}}

Return ONLY JSON:
{
  "section_order": ["summary", "skills", "experience", "projects", "education", "certifications", "activities", "interests"],
  "heading_case": "upper" | "title",
  "density": "concise" | "detailed",
  "bold_label_bullets": true | false,
  "role_header_style": "company_first_two_line" | "title_first_one_line",
  "company_case": "upper" | "as_is",
  "example_bullets": ["1-3 short bullets copied VERBATIM from the resume that best demonstrate its bullet structure/pattern — empty array if bullets are plain sentences with no notable pattern"],
  "notes": "one or two sentences on anything else notable about the presentation — not directly rendered, just useful context"
}

"section_order" should only include sections actually present in the uploaded resume, in the order they appear. Use exactly these keys: summary, skills, experience, projects, education, certifications, activities, interests.`,
    config: { model: MODEL, temperature: 0.1 },
  },

  cover_letter: {
    prompt: `Write a cover letter for this candidate, for this specific job. It draws on two different sources, and they serve different jobs in the letter:

1. TAILORED RESUME — the skills/experience/achievements already selected and reframed as most relevant to this job. This is your source of truth for what to claim professionally. Stay consistent with it rather than re-deriving your own angle on what matters.
2. PERSONAL CONTEXT — interests, activities, and other facts from the candidate's full profile that never made it into the resume (resumes are deliberately trimmed to job-relevant content; a cover letter has room for a little more of the person). Use this ONLY where it adds a genuine, specific, non-generic touch — a real interest that plausibly connects to the company/role, a piece of context that explains motivation. If nothing here is actually relevant, ignore this section entirely rather than forcing it in.

STRICT RULES:
- Only reference facts that appear in one of the two sources below. Never invent accomplishments, numbers, experience, or interests.
- 3-4 short paragraphs: opening (role + why this company specifically, using real detail from the job description — not generic flattery), 1-2 body paragraphs connecting specific resume achievements to what the job asks for, closing (enthusiasm + call to action). Personal context, if used, belongs in the opening or closing — never displaces the resume-grounded body paragraphs.
- Concrete over generic. Reference actual company/role details from the JD, actual metrics/achievements from the resume. Avoid empty phrases like "I am a hard worker" or "I am passionate about this opportunity."
- No greeting/sign-off boilerplate beyond a simple "Dear Hiring Manager," open and "Sincerely, {{candidate_name}}" close — the greeting and sign-off are handled separately by the renderer, just write the body paragraphs.

JOB:
Title: {{job_title}}
Company: {{job_company}}
Description:
{{job_description}}

TAILORED RESUME:
{{tailored_resume_json}}

PERSONAL CONTEXT (use only what's genuinely relevant, ignore the rest):
{{personal_context}}

Return ONLY JSON:
{
  "paragraphs": ["opening paragraph text", "body paragraph text", "closing paragraph text"]
}`,
    config: { model: WRITING_MODEL, temperature: 0.4 },
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

  const missing = result.missing_keywords || [];
  const placed = (result.missing_keyword_context || []).filter(c => c.best_fit_bullet).length;
  if (missing.length) {
    langfuse.score({ traceId: trace.id, name: 'missing-keywords-placed', value: placed, comment: `${placed}/${missing.length} missing keywords have a genuine placement` });
  }
}

function evalTailoring(trace, result) {
  const allBullets = (result.experience || []).flatMap(e => e.bullets || []);
  langfuse.score({ traceId: trace.id, name: 'total-bullets', value: allBullets.length });

  const annotated = allBullets.filter(b => typeof b === 'object' && b.serves);
  langfuse.score({ traceId: trace.id, name: 'bullets-annotated', value: annotated.length, comment: `${annotated.length}/${allBullets.length} bullets have serves annotation` });

  const jdReqs = (result.jd_requirements || []).length;
  langfuse.score({ traceId: trace.id, name: 'jd-requirements-extracted', value: jdReqs });

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
// fileAttachment: optional { filename, base64, mimeType } — sends the raw
// file as multimodal input (Gemini can genuinely see PDF layout/bold/etc.,
// not just inferred text). Only use for one-time analysis calls, not calls
// that run per-job, since re-sending file bytes on every call burns tokens.
async function askJson(system, user, generationName, trace, langfusePrompt, history = [], model = MODEL, fileAttachment = null) {
  const userContent = fileAttachment
    ? [
        { type: 'text', text: user },
        { type: 'file', file: { filename: fileAttachment.filename, file_data: `data:${fileAttachment.mimeType};base64,${fileAttachment.base64}` } },
      ]
    : user;

  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: userContent },
  ];

  const generation = trace.generation({
    name: generationName,
    model,
    input: messages,
    ...(langfusePrompt ? { prompt: langfusePrompt } : {}),
  });

  try {
    const res = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      // Without an explicit cap, OpenRouter defaults to the model's full output ceiling
      // (65536 for Claude Sonnet) and reserves credits against that worst case on every
      // call — including short ones like the cover letter — which can 402 a call that
      // would've easily fit in the actual remaining balance. None of these responses
      // (resume JSON, cover letter, scoring) need anywhere near 65k tokens.
      max_tokens: 8000,
      messages,
      // Gemini's reasoning models burn hidden "thinking" tokens by default (~100x cost
      // on trivial calls) — these are structured extraction/classification tasks, not
      // reasoning tasks, so keep it off. Ignored by providers that don't support it.
      ...(model.startsWith('google/') ? { reasoning: { effort: 'minimal' } } : {}),
    });

    const raw = res.choices[0].message.content;
    // response_format: json_object is an OpenAI-model guarantee — Claude (via OpenRouter)
    // doesn't reliably honor it and sometimes wraps the JSON in a ```json ... ``` fence.
    const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    let parsed;
    try { parsed = JSON.parse(unfenced); }
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

async function recordSchemaSuggestions(trace, suggestions) {
  if (!suggestions?.length) return;
  langfuse.score({ traceId: trace.id, name: 'schema-suggestions', value: suggestions.length, comment: suggestions.map(s => s.category).join(', ') });
  for (const s of suggestions) {
    try {
      await upsertSchemaProposal({
        category: s.category,
        displayName: s.display_name,
        description: s.description,
        exampleFields: s.example_fields,
        sampleData: s.sample_data,
      });
    } catch (e) {
      console.error('⚠ Failed to record schema suggestion:', e.message);
    }
  }
}

// ── PUBLIC FUNCTIONS ────────────────────────────────────────────────────
async function extractFacts(rawText, ctx = {}) {
  const trace = makeTrace('extract_facts', ctx);
  const approvedCategories = await formatApprovedCategories();
  const { text: system, langfusePrompt } = await getPrompt('extract_facts', { profile_schema: PROFILE_SCHEMA, approved_categories: approvedCategories });
  const result = await askJson(system, `Extract facts from:\n\n"""${rawText}"""`, 'extract_facts', trace, langfusePrompt);
  evalExtraction(trace, result);
  const ambiguities = result.ambiguities || [];
  delete result.ambiguities;
  if (ambiguities.length) {
    langfuse.score({ traceId: trace.id, name: 'ambiguities', value: ambiguities.length, comment: ambiguities.map(a => a.field).join(', ') });
  }
  result._ambiguities = ambiguities.length ? ambiguities : undefined;

  const schemaSuggestions = result.schema_suggestions || [];
  delete result.schema_suggestions;
  await recordSchemaSuggestions(trace, schemaSuggestions);

  return result;
}

async function tailorResume(profile, job, trace, resumeFormat) {
  const { text: system, langfusePrompt } = await getPrompt('tailor_resume', {
    target_pages: resumeFormat?.target_pages || 'not specified',
  });

  // Reuses the compact style_profile distilled once at upload time (from a
  // multimodal read of the actual uploaded file, when available) — never the
  // raw document itself, which would burn tokens resending it on every job.
  const sp = resumeFormat?.style_profile;
  const styleBlock = sp
    ? `\n\nSTYLE REFERENCE (distilled from the candidate's own uploaded resume template — match wherever it fits the actual facts; never fabricate detail just to match the pattern; every fact must still trace to CANDIDATE PROFILE above):\n` +
      (sp.notes ? `${sp.notes}\n` : '') +
      (sp.density === 'detailed' ? 'Bullets should be multi-line and detailed, not terse one-liners.\n' : 'Bullets should be terse and concise.\n') +
      (sp.bold_label_bullets && sp.example_bullets?.length
        ? `Bullets use a bold functional/skill label prefix before a colon or dash. Examples from the reference:\n${sp.example_bullets.map(b => `- ${b}`).join('\n')}\nMatch this exact structural pattern in your own bullets.\n`
        : '')
    : '';

  const user =
    `TARGET JOB:\nTitle: ${job.title}\nCompany: ${job.company}\nURL: ${job.url || 'N/A'}\n` +
    `Description:\n${job.jd_text}\n\n` +
    `CANDIDATE PROFILE:\n${JSON.stringify(profile)}${styleBlock}`;

  const result = await askJson(system, user, 'tailor_resume', trace, langfusePrompt, [], WRITING_MODEL);
  evalTailoring(trace, result);
  return result;
}

async function improveResume(resume, job, ats, trace, tailoringNotes = [], jdRequirements = []) {
  const { text: system, langfusePrompt } = await getPrompt('improve_resume');

  const placementLines = (ats.missing_keyword_context || []).map(c =>
    c.best_fit_bullet
      ? `- "${c.keyword}" → fits "${c.best_fit_bullet}" (${c.role || 'role unspecified'}): ${c.reason || ''}`
      : `- "${c.keyword}" → no genuine fit found: ${c.reason || ''}`
  ).join('\n') || '(no placement analysis available — treat all missing keywords as unplaced)';

  const user =
    `CURRENT ATS SCORE: ${ats.score}/100\n` +
    `MISSING KEYWORDS: ${(ats.missing_keywords || []).join(', ')}\n\n` +
    `MISSING KEYWORD PLACEMENT:\n${placementLines}\n\n` +
    `TAILORING NOTES (from original tailoring pass):\n${(tailoringNotes || []).join('\n') || '(none)'}\n\n` +
    `JD REQUIREMENTS (from original tailoring pass):\n${JSON.stringify(jdRequirements || [])}\n\n` +
    `JOB DESCRIPTION:\n${job.jd_text}\n\n` +
    `CURRENT RESUME:\n${JSON.stringify(resume)}`;

  const result = await askJson(system, user, 'improve_resume', trace, langfusePrompt, [], WRITING_MODEL);
  evalImprovement(trace, result, ats.score);
  return result;
}

function buildPersonalContext(profile) {
  if (!profile) return '(none available)';
  const parts = [];
  if (profile.about_me) parts.push(`In the candidate's own words, about themselves: ${profile.about_me}`);
  if (profile.summary) parts.push(`Full profile summary: ${profile.summary}`);
  if (Array.isArray(profile.interests) && profile.interests.length) parts.push(`Interests: ${profile.interests.join(', ')}`);
  if (Array.isArray(profile.activities) && profile.activities.length) parts.push(`Activities: ${profile.activities.join(', ')}`);
  const customFacts = (profile.custom_facts || []).map(f => typeof f === 'string' ? f : f.text).filter(Boolean);
  if (customFacts.length) parts.push(`Other facts: ${customFacts.join('; ')}`);
  return parts.length ? parts.join('\n') : '(none available)';
}

async function coverLetter(resume, job, trace, profile = null) {
  const { text: system, langfusePrompt } = await getPrompt('cover_letter', {
    job_title: job.title || '',
    job_company: job.company || '',
    job_description: job.jd_text || '',
    tailored_resume_json: JSON.stringify(resume),
    candidate_name: resume.contact?.name || '',
    personal_context: buildPersonalContext(profile),
  });

  const result = await askJson(system, 'Write the cover letter.', 'cover_letter', trace, langfusePrompt, [], WRITING_MODEL);
  const paragraphs = (result.paragraphs || []).filter(p => typeof p === 'string' && p.trim().length);
  langfuse.score({ traceId: trace.id, name: 'cover-letter-paragraphs', value: paragraphs.length });
  return paragraphs;
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

// ── INTENT GATE ───────────────────────────────────────────────────────

async function classifyIntent(message, profile, ctx = {}, history = [], jobContext = null) {
  // URL detection is structural — the only thing safe to handle without LLM
  const urlMatch = message.trim().match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    const url = urlMatch[0].replace(/[)>\]]+$/, '');
    if (/linkedin\.com\/jobs\/|indeed\.com\/|naukri\.com\/job-listings/i.test(url)) {
      return { intent: 'url_job', inScope: false, url };
    }
    const profileFields = [
      { pattern: /linkedin\.com\/in\//i, field: 'linkedin' },
      { pattern: /github\.com\//i, field: 'github' },
      { pattern: /gitlab\.com\//i, field: 'github' },
    ];
    for (const { pattern, field } of profileFields) {
      if (pattern.test(url)) {
        return { intent: 'url_profile', inScope: true, url, contactField: field };
      }
    }
    if (/^https?:\/\/[^\s]+$/.test(message.trim())) {
      return { intent: 'url_profile', inScope: true, url, contactField: 'portfolio' };
    }
  }

  // Everything else → LLM intent gate (with profile context + history)
  const trace = makeTrace('intent_classify', ctx);
  const { text: system, langfusePrompt } = await getPrompt('intent_classify');

  const jobContextBlock = jobContext
    ? `\n\nMOST RECENT TAILORED RESUME (for "why this bullet / why not that" style questions about a specific job application — answer using this, not just the general profile):\n` +
      `Job: ${jobContext.title} at ${jobContext.company}\n` +
      `ATS score: ${jobContext.ats_score}/100${jobContext.improved ? ' (after an improvement pass)' : ''}\n` +
      `Matched keywords: ${(jobContext.matched_keywords || []).join(', ') || 'none'}\n` +
      `Missing keywords: ${(jobContext.missing_keywords || []).join(', ') || 'none'}\n` +
      `Tailoring notes: ${(jobContext.tailoring_notes || []).join('; ') || 'none'}\n` +
      `Resume bullets actually used, each with WHY it was selected ("serves" = the JD requirement it addresses):\n` +
      (jobContext.resume_json?.experience || []).map(e =>
        `${e.company}:\n` + (e.bullets || []).map(b => `  - "${b.text}" — serves: ${b.serves || 'general relevance'}`).join('\n')
      ).join('\n')
    : '';

  const userContent = `CURRENT PROFILE:\n${JSON.stringify(profile)}\n\nUSER MESSAGE:\n${message}${jobContextBlock}`;
  const result = await askJson(system, userContent, 'intent_classify', trace, langfusePrompt, history);

  langfuse.score({ traceId: trace.id, name: 'intent', value: result.in_scope ? 1 : 0, comment: result.intent });
  return {
    intent: result.intent,
    inScope: result.in_scope,
    reply: result.reply || null,
    _traceId: trace.id,
  };
}

async function chatEnrich(userMessage, currentProfile, ctx = {}, history = []) {
  const trace = makeTrace('chat_enrich', ctx, { mode: 'profile' });
  const { text: system, langfusePrompt } = await getPrompt('chat_enrich', { profile_schema: PROFILE_SCHEMA.trim() });

  const user = `CURRENT PROFILE:\n${JSON.stringify(currentProfile)}\n\nUSER MESSAGE:\n${userMessage}`;

  const result = await askJson(system, user, 'chat_enrich', trace, langfusePrompt, history);
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
  result._mergeTraceId = trace.id;
  return result;
}

// Backfill: classify a user's existing uncategorized custom_facts against a newly-approved category
async function classifyCustomFacts(customFacts, category, ctx = {}) {
  const trace = makeTrace('classify_custom_facts', ctx, { category: category.category });
  const { text: system, langfusePrompt } = await getPrompt('classify_custom_facts', {
    category_display_name: category.display_name || category.category,
    category_key: category.category,
    category_description: category.description || '',
    category_fields: (category.example_fields || []).join(', ') || 'none specified',
  });

  const indexedFacts = customFacts.map((f, i) => `[${i}] ${typeof f === 'string' ? f : f.text || ''}`).join('\n');
  const user = `RAW FACTS (indexed):\n${indexedFacts}`;

  const result = await askJson(system, user, 'classify_custom_facts', trace, langfusePrompt);
  const matches = result.matches || [];
  langfuse.score({ traceId: trace.id, name: 'facts-reclassified', value: matches.length, comment: `${matches.length}/${customFacts.length} facts matched ${category.category}` });
  return matches;
}

// Browser extension: map scraped job-application form fields to profile values by meaning
async function mapFormFields(fields, profile, ctx = {}) {
  const trace = makeTrace('map_form_fields', ctx, { url: ctx.url });
  const { text: system, langfusePrompt } = await getPrompt('map_form_fields', {
    profile_json: JSON.stringify(profile),
    form_fields_json: JSON.stringify(fields),
    today: new Date().toISOString().slice(0, 10),
  });

  let result;
  let model = FORM_FILL_MODEL;
  let primaryError = null;
  try {
    result = await askJson(system, 'Map the fields.', 'map_form_fields', trace, langfusePrompt, [], FORM_FILL_MODEL);
  } catch (e) {
    primaryError = e.message;
    console.error(`map_form_fields: primary model ${FORM_FILL_MODEL} failed (${e.message}), retrying with ${FORM_FILL_FALLBACK_MODEL}`);
    model = FORM_FILL_FALLBACK_MODEL;
    try {
      result = await askJson(system, 'Map the fields.', 'map_form_fields', trace, langfusePrompt, [], FORM_FILL_FALLBACK_MODEL);
    } catch (e2) {
      // Surface both failures — the admin Extension tab shows this message, and "401 User
      // not found" on both means the OpenRouter key is bad, not the models.
      const err = new Error(`${FORM_FILL_MODEL}: ${primaryError} | ${FORM_FILL_FALLBACK_MODEL}: ${e2.message}`);
      err.model = FORM_FILL_FALLBACK_MODEL;
      throw err;
    }
  }
  const mappings = result.mappings || [];
  langfuse.score({ traceId: trace.id, name: 'fields-mapped', value: mappings.length, comment: `${mappings.length}/${fields.length} fields mapped` });
  return { mappings, model, primaryError };
}

const VALID_SECTIONS = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'activities', 'interests'];

// Analyzes an uploaded resume as a STYLE reference (section order/heading case/density) —
// not fact extraction. Used to render future tailored resumes in a similar presentation.
// fileAttachment: optional { filename, base64, mimeType } — when given (PDF
// uploads), Gemini sees the actual document layout instead of just extracted
// text. One-time call at upload; the resulting styleProfile is what gets
// reused cheaply on every future tailoring call, not the file itself.
async function analyzeResumeFormat(templateText, targetPages, ctx = {}, fileAttachment = null) {
  const trace = makeTrace('analyze_resume_format', ctx);
  const { text: system, langfusePrompt } = await getPrompt('analyze_resume_format', {
    template_text: templateText,
    target_pages: targetPages || 'not specified',
  });

  const result = await askJson(system, 'Analyze the format.', 'analyze_resume_format', trace, langfusePrompt, [], MODEL, fileAttachment);
  const sectionOrder = (result.section_order || []).filter(s => VALID_SECTIONS.includes(s));
  const styleProfile = {
    section_order: sectionOrder.length ? sectionOrder : VALID_SECTIONS,
    heading_case: result.heading_case === 'title' ? 'title' : 'upper',
    density: result.density === 'detailed' ? 'detailed' : 'concise',
    bold_label_bullets: !!result.bold_label_bullets,
    role_header_style: result.role_header_style === 'company_first_two_line' ? 'company_first_two_line' : 'title_first_one_line',
    company_case: result.company_case === 'upper' ? 'upper' : 'as_is',
    example_bullets: Array.isArray(result.example_bullets) ? result.example_bullets.slice(0, 3) : [],
    notes: result.notes || '',
  };
  langfuse.score({ traceId: trace.id, name: 'sections-detected', value: sectionOrder.length });
  return styleProfile;
}

function scoreIngestionCoverage(traceId, drops) {
  if (!traceId || !drops) return;
  const total = drops.totalExtracted || 1;
  const dropped = drops.items.length;
  const landed = total - dropped;
  const coverage = Math.round(100 * landed / total);
  langfuse.score({ traceId, name: 'ingestion-coverage', value: coverage, comment: `${landed}/${total} items landed (${dropped} dropped)` });
  langfuse.score({ traceId, name: 'ingestion-drops', value: dropped });
  if (dropped > 0) {
    const reasons = {};
    for (const d of drops.items) { reasons[d.reason] = (reasons[d.reason] || 0) + 1; }
    langfuse.score({ traceId, name: 'ingestion-drop-reasons', value: dropped, comment: JSON.stringify(reasons) });
  }
}

module.exports = { extractFacts, tailorResume, improveResume, calculateAtsScore, createJobTrace, classifyIntent, chatEnrich, smartMerge, classifyCustomFacts, mapFormFields, analyzeResumeFormat, coverLetter, scoreIngestionCoverage, langfuse, syncPrompts };
