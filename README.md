# resume-assistant

Personal backend that keeps a **master profile** of everything about you,
tailors a resume per job via **OpenRouter**, renders it to **.docx**, and
**emails** it. Deploys on **Railway**.

## What it does

- Ingest facts about yourself (a typed message or a resume PDF) → merged into one master profile in Postgres.
- Process a job (title + company + JD) → tailor a resume from the profile → render `.docx` → email it.
- Dedupes jobs by LinkedIn job id so the same posting is never processed twice.

## Backend stack

Node.js + Express · OpenRouter (via `openai` SDK) · PostgreSQL (`pg`) · `docx` ·
`pdf-parse` + `multer` · `nodemailer` · `node-cron`.

## Integrations you must set up

| Integration | What to get | Env vars |
|---|---|---|
| OpenRouter | API key | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| Postgres | Railway Postgres plugin | `DATABASE_URL`, `PGSSL=true` |
| Email (SMTP) | Gmail App Password | `SMTP_*`, `TO_EMAIL`, `FROM_EMAIL` |
| API auth | any long random string | `API_KEY` |

Not part of this service (they live in your existing WhatsApp/Puppeteer repo):
reading LinkedIn alert emails and sending/receiving WhatsApp. Those call the
HTTP endpoints below.

## Run locally

```bash
npm install
cp .env.example .env        # fill in values
npm run init-db             # create tables
npm start                   # server on :3000
```

## Deploy to Railway

1. Push this repo to GitHub, create a Railway project from it.
2. Add the **Postgres** plugin — `DATABASE_URL` is injected automatically.
3. Add the other env vars (`OPENROUTER_API_KEY`, `SMTP_*`, `API_KEY`, `PGSSL=true`).
4. Railway builds with Nixpacks and runs `node src/server.js` (see `railway.toml`).
5. Run the schema once: in the Railway shell, `npm run init-db`.

## API

All routes except `/health` require header `x-api-key: <API_KEY>`.

```bash
# Ingest a typed fact
curl -X POST $URL/ingest/text -H "x-api-key: $KEY" \
  -H 'content-type: application/json' \
  -d '{"text":"I now know Kubernetes and led a migration to AWS EKS"}'

# Ingest a resume PDF
curl -X POST $URL/ingest/pdf -H "x-api-key: $KEY" -F file=@resume.pdf

# View the master profile
curl $URL/profile -H "x-api-key: $KEY"

# Process one job (tailor -> docx -> email)
curl -X POST $URL/jobs/process -H "x-api-key: $KEY" \
  -H 'content-type: application/json' \
  -d '{"job_id":"ln-402199","title":"Senior PM","company":"Acme","jd_text":"..."}'
```

## Wiring your WhatsApp layer

- User texts a fact  → your handler calls `POST /ingest/text`.
- User sends a PDF   → download it, call `POST /ingest/pdf`.
- New job to tailor  → call `POST /jobs/process`; on success, WhatsApp-notify yourself.

## The delayed batch

`src/cron.js` is a scaffold for the 2-3 hr Gmail-triggered batch. Plug your
email reader into `runBatch()` and call `startCron()` from `server.js`. Because
`processJob()` dedupes by job id, running it hourly is safe.
