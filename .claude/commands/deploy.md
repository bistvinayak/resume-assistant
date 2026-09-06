Build the frontend, commit all changes, and push to deploy to EC2 (via GitHub Actions).

Steps:
1. Run `cd resumeai-frontend && npm run build` — fail if build errors
2. Run `git status` and `git diff --stat` to review changes
3. Stage all changed files with `git add` (list specific files, not -A)
4. Commit with a clear message describing the changes
5. Push to origin main
6. Report: commit hash, files changed, deploy status

If there are no changes to commit, say so and skip.
Never force push. Never skip pre-commit hooks.
