import { auth } from './firebase';

const BASE = import.meta.env.VITE_API_URL || '/api';
const SESSION_ID = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function waitForAuth() {
  return new Promise((resolve) => {
    const user = auth.currentUser;
    if (user) return resolve(user);
    const unsub = auth.onAuthStateChanged((u) => {
      unsub();
      resolve(u);
    });
  });
}

async function getHeaders() {
  const user = await waitForAuth();
  if (!user) throw new Error('Not authenticated');
  const token = await user.getIdToken().catch(() => null);
  if (!token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Session-Id': SESSION_ID,
  };
}

async function checkedFetch(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    await auth.signOut();
    window.location.href = '/';
    throw new Error('Session expired');
  }
  return res;
}

export const api = {
  async getProfile() {
    const res = await checkedFetch(`${BASE}/profile`, { headers: await getHeaders() });
    return res.json();
  },

  async updateProfile(profile) {
    const res = await checkedFetch(`${BASE}/profile`, {
      method: 'PUT',
      headers: await getHeaders(),
      body: JSON.stringify({ profile }),
    });
    return res.json();
  },

  async ingestText(text) {
    const res = await checkedFetch(`${BASE}/ingest/text`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ text }),
    });
    return res.json();
  },

  async ingestPdf(file) {
    const user = await waitForAuth();
    const token = await user.getIdToken(true);
    const form = new FormData();
    form.append('file', file);
    const res = await checkedFetch(`${BASE}/ingest/pdf`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'X-Session-Id': SESSION_ID },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  async ingestFiles(files) {
    const user = await waitForAuth();
    const token = await user.getIdToken(true);
    const form = new FormData();
    for (const file of files) {
      form.append('files', file);
    }
    const url = `${BASE}/ingest/files`;
    const res = await checkedFetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'X-Session-Id': SESSION_ID },
      body: form,
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      await res.text();
      throw new Error(`Server returned HTML instead of JSON (status ${res.status}, url: ${url}). This usually means the request didn't reach the API.`);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  async getIngestionStatus() {
    const res = await checkedFetch(`${BASE}/ingest/status`, { headers: await getHeaders() });
    return res.json();
  },

  async getProfileVersions() {
    const res = await checkedFetch(`${BASE}/profile/versions`, { headers: await getHeaders() });
    return res.json();
  },

  async restoreProfileVersion(version) {
    const res = await checkedFetch(`${BASE}/profile/restore`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ version }),
    });
    return res.json();
  },

  async submitJobUrl(url) {
    const res = await checkedFetch(`${BASE}/jobs/submit-url`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ url }),
    });
    return res.json();
  },

  async getJobs() {
    const res = await checkedFetch(`${BASE}/jobs`, { headers: await getHeaders() });
    return res.json();
  },

  async runBatch() {
    const res = await checkedFetch(`${BASE}/jobs/run-batch`, {
      method: 'POST',
      headers: await getHeaders(),
    });
    return res.json();
  },

  async addKeywordToProfile(keyword) {
    return this.ingestText(`I have experience with ${keyword}`);
  },

  async chat(message, mode = 'profile') {
    const res = await checkedFetch(`${BASE}/chat`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ message, mode }),
    });
    return res.json();
  },

  async connectGmail(code) {
    const res = await checkedFetch(`${BASE}/gmail/connect`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ code }),
    });
    return res.json();
  },

  async verifyGmailFilter() {
    const res = await checkedFetch(`${BASE}/gmail/verify`, {
      method: 'POST',
      headers: await getHeaders(),
    });
    return res.json();
  },

  async confirmChanges(changes, deletions) {
    const res = await checkedFetch(`${BASE}/chat/confirm`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ changes, deletions }),
    });
    return res.json();
  },

  async downloadResume(jobId, format = 'docx') {
    const user = await waitForAuth();
    const token = await user.getIdToken(true);
    const res = await checkedFetch(`${BASE}/jobs/${jobId}/download?format=${format}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-Session-Id': SESSION_ID },
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const fallback = format === 'pdf' ? 'resume.pdf' : 'resume.docx';
    const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || fallback;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  async adminGetStats() {
    const res = await checkedFetch(`${BASE}/admin/stats`, { headers: await getHeaders() });
    return res.json();
  },
  async adminGetUsers() {
    const res = await checkedFetch(`${BASE}/admin/users`, { headers: await getHeaders() });
    return res.json();
  },
  async adminUpdateUser(userId, data) {
    const res = await checkedFetch(`${BASE}/admin/users/${userId}`, { method: 'PATCH', headers: await getHeaders(), body: JSON.stringify(data) });
    return res.json();
  },
  async adminDeleteUser(userId) {
    const res = await checkedFetch(`${BASE}/admin/users/${userId}`, { method: 'DELETE', headers: await getHeaders() });
    return res.json();
  },
  async adminGetJobs() {
    const res = await checkedFetch(`${BASE}/admin/jobs`, { headers: await getHeaders() });
    return res.json();
  },
  async adminTriggerCron() {
    const res = await checkedFetch(`${BASE}/admin/cron/run`, { method: 'POST', headers: await getHeaders() });
    return res.json();
  },
  async adminGetSettings() {
    const res = await checkedFetch(`${BASE}/admin/settings`, { headers: await getHeaders() });
    return res.json();
  },
  async adminUpdateSettings(settings) {
    const res = await checkedFetch(`${BASE}/admin/settings`, { method: 'PATCH', headers: await getHeaders(), body: JSON.stringify(settings) });
    return res.json();
  },

  async sendFeedback(traceId, score, comment) {
    const res = await checkedFetch(`${BASE}/feedback`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ traceId, score, ...(comment ? { comment } : {}) }),
    });
    return res.json();
  },
};
