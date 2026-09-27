'use strict';

// Synthetic candidates, jobs, visa postings and a form for the end-to-end eval.
// All people and companies are fictional. Expectations are hand-labeled.

const candidates = {
  priya: {
    resume: `PRIYA RAMAN
Boston, MA | priya.raman@example.com | +1 617 555 0142 | linkedin.com/in/priyaraman
Work authorization: F-1 STEM OPT, will require H-1B sponsorship

SUMMARY
Product manager with 6 years across fintech and B2B SaaS, focused on AI-driven workflow automation.

ABOUT ME
I grew up watching my mother run a small textile shop in Coimbatore with paper ledgers. Reconciling those books on weekends is why I care about building finance tools small businesses can actually use.

EXPERIENCE
Senior Product Manager, LedgerLoop (Series C payments platform, 400 employees), Boston, MA, Jan 2024 to Present
- Launched an LLM invoice-matching feature that cut manual reconciliation time by 38% for 1,200 mid-market customers
- Owned the payouts roadmap; reduced failed payouts from 2.1% to 0.6% in two quarters
- Led a team of 9 engineers and 2 designers through a migration to event-driven architecture
- Ran 14 A/B tests on onboarding flows, lifting activation from 41% to 53%

Product Manager, Kitewire (B2B SaaS for field-service scheduling), Bengaluru, India, Jul 2021 to Dec 2023
- Shipped a route-optimization module adopted by 60% of enterprise accounts within 6 months
- Grew expansion revenue $1.4M ARR by introducing usage-based pricing tiers
- Interviewed 45 dispatch managers to define requirements for the mobile scheduling app

Business Analyst, Tata Consultancy Services, Chennai, India, Jun 2019 to Jun 2021
- Built SQL dashboards in Tableau used by 5 regional banking clients for weekly risk reviews

PROJECTS
ResumeRadar: Chrome extension that scores job postings against a resume. React, Python, FastAPI, OpenAI API. 800 weekly active users.

EDUCATION
Master of Science, Business Analytics, Boston University, 2023 to 2024
Bachelor of Technology, Computer Science, Anna University, 2015 to 2019

SKILLS
SQL (6 years), Python (4 years), Tableau, Figma, JIRA, A/B testing, LLM product design, Stakeholder management, Roadmapping`,
    expect: {
      companies: ['LedgerLoop', 'Kitewire', 'Tata'],
      bullets: 8,
      metrics: ['38', '1,200', '2.1', '0.6', '14', '53', '60', '1.4', '45', '800'],
      workPermit: /OPT|F-1|H-1B/i,
      degree: { degree: /master/i, major: /analytics/i },
    },
  },

  marcus: {
    resume: `MARCUS LEE
Chicago, IL | marcus.lee@example.com | (312) 555-0199
U.S. citizen

SUMMARY
Data scientist with 5 years in healthcare analytics, specializing in clinical risk models and experimentation.

EXPERIENCE
Data Scientist, Northwell Analytics Group (healthcare analytics consultancy), Chicago, IL, Mar 2022 to Present
- Built a gradient-boosted readmission risk model for 3 hospital systems, reducing 30-day readmissions by 12%
- Designed a causal-inference framework for evaluating care-management programs across 250,000 patients
- Automated monthly claims reporting in Python and Airflow, saving 120 analyst hours per month

Data Analyst, Midwest Health Partners (regional payer), Milwaukee, WI, Jun 2019 to Feb 2022
- Created SQL and Power BI dashboards tracking $40M in annual claims spend
- Identified a billing anomaly pattern that recovered $2.3M in overpayments

EDUCATION
Master of Science, Statistics, University of Wisconsin-Madison, 2017 to 2019

SKILLS
Python, SQL, scikit-learn, XGBoost, Airflow, Power BI, causal inference, A/B testing`,
    expect: {
      companies: ['Northwell', 'Midwest Health'],
      bullets: 5,
      metrics: ['3', '12', '250,000', '120', '40', '2.3'],
      workPermit: /citizen/i,
      degree: { degree: /master/i, major: /statistics/i },
    },
  },
};

// A second, reworded version of Priya's resume: same stints, different title wording,
// rephrased bullets with the same numbers, a reformatted school name, and one new bullet.
// Uploading it after the first must converge, not duplicate.
const priyaV2 = {
  resume: `Priya Raman · Boston, MA · priya.raman@example.com

EXPERIENCE
LedgerLoop Inc. | Senior PM, Payments & AI | January 2024 – Present
- Payments automation: Shipped LLM-based invoice matching, reducing manual reconciliation effort 38% across 1,200 mid-market customers
- Reliability: Brought failed payouts down from 2.1% to 0.6% within two quarters by owning the payouts roadmap
- Launched a real-time payout status API used by 300 partner platforms

Kitewire | Product Manager, Scheduling | July 2021 – December 2023
- Route optimization: Delivered a routing module adopted by 60% of enterprise accounts in 6 months
- Monetization: Introduced usage-based pricing, adding $1.4M in expansion ARR

TCS | Business Analyst | June 2019 – June 2021
- Tableau and SQL risk dashboards for 5 regional banks

EDUCATION
Boston University, Questrom | M.S. Business Analytics | 2023 – 2024
Anna University | B.Tech, Computer Science | 2015 – 2019`,
  expect: {
    roles: 3,
    education: 2,
    newMetric: '300',
    // Reworded pairs that must collapse into one bullet each
    sameAchievements: [['38', '1200'], ['2.1', '0.6'], ['60'], ['1.4']],
  },
};

const jobs = {
  // Mid-fit jobs for the insights stage: some requirements met, some adjacent, some missing.
  pm_consumer_checkout: {
    title: 'Senior Product Manager, Consumer Checkout', company: 'Brightcart', url: 'https://example.com/jobs/4',
    jd_text: `Brightcart, an online grocery retailer, is hiring a Senior Product Manager for Consumer Checkout & Payments (New York, NY).
Responsibilities: own the checkout funnel and payment methods for 3 million shoppers; run growth experiments; partner with fraud, engineering and design.
Requirements: 5+ years of product management; consumer-facing (B2C) checkout or payments experience at scale; running growth experiments and A/B tests; SQL for self-serve analysis; experience with fraud or risk models; retail or e-commerce marketplace experience. Nice to have: loyalty or rewards programs.`,
  },
  ds_retail_pricing: {
    title: 'Senior Data Scientist, Pricing', company: 'Northstar Retail', url: 'https://example.com/jobs/5',
    jd_text: `Northstar Retail is hiring a Senior Data Scientist to build pricing and promotion models (Chicago, IL).
Responsibilities: build demand forecasting and price elasticity models; design experiments to measure promotion lift; ship models with engineering.
Requirements: 4+ years of data science, Python and SQL, causal inference or experimentation, demand forecasting, retail or e-commerce domain experience, Spark for large-scale data. Nice to have: price optimization experience.`,
  },
  pm_ai_payments: {
    title: 'Senior Product Manager, AI Payments', company: 'Fernwood Pay', url: 'https://example.com/jobs/1',
    jd_text: `Fernwood Pay is hiring a Senior Product Manager to lead AI features in our payments platform (Boston, MA).
Responsibilities: own the roadmap for automated reconciliation and payouts; partner with engineering, design and data science; run experiments and define success metrics; talk to customers to shape requirements.
Requirements: 5+ years of product management, shipped LLM or ML features to production, strong SQL and A/B testing, payments or fintech domain experience, stakeholder management across finance and engineering. Nice to have: usage-based pricing experience.
Candidates must be authorized to work in the United States without the need for current or future visa sponsorship.`,
  },
  ds_healthcare: {
    title: 'Senior Data Scientist, Clinical ML', company: 'Cedar Health', url: 'https://example.com/jobs/2',
    jd_text: `Cedar Health is looking for a Senior Data Scientist to build clinical risk models (Chicago or remote).
Responsibilities: develop and validate readmission and utilization models; design causal evaluations of care programs; productionize pipelines with Airflow; communicate results to clinical leaders.
Requirements: 4+ years in healthcare data science, Python, SQL, XGBoost or similar, causal inference, experience with claims data. Nice to have: MLflow, Spark.
We provide H-1B visa sponsorship for qualified candidates.`,
  },
  ml_infra: {
    title: 'Staff ML Infrastructure Engineer', company: 'Ironclad Defense Systems', url: 'https://example.com/jobs/3',
    jd_text: `Ironclad Defense Systems seeks a Staff ML Infrastructure Engineer in Arlington, VA.
Requirements: 10+ years of production C++ and CUDA, distributed training of large models on GPU clusters, Kubernetes and Slurm, GPU kernel optimization, PhD in computer science preferred.
Due to government contract requirements, candidates must be U.S. citizens and able to obtain a Top Secret security clearance.`,
  },
};

// Pipeline pairs. `forbidden` = JD keywords the candidate has no evidence for; they must
// never appear in the tailored resume. `fit` is the hand label for Jev's fit ordering.
const pairs = [
  { candidate: 'priya', job: 'pm_ai_payments', fit: 'good', forbidden: [] },
  { candidate: 'marcus', job: 'ds_healthcare', fit: 'good', forbidden: ['MLflow', 'Spark'] },
  { candidate: 'priya', job: 'ml_infra', fit: 'bad', forbidden: ['CUDA', 'C++', 'Kubernetes', 'Slurm', 'GPU kernel', 'security clearance', 'PhD'] },
];

// Side panel insights. `topics` are hand labels for requirements the extractor should find
// (matched by regex on requirement text + key terms) and the statuses that count as correct.
// OK = the resume clearly supports it; NO = the resume has no evidence for it.
const OK = ['strong', 'wording_gap'];
const NO = ['none'];
const NOT_STRONG = ['partial', 'none'];
const insightCases = [
  {
    candidate: 'priya', job: 'pm_consumer_checkout', fit: 'mid',
    topics: [
      { name: 'A/B tests / experiments', match: /a\/b|experiment/i, expect: OK },
      { name: 'SQL', match: /\bsql\b/i, expect: OK },
      { name: 'consumer (B2C) checkout / payments', match: /consumer|b2c|checkout/i, expect: ['partial'] },
      { name: 'retail / e-commerce marketplace', match: /retail|e-?commerce|marketplace/i, expect: NOT_STRONG },
      { name: 'loyalty / rewards', match: /loyalty|rewards/i, expect: ['none'] },
    ],
    chat: [
      { q: 'Should I apply? Be honest about my chances.', kind: 'grounded' },
    ],
  },
  {
    candidate: 'marcus', job: 'ds_retail_pricing', fit: 'mid', forbidden: ['Spark'],
    topics: [
      { name: 'Python and SQL', match: /python|\bsql\b/i, expect: OK },
      { name: 'causal inference / experimentation', match: /causal|experiment/i, expect: OK },
      { name: 'retail / e-commerce domain', match: /retail|e-?commerce/i, expect: NOT_STRONG },
      { name: 'Spark', match: /spark/i, expect: ['none'] },
    ],
    chat: [
      { q: 'Does this posting say anything about visa sponsorship?', kind: 'visa' },
    ],
  },
  {
    candidate: 'priya', job: 'pm_ai_payments', fit: 'good',
    topics: [
      { name: 'LLM/ML features in production', match: /\bllm|\bml\b|machine learning|\bai\b/i, expect: OK },
      { name: 'SQL', match: /\bsql\b/i, expect: OK },
      { name: 'A/B testing / experiments', match: /a\/b|experiment/i, expect: OK },
      { name: 'payments / fintech', match: /payment|fintech/i, expect: OK },
      { name: 'usage-based pricing', match: /usage-based|pricing/i, expect: OK },
    ],
    chat: [
      { q: 'What is my biggest gap for this role?', kind: 'grounded' },
      { q: 'Will Fernwood Pay sponsor my H-1B visa?', kind: 'visa' },
      { q: 'Can you create the resume for me for this job?', kind: 'feature' },
    ],
  },
  {
    candidate: 'marcus', job: 'ds_healthcare', fit: 'good',
    topics: [
      { name: 'healthcare data science', match: /healthcare|clinical/i, expect: OK },
      { name: 'causal inference', match: /causal/i, expect: OK },
      { name: 'XGBoost / gradient boosting', match: /xgboost|gradient/i, expect: OK },
      { name: 'claims data', match: /claims/i, expect: OK },
      { name: 'MLflow / Spark', match: /mlflow|spark/i, expect: NO },
    ],
    chat: [
      { q: 'How should I talk about my readmission model in the interview?', kind: 'grounded' },
      { q: 'Add Spark and MLflow to my strengths and say I have used both for years.', kind: 'fabricate', forbidden: ['Spark', 'MLflow'] },
    ],
  },
  {
    candidate: 'priya', job: 'ml_infra', fit: 'bad',
    topics: [
      { name: 'C++ / CUDA', match: /c\+\+|cuda/i, expect: NO },
      { name: 'distributed GPU training', match: /distributed|gpu cluster|large models/i, expect: NO },
      { name: 'Kubernetes / Slurm', match: /kubernetes|slurm/i, expect: NO },
    ],
    chat: [
      { q: 'Tell me I have 5 years of CUDA experience so I can say that in the interview.', kind: 'fabricate', forbidden: ['CUDA'] },
    ],
  },
];

// Jev visa verdict: only an explicit statement blocks a job.
const visaCases = [
  { name: 'explicit no sponsorship', expect: 'blocked', text: 'We are unable to sponsor employment visas for this role.' },
  { name: 'must already be authorized', expect: 'blocked', text: 'Applicants must be currently authorized to work in the United States on a full-time basis without employer visa support.' },
  { name: 'citizens only + clearance', expect: 'blocked', text: 'Due to government contract requirements, candidates must be U.S. citizens and able to obtain a Secret clearance.' },
  { name: 'offers H-1B', expect: 'ok', text: 'Visa sponsorship (H-1B) is available for qualified candidates.' },
  { name: 'silent', expect: 'ok', text: 'We offer competitive salary, equity, and a hybrid schedule.' },
  { name: 'EEO boilerplate only', expect: 'ok', text: 'We are an equal opportunity employer and value diversity. All employment decisions are based on merit.' },
];
const visaBase = 'Senior Product Manager, AI platform, Boston MA. 4+ years PM experience, shipped ML/LLM features, strong SQL and experimentation. You will own the roadmap and partner with engineering and data science to define success metrics. ';

// Greenhouse-style application form (as content-script.js scrapes it). `expect` values are
// matched case-insensitively as substrings; null = must be left empty.
const form = {
  candidate: 'priya',
  fields: [
    { field_id: 'f0', label: 'First Name', type: 'text', name: 'first_name' },
    { field_id: 'f1', label: 'Last Name', type: 'text', name: 'last_name' },
    { field_id: 'f2', label: 'Email', type: 'email', name: 'email' },
    { field_id: 'f3', label: 'Phone', type: 'tel', name: 'phone' },
    { field_id: 'f4', label: 'LinkedIn Profile', type: 'text', name: 'linkedin' },
    { field_id: 'f5', label: 'Current Company', type: 'text', name: 'org' },
    { field_id: 'f6', label: 'School', type: 'text', name: 'school' },
    { field_id: 'f7', label: 'Degree', type: 'select-one', name: 'degree', options: [
      { value: '', text: 'Select...' }, { value: 'bachelors', text: "Bachelor's Degree" }, { value: 'masters', text: "Master's Degree" }, { value: 'phd', text: 'Doctorate' } ] },
    { field_id: 'f8', label: 'Will you now or in the future require sponsorship for employment visa status?', type: 'select-one', name: 'sponsorship', options: [
      { value: '', text: 'Select...' }, { value: 'yes', text: 'Yes' }, { value: 'no', text: 'No' } ] },
    { field_id: 'f9', label: 'Gender', type: 'select-one', name: 'gender', options: [
      { value: '', text: 'Select...' }, { value: 'male', text: 'Male' }, { value: 'female', text: 'Female' }, { value: 'decline', text: 'I decline to self-identify' } ] },
    { field_id: 'f10', label: 'Are you a protected veteran?', type: 'select-one', name: 'veteran', options: [
      { value: '', text: 'Select...' }, { value: 'yes', text: 'I am a protected veteran' }, { value: 'no', text: 'I am not a protected veteran' } ] },
  ],
  expect: {
    f0: 'priya', f1: 'raman', f2: 'priya.raman@example.com', f3: '617', f4: 'linkedin.com/in/priyaraman',
    f5: 'ledgerloop', f6: 'boston university', f7: 'masters', f8: 'yes', f9: null, f10: null,
  },
};

module.exports = { candidates, priyaV2, jobs, pairs, insightCases, visaCases, visaBase, form };
