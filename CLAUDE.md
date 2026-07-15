# Arjun — AI Resume Assistant

## Architecture

```
User → CloudFront (vinayakbist.com)
         ├── /projects/arjun*  → Railway (Express + React SPA)
         ├── /api/*            → Railway
         └── default           → S3 (personal site)

Railway runs: Express server (port 3000) serving:
  - Static React build from /public
  - SPA catch-all for client-side routes
  - REST API under /api/*
  - Cron job every 2 hours (Gmail job alerts)
```

## Stack
- **Frontend:** React 18 + Vite, single-page app, inline styles (no CSS framework)
- **Backend:** Express.js, Node 18+
- **Database:** PostgreSQL on Railway
- **Auth:** Firebase Auth (Google OAuth), JWT verification via firebase-admin
- **LLM:** OpenRouter API (gpt-4o-mini default), JSON mode
- **Observability:** Langfuse (traces, sessions, evaluations, prompts, user feedback)
- **Email:** Nodemailer (SMTP via Gmail) for resume delivery
- **Deployment:** Railway (auto-deploy on push to main), CloudFront CDN

## File Map

### Backend (`src/`)
| File | Purpose |
|------|---------|
| `server.js` | Express app, all routes, CORS, auth middleware, SPA catch-all |
| `auth.js` | Firebase JWT verification, sets req.userId/userEmail/userName |
| `llm.js` | All LLM calls, Langfuse traces/evaluations, prompt definitions & sync |
| `pipeline.js` | Job processing: tailor → ATS score → improve → render → deliver |
| `profile.js` | Profile merge/upsert logic, PDF/text ingestion, deletion |
| `db.js` | PostgreSQL pool, schema init, profile/job CRUD |
| `cron.js` | node-cron: fetches Gmail job alerts every 2hrs, runs pipeline |
| `gmail.js` | Gmail API: fetch LinkedIn job alert emails |
| `gmail-connect.js` | OAuth2 flow for Gmail connection |
| `scraper.js` | Scrapes job descriptions from LinkedIn/job URLs |
| `renderDocx.js` | Generates .docx resume from tailored JSON |
| `renderPdf.js` | Generates .pdf resume from tailored JSON |
| `mailer.js` | Sends resume emails via SMTP |
| `admin.js` | Admin endpoints: stats, user management, settings |

### Frontend (`resumeai-frontend/src/`)
| File | Purpose |
|------|---------|
| `App.jsx` | Router: Landing → Onboarding → Dashboard, auth guard |
| `api.js` | All fetch calls to backend, session ID generation, checkedFetch (401 handling) |
| `firebase.js` | Firebase config, Google auth provider |
| `pages/Landing.jsx` | Marketing page with Google sign-in |
| `pages/Onboarding.jsx` | 2-step: PDF/text upload → Gmail connect |
| `pages/Dashboard.jsx` | Main app: 5 tabs (Profile, Build Profile, Tailor Resume, Jobs, Gaps) |
| `pages/Admin.jsx` | Admin dashboard (stats, users, jobs, settings) |
| `pages/GmailOAuthCallback.jsx` | Handles Gmail OAuth redirect |

### Build Output (`public/`)
- Vite builds `resumeai-frontend/` → `public/` (served by Express)
- `public/index.html` — SPA entry point
- `public/assets/` — JS/CSS bundles (hashed filenames)

## Key Flows

### Profile Ingestion (Smart Merge Pipeline)
```
PDF/text → extractFacts (LLM) → is profile empty?
  ├── YES (1st time) → programmatic mergeProfile → saveProfile
  └── NO  (2nd+ time) → smartMerge (LLM) → saveProfile
                         ↳ fallback: programmatic mergeProfile
```
- Bullets are structured: `{ text, metric, impact }` — metrics and business impact extracted per bullet
- Smart merge: LLM matches experience entries by company+title (fuzzy), keeps richer bullets, deduplicates skills semantically, preserves all metrics
- Programmatic merge (fallback + chat confirm): upserts by key, merges bullets by text match, unions skills case-insensitively

### Resume Tailoring (job URL submitted)
`scrapeJob → tailorResume (LLM) → atsScore (LLM) → [if <95: improveResume → atsScore] → renderDocx → save → email (if cron)`

### Chat (Build Profile tab)
`userMessage → chatEnrich (LLM) → { extracted, deletions, reply } → frontend shows proposed changes → user confirms → mergeProfile/applyDeletions`

## LLM Prompts (Langfuse Prompt Management)
All defined in `src/llm.js` PROMPT_DEFS, synced to Langfuse on startup:
- `extract_facts` — parse resume/text into structured profile (with metrics, impact, company context)
- `smart_merge` — LLM-powered intelligent merge of existing + new profile data
- `tailor_resume` — rewrite profile into job-tailored resume
- `improve_resume` — rephrase bullets using missing JD keywords
- `ats_score` — score resume vs job description
- `chat_enrich` — conversational profile building

## Langfuse Observability
- **Traces:** every LLM call creates a trace with userId, sessionId, userEmail
- **Sessions:** frontend generates session ID per page load (X-Session-Id header)
- **Evaluations:** auto-scored on every call (extraction-fields, ats-score, skills-extracted, metric-coverage, merge-metrics-preserved, etc.)
- **Feedback:** thumbs up/down on both chat interfaces → Langfuse scores
- **Prompts:** fetched from Langfuse at runtime (production label), fallback to hardcoded

## API Endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/profile | JWT | Get user profile |
| PUT | /api/profile | JWT | Update profile directly |
| POST | /api/ingest/text | JWT | Ingest text into profile |
| POST | /api/ingest/pdf | JWT | Ingest PDF into profile |
| POST | /api/chat | JWT | Chat with Arjun (profile or tailor mode) |
| POST | /api/chat/confirm | JWT | Confirm proposed changes/deletions |
| POST | /api/feedback | JWT | Send thumbs up/down to Langfuse |
| GET | /api/jobs | JWT | List all jobs for user |
| POST | /api/jobs/submit-url | JWT | Submit a job URL for processing |
| GET | /api/jobs/:id/download | JWT | Download tailored resume (.docx/.pdf) |
| POST | /api/gmail/connect | JWT | Start Gmail OAuth |
| POST | /api/gmail/verify | JWT | Verify Gmail filter |
| GET | /api/admin/* | JWT+admin | Admin endpoints |
| GET | /health | none | Health check |

## Database Schema (PostgreSQL)
- `profiles` — user_id (PK), profile_json, created_at, updated_at
- `seen_jobs` — job_id, user_id, seen_at (dedup)
- `tailored_resumes` — id, job_id, user_id, resume_json, file_path, status, ats_score, metadata
- `settings` — key-value store for admin settings

## Deployment
- Push to `main` → Railway auto-deploys backend + serves frontend
- Frontend build: `cd resumeai-frontend && npm run build` (outputs to `../public/`)
- CloudFront cache: invalidate after deploy if needed
- Personal site (S3): separate from Arjun, served via CloudFront default behavior

## Conventions
- No CSS framework — all inline styles with design tokens (DM Serif Display, DM Sans, DM Mono; amber #f59e0b accent)
- No chat message persistence in PostgreSQL (security constraint)
- All LLM calls use JSON mode (response_format: json_object)
- Profile merge is additive (upsert by key), deletions are explicit
- Frontend session ID: `s_{timestamp}_{random}` generated once per page load
