Test the Arjun API endpoints locally.

Steps:
1. Start the server: `node src/server.js &`
2. Wait 3 seconds for startup
3. Test these endpoints:
   - `curl -s http://localhost:3000/health` — should return `{"ok":true}`
   - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/profile` — should return 401 (no auth)
   - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/ingest/status` — should return 401
4. Report results for each endpoint
5. Kill the server: `kill %1`

If the server fails to start, read the error and diagnose.
If any endpoint returns unexpected results, investigate.
