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
  "contact": { "name": "", "email": "", "phone": "", "location": "", "linkedin": "", "github": "", "portfolio": "" },
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
      "description": "",
      "tags": [],
      "outcome": "Measurable result or impact of this project"
    }
  ],
  "education": [ { "school": "", "degree": "", "dates": "", "gpa": "", "honors": "" } ],
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
  "activities": [],
  "interests": [],
  "custom_facts": []
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

{{profile_schema}}`,
    config: { model: MODEL, temperature: 0.2 },
  },

  tailor_resume: {
    prompt: `You are selecting and reframing profile content for a targeted resume. You are NOT writing a resume from scratch.

YOUR JOB IS SELECT + REFRAME, NOT REWRITE:
1. SELECT which bullets from the profile are most relevant to this JD
2. REFRAME the wording to use JD keywords where the candidate has equivalent experience
3. The core fact, metric, and impact of each bullet MUST be preserved
4. NEVER invent new bullets, combine two bullets into one, or summarize multiple achievements into a single line
5. NEVER drop a metric ($, %, number) from a bullet — metrics are sacred

CONTENT INTEGRITY RULES:
- Every bullet in the output MUST trace back to a specific bullet in the profile
- You may rephrase "Spearheaded a centralized Content Management Tool" → "Led development of a centralized Content Management Tool" (same fact, JD-aligned wording)
- You may NOT rephrase "Built 4 separate analytics products" → "Owned analytics suite" (lost the detail)
- Sub-point bullets (e.g. "Price Monitor — ...", "Brand Protector — ...") are distinct achievements. Each one is its own bullet. NEVER collapse them.
- If the profile says "$0.5M revenue" the resume must say "$0.5M revenue", not "significant revenue"

WHAT TO INCLUDE:
- ALL experience roles from the profile — never drop a role entirely
- Be GREEDY with bullets — include all JD-relevant bullets. We trim for page fit separately.
- For highly relevant roles: include ALL bullets (up to 8)
- For somewhat relevant roles: include 3-5 bullets, prioritize ones with metrics
- For roles with minimal JD overlap: include 2 bullets minimum
- Bullets with specific metrics that match JD requirements always get priority
- Contact: use exactly what the profile has (name, email, phone, location, links)

SUMMARY: 2-3 sentences. Reuse profile facts. Tune to JD but do not fabricate.

SKILLS: Select from profile skills, reorder with JD-relevant first. Max 15. Group as: Product | Technical & Analytics | AI & Tools

PROJECTS: Copy name and description from profile. If JD relates to the project's domain, expand description with tech stack and outcomes FROM the profile. Do not invent project details.

COMPANY TAGLINE: Copy verbatim from the profile's company_description field.

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
    "Short sentence explaining a key tailoring decision"
  ]
}
tailoring_notes: 4-6 sentences. For each note: which profile bullet you reframed, what JD keyword you targeted, and what you changed. Be specific.`,
    config: { model: MODEL, temperature: 0.1 },
  },

  fit_resume: {
    prompt: `You are adjusting a tailored resume to fit a target page count. You will receive:
- The current tailored resume JSON
- A directive: either TIGHTEN (fit to 1 page) or EXPAND (fill 2 full pages)
- The candidate's full profile (for EXPAND — to pull additional relevant bullets)
- The job description (for relevance context)

TIGHTEN (target: 1 page):
- Remove the lowest JD-relevance bullets first
- Shorten project descriptions to 1 line each
- Compress older/less-relevant roles to 1-2 bullets
- Shorten the summary if possible
- Do NOT remove entire roles — keep at least 1 bullet per role
- Do NOT remove bullets with strong metrics that match JD requirements

EXPAND (target: full 2 pages):
- Pull additional relevant bullets from the candidate profile that match JD requirements
- Expand project descriptions with tech stack, architecture decisions, and measurable outcomes
- Add more sub-point details (e.g. individual product names under a suite)
- Flesh out older roles with relevant bullets from the profile
- Expand the summary to 3-4 sentences if it adds JD-relevant context
- Do NOT invent new facts — only use data from the provided profile

Return ONLY JSON with the same resume structure (contact, summary, skills_*, experience, projects, education, certifications, activities, interests). No tailoring_notes needed.`,
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

9. PROJECTS: Match by name (fuzzy). Merge descriptions, keep richer outcome. Preserve project URLs.

10. EDUCATION: Match by school+degree. Include secondary education (12th, 10th) if present. Keep entry with GPA/honors.

11. LANGUAGES: Union by name, keep richer proficiency and read/write/speak flags.

12. CERTIFICATIONS: Union by name, deduplicate. Keep issuer, date, validity from whichever source has them.

13. CAREER: Merge per field, prefer NEW data. Keep notice_period, preferred_locations, work_permit, total_experience, etc.

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

You will receive the user's CURRENT PROFILE as context. Use it to answer profile questions directly and give informed responses.

Arjun's scope:
- Adding/updating career info: experience, skills, education, certifications, projects, contact details, summary, languages, achievements
- Removing/deleting profile data
- Questions about their profile, the system, or career-related advice
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
async function askJson(system, user, generationName, trace, langfusePrompt, history = []) {
  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: user },
  ];

  const generation = trace.generation({
    name: generationName,
    model: MODEL,
    input: messages,
    ...(langfusePrompt ? { prompt: langfusePrompt } : {}),
  });

  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages,
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
  const ambiguities = result.ambiguities || [];
  delete result.ambiguities;
  if (ambiguities.length) {
    langfuse.score({ traceId: trace.id, name: 'ambiguities', value: ambiguities.length, comment: ambiguities.map(a => a.field).join(', ') });
  }
  result._ambiguities = ambiguities.length ? ambiguities : undefined;
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

async function fitResume(resume, directive, profile, job, trace) {
  const { text: system, langfusePrompt } = await getPrompt('fit_resume');

  const user =
    `DIRECTIVE: ${directive}\n\n` +
    `JOB DESCRIPTION:\nTitle: ${job.title}\nCompany: ${job.company}\n${job.jd_text}\n\n` +
    `CURRENT TAILORED RESUME:\n${JSON.stringify(resume)}\n\n` +
    (directive === 'EXPAND' ? `CANDIDATE FULL PROFILE (pull additional bullets from here):\n${JSON.stringify(profile)}` : '');

  return await askJson(system, user, 'fit_resume', trace, langfusePrompt);
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

// ── INTENT GATE ───────────────────────────────────────────────────────

async function classifyIntent(message, profile, ctx = {}, history = []) {
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

  const userContent = `CURRENT PROFILE:\n${JSON.stringify(profile)}\n\nUSER MESSAGE:\n${message}`;
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

module.exports = { extractFacts, tailorResume, fitResume, improveResume, calculateAtsScore, createJobTrace, classifyIntent, chatEnrich, smartMerge, scoreIngestionCoverage, langfuse, syncPrompts };
