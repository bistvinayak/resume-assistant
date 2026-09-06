Check if the latest deployment is live and healthy.

Steps:
1. Run `git log --oneline -1` to get the latest local commit
2. Test production health: `curl -s https://vinayakbist.com/api/health`
3. Test direct EC2 (if accessible): check if the response matches
4. If health check fails, check PM2 logs over SSH: `ssh -i ~/.ssh/arjun-ec2.pem ec2-user@<IP> "pm2 logs arjun --lines 20 --nostream"` (if SSH access available)
5. Report: commit hash, health status, any errors

If production is down, suggest next steps (redeploy via `bash deploy/deploy.sh`, check PM2 status on EC2, etc.)
