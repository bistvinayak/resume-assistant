Diagnose a production issue with Arjun.

Input: $ARGUMENTS (the error message or symptom)

Steps:
1. Parse the error/symptom from the input
2. Classify: is it a 504 timeout, auth failure, HTML-instead-of-JSON, upload error, or something else?
3. Run targeted diagnostics:
   - For 504: check if the failing endpoint does LLM work synchronously (should be async)
   - For HTML response: test `curl -s -w "\nHTTP %{http_code}" https://vinayakbist.com/api/health`
   - For auth: check firebase config and token flow in api.js
   - For upload: check multer config in server.js, file size limits, accepted extensions
4. Check recent commits: `git log --oneline -5` — did a recent change break something?
5. Check server syntax: `node -e "require('./src/server')"`
6. Report: root cause, affected code, fix suggestion

Architecture reminder:
- CloudFront has ~30s timeout — LLM endpoints MUST be async
- GitHub Actions deploys to EC2 (PM2) on push to main
- Frontend build: `cd resumeai-frontend && npm run build` → `public/`
