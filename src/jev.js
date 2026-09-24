// Job-fit + visa-sponsorship check via TypeSafe's Jev (System One model).
// Jev returns typed answers (score / choice / noul) with calibrated confidence
// instead of free text, so there is no JSON to parse or hallucinated fields to guard.
// Docs: https://docs.typesafe.ai/api

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = process.env.TYPESAFE_MODEL || 'jev-latest';
const MAX_JOB_CHARS = 15000;

// Only what matters for fit — no email/phone/address/self-identification leaves the server.
function compactProfile(p) {
  return {
    location: p.contact?.location || '',
    summary: p.summary || '',
    career: p.career || {},
    experience: (p.experience || []).map(e => ({
      title: e.title,
      company: e.company,
      company_description: e.company_description,
      dates: e.dates,
      highlights: (e.bullets || []).slice(0, 5).map(b => (typeof b === 'string' ? b : b.text)),
    })),
    projects: (p.projects || []).map(pr => ({ name: pr.name, description: pr.description, tech_stack: pr.tech_stack })),
    skills: p.skills || [],
    education: (p.education || []).map(ed => ({ school: ed.school, degree: ed.degree, major: ed.major, dates: ed.dates })),
    certifications: (p.certifications || []).map(c => c.name),
  };
}

const QUESTIONS = {
  overall_fit: {
    type: 'score',
    instructions: 'How well do `candidate`\'s qualifications fit the role described in `job_posting`, considering skills, experience level, domain and required qualifications? Ignore work authorization, visa sponsorship and citizenship entirely — those are assessed separately.',
    criteria: [
      'Not a fit — misses most core requirements',
      'Weak fit — meets a few requirements, major gaps',
      'Partial fit — meets about half the core requirements',
      'Good fit — meets most core requirements, minor gaps',
      'Excellent fit — meets or exceeds nearly all requirements',
    ],
  },
  skills_match: {
    type: 'score',
    instructions: 'How many of the required and preferred skills/tools in `job_posting` does `candidate` demonstrably have?',
    criteria: ['Few or none', 'Some', 'Most', 'Nearly all'],
  },
  domain_match: {
    type: 'score',
    instructions: "How relevant is `candidate`'s industry and domain experience to the domain of `job_posting`?",
    criteria: ['Unrelated domain', 'Adjacent or transferable domain', 'Same domain'],
  },
  seniority: {
    type: 'choice',
    instructions: "Compare `candidate`'s years and level of experience to what `job_posting` asks for.",
    criteria: {
      under_qualified: 'Candidate has noticeably less experience or a lower level than required',
      good_match: 'Candidate experience level matches the requirement',
      over_qualified: 'Candidate is clearly more senior than the role',
    },
  },
  sponsorship: {
    type: 'choice',
    instructions: 'What does `job_posting` explicitly state about employer visa sponsorship or work authorization? Only count statements written in the posting; do not infer from company, location or role type.',
    criteria: {
      sponsors: 'Posting explicitly says the employer offers or will consider visa sponsorship',
      no_sponsorship: 'Posting explicitly says sponsorship is not available, or that applicants must already hold a visa / work authorization without needing sponsorship now or in the future',
      not_mentioned: 'Posting says nothing explicit about visa sponsorship or work authorization',
    },
  },
  citizenship_or_clearance_required: {
    type: 'noul',
    instructions: 'Does `job_posting` explicitly require citizenship, permanent residency (green card), or a government security clearance?',
    criteria: {
      true: 'Posting explicitly requires being a citizen, a green-card holder, or holding/obtaining a security clearance',
      false: 'No such requirement. A general "must be authorized to work without sponsorship" statement alone does NOT count',
    },
  },
};

async function callJev(body, attempt = 0) {
  const res = await fetch(JEV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  // 429 rate limit / 529 overloaded — docs recommend exponential backoff
  if ((res.status === 429 || res.status === 529) && attempt < 2) {
    await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    return callJev(body, attempt + 1);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`jev_error_${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

// Only an explicit statement in the posting blocks a job; silence means OK to apply.
function visaVerdict(a) {
  if (a.citizenship_or_clearance_required.noul >= 0.5) {
    return { status: 'blocked', reason: 'Requires citizenship, green card or clearance', confidence: a.citizenship_or_clearance_required.noul };
  }
  if (a.sponsorship.choice === 'no_sponsorship') {
    return { status: 'blocked', reason: 'Says no visa sponsorship', confidence: a.sponsorship.confidence };
  }
  return {
    status: 'ok',
    reason: a.sponsorship.choice === 'sponsors' ? 'Offers visa sponsorship' : 'No visa restriction mentioned',
    confidence: a.sponsorship.confidence,
  };
}

async function assessJobFit(profile, job) {
  if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY not set');

  const state = {
    candidate: compactProfile(profile),
    job_posting: {
      title: job.title || '',
      company: job.company || '',
      url: job.url || '',
      description: String(job.text || '').slice(0, MAX_JOB_CHARS),
    },
  };

  const t0 = Date.now();
  const data = await callJev({ state, model: JEV_MODEL, questions: QUESTIONS });
  const a = data.answers;

  return {
    model: data.model,
    durationMs: Date.now() - t0,
    // score answers are probability-weighted level indices; normalize to 0–100 for the UI
    overallFit: {
      percent: Math.round((a.overall_fit.score / (QUESTIONS.overall_fit.criteria.length - 1)) * 100),
      label: a.overall_fit.legend[String(Math.round(a.overall_fit.score))],
      confidence: a.overall_fit.confidence,
    },
    skills: {
      percent: Math.round((a.skills_match.score / (QUESTIONS.skills_match.criteria.length - 1)) * 100),
      label: a.skills_match.legend[String(Math.round(a.skills_match.score))],
      confidence: a.skills_match.confidence,
    },
    domain: {
      percent: Math.round((a.domain_match.score / (QUESTIONS.domain_match.criteria.length - 1)) * 100),
      label: a.domain_match.legend[String(Math.round(a.domain_match.score))],
      confidence: a.domain_match.confidence,
    },
    seniority: { value: a.seniority.choice, confidence: a.seniority.confidence },
    sponsorship: {
      value: a.sponsorship.choice,
      probabilities: a.sponsorship.probabilities,
      confidence: a.sponsorship.confidence,
    },
    citizenshipRequired: a.citizenship_or_clearance_required.noul,
    visa: visaVerdict(a),
    usage: data.usage,
  };
}

module.exports = { assessJobFit, compactProfile };
