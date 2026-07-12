# ResumeAI — Deployment Strategy

## Architecture

```
vinayakbist.com (EC2 + Nginx)
    └── /projects/resumeai → proxy → Railway backend
                                        ├── Express API (Node.js)
                                        ├── React frontend (served as static)
                                        └── PostgreSQL (Railway managed)
```

---

## Step 1 — Local Setup & Test

### Backend
```bash
cd ~/Downloads/resume-assistant
# Copy new files
cp backend-v3/src/* src/
cp backend-v3/.env .env
cp backend-v3/package.json .
npm install
node src/server.js
```

### Frontend
```bash
cd ~/Downloads/resumeai-frontend
npm install
npm run dev
# Opens at http://localhost:5173
```

Test locally:
- Visit http://localhost:5173
- Sign in with Google
- Complete onboarding
- Submit a LinkedIn job URL
- Check Gmail for tailored resume

---

## Step 2 — Build Frontend into Backend

Once local testing passes:

```bash
cd ~/Downloads/resumeai-frontend

# Build React into backend's public folder
npm run build
# This outputs to ~/Downloads/resume-assistant/public/

# Verify
ls ~/Downloads/resume-assistant/public/
# Should see: index.html, assets/
```

---

## Step 3 — Deploy to Railway

### Add new environment variables
```bash
cd ~/Downloads/resume-assistant

railway variables set \
  FIREBASE_PROJECT_ID="resume-assist-f8361" \
  FIREBASE_CLIENT_EMAIL="firebase-adminsdk-fbsvc@resume-assist-f8361.iam.gserviceaccount.com" \
  FRONTEND_URL="https://vinayakbist.com" \
  CORS_ORIGIN="https://vinayakbist.com"

# Firebase private key (multiline — set via Railway dashboard)
# Go to Railway → resume-assistant-app → Variables → Add
# Key: FIREBASE_PRIVATE_KEY
# Value: paste the entire private key including -----BEGIN/END PRIVATE KEY-----
```

### Push to GitHub (triggers auto-deploy)
```bash
cd ~/Downloads/resume-assistant
git add -A
git commit -m "v3: Firebase auth + multi-tenancy + frontend"
git push
```

Railway auto-deploys on push. Monitor:
```bash
railway logs --tail 30
```

---

## Step 4 — Configure Firebase

1. Go to Firebase Console → resume-assist-f8361
2. Authentication → Settings → Authorized domains
3. Add: `resume-assistant-app-production.up.railway.app`
4. Add: `vinayakbist.com`

---

## Step 5 — Configure Nginx on EC2

SSH into your EC2:
```bash
ssh -i chanakya-key.pem ubuntu@<your-ec2-ip>
```

Edit Nginx config:
```bash
sudo nano /etc/nginx/sites-available/default
```

Add inside your server block:
```nginx
location /projects/resumeai {
    proxy_pass https://resume-assistant-app-production.up.railway.app;
    proxy_set_header Host resume-assistant-app-production.up.railway.app;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_ssl_server_name on;
}
```

Test and reload:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 6 — Update Frontend API URL

In Railway → resume-assistant-app → Variables:
```
VITE_API_URL=https://resume-assistant-app-production.up.railway.app
```

Or set it before building:
```bash
cd ~/Downloads/resumeai-frontend
echo "VITE_API_URL=https://resume-assistant-app-production.up.railway.app" > .env
npm run build
```

---

## Verification Checklist

- [ ] http://localhost:5173 — local frontend loads
- [ ] Google sign-in works locally
- [ ] Onboarding saves to profile
- [ ] Submit URL processes a job
- [ ] Email arrives with ATS score
- [ ] https://resume-assistant-app-production.up.railway.app/health → {"ok":true}
- [ ] https://vinayakbist.com/projects/resumeai → loads ResumeAI

---

## Environment Variables Summary

| Variable | Where set | Value |
|---|---|---|
| FIREBASE_PRIVATE_KEY | Railway (multiline) | from service account JSON |
| FIREBASE_PROJECT_ID | Railway | resume-assist-f8361 |
| FIREBASE_CLIENT_EMAIL | Railway | firebase-adminsdk-fbsvc@... |
| FRONTEND_URL | Railway | https://vinayakbist.com |
| DATABASE_URL | Railway (already set) | postgresql://... |
| All others | Railway (already set) | unchanged |
