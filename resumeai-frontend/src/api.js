import { auth } from './firebase';

const BASE = import.meta.env.VITE_API_URL || '/api';

async function getHeaders() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

export const api = {
  async getProfile() {
    const res = await fetch(`${BASE}/profile`, { headers: await getHeaders() });
    return res.json();
  },

  async ingestText(text) {
    const res = await fetch(`${BASE}/ingest/text`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ text }),
    });
    return res.json();
  },

  async ingestPdf(file) {
    const user = auth.currentUser;
    const token = await user.getIdToken();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/ingest/pdf`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form,
    });
    return res.json();
  },

  async submitJobUrl(url) {
    const res = await fetch(`${BASE}/jobs/submit-url`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ url }),
    });
    return res.json();
  },

  async getJobs() {
    const res = await fetch(`${BASE}/jobs`, { headers: await getHeaders() });
    return res.json();
  },

  async runBatch() {
    const res = await fetch(`${BASE}/jobs/run-batch`, {
      method: 'POST',
      headers: await getHeaders(),
    });
    return res.json();
  },

  async addKeywordToProfile(keyword) {
    return this.ingestText(`I have experience with ${keyword}`);
  },

  async chat(message) {
    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ message }),
    });
    return res.json();
  },

  async connectGmail(code) {
    const res = await fetch(`${BASE}/gmail/connect`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ code }),
    });
    return res.json();
  },

  async verifyGmailFilter() {
    const res = await fetch(`${BASE}/gmail/verify`, {
      method: 'POST',
      headers: await getHeaders(),
    });
    return res.json();
  },

  async downloadResume(jobId) {
    const user = auth.currentUser;
    const token = await user.getIdToken();
    const res = await fetch(`${BASE}/jobs/${jobId}/download`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'resume.docx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
