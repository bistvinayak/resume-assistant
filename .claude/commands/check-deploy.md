Check if the latest deployment is live and healthy.

Steps:
1. Run `git log --oneline -1` to get the latest local commit
2. Test production health: `curl -s https://vinayakbist.com/api/health`
3. Test direct Railway (if accessible): check if the response matches
4. If health check fails, check Railway logs: `railway logs --tail 20` (if CLI available)
5. Report: commit hash, health status, any errors

If production is down, suggest next steps (redeploy, check Railway dashboard, etc.)
