import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, signOutUser } from '../firebase';
import { api } from '../api';

const ATSBadge = ({ score }) => {
  const color = score >= 90 ? '#22c55e' : score >= 75 ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color, fontWeight: 600 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {score}/100
    </span>
  );
};

const ProgressBar = ({ value, label, sublabel }) => {
  const color = value === 0 ? '#d6d3d1' : value === 100 ? '#22c55e' : '#f59e0b';
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
        <span style={{ fontSize: '12px', color: '#57534e' }}>{label}</span>
        <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: value === 0 ? '#c4c0bc' : value === 100 ? '#22c55e' : '#f59e0b' }}>
          {value === 0 ? 'missing' : value === 100 ? 'complete' : `${value}%`}
        </span>
      </div>
      <div style={{ height: '3px', background: '#e7e5e4', borderRadius: '2px' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: '2px', transition: 'width 1s ease' }} />
      </div>
      {sublabel && <div style={{ fontSize: '10px', color: '#c4c0bc', fontFamily: "'DM Mono', monospace", marginTop: '3px' }}>{sublabel}</div>}
    </div>
  );
};

const ThinkingSection = ({ job }) => {
  const notes = job.tailoring_notes || [];
  const subs = job.substitutions || [];
  if (!notes.length && !subs.length) return null;
  return (
    <div style={{ marginBottom: '14px', background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '12px' }}>
      <div style={{ fontSize: '10px', color: '#8b5cf6', fontFamily: "'DM Mono', monospace", letterSpacing: '0.05em', marginBottom: '8px' }}>
        WHAT ARJUN DID
      </div>
      {notes.map((note, ni) => (
        <div key={ni} style={{ display: 'flex', gap: '8px', padding: '3px 0', fontSize: '11px', color: '#57534e', lineHeight: 1.5 }}>
          <span style={{ color: '#8b5cf6', flexShrink: 0 }}>→</span>
          <span>{note}</span>
        </div>
      ))}
      {subs.length > 0 && (
        <div style={{ marginTop: notes.length ? '8px' : 0, borderTop: notes.length ? '1px solid #e7e5e4' : 'none', paddingTop: notes.length ? '8px' : 0 }}>
          <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>
            REWRITES ({subs.length})
          </div>
          {subs.map((s, si) => (
            <div key={si} style={{ fontSize: '11px', color: '#57534e', padding: '3px 0', lineHeight: 1.5 }}>
              <span style={{ color: '#ef444488', textDecoration: 'line-through' }}>{s.original_phrase}</span>
              <span style={{ color: '#78716c' }}> → </span>
              <span style={{ color: '#22c55e', fontWeight: 500 }}>{s.new_phrase}</span>
              {s.jd_keyword && <span style={{ color: '#a8a29e', fontSize: '10px' }}> (JD: {s.jd_keyword})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const FeedbackButtons = ({ traceId, feedback, onFeedback }) => {
  if (!traceId) return null;
  return (
    <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
      <button
        onClick={() => onFeedback(traceId, 1)}
        disabled={feedback !== undefined}
        style={{
          background: feedback === 1 ? '#ecfdf5' : 'transparent',
          border: `1px solid ${feedback === 1 ? '#22c55e44' : '#e7e5e4'}`,
          borderRadius: '4px', padding: '3px 8px', cursor: feedback !== undefined ? 'default' : 'pointer',
          fontSize: '13px', opacity: feedback !== undefined && feedback !== 1 ? 0.3 : 1,
          transition: 'all 0.15s',
        }}
        title="Helpful"
      >
        {feedback === 1 ? '👍' : '👍'}
      </button>
      <button
        onClick={() => onFeedback(traceId, 0)}
        disabled={feedback !== undefined}
        style={{
          background: feedback === 0 ? '#fef2f2' : 'transparent',
          border: `1px solid ${feedback === 0 ? '#ef444444' : '#e7e5e4'}`,
          borderRadius: '4px', padding: '3px 8px', cursor: feedback !== undefined ? 'default' : 'pointer',
          fontSize: '13px', opacity: feedback !== undefined && feedback !== 0 ? 0.3 : 1,
          transition: 'all 0.15s',
        }}
        title="Not helpful"
      >
        {feedback === 0 ? '👎' : '👎'}
      </button>
    </div>
  );
};

const DownloadButtons = ({ jobId, downloading, onDownload }) => (
  <div style={{ display: 'flex', gap: '8px' }}>
    <button
      onClick={(e) => onDownload(e, jobId, 'docx')}
      disabled={downloading === `${jobId}_docx`}
      style={{ flex: 1, background: '#f59e0b', color: '#1c1917', border: 'none', padding: '10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: downloading === `${jobId}_docx` ? 0.7 : 1 }}
    >
      {downloading === `${jobId}_docx` ? 'Downloading...' : '↓ Download .docx'}
    </button>
    <button
      onClick={(e) => onDownload(e, jobId, 'pdf')}
      disabled={downloading === `${jobId}_pdf`}
      style={{ flex: 1, background: '#ffffff', color: '#1c1917', border: '1px solid #d6d3d1', padding: '10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: downloading === `${jobId}_pdf` ? 0.7 : 1 }}
    >
      {downloading === `${jobId}_pdf` ? 'Downloading...' : '↓ Download .pdf'}
    </button>
  </div>
);

export default function Dashboard() {
  const navigate = useNavigate();
  const user = auth.currentUser;
  const [tab, setTab] = useState('profile');
  const [profile, setProfile] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [addedKeywords, setAddedKeywords] = useState([]);
  const [jobUrl, setJobUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [filesUploading, setFilesUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editProfile, setEditProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const [tailorMessages, setTailorMessages] = useState([]);
  const [tailorInput, setTailorInput] = useState('');
  const [tailorSending, setTailorSending] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState({});
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState([]);
  const [restoringVersion, setRestoringVersion] = useState(null);
  const chatEndRef = useRef(null);
  const tailorEndRef = useRef(null);

  const handleFeedback = async (traceId, score) => {
    setFeedbackMap(prev => ({ ...prev, [traceId]: score }));
    try { await api.sendFeedback(traceId, score); } catch {}
  };

  const handleDownload = async (e, jobId, format = 'docx') => {
    e.stopPropagation();
    setDownloading(`${jobId}_${format}`);
    try {
      await api.downloadResume(jobId, format);
    } catch (err) {
      console.error('Download failed:', err);
    }
    setDownloading(null);
  };

  useEffect(() => {
    Promise.all([api.getProfile(), api.getJobs()])
      .then(([p, j]) => {
        if (!p?._onboarded) {
          navigate('/onboarding', { replace: true });
          return;
        }
        setProfile(p);
        setJobs(j.jobs || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const startEditing = () => {
    setEditProfile(JSON.parse(JSON.stringify(profile)));
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditProfile(null);
    setEditing(false);
    setNewSkill('');
  };

  const saveEditing = async () => {
    setSaving(true);
    try {
      const updated = await api.updateProfile(editProfile);
      setProfile(updated);
      setEditing(false);
      setEditProfile(null);
      setNewSkill('');
    } catch (e) {
      console.error('Save failed:', e);
    }
    setSaving(false);
  };

  const loadVersions = async () => {
    if (showVersions) { setShowVersions(false); return; }
    try {
      const v = await api.getProfileVersions();
      setVersions(v);
      setShowVersions(true);
    } catch (e) { console.error('Failed to load versions:', e); }
  };

  const restoreVersion = async (version) => {
    setRestoringVersion(version);
    try {
      const restored = await api.restoreProfileVersion(version);
      setProfile(restored);
      setShowVersions(false);
      setVersions([]);
    } catch (e) { console.error('Restore failed:', e); }
    setRestoringVersion(null);
  };

  const updateContact = (field, value) => {
    setEditProfile(p => ({ ...p, contact: { ...p.contact, [field]: value } }));
  };

  const updateExperience = (idx, field, value) => {
    setEditProfile(p => {
      const exp = [...(p.experience || [])];
      exp[idx] = { ...exp[idx], [field]: value };
      return { ...p, experience: exp };
    });
  };

  const updateBullet = (expIdx, bulletIdx, value) => {
    setEditProfile(p => {
      const exp = [...(p.experience || [])];
      const bullets = [...(exp[expIdx].bullets || [])];
      bullets[bulletIdx] = value;
      exp[expIdx] = { ...exp[expIdx], bullets };
      return { ...p, experience: exp };
    });
  };

  const removeBullet = (expIdx, bulletIdx) => {
    setEditProfile(p => {
      const exp = [...(p.experience || [])];
      const bullets = [...(exp[expIdx].bullets || [])];
      bullets.splice(bulletIdx, 1);
      exp[expIdx] = { ...exp[expIdx], bullets };
      return { ...p, experience: exp };
    });
  };

  const addBullet = (expIdx) => {
    setEditProfile(p => {
      const exp = [...(p.experience || [])];
      exp[expIdx] = { ...exp[expIdx], bullets: [...(exp[expIdx].bullets || []), ''] };
      return { ...p, experience: exp };
    });
  };

  const removeExperience = (idx) => {
    setEditProfile(p => {
      const exp = [...(p.experience || [])];
      exp.splice(idx, 1);
      return { ...p, experience: exp };
    });
  };

  const addExperience = () => {
    setEditProfile(p => ({
      ...p,
      experience: [...(p.experience || []), { company: '', title: '', dates: '', location: '', bullets: [''] }],
    }));
  };

  const removeSkill = (idx) => {
    setEditProfile(p => {
      const skills = [...(p.skills || [])];
      skills.splice(idx, 1);
      return { ...p, skills };
    });
  };

  const addSkill = () => {
    if (!newSkill.trim()) return;
    setEditProfile(p => ({ ...p, skills: [...(p.skills || []), newSkill.trim()] }));
    setNewSkill('');
  };

  const updateEducation = (idx, field, value) => {
    setEditProfile(p => {
      const edu = [...(p.education || [])];
      edu[idx] = { ...edu[idx], [field]: value };
      return { ...p, education: edu };
    });
  };

  const removeEducation = (idx) => {
    setEditProfile(p => {
      const edu = [...(p.education || [])];
      edu.splice(idx, 1);
      return { ...p, education: edu };
    });
  };

  const addEducation = () => {
    setEditProfile(p => ({
      ...p,
      education: [...(p.education || []), { school: '', degree: '', dates: '' }],
    }));
  };

  const handleAddKeyword = async (keyword) => {
    setAddedKeywords(prev => [...prev, keyword]);
    await api.addKeywordToProfile(keyword);
  };

  const handleSubmitUrl = async () => {
    if (!jobUrl.trim()) return;
    setSubmitting(true);
    setSubmitMsg('');
    try {
      await api.submitJobUrl(jobUrl);
      setSubmitMsg('✓ Job queued — resume will be emailed shortly');
      setJobUrl('');
      setTimeout(() => setSubmitMsg(''), 4000);
    } catch (e) {
      setSubmitMsg('Failed — check the URL and try again');
    }
    setSubmitting(false);
  };

  const handleConfirmChanges = async (msgIndex, changes, deletions) => {
    setChatMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, confirmState: 'saving' } : m));
    try {
      const res = await api.confirmChanges(changes, deletions);
      if (res.profile) setProfile(res.profile);
      setChatMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, confirmState: 'confirmed' } : m));
    } catch {
      setChatMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, confirmState: null } : m));
    }
  };

  const handleRejectChanges = (msgIndex) => {
    setChatMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, confirmState: 'rejected' } : m));
  };

  const formatChanges = (changes, deletions) => {
    const parts = [];
    if (changes) {
      if (changes.contact && Object.keys(changes.contact).length) {
        Object.entries(changes.contact).forEach(([k, v]) => {
          if (v) parts.push({ section: 'Contact', detail: `${k}: ${Array.isArray(v) ? v.join(', ') : v}` });
        });
      }
      if (changes.summary) parts.push({ section: 'Summary', detail: changes.summary.slice(0, 100) + (changes.summary.length > 100 ? '...' : '') });
      if (changes.skills?.length) parts.push({ section: 'Skills', detail: changes.skills.map(s => typeof s === 'object' ? s.name : s).join(', ') });
      if (changes.technical_skills?.length) parts.push({ section: 'Technical Skills', detail: changes.technical_skills.map(s => typeof s === 'object' ? s.name : s).join(', ') });
      if (changes.soft_skills?.length) parts.push({ section: 'Soft Skills', detail: changes.soft_skills.join(', ') });
      if (changes.experience?.length) {
        changes.experience.forEach(exp => {
          const line = [exp.title, exp.company, exp.dates].filter(Boolean).join(' · ');
          parts.push({ section: 'Experience', detail: line || 'New role' });
          if (exp.bullets?.length) exp.bullets.forEach(b => {
            const text = typeof b === 'string' ? b : (b.text || JSON.stringify(b));
            parts.push({ section: '', detail: `  · ${text}` });
          });
        });
      }
      if (changes.projects?.length) {
        changes.projects.forEach(p => parts.push({ section: 'Project', detail: p.name || p.description || 'New project' }));
      }
      if (changes.education?.length) {
        changes.education.forEach(e => parts.push({ section: 'Education', detail: [e.degree, e.school].filter(Boolean).join(' — ') }));
      }
      if (changes.certifications?.length) {
        changes.certifications.forEach(c => parts.push({ section: 'Certification', detail: typeof c === 'string' ? c : (c.name || '') }));
      }
      if (changes.languages?.length) {
        changes.languages.forEach(l => parts.push({ section: 'Language', detail: typeof l === 'string' ? l : `${l.name}${l.proficiency ? ` (${l.proficiency})` : ''}` }));
      }
      if (changes.career && Object.keys(changes.career).length) {
        Object.entries(changes.career).forEach(([k, v]) => {
          if (v) parts.push({ section: 'Career', detail: `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v}` });
        });
      }
      if (changes.custom_facts?.length) {
        changes.custom_facts.forEach(f => parts.push({ section: 'Fact', detail: typeof f === 'string' ? f : (f.text || JSON.stringify(f)) }));
      }
    }
    if (deletions) {
      if (deletions.skills?.length) parts.push({ section: 'Remove Skills', detail: deletions.skills.join(', '), isDelete: true });
      if (deletions.experience_ids?.length) parts.push({ section: 'Remove Experience', detail: deletions.experience_ids.join(', '), isDelete: true });
      if (deletions.project_ids?.length) parts.push({ section: 'Remove Projects', detail: deletions.project_ids.join(', '), isDelete: true });
      if (deletions.certifications?.length) parts.push({ section: 'Remove Certifications', detail: deletions.certifications.join(', '), isDelete: true });
      if (deletions.education_ids?.length) parts.push({ section: 'Remove Education', detail: deletions.education_ids.join(', '), isDelete: true });
      if (deletions.clear_summary) parts.push({ section: 'Clear Summary', detail: 'Will be cleared', isDelete: true });
    }
    return parts;
  };

  const buildHistory = () => {
    return chatMessages
      .filter(m => m.text && (m.role === 'user' || m.role === 'arjun'))
      .slice(-10)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  };

  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatSending) return;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: msg }]);
    setChatSending(true);
    try {
      const history = buildHistory();
      const res = await api.chat(msg, 'profile', history);

      const hasChanges = res.pendingChanges && Object.keys(res.pendingChanges).length > 0;
      const hasDeletions = res.pendingDeletions && Object.keys(res.pendingDeletions).length > 0;
      if (hasChanges || hasDeletions) {
        setChatMessages(prev => [...prev, {
          role: 'arjun',
          text: res.reply,
          traceId: res.traceId,
          ...(hasChanges ? { pendingChanges: res.pendingChanges } : {}),
          ...(hasDeletions ? { pendingDeletions: res.pendingDeletions } : {}),
          confirmState: null,
        }]);
      } else {
        setChatMessages(prev => [...prev, { role: 'arjun', text: res.reply, traceId: res.traceId }]);
      }

      if (res.profile) setProfile(res.profile);

      // Duplicate job — show existing result inline, no polling needed
      if (res.duplicate && res.existingJob) {
        setChatMessages(prev => [...prev, { role: 'arjun', type: 'jobResult', job: res.existingJob }]);
        setChatSending(false);
        return;
      }

      if (res.scraping) {
        const progressId = Date.now();
        const deliveredCountAtStart = jobs.filter(j => j.status === 'delivered').length;
        setChatMessages(prev => [...prev, { role: 'arjun', type: 'progress', id: progressId, startTime: Date.now(), stage: 0 }]);

        let stageIdx = 0;
        const elapsedTimer = setInterval(() => {
          const now = Date.now();
          setChatMessages(prev => prev.map(m => {
            if (m.id !== progressId) return m;
            const elapsed = Math.floor((now - m.startTime) / 1000);
            const newStage = elapsed < 8 ? 0 : elapsed < 16 ? 1 : elapsed < 28 ? 2 : elapsed < 38 ? 3 : 4;
            return { ...m, elapsed, stage: newStage };
          }));
        }, 1000);

        let pollCount = 0;
        const pollJobs = setInterval(async () => {
          pollCount++;
          try {
            const jobsRes = await api.getJobs();
            const allJobs = jobsRes.jobs || [];
            const deliveredJobs = allJobs.filter(j => j.status === 'delivered');
            const failedNew = allJobs.find(j => j.status === 'failed' && !jobs.some(ej => ej.job_id === j.job_id));

            if (deliveredJobs.length > deliveredCountAtStart) {
              clearInterval(pollJobs);
              clearInterval(elapsedTimer);
              setJobs(allJobs);
              const latest = deliveredJobs[0];
              setChatMessages(prev => [
                ...prev.filter(m => m.id !== progressId),
                { role: 'arjun', type: 'jobResult', job: latest },
              ]);
            } else if (failedNew) {
              clearInterval(pollJobs);
              clearInterval(elapsedTimer);
              setJobs(allJobs);
              setChatMessages(prev => [
                ...prev.filter(m => m.id !== progressId),
                { role: 'arjun', text: `Scraping failed for this job — the page may require login or the URL couldn't be read. Try a different URL or paste the job description directly.` },
              ]);
            } else if (pollCount >= 30) {
              clearInterval(pollJobs);
              clearInterval(elapsedTimer);
              setJobs(allJobs);
              setChatMessages(prev => [
                ...prev.filter(m => m.id !== progressId),
                { role: 'arjun', text: 'Still processing after 5 minutes — the scraper may be slow or the page may need login. Check the **Job Activity** tab for the final status.' },
              ]);
            }
          } catch {}
        }, 10000);
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'arjun', text: 'Something went wrong. Try again.' }]);
    }
    setChatSending(false);
  };

  const buildIngestionSummary = (changes, fileCount, conflicts = [], ambiguities = [], extracted = '', drops = null) => {
    const parts = [`[Ingestion complete: ${fileCount} file(s) processed.`];
    if (extracted) {
      parts.push(`\nWhat was extracted from the file:\n${extracted}`);
    }
    if (changes.length) {
      parts.push('\nWhat was NEW (added to profile):');
      for (const c of changes) {
        parts.push(`- ${c.type.toUpperCase()}: ${c.section} — ${c.detail}`);
      }
    } else {
      parts.push('\nNo new information found — profile already had this data.');
    }
    if (drops && drops.items.length) {
      parts.push(`\nWhat was DROPPED during merge (${drops.items.length} item(s)):`);
      for (const d of drops.items) {
        parts.push(`- ${d.field}: "${d.value}" — ${d.reason.replace(/_/g, ' ')}${d.company ? ` (${d.company})` : ''}`);
      }
    }
    if (conflicts.length) parts.push(`\n${conflicts.length} possible duplicate(s) flagged for review.`);
    if (ambiguities.length) parts.push(`${ambiguities.length} ambiguity/ambiguities flagged for clarification.`);
    parts.push(']');
    return parts.join('\n');
  };

  const diffProfiles = (before, after) => {
    const changes = [];
    const bText = (b) => typeof b === 'string' ? b : (b.text || '');
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (after.summary && after.summary !== before.summary) {
      changes.push({ section: 'Summary', type: before.summary ? 'updated' : 'added', detail: after.summary.slice(0, 80) + (after.summary.length > 80 ? '...' : '') });
    }

    // Collect ALL before-skills across all formats for dedup
    const beforeAllSkills = new Set([
      ...(before.skills || []).map(s => norm(typeof s === 'object' ? s.name : s)),
      ...(before.technical_skills || []).map(s => norm(typeof s === 'object' ? s.name : s)),
      ...(before.soft_skills || []).map(s => norm(s)),
    ]);
    const afterAllSkills = [
      ...(after.skills || []).map(s => typeof s === 'object' ? s.name : s),
      ...(after.technical_skills || []).map(s => typeof s === 'object' ? s.name : s),
      ...(after.soft_skills || []),
    ];
    const newSkills = afterAllSkills.filter(s => !beforeAllSkills.has(norm(s)));
    const uniqueNewSkills = [...new Set(newSkills.map(s => s))];
    if (uniqueNewSkills.length) changes.push({ section: 'Skills', type: 'added', detail: uniqueNewSkills.join(', ') });

    const beforeExpKeys = new Set((before.experience || []).map(e => `${norm(e.company)}|${norm(e.title)}`));
    for (const exp of (after.experience || [])) {
      const key = `${norm(exp.company)}|${norm(exp.title)}`;
      if (!beforeExpKeys.has(key)) {
        changes.push({ section: 'Experience', type: 'added', detail: `${exp.title} at ${exp.company}` });
      } else {
        const prev = (before.experience || []).find(e => `${norm(e.company)}|${norm(e.title)}` === key);
        const prevBulletTexts = new Set((prev?.bullets || []).map(pb => norm(bText(pb))));
        const newBullets = (exp.bullets || []).filter(b => !prevBulletTexts.has(norm(bText(b))));
        if (newBullets.length) changes.push({ section: 'Experience', type: 'enriched', detail: `${exp.title} at ${exp.company} — ${newBullets.length} new bullet${newBullets.length > 1 ? 's' : ''}` });
      }
    }

    const beforeProjKeys = new Set((before.projects || []).map(p => norm(p.name)));
    for (const p of (after.projects || [])) {
      if (!beforeProjKeys.has(norm(p.name))) {
        changes.push({ section: 'Project', type: 'added', detail: p.name });
      }
    }

    // Fuzzy education match — match if school name contains the other
    const beforeEdus = (before.education || []);
    for (const e of (after.education || [])) {
      const matched = beforeEdus.some(be =>
        norm(be.school).includes(norm(e.school)) || norm(e.school).includes(norm(be.school)) ||
        (norm(be.degree).includes(norm(e.degree)) && norm(be.school).includes(norm(e.school).slice(0, 6)))
      );
      if (!matched) {
        changes.push({ section: 'Education', type: 'added', detail: `${e.degree} — ${e.school}` });
      }
    }

    const newLangs = (after.languages || []).filter(l => {
      const name = typeof l === 'string' ? l : l.name || '';
      return !(before.languages || []).some(bl => norm(typeof bl === 'string' ? bl : bl.name) === norm(name));
    });
    if (newLangs.length) changes.push({ section: 'Languages', type: 'added', detail: newLangs.map(l => typeof l === 'string' ? l : l.name).join(', ') });

    const newCerts = (after.certifications || []).filter(c => {
      const name = typeof c === 'string' ? c : c.name || '';
      return !(before.certifications || []).some(bc => norm(typeof bc === 'string' ? bc : bc.name) === norm(name));
    });
    if (newCerts.length) changes.push({ section: 'Certifications', type: 'added', detail: newCerts.map(c => typeof c === 'string' ? c : c.name).join(', ') });

    if (after.contact) {
      for (const [k, v] of Object.entries(after.contact)) {
        if (!v || k === 'links') continue;
        const beforeVal = before.contact?.[k];
        if (!beforeVal) {
          changes.push({ section: 'Contact', type: 'added', detail: `${k}: ${Array.isArray(v) ? v.join(', ') : v}` });
        } else if (norm(String(beforeVal)) !== norm(String(v))) {
          changes.push({ section: 'Contact', type: 'updated', detail: `${k}: ${Array.isArray(v) ? v.join(', ') : v}` });
        }
      }
    }

    return changes;
  };

  const handleChatFiles = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setFilesUploading(true);
    const names = files.map(f => f.name).join(', ');
    setChatMessages(prev => [...prev, { role: 'user', text: `Uploading: ${names}` }]);

    const progressId = Date.now();
    setChatMessages(prev => [...prev, { role: 'arjun', type: 'ingestProgress', id: progressId, startTime: Date.now(), stage: 0, fileCount: files.length }]);

    const stageTimer = setInterval(() => {
      setChatMessages(prev => prev.map(m => {
        if (m.id !== progressId) return m;
        const elapsed = Math.floor((Date.now() - m.startTime) / 1000);
        const newStage = elapsed < 3 ? 0 : elapsed < 8 ? 1 : elapsed < 20 ? 2 : 3;
        return { ...m, elapsed, stage: newStage };
      }));
    }, 1000);

    const beforeProfile = profile ? JSON.parse(JSON.stringify(profile)) : {};

    try {
      const uploadResult = await api.ingestFiles(files);

      if (uploadResult.processing) {
        setChatMessages(prev => prev.map(m =>
          m.id === progressId ? { ...m, stage: 1, filesExtracted: uploadResult.filesExtracted } : m
        ));

        const poll = () => new Promise((resolve, reject) => {
          let attempts = 0;
          const iv = setInterval(async () => {
            try {
              const status = await api.getIngestionStatus();
              attempts++;
              if (status.stage === 'done') {
                clearInterval(iv);
                resolve(status);
              } else if (status.stage === 'failed') {
                clearInterval(iv);
                reject(new Error(status.error || 'Processing failed'));
              } else if (attempts > 90) {
                clearInterval(iv);
                reject(new Error('Processing timed out. Check the Jobs tab or try again.'));
              }
            } catch (e) {
              clearInterval(iv);
              reject(e);
            }
          }, 2000);
        });

        const result = await poll();
        clearInterval(stageTimer);

        const updated = await api.getProfile();
        setProfile(updated);
        const changes = diffProfiles(beforeProfile, updated);
        const ingestion = { filesProcessed: result.filesExtracted, filesSkipped: result.filesSkipped, errors: result.errors };
        const conflicts = result.conflicts || [];
        const ambiguities = result.ambiguities || [];
        const extracted = result.extracted || '';
        const drops = result.drops || null;

        const summaryText = buildIngestionSummary(changes, files.length, conflicts, ambiguities, extracted, drops);
        setChatMessages(prev => [
          ...prev.filter(m => m.id !== progressId),
          { role: 'arjun', type: 'ingestResult', text: summaryText, changes, ingestion, fileCount: files.length, conflicts, ambiguities, drops },
        ]);
      } else {
        clearInterval(stageTimer);
        const conflicts = uploadResult._conflicts || [];
        const ambiguities = uploadResult._ambiguities || [];
        const extracted = uploadResult._extracted || '';
        const drops = uploadResult._drops || null;
        delete uploadResult._conflicts;
        delete uploadResult._ambiguities;
        delete uploadResult._extracted;
        delete uploadResult._drops;
        setProfile(uploadResult);
        const ingestion = uploadResult._ingestion || {};
        const changes = diffProfiles(beforeProfile, uploadResult);
        const summaryText = buildIngestionSummary(changes, files.length, conflicts, ambiguities, extracted, drops);
        setChatMessages(prev => [
          ...prev.filter(m => m.id !== progressId),
          { role: 'arjun', type: 'ingestResult', text: summaryText, changes, ingestion, fileCount: files.length, conflicts, ambiguities, drops },
        ]);
      }
    } catch (e) {
      clearInterval(stageTimer);
      setChatMessages(prev => [
        ...prev.filter(m => m.id !== progressId),
        { role: 'arjun', type: 'ingestError', error: e.message || 'Upload failed' },
      ]);
    }
    setFilesUploading(false);
  };

  const handleResolveConflict = async (msgIdx, conflictIdx, choice) => {
    setChatMessages(prev => prev.map((m, mi) => {
      if (mi !== msgIdx) return m;
      const resolutions = { ...(m.resolutions || {}) };
      resolutions[conflictIdx] = choice;
      const allResolved = (m.conflicts || []).every((_, ci) => resolutions[ci]);
      return { ...m, resolutions, conflictsResolved: allResolved };
    }));

    // Check if all conflicts for this message are now resolved
    const msg = chatMessages[msgIdx];
    const resolutions = { ...(msg?.resolutions || {}), [conflictIdx]: choice };
    const allResolved = (msg?.conflicts || []).every((_, ci) => resolutions[ci]);

    if (allResolved && msg?.conflicts?.length) {
      try {
        const resolveData = msg.conflicts.map((c, ci) => ({
          type: c.type,
          keep: resolutions[ci],
          existing: c.existing,
          incoming: c.incoming,
        }));
        const resolved = await api.resolveConflicts(resolveData);
        setProfile(resolved);
      } catch (e) {
        console.error('Conflict resolution failed:', e);
      }
    }
  };

  const handleResolveAmbiguity = async (msgIdx, ambIdx, value) => {
    setChatMessages(prev => prev.map((m, mi) => {
      if (mi !== msgIdx) return m;
      const ambAnswers = { ...(m.ambAnswers || {}) };
      ambAnswers[ambIdx] = value;
      const allAnswered = (m.ambiguities || []).every((_, ai) => ambAnswers[ai] !== undefined);
      return { ...m, ambAnswers, ambiguitiesResolved: allAnswered };
    }));

    const msg = chatMessages[msgIdx];
    const ambAnswers = { ...(msg?.ambAnswers || {}), [ambIdx]: value };
    const allAnswered = (msg?.ambiguities || []).every((_, ai) => ambAnswers[ai] !== undefined);

    if (allAnswered && msg?.ambiguities?.length) {
      try {
        const answers = msg.ambiguities.map((a, ai) => ({
          field: a.field,
          value: ambAnswers[ai],
        }));
        const resolved = await api.resolveAmbiguities(answers);
        setProfile(resolved);
      } catch (e) {
        console.error('Ambiguity resolution failed:', e);
      }
    }
  };

  const handleTailorSend = async () => {
    const msg = tailorInput.trim();
    if (!msg || tailorSending) return;
    setTailorInput('');
    setTailorMessages(prev => [...prev, { role: 'user', text: msg }]);
    setTailorSending(true);
    try {
      const res = await api.chat(msg, 'tailor');

      if (res.reply) {
        setTailorMessages(prev => [...prev, { role: 'arjun', text: res.reply, traceId: res.traceId }]);
      }

      if (res.profile) setProfile(res.profile);

      if (res.duplicate && res.existingJob) {
        setTailorMessages(prev => [...prev, { role: 'arjun', type: 'jobResult', job: res.existingJob }]);
        setTailorSending(false);
        return;
      }

      if (res.scraping) {
        const progressId = Date.now();
        const deliveredCountAtStart = jobs.filter(j => j.status === 'delivered').length;
        setTailorMessages(prev => [...prev, { role: 'arjun', type: 'progress', id: progressId, startTime: Date.now(), stage: 0 }]);

        let stageIdx = 0;
        const elapsedTimer = setInterval(() => {
          const now = Date.now();
          setTailorMessages(prev => prev.map(m => {
            if (m.id !== progressId) return m;
            const elapsed = Math.floor((now - m.startTime) / 1000);
            const newStage = elapsed < 8 ? 0 : elapsed < 16 ? 1 : elapsed < 28 ? 2 : elapsed < 38 ? 3 : 4;
            return { ...m, elapsed, stage: newStage };
          }));
        }, 1000);

        let pollCount = 0;
        const pollJobs = setInterval(async () => {
          pollCount++;
          try {
            const jobsRes = await api.getJobs();
            const allJobs = jobsRes.jobs || [];
            const deliveredJobs = allJobs.filter(j => j.status === 'delivered');
            const failedNew = allJobs.find(j => j.status === 'failed' && !jobs.some(ej => ej.job_id === j.job_id));

            if (deliveredJobs.length > deliveredCountAtStart) {
              clearInterval(pollJobs);
              clearInterval(elapsedTimer);
              setJobs(allJobs);
              const latest = deliveredJobs[0];
              setTailorMessages(prev => [
                ...prev.filter(m => m.id !== progressId),
                { role: 'arjun', type: 'jobResult', job: latest },
              ]);
            } else if (failedNew) {
              clearInterval(pollJobs);
              clearInterval(elapsedTimer);
              setJobs(allJobs);
              setTailorMessages(prev => [
                ...prev.filter(m => m.id !== progressId),
                { role: 'arjun', text: `Scraping failed for this job — the page may require login or the URL couldn't be read. Try a different URL or paste the job description directly.` },
              ]);
            } else if (pollCount >= 30) {
              clearInterval(pollJobs);
              clearInterval(elapsedTimer);
              setJobs(allJobs);
              setTailorMessages(prev => [
                ...prev.filter(m => m.id !== progressId),
                { role: 'arjun', text: 'Still processing after 5 minutes — the scraper may be slow or the page may need login. Check the **Job Activity** tab for the final status.' },
              ]);
            }
          } catch {}
        }, 10000);
      }
    } catch {
      setTailorMessages(prev => [...prev, { role: 'arjun', text: 'Something went wrong. Try again.' }]);
    }
    setTailorSending(false);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    tailorEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tailorMessages]);

  useEffect(() => {
    if (tab === 'profile') {
      api.getProfile().then(p => setProfile(p)).catch(() => {});
    }
  }, [tab]);

  useEffect(() => {
    if (tab === 'chat' && chatMessages.length === 0) {
      const missing = [];
      if (!profile?.contact?.phone) missing.push('phone number');
      if (!profile?.contact?.location) missing.push('location');
      if (!(profile?.contact?.linkedin)) missing.push('LinkedIn URL');
      if ((profile?.experience?.length || 0) < 2) missing.push('more work experience');
      if ((profile?.projects?.length || 0) === 0) missing.push('projects');
      if ((profile?.education?.length || 0) === 0) missing.push('education');
      if (!(profile?.certifications?.length > 0)) missing.push('certifications');
      const hint = missing.length > 0 ? `\n\nI noticed you're missing: ${missing.slice(0, 4).join(', ')}. Want to start there?` : '\n\nWhat would you like to add?';
      setChatMessages([{
        role: 'arjun',
        type: 'welcome',
        text: `Hey ${user?.displayName?.split(' ')[0] || 'there'}! Tell me anything about your career and I'll index it into your profile.${hint}`,
        tips: [
          { icon: '✅', text: 'Start with the company name: "At Zinnia, I owned the product roadmap for..."' },
          { icon: '📋', text: 'One role at a time works best — include title, dates, and key achievements' },
          { icon: '📊', text: 'Include numbers: "reduced costs by 12%", "managed $2M budget", "led team of 8"' },
          { icon: '📄', text: 'Or upload files (PDF, DOCX, TXT, JSON) — I\'ll extract everything automatically' },
        ],
      }]);
    }
    if (tab === 'submit' && tailorMessages.length === 0) {
      setTailorMessages([{ role: 'arjun', text: `Paste a job URL and I'll tailor your resume for it. I'll scrape the full job description, rewrite your bullets to match their keywords, score it against ATS, and email you the .docx.\n\nTry LinkedIn, Indeed, Greenhouse, or any job posting URL.` }]);
    }
  }, [tab]);

  const allSkills = profile ? [
    ...(profile.skills || []),
    ...(profile.technical_skills || []).map(s => s.name || s),
    ...(profile.soft_skills || []),
  ].filter((s, i, a) => a.findIndex(x => (x || '').toString().toLowerCase() === (s || '').toString().toLowerCase()) === i) : [];

  const hasLinkedIn = !!(profile?.contact?.linkedin || profile?.contact?.linkedIn || profile?.contact?.LinkedIn);
  const completeness = profile ? {
    contact: profile.contact?.name && profile.contact?.email ? (hasLinkedIn ? 100 : 80) : 40,
    summary: (profile.summary?.length || 0) > 50 ? 100 : 20,
    skills: allSkills.length > 10 ? 100 : allSkills.length > 0 ? 60 : 0,
    experience: (profile.experience?.length || 0) >= 2 ? 100 : (profile.experience?.length || 0) > 0 ? 50 : 0,
    education: (profile.education?.length || 0) > 0 ? 100 : 0,
    certifications: (profile.certifications?.length || 0) > 0 ? 100 : 0,
    projects: (profile.projects?.length || 0) > 0 ? 100 : 0,
  } : {};

  const overallScore = Object.keys(completeness).length
    ? Math.round(Object.values(completeness).reduce((a, b) => a + b, 0) / Object.keys(completeness).length)
    : 0;

  const deliveredJobs = jobs.filter(j => j.status === 'delivered');
  const avgATS = deliveredJobs.length ? Math.round(deliveredJobs.reduce((a, j) => a + (j.ats_score || 0), 0) / deliveredJobs.length) : 0;

  const allMissing = deliveredJobs.flatMap(j => j.missing_keywords || []);
  const missingFreq = allMissing.reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const topMissing = Object.entries(missingFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ width: 24, height: 24, border: '2px solid #333', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 40px', borderBottom: '1px solid #e7e5e4',
        position: 'sticky', top: 0, background: '#fafaf9', zIndex: 10,
      }}>
        <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '18px' }}>
          resumai<span style={{ color: '#f59e0b' }}>.</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '100px', padding: '5px 14px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>auto-running</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {user?.photoURL && <img src={user.photoURL} style={{ width: 28, height: 28, borderRadius: '50%' }} />}
            <button onClick={async () => { await signOutUser(); navigate('/'); }} style={{ background: 'none', border: 'none', color: '#a8a29e', fontSize: '12px', fontFamily: "'DM Mono', monospace" }}>
              sign out
            </button>
          </div>
        </div>
      </nav>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1 }}>
        {/* Sidebar */}
        <aside style={{ borderRight: '1px solid #e7e5e4', padding: '24px 16px', position: 'sticky', top: 61, height: 'calc(100vh - 61px)', overflowY: 'auto' }}>
          {/* Profile ring */}
          <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              {user?.photoURL && <img src={user.photoURL} style={{ width: 32, height: 32, borderRadius: '50%' }} />}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>{user?.displayName}</div>
                <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{user?.email}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: `conic-gradient(#f59e0b ${overallScore * 3.6}deg, #e7e5e4 0deg)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                  {overallScore}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#1c1917' }}>Profile score</div>
                <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>
                  {overallScore < 70 ? 'add more info' : 'looking good'}
                </div>
              </div>
            </div>
          </div>

          {/* Nav tabs */}
          {[
            { id: 'profile', label: 'Profile Index', desc: 'Your indexed career data' },
            { id: 'chat', label: 'Build Profile', desc: 'Chat or upload files to add info' },
            { id: 'submit', label: 'Tailor Resume', desc: 'Paste a job URL to get a resume' },
            { id: 'jobs', label: 'Job Activity', desc: 'All requests & results' },
            { id: 'gaps', label: 'Skill Gaps', desc: 'Top missing keywords' },
          ].map(({ id, label, desc }) => (
            <button key={id} onClick={() => setTab(id)} style={{
              width: '100%', textAlign: 'left',
              background: tab === id ? '#ffffff' : 'transparent',
              border: `1px solid ${tab === id ? '#d6d3d1' : 'transparent'}`,
              borderRadius: '6px', padding: '9px 12px', marginBottom: '3px',
              color: tab === id ? '#1c1917' : '#57534e', fontSize: '13px',
              transition: 'all 0.15s',
            }}>
              {label}
              <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginTop: '2px' }}>{desc}</div>
            </button>
          ))}

          {/* Quick stats */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #e7e5e4', paddingTop: '16px' }}>
            {[
              { label: 'Resumes sent', value: deliveredJobs.length },
              { label: 'Avg ATS', value: avgATS ? `${avgATS}/100` : '—' },
              { label: '90+ matches', value: deliveredJobs.filter(j => j.ats_score >= 90).length },
              { label: 'Skills', value: allSkills.length },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f5f5f4' }}>
                <span style={{ fontSize: '11px', color: '#a8a29e' }}>{label}</span>
                <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace" }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Gmail connector */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #e7e5e4', paddingTop: '16px' }}>
            <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '6px' }}>
              ⚡ CONNECT GMAIL
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px', lineHeight: 1.5 }}>
              Auto-process job alerts every 2 hours
            </div>
            {profile?.gmail_connected || profile?.gmail_filter_pending ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#22c55e', fontFamily: "'DM Mono', monospace" }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                {profile?.gmail_connected ? 'Connected' : 'Filter pending'}
              </div>
            ) : (
              <button
                onClick={() => navigate('/onboarding?step=gmail')}
                style={{
                  width: '100%', background: '#f59e0b', color: '#1c1917',
                  border: 'none', padding: '8px', borderRadius: '6px',
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Connect Gmail →
              </button>
            )}
          </div>
        </aside>

        {/* Main */}
        <main style={{ padding: '32px 40px', overflowY: 'auto' }}>

          {/* ── PROFILE INDEX ── */}
          {tab === 'profile' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px' }}>Profile Index</h2>
                {!editing ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={loadVersions} style={{ background: 'transparent', border: '1px solid #d6d3d1', color: '#78716c', padding: '7px 12px', borderRadius: '6px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                      {showVersions ? 'Hide History' : 'Version History'}
                    </button>
                    <button onClick={startEditing} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: '#57534e', padding: '7px 16px', borderRadius: '6px', fontSize: '12px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                      Edit Profile
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={cancelEditing} style={{ background: 'transparent', border: '1px solid #d6d3d1', color: '#57534e', padding: '7px 16px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button onClick={saveEditing} disabled={saving} style={{ background: '#22c55e', border: 'none', color: '#1c1917', padding: '7px 20px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                )}
              </div>
              <p style={{ fontSize: '13px', color: '#78716c', marginBottom: showVersions ? '16px' : '28px' }}>
                {editing ? 'Edit your profile details below. Click Save when done.' : 'Everything the system knows about you.'}
              </p>

              {showVersions && versions.length > 0 && (
                <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '16px', marginBottom: '20px', animation: 'fadeIn 0.2s ease' }}>
                  <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '12px' }}>PROFILE VERSIONS (last 3)</div>
                  {versions.map((v, i) => {
                    const date = new Date(v.updated_at);
                    const timeAgo = Math.round((Date.now() - date.getTime()) / 60000);
                    const when = timeAgo < 60 ? `${timeAgo}m ago` : timeAgo < 1440 ? `${Math.round(timeAgo / 60)}h ago` : date.toLocaleDateString();
                    const sourceLabel = { manual_edit: 'Manual Edit', chat_confirm: 'Chat', ingestion: 'File Upload', unknown: 'Update' }[v.change_source] || v.change_source;
                    return (
                      <div key={v.version} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < versions.length - 1 ? '1px solid #e7e5e4' : 'none' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 500, color: i === 0 ? '#22c55e' : '#1c1917' }}>
                              {i === 0 ? 'Current' : `v${v.version}`}
                            </span>
                            <span style={{ background: '#e7e5e4', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>{sourceLabel}</span>
                            <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{when}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#78716c', marginTop: '2px', fontFamily: "'DM Mono', monospace" }}>
                            {v.exp_count} roles · {v.skills_count} skills · {v.projects_count} projects · {v.certs_count} certs
                          </div>
                        </div>
                        {i > 0 && (
                          <button
                            onClick={() => restoreVersion(v.version)}
                            disabled={restoringVersion !== null}
                            style={{ background: '#f59e0b', border: 'none', color: '#1c1917', padding: '6px 14px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', opacity: restoringVersion === v.version ? 0.7 : 1 }}
                          >
                            {restoringVersion === v.version ? 'Restoring...' : 'Restore'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!editing ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px' }}>
                      <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>COMPLETENESS</div>
                      <ProgressBar value={completeness.contact || 0} label="Contact info" />
                      <ProgressBar value={completeness.summary || 0} label="Summary" sublabel={`${profile?.summary?.length || 0} chars`} />
                      <ProgressBar value={completeness.skills || 0} label="Skills" sublabel={`${allSkills.length} indexed`} />
                      <ProgressBar value={completeness.experience || 0} label="Experience" sublabel={`${profile?.experience?.length || 0} roles`} />
                      <ProgressBar value={completeness.education || 0} label="Education" />
                      <ProgressBar value={completeness.certifications || 0} label="Certifications" sublabel={`${profile?.certifications?.length || 0} added`} />
                      <ProgressBar value={completeness.projects || 0} label="Projects" />
                    </div>
                    <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px' }}>
                      <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>CONTACT</div>
                      {profile?.contact && Object.entries(profile.contact).filter(([k, v]) => v && k !== 'links').map(([k, v]) => {
                        const isLink = ['linkedin', 'github', 'portfolio'].includes(k) && String(v).startsWith('http');
                        const display = isLink ? String(v).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : (Array.isArray(v) ? v.join(', ') : String(v));
                        return (
                          <div key={k} style={{ display: 'flex', gap: '12px', padding: '7px 0', borderBottom: '1px solid #e7e5e4' }}>
                            <span style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", minWidth: 60, textTransform: 'capitalize' }}>{k}</span>
                            {isLink ? (
                              <a href={String(v)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#f59e0b', textDecoration: 'none', wordBreak: 'break-all' }}
                                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                              >{display}</a>
                            ) : (
                              <span style={{ fontSize: '12px', color: '#1c1917' }}>{display}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {allSkills.length > 0 && (
                    <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '14px' }}>SKILLS — {allSkills.length} TOTAL</div>

                      {(profile.technical_skills?.length > 0) && (
                        <>
                          <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", marginBottom: '8px', marginTop: '4px' }}>TECHNICAL</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                            {profile.technical_skills.map((s, i) => {
                              const name = typeof s === 'string' ? s : s.name;
                              const exp = typeof s === 'object' ? s.experience : null;
                              return (
                                <span key={i} title={exp ? `Experience: ${exp}` : undefined} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>
                                  {name}{exp ? <span style={{ color: '#a8a29e', fontSize: '9px', marginLeft: '4px' }}>{exp}</span> : ''}
                                </span>
                              );
                            })}
                          </div>
                        </>
                      )}

                      {(profile.soft_skills?.length > 0) && (
                        <>
                          <div style={{ fontSize: '10px', color: '#8b5cf6', fontFamily: "'DM Mono', monospace", marginBottom: '8px' }}>INTERPERSONAL</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                            {profile.soft_skills.map((skill, i) => (
                              <span key={i} style={{ background: '#f3f0ff', border: '1px solid #ddd6fe', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', color: '#6d28d9', fontFamily: "'DM Mono', monospace" }}>{skill}</span>
                            ))}
                          </div>
                        </>
                      )}

                      {(!profile.technical_skills?.length && !profile.soft_skills?.length && profile.skills?.length > 0) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {profile.skills.map(skill => (
                            <span key={skill} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>{skill}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {profile?.experience && profile.experience.length > 0 && (
                    <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>EXPERIENCE</div>
                      {profile.experience.map((exp, i) => (
                        <div key={exp.company || i} style={{ paddingBottom: '14px', borderBottom: i < profile.experience.length - 1 ? '1px solid #e7e5e4' : 'none', marginBottom: i < profile.experience.length - 1 ? '14px' : 0 }}>
                          <div style={{ display: 'flex', gap: '14px' }}>
                            <div style={{ width: 34, height: 34, borderRadius: '8px', background: '#e7e5e4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 600, color: '#f59e0b', flexShrink: 0 }}>
                              {(exp.company || '?')[0]}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 500 }}>{exp.title} · {exp.company}</span>
                                <span style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{exp.dates}</span>
                              </div>
                              {exp.location && <div style={{ fontSize: '11px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginBottom: '8px' }}>{exp.location}</div>}
                            </div>
                          </div>
                          {(exp.bullets || []).length > 0 && (
                            <div style={{ marginTop: '8px', paddingLeft: '48px' }}>
                              {exp.bullets.map((b, bi) => {
                                const text = typeof b === 'string' ? b : (b.text || '');
                                const metric = typeof b === 'object' ? b.metric : null;
                                const impact = typeof b === 'object' ? b.impact : null;
                                return (
                                  <div key={bi} style={{ display: 'flex', gap: '8px', padding: '3px 0', fontSize: '12px', color: '#57534e', lineHeight: 1.5 }}>
                                    <span style={{ color: '#c4c0bc', flexShrink: 0 }}>·</span>
                                    <span>
                                      {text}
                                      {(metric || impact) && (
                                        <span style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginLeft: '6px' }}>
                                          {metric && <span style={{ color: '#f59e0b' }}>{metric}</span>}
                                          {metric && impact && ' · '}
                                          {impact && <span>{impact}</span>}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {profile?.education && profile.education.length > 0 && (
                    <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>EDUCATION</div>
                      {profile.education.map((edu, i) => (
                        <div key={i} style={{ padding: '7px 0', borderBottom: i < profile.education.length - 1 ? '1px solid #e7e5e4' : 'none' }}>
                          <div style={{ fontSize: '13px', fontWeight: 500 }}>{edu.degree}</div>
                          <div style={{ fontSize: '12px', color: '#57534e' }}>{edu.school} {edu.dates ? `· ${edu.dates}` : ''}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {profile?.certifications && profile.certifications.length > 0 && (
                    <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '14px' }}>CERTIFICATIONS — {profile.certifications.length}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {profile.certifications.map((c, i) => {
                          const name = typeof c === 'string' ? c : (c.name || '');
                          return (
                            <span key={i} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>{name}</span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {profile?.languages && profile.languages.length > 0 && (
                    <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '14px' }}>LANGUAGES — {profile.languages.length}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {profile.languages.map((l, i) => {
                          const name = typeof l === 'string' ? l : (l.name || '');
                          const level = typeof l === 'object' ? l.proficiency || l.level : null;
                          return (
                            <span key={i} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>
                              {name}{level ? ` · ${level}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {(() => {
                    const missingItems = [];
                    if (!(profile?.certifications?.length > 0)) missingItems.push('Certifications');
                    if (!(profile?.projects?.length > 0)) missingItems.push('Projects');
                    if (!hasLinkedIn) missingItems.push('LinkedIn URL');
                    if (!(profile?.contact?.phone)) missingItems.push('Phone');
                    if (!(profile?.contact?.location)) missingItems.push('Location');
                    if ((profile?.experience?.length || 0) < 2) missingItems.push('More Experience');
                    return missingItems.length > 0 ? (
                      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '20px' }}>
                        <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '12px' }}>⚠ MISSING</div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {missingItems.map(item => (
                            <button key={item} onClick={() => setTab('chat')} style={{ background: 'transparent', border: '1px dashed #fecaca', borderRadius: '6px', padding: '7px 14px', fontSize: '12px', color: '#78716c', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer' }}>
                              + Add {item}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: '#ecfdf5', border: '1px solid #22c55e22', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', color: '#22c55e', fontFamily: "'DM Mono', monospace" }}>✓ Profile complete</span>
                      </div>
                    );
                  })()}
                </>
              ) : editProfile && (
                <>
                  {/* Edit: Contact */}
                  <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>CONTACT</div>
                    {['name', 'email', 'phone', 'location', 'linkedin', 'github', 'portfolio'].map(field => (
                      <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                        <span style={{ fontSize: '10px', color: '#78716c', fontFamily: "'DM Mono', monospace", minWidth: 70, textTransform: 'capitalize' }}>{field}</span>
                        <input
                          value={editProfile.contact?.[field] || ''}
                          onChange={e => updateContact(field, e.target.value)}
                          placeholder={['linkedin', 'github', 'portfolio'].includes(field) ? `https://...` : field}
                          style={{ flex: 1, background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '13px', padding: '8px 12px', fontFamily: "'DM Sans', sans-serif", outline: 'none' }}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Edit: Summary */}
                  <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>SUMMARY</div>
                    <textarea
                      value={editProfile.summary || ''}
                      onChange={e => setEditProfile(p => ({ ...p, summary: e.target.value }))}
                      placeholder="A brief professional summary..."
                      rows={3}
                      style={{ width: '100%', background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '13px', padding: '10px 12px', fontFamily: "'DM Sans', sans-serif", outline: 'none', resize: 'vertical' }}
                    />
                  </div>

                  {/* Edit: Skills */}
                  <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '16px' }}>SKILLS</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                      {(editProfile.skills || []).map((skill, si) => (
                        <span key={si} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#e7e5e4', border: '1px solid #d6d3d1', borderRadius: '4px', padding: '4px 8px 4px 10px', fontSize: '11px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>
                          {skill}
                          <button onClick={() => removeSkill(si)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '14px', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        value={newSkill}
                        onChange={e => setNewSkill(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addSkill()}
                        placeholder="Add a skill..."
                        style={{ flex: 1, background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '12px', padding: '8px 12px', fontFamily: "'DM Mono', monospace", outline: 'none' }}
                      />
                      <button onClick={addSkill} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: '#57534e', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>+ Add</button>
                    </div>
                  </div>

                  {/* Edit: Experience */}
                  <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em' }}>EXPERIENCE</div>
                      <button onClick={addExperience} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: '#57534e', padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>+ Add Role</button>
                    </div>
                    {(editProfile.experience || []).map((exp, ei) => (
                      <div key={ei} style={{ paddingBottom: '16px', borderBottom: ei < (editProfile.experience || []).length - 1 ? '1px solid #e7e5e4' : 'none', marginBottom: ei < (editProfile.experience || []).length - 1 ? '16px' : 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ width: 28, height: 28, borderRadius: '6px', background: '#e7e5e4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, color: '#f59e0b' }}>
                            {(exp.company || '?')[0]}
                          </div>
                          <button onClick={() => removeExperience(ei)} style={{ background: 'none', border: '1px solid #fecaca', color: '#ef4444', padding: '4px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>Remove</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                          <input value={exp.title || ''} onChange={e => updateExperience(ei, 'title', e.target.value)} placeholder="Title" style={{ background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '12px', padding: '8px 12px', outline: 'none' }} />
                          <input value={exp.company || ''} onChange={e => updateExperience(ei, 'company', e.target.value)} placeholder="Company" style={{ background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '12px', padding: '8px 12px', outline: 'none' }} />
                          <input value={exp.dates || ''} onChange={e => updateExperience(ei, 'dates', e.target.value)} placeholder="Dates (e.g. Jan 2022 - Dec 2024)" style={{ background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '12px', padding: '8px 12px', outline: 'none' }} />
                          <input value={exp.location || ''} onChange={e => updateExperience(ei, 'location', e.target.value)} placeholder="Location" style={{ background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '12px', padding: '8px 12px', outline: 'none' }} />
                        </div>
                        <div style={{ fontSize: '10px', color: '#78716c', fontFamily: "'DM Mono', monospace", marginBottom: '6px', marginTop: '4px' }}>BULLETS</div>
                        {(exp.bullets || []).map((b, bi) => {
                          const bulletText = typeof b === 'string' ? b : (b.text || '');
                          return (
                          <div key={bi} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'flex-start' }}>
                            <span style={{ color: '#c4c0bc', marginTop: '8px', flexShrink: 0 }}>·</span>
                            <textarea
                              value={bulletText}
                              onChange={e => updateBullet(ei, bi, typeof b === 'object' ? { ...b, text: e.target.value } : e.target.value)}
                              rows={1}
                              style={{ flex: 1, background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#57534e', fontSize: '12px', padding: '8px 10px', outline: 'none', resize: 'vertical', fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5 }}
                            />
                            <button onClick={() => removeBullet(ei, bi)} style={{ background: 'none', border: 'none', color: '#ef444488', fontSize: '16px', cursor: 'pointer', padding: '4px', lineHeight: 1 }}>×</button>
                          </div>
                          );
                        })}
                        <button onClick={() => addBullet(ei)} style={{ background: 'none', border: '1px dashed #d6d3d1', color: '#78716c', padding: '5px 12px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', marginTop: '4px' }}>+ Add bullet</button>
                      </div>
                    ))}
                  </div>

                  {/* Edit: Education */}
                  <div style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em' }}>EDUCATION</div>
                      <button onClick={addEducation} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: '#57534e', padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>+ Add</button>
                    </div>
                    {(editProfile.education || []).map((edu, ei) => (
                      <div key={ei} style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
                        <input value={edu.degree || ''} onChange={e => updateEducation(ei, 'degree', e.target.value)} placeholder="Degree" style={{ flex: 1, background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '12px', padding: '8px 12px', outline: 'none' }} />
                        <input value={edu.school || ''} onChange={e => updateEducation(ei, 'school', e.target.value)} placeholder="School" style={{ flex: 1, background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '12px', padding: '8px 12px', outline: 'none' }} />
                        <input value={edu.dates || ''} onChange={e => updateEducation(ei, 'dates', e.target.value)} placeholder="Dates" style={{ width: 140, background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '6px', color: '#1c1917', fontSize: '12px', padding: '8px 12px', outline: 'none' }} />
                        <button onClick={() => removeEducation(ei)} style={{ background: 'none', border: 'none', color: '#ef444488', fontSize: '16px', cursor: 'pointer', padding: '4px', lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>

                  {/* Save/Cancel bottom bar */}
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '8px' }}>
                    <button onClick={cancelEditing} style={{ background: 'transparent', border: '1px solid #d6d3d1', color: '#57534e', padding: '10px 24px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={saveEditing} disabled={saving} style={{ background: '#22c55e', border: 'none', color: '#1c1917', padding: '10px 28px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── ADD INFO (CHAT) ── */}
          {tab === 'chat' && (
            <div style={{ animation: 'fadeIn 0.3s ease', maxWidth: '700px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>Build Profile</h2>
              <p style={{ fontSize: '13px', color: '#78716c', marginBottom: '20px', lineHeight: 1.6 }}>
                Tell Arjun about your career — type anything or upload documents (PDF, DOCX, TXT, JSON). It gets indexed into your profile for resume tailoring.
              </p>

              <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px', padding: '4px' }}>
                {chatMessages.map((msg, i) => {
                  if (msg.type === 'welcome') {
                    return (
                      <div key={i} style={{ marginBottom: '16px' }}>
                        <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '16px', marginBottom: '10px' }}>
                          <div style={{ fontSize: '13px', color: '#1c1917', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{msg.text}</div>
                        </div>
                        {msg.tips && (
                          <div style={{ background: '#fffbeb', border: '1px solid #f59e0b33', borderRadius: '10px', padding: '14px 16px' }}>
                            <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '10px' }}>TIPS FOR BEST RESULTS</div>
                            {msg.tips.map((tip, ti) => (
                              <div key={ti} style={{ display: 'flex', gap: '10px', padding: '4px 0', fontSize: '12px', color: '#57534e', lineHeight: 1.5 }}>
                                <span style={{ flexShrink: 0 }}>{tip.icon}</span>
                                <span>{tip.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }
                  if (msg.type === 'progress') {
                    const secs = msg.elapsed || 0;
                    const progressStages = [
                      'Scraping job page...',
                      'Reading job description...',
                      'Tailoring resume with AI...',
                      'Calculating ATS match score...',
                      'Improving resume if needed...',
                    ];
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ maxWidth: '85%', padding: '16px', borderRadius: '12px', background: '#ffffff', border: '1px solid #d6d3d1', fontSize: '13px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace" }}>ARJUN — PROCESSING</div>
                            <div style={{ fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>{secs}s</div>
                          </div>
                          {progressStages.map((stage, si) => {
                            const done = si < msg.stage;
                            const active = si === msg.stage;
                            return (
                              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', opacity: si > msg.stage ? 0.3 : 1 }}>
                                <div style={{
                                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: done ? '#22c55e' : active ? '#f59e0b' : '#e7e5e4',
                                  fontSize: '9px', color: done ? '#fff' : '#1c1917', fontWeight: 700,
                                }}>
                                  {done ? '✓' : active ? (
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #fff', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                                  ) : (si + 1)}
                                </div>
                                <span style={{ fontSize: '12px', color: done ? '#22c55e' : active ? '#1c1917' : '#78716c', fontFamily: "'DM Mono', monospace" }}>
                                  {stage}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (msg.type === 'ingestProgress') {
                    const secs = msg.elapsed || 0;
                    const stages = [
                      `Uploading ${msg.fileCount} file${msg.fileCount > 1 ? 's' : ''}...`,
                      'Extracting text from documents...',
                      'Analyzing content with AI...',
                      'Merging into your profile...',
                    ];
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ maxWidth: '85%', padding: '16px', borderRadius: '12px', background: '#ffffff', border: '1px solid #d6d3d1', fontSize: '13px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace" }}>ARJUN — INGESTING</div>
                            <div style={{ fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>{secs}s</div>
                          </div>
                          {stages.map((stage, si) => {
                            const done = si < msg.stage;
                            const active = si === msg.stage;
                            return (
                              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', opacity: si > msg.stage ? 0.3 : 1 }}>
                                <div style={{
                                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: done ? '#22c55e' : active ? '#f59e0b' : '#e7e5e4',
                                  fontSize: '9px', color: done ? '#fff' : '#1c1917', fontWeight: 700,
                                }}>
                                  {done ? '✓' : active ? (
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #fff', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                                  ) : (si + 1)}
                                </div>
                                <span style={{ fontSize: '12px', color: done ? '#22c55e' : active ? '#1c1917' : '#78716c', fontFamily: "'DM Mono', monospace" }}>
                                  {stage}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (msg.type === 'ingestResult') {
                    const { changes, ingestion } = msg;
                    const processed = ingestion?.filesProcessed || msg.fileCount;
                    const skipped = ingestion?.filesSkipped || 0;
                    const errors = ingestion?.errors || [];
                    const typeColor = { added: '#22c55e', updated: '#f59e0b', enriched: '#8b5cf6' };
                    const typeLabel = { added: 'NEW', updated: 'UPDATED', enriched: 'ENRICHED' };
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ maxWidth: '90%', padding: '16px', borderRadius: '12px', background: '#ffffff', border: '1px solid #d6d3d1', fontSize: '13px' }}>
                          <div style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace", marginBottom: '10px' }}>
                            ARJUN — PROFILE UPDATED
                          </div>

                          <div style={{ display: 'flex', gap: '16px', marginBottom: '14px' }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: "'DM Mono', monospace", color: '#22c55e' }}>{processed}</div>
                              <div style={{ fontSize: '10px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>file{processed > 1 ? 's' : ''} read</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: "'DM Mono', monospace", color: '#f59e0b' }}>{changes.length}</div>
                              <div style={{ fontSize: '10px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>change{changes.length !== 1 ? 's' : ''}</div>
                            </div>
                            {skipped > 0 && (
                              <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: "'DM Mono', monospace", color: '#ef4444' }}>{skipped}</div>
                                <div style={{ fontSize: '10px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>skipped</div>
                              </div>
                            )}
                          </div>

                          {changes.length > 0 && (
                            <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                              <div style={{ fontSize: '10px', color: '#78716c', fontFamily: "'DM Mono', monospace", letterSpacing: '0.05em', marginBottom: '8px' }}>WHAT CHANGED</div>
                              {changes.map((c, ci) => (
                                <div key={ci} style={{ display: 'flex', gap: '8px', padding: '4px 0', borderBottom: ci < changes.length - 1 ? '1px solid #e7e5e4' : 'none', alignItems: 'flex-start' }}>
                                  <span style={{
                                    fontSize: '9px', fontFamily: "'DM Mono', monospace", fontWeight: 700,
                                    color: typeColor[c.type] || '#78716c',
                                    background: (typeColor[c.type] || '#78716c') + '15',
                                    border: `1px solid ${(typeColor[c.type] || '#78716c')}33`,
                                    borderRadius: '3px', padding: '1px 5px', flexShrink: 0, marginTop: '2px',
                                  }}>
                                    {typeLabel[c.type] || c.type.toUpperCase()}
                                  </span>
                                  <div>
                                    <span style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{c.section}</span>
                                    <div style={{ fontSize: '12px', color: '#57534e', lineHeight: 1.4 }}>{c.detail}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {errors.length > 0 && (
                            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px', marginBottom: '12px' }}>
                              <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>FILES SKIPPED</div>
                              {errors.map((e, ei) => (
                                <div key={ei} style={{ fontSize: '11px', color: '#57534e', padding: '2px 0' }}>
                                  <span style={{ fontFamily: "'DM Mono', monospace", color: '#ef4444' }}>{e.file}</span>: {e.error}
                                </div>
                              ))}
                            </div>
                          )}

                          {(msg.conflicts || []).length > 0 && (
                            <div style={{ background: '#fffbeb', border: '1px solid #f59e0b44', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                              <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.05em', marginBottom: '10px' }}>
                                POSSIBLE DUPLICATES ({msg.conflicts.length})
                              </div>
                              <div style={{ fontSize: '11px', color: '#78716c', marginBottom: '10px', lineHeight: 1.5 }}>
                                We found entries that look like duplicates. Pick which version to keep — bullets from the removed entry will be merged into the kept one.
                              </div>
                              {msg.conflicts.map((c, ci) => {
                                const label = c.type === 'experience'
                                  ? `${c.existing.company} — "${c.existing.title}" vs "${c.incoming.title}"`
                                  : `${c.existing.school?.split(',')[0]} — "${c.existing.school}" vs "${c.incoming.school}"`;
                                const existingDetail = c.type === 'experience'
                                  ? `${c.existing.title} · ${c.existing.dates || 'no dates'} · ${(c.existing.bullets || []).length} bullets`
                                  : `${c.existing.school} · ${c.existing.degree}`;
                                const incomingDetail = c.type === 'experience'
                                  ? `${c.incoming.title} · ${c.incoming.dates || 'no dates'} · ${(c.incoming.bullets || []).length} bullets`
                                  : `${c.incoming.school} · ${c.incoming.degree}`;
                                return (
                                  <div key={ci} style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '10px', marginBottom: ci < msg.conflicts.length - 1 ? '8px' : 0 }}>
                                    <div style={{ fontSize: '11px', color: '#57534e', fontWeight: 500, marginBottom: '8px' }}>{c.reason}</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                                      <div style={{ fontSize: '11px', color: '#1c1917', fontFamily: "'DM Mono', monospace" }}>
                                        <span style={{ color: '#a8a29e' }}>A:</span> {existingDetail}
                                      </div>
                                      <div style={{ fontSize: '11px', color: '#1c1917', fontFamily: "'DM Mono', monospace" }}>
                                        <span style={{ color: '#a8a29e' }}>B:</span> {incomingDetail}
                                      </div>
                                    </div>
                                    {!msg.conflictsResolved && (
                                      <div style={{ display: 'flex', gap: '6px' }}>
                                        <button onClick={() => handleResolveConflict(i, ci, 'existing')} style={{ flex: 1, background: '#f0fdf4', border: '1px solid #22c55e44', color: '#22c55e', padding: '6px', borderRadius: '5px', fontSize: '10px', fontWeight: 600, fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                                          Keep A
                                        </button>
                                        <button onClick={() => handleResolveConflict(i, ci, 'incoming')} style={{ flex: 1, background: '#eff6ff', border: '1px solid #3b82f644', color: '#3b82f6', padding: '6px', borderRadius: '5px', fontSize: '10px', fontWeight: 600, fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                                          Keep B
                                        </button>
                                        <button onClick={() => handleResolveConflict(i, ci, 'both')} style={{ flex: 1, background: '#fafaf9', border: '1px solid #d6d3d1', color: '#78716c', padding: '6px', borderRadius: '5px', fontSize: '10px', fontWeight: 600, fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                                          Keep Both
                                        </button>
                                      </div>
                                    )}
                                    {msg.conflictsResolved && msg.resolutions?.[ci] && (
                                      <div style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace", marginTop: '4px' }}>
                                        Resolved: kept {msg.resolutions[ci] === 'both' ? 'both' : msg.resolutions[ci] === 'existing' ? 'A' : 'B'}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {(msg.ambiguities || []).length > 0 && (
                            <div style={{ background: '#f0f9ff', border: '1px solid #3b82f644', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                              <div style={{ fontSize: '10px', color: '#3b82f6', fontFamily: "'DM Mono', monospace", letterSpacing: '0.05em', marginBottom: '10px' }}>
                                NEEDS CLARIFICATION ({msg.ambiguities.filter((_, ai) => !msg.ambAnswers?.[ai]).length} remaining)
                              </div>
                              <div style={{ fontSize: '11px', color: '#78716c', marginBottom: '10px', lineHeight: 1.5 }}>
                                A few things weren't clear from your resume. Help Arjun get them right.
                              </div>
                              {msg.ambiguities.map((amb, ai) => (
                                <div key={ai} style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '10px', marginBottom: ai < msg.ambiguities.length - 1 ? '8px' : 0 }}>
                                  <div style={{ fontSize: '11px', color: '#1c1917', marginBottom: '6px', lineHeight: 1.5 }}>
                                    {amb.question}
                                  </div>
                                  <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginBottom: '8px' }}>
                                    Current value: <span style={{ color: '#57534e' }}>{amb.value || 'empty'}</span>
                                  </div>
                                  {msg.ambAnswers?.[ai] !== undefined ? (
                                    <div style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace'" }}>
                                      Answered: {msg.ambAnswers[ai]}
                                    </div>
                                  ) : amb.options?.length ? (
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                      {amb.options.map((opt, oi) => (
                                        <button key={oi} onClick={() => handleResolveAmbiguity(i, ai, opt)} style={{
                                          background: '#fafaf9', border: '1px solid #d6d3d1', color: '#1c1917',
                                          padding: '5px 12px', borderRadius: '5px', fontSize: '11px', cursor: 'pointer',
                                          fontFamily: "'DM Sans', sans-serif",
                                        }}>
                                          {opt}
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <input
                                        type="text"
                                        placeholder="Type your answer..."
                                        onKeyDown={e => { if (e.key === 'Enter' && e.target.value.trim()) { handleResolveAmbiguity(i, ai, e.target.value.trim()); e.target.value = ''; } }}
                                        style={{
                                          flex: 1, padding: '5px 10px', borderRadius: '5px', border: '1px solid #d6d3d1',
                                          fontSize: '11px', fontFamily: "'DM Sans', sans-serif", outline: 'none',
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {(msg.drops?.items || []).length > 0 && (
                            <div style={{ background: '#fdf2f8', border: '1px solid #ec489944', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                              <div style={{ fontSize: '10px', color: '#ec4899', fontFamily: "'DM Mono', monospace", letterSpacing: '0.05em', marginBottom: '10px' }}>
                                INGESTION FEEDBACK ({msg.drops.items.length} item{msg.drops.items.length !== 1 ? 's' : ''} not added)
                              </div>
                              <div style={{ fontSize: '11px', color: '#78716c', marginBottom: '10px', lineHeight: 1.5 }}>
                                These items were extracted from your file but didn't make it into your profile. This usually means they already existed or were merged into existing entries.
                              </div>
                              {msg.drops.items.map((d, di) => {
                                const reasonLabels = {
                                  bullet_dropped_during_merge: 'Dropped during merge — may already exist in a different form',
                                  entry_not_in_profile: 'Company/entry not found in merged profile',
                                  project_not_in_profile: 'Project not found in merged profile',
                                  education_not_in_profile: 'Education entry not found',
                                  skill_not_in_profile: 'Skill not found in merged profile',
                                  cert_not_in_profile: 'Certification not found',
                                };
                                return (
                                  <div key={di} style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: '6px', padding: '8px 10px', marginBottom: di < msg.drops.items.length - 1 ? '6px' : 0 }}>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                      <span style={{
                                        fontSize: '9px', fontFamily: "'DM Mono', monospace", fontWeight: 700,
                                        color: '#ec4899', background: '#ec489915', border: '1px solid #ec489933',
                                        borderRadius: '3px', padding: '1px 5px', flexShrink: 0, marginTop: '2px',
                                      }}>
                                        {d.field.toUpperCase()}
                                      </span>
                                      <div>
                                        <div style={{ fontSize: '12px', color: '#1c1917', lineHeight: 1.4, marginBottom: '2px' }}>
                                          {(d.value || '').length > 100 ? d.value.slice(0, 100) + '...' : d.value}
                                        </div>
                                        {d.company && <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace" }}>{d.company}</div>}
                                        <div style={{ fontSize: '10px', color: '#78716c', marginTop: '2px' }}>{reasonLabels[d.reason] || d.reason.replace(/_/g, ' ')}</div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                              <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", marginTop: '8px' }}>
                                Coverage: {Math.round(100 * (msg.drops.totalExtracted - msg.drops.items.length) / msg.drops.totalExtracted)}% of extracted items landed in profile
                              </div>
                            </div>
                          )}

                          <div style={{ fontSize: '12px', color: '#78716c', lineHeight: 1.5 }}>
                            {changes.length === 0 ? 'No new information found — your profile already had this data.' : 'What else would you like to add?'}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (msg.type === 'ingestError') {
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ maxWidth: '85%', padding: '16px', borderRadius: '12px', background: '#ffffff', border: '1px solid #fecaca', fontSize: '13px' }}>
                          <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", marginBottom: '8px' }}>ARJUN — UPLOAD FAILED</div>
                          <div style={{ fontSize: '12px', color: '#57534e', lineHeight: 1.5, marginBottom: '8px' }}>{msg.error}</div>
                          <div style={{ fontSize: '11px', color: '#a8a29e' }}>Check the file format and try again. Supported: PDF, DOCX, TXT, JSON.</div>
                        </div>
                      </div>
                    );
                  }

                  if (msg.type === 'jobResult' && msg.job) {
                    const j = msg.job;
                    const scoreColor = (j.ats_score || 0) >= 90 ? '#22c55e' : (j.ats_score || 0) >= 75 ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ maxWidth: '90%', padding: '16px', borderRadius: '12px', background: '#ffffff', border: '1px solid #d6d3d1', fontSize: '13px' }}>
                          <div style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace", marginBottom: '10px' }}>ARJUN — RESUME READY</div>
                          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>{j.title}</div>
                          <div style={{ fontSize: '12px', color: '#57534e', fontFamily: "'DM Mono', monospace", marginBottom: '14px' }}>{j.company}</div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                            <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: "'DM Mono', monospace", color: scoreColor }}>{j.ats_score || '—'}</div>
                            <div>
                              <div style={{ fontSize: '10px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>ATS SCORE</div>
                              <div style={{ height: '4px', width: '120px', background: '#e7e5e4', borderRadius: '2px', marginTop: '4px' }}>
                                <div style={{ height: '100%', width: `${j.ats_score || 0}%`, background: scoreColor, borderRadius: '2px', transition: 'width 1s ease' }} />
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                            <div>
                              <div style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>MATCHED ({(j.matched_keywords || []).length})</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                {(j.matched_keywords || []).slice(0, 8).map(k => (
                                  <span key={k} style={{ background: '#ecfdf5', border: '1px solid #22c55e22', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', color: '#22c55e88', fontFamily: "'DM Mono', monospace" }}>{k}</span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>MISSING ({(j.missing_keywords || []).length})</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                {(j.missing_keywords || []).slice(0, 8).map(k => (
                                  <span key={k} style={{ background: '#fef2f2', border: '1px solid #ef444422', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', color: '#ef444488', fontFamily: "'DM Mono', monospace" }}>{k}</span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <ThinkingSection job={j} />

                          <DownloadButtons jobId={j.job_id} downloading={downloading} onDownload={handleDownload} />
                        </div>
                      </div>
                    );
                  }

                  return (
                  <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '12px' }}>
                    <div style={{
                      maxWidth: '85%', padding: '12px 16px', borderRadius: '12px',
                      background: msg.role === 'user' ? '#f59e0b' : '#ffffff',
                      color: '#1c1917',
                      border: msg.role === 'user' ? 'none' : '1px solid #d6d3d1',
                      fontSize: '13px', lineHeight: 1.6,
                    }}>
                      {msg.role === 'arjun' && (
                        <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>ARJUN</div>
                      )}
                      {msg.text}

                      {(msg.pendingChanges || msg.pendingDeletions) && (
                        <div style={{ marginTop: '12px', background: '#fafaf9', border: '1px solid #d6d3d1', borderRadius: '8px', padding: '12px', fontSize: '12px' }}>
                          <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", letterSpacing: '0.08em', marginBottom: '10px' }}>
                            PROPOSED CHANGES
                          </div>
                          {formatChanges(msg.pendingChanges, msg.pendingDeletions).map((item, ci) => (
                            <div key={ci} style={{ display: 'flex', gap: '8px', padding: '4px 0', borderBottom: '1px solid #e7e5e4' }}>
                              {item.section && (
                                <span style={{ fontSize: '10px', color: item.isDelete ? '#ef4444' : '#78716c', fontFamily: "'DM Mono', monospace", minWidth: 70, flexShrink: 0, textTransform: 'uppercase' }}>{item.section}</span>
                              )}
                              <span style={{ color: item.isDelete ? '#ef4444' : '#57534e', fontSize: '12px', textDecoration: item.isDelete ? 'line-through' : 'none' }}>{item.detail}</span>
                            </div>
                          ))}

                          {!msg.confirmState && (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                              <button
                                onClick={() => handleConfirmChanges(i, msg.pendingChanges, msg.pendingDeletions)}
                                style={{ flex: 1, background: '#22c55e', color: '#1c1917', border: 'none', padding: '8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                              >
                                Confirm & Save
                              </button>
                              <button
                                onClick={() => handleRejectChanges(i)}
                                style={{ flex: 1, background: 'transparent', color: '#57534e', border: '1px solid #d6d3d1', padding: '8px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                Discard
                              </button>
                            </div>
                          )}

                          {msg.confirmState === 'saving' && (
                            <div style={{ marginTop: '10px', fontSize: '11px', color: '#f59e0b', fontFamily: "'DM Mono', monospace" }}>Saving...</div>
                          )}
                          {msg.confirmState === 'confirmed' && (
                            <div style={{ marginTop: '10px', fontSize: '11px', color: '#22c55e', fontFamily: "'DM Mono', monospace" }}>✓ Saved to profile</div>
                          )}
                          {msg.confirmState === 'rejected' && (
                            <div style={{ marginTop: '10px', fontSize: '11px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>Changes discarded</div>
                          )}
                        </div>
                      )}
                      {msg.role === 'arjun' && (
                        <FeedbackButtons traceId={msg.traceId} feedback={feedbackMap[msg.traceId]} onFeedback={handleFeedback} />
                      )}
                    </div>
                  </div>
                  );
                })}
                {chatSending && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ padding: '12px 16px', borderRadius: '12px', background: '#ffffff', border: '1px solid #d6d3d1', fontSize: '13px', color: '#78716c' }}>
                      <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>ARJUN</div>
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <label style={{ background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '8px', padding: '10px 14px', cursor: 'pointer', flexShrink: 0, opacity: filesUploading ? 0.5 : 1 }} title="Upload PDF, DOCX, TXT, or JSON">
                  <input type="file" accept=".pdf,.docx,.doc,.txt,.json" multiple style={{ display: 'none' }} onChange={e => { handleChatFiles(e.target.files); e.target.value = ''; }} disabled={filesUploading} />
                  <span style={{ fontSize: '14px' }}>{filesUploading ? '...' : '📄'}</span>
                </label>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleChatSend()}
                  placeholder="I have 3 years of experience at Google as a PM..."
                  disabled={chatSending}
                  style={{
                    flex: 1, background: '#fafaf9', border: '1px solid #d6d3d1',
                    borderRadius: '8px', color: '#1c1917', fontFamily: "'DM Sans', sans-serif",
                    fontSize: '13px', padding: '12px 16px', outline: 'none',
                  }}
                />
                <button
                  onClick={handleChatSend}
                  disabled={!chatInput.trim() || chatSending}
                  style={{
                    background: chatInput.trim() ? '#f59e0b' : '#e7e5e4',
                    color: chatInput.trim() ? '#1c1917' : '#a8a29e',
                    border: 'none', padding: '10px 20px', borderRadius: '8px',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          )}

          {/* ── JOB ACTIVITY ── */}
          {tab === 'jobs' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>Job Activity</h2>
              <p style={{ fontSize: '13px', color: '#78716c', marginBottom: '28px' }}>All job requests — delivered, processing, and failed.</p>

              {jobs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: '#a8a29e' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>📭</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '13px' }}>No jobs processed yet</div>
                  <div style={{ fontSize: '12px', color: '#c4c0bc', marginTop: '6px' }}>Submit a job URL or wait for the auto-run</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {jobs.map(job => (
                    <div key={job.job_id}>
                      <div
                        onClick={() => (job.status === 'delivered' || job.status === 'failed') ? setActiveJob(activeJob?.job_id === job.job_id ? null : job) : null}
                        style={{
                          display: 'grid', gridTemplateColumns: '1fr auto auto auto auto',
                          alignItems: 'center', gap: '16px', padding: '14px 16px',
                          background: activeJob?.job_id === job.job_id ? '#ffffff' : 'transparent',
                          border: `1px solid ${activeJob?.job_id === job.job_id ? '#d6d3d1' : 'transparent'}`,
                          borderRadius: '8px', cursor: (job.status === 'delivered' || job.status === 'failed') ? 'pointer' : 'default',
                          transition: 'all 0.15s',
                          opacity: job.status === 'failed' ? 0.6 : 1,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>{job.title || 'Untitled job'}</div>
                          <div style={{ fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>{job.company || job.url?.slice(0, 40) || 'Unknown'}</div>
                        </div>
                        {job.status === 'delivered' && job.ats_score ? (
                          <ATSBadge score={job.ats_score} />
                        ) : job.status === 'processing' ? (
                          <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', background: '#f59e0b11', border: '1px solid #f59e0b33', borderRadius: '4px', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                            processing
                          </span>
                        ) : job.status === 'failed' ? (
                          <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#ef4444', background: '#ef444411', border: '1px solid #ef444433', borderRadius: '4px', padding: '2px 8px' }}>failed</span>
                        ) : null}
                        {job.improved && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', background: '#f59e0b11', border: '1px solid #f59e0b33', borderRadius: '4px', padding: '2px 8px' }}>2nd run</span>}
                        <span style={{ fontSize: '11px', color: '#c4c0bc', fontFamily: "'DM Mono', monospace" }}>{new Date(job.created_at || job.seen_at).toLocaleDateString()}</span>
                        {job.status === 'delivered' ? (
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button onClick={(e) => handleDownload(e, job.job_id, 'docx')} disabled={downloading === `${job.job_id}_docx`} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: downloading === `${job.job_id}_docx` ? '#f59e0b' : '#888', padding: '5px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                              {downloading === `${job.job_id}_docx` ? '...' : '↓ docx'}
                            </button>
                            <button onClick={(e) => handleDownload(e, job.job_id, 'pdf')} disabled={downloading === `${job.job_id}_pdf`} style={{ background: '#e7e5e4', border: '1px solid #d6d3d1', color: downloading === `${job.job_id}_pdf` ? '#f59e0b' : '#888', padding: '5px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                              {downloading === `${job.job_id}_pdf` ? '...' : '↓ pdf'}
                            </button>
                          </div>
                        ) : (
                          <span style={{ width: '60px' }} />
                        )}
                      </div>

                      {activeJob?.job_id === job.job_id && job.status === 'failed' && (
                        <div style={{ background: '#f5f5f4', border: '1px solid #e7e5e4', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '16px', animation: 'fadeIn 0.2s ease' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#ef4444' }}>FAILED</span>
                          </div>
                          <p style={{ fontSize: '12px', color: '#57534e', lineHeight: 1.5, marginBottom: '8px' }}>
                            This job couldn't be processed — the page may require login, the URL may be invalid, or the scraper couldn't extract the job description.
                          </p>
                          {job.url && <a href={job.url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>→ {job.url}</a>}
                        </div>
                      )}

                      {activeJob?.job_id === job.job_id && job.status === 'delivered' && (
                        <div style={{ background: '#f5f5f4', border: '1px solid #e7e5e4', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '16px', animation: 'fadeIn 0.2s ease' }}>
                          {/* ATS Score bar */}
                          {job.ats_score && (
                            <div style={{ marginBottom: '16px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <span style={{ fontSize: '10px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>ATS MATCH SCORE</span>
                                <span style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", fontWeight: 600, color: job.ats_score >= 90 ? '#22c55e' : job.ats_score >= 75 ? '#f59e0b' : '#ef4444' }}>{job.ats_score}/100</span>
                              </div>
                              <div style={{ height: '4px', background: '#e7e5e4', borderRadius: '2px' }}>
                                <div style={{ height: '100%', width: `${job.ats_score}%`, background: job.ats_score >= 90 ? '#22c55e' : job.ats_score >= 75 ? '#f59e0b' : '#ef4444', borderRadius: '2px', transition: 'width 1s ease' }} />
                              </div>
                            </div>
                          )}

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                            <div>
                              <div style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace", marginBottom: '8px' }}>✓ MATCHED ({(job.matched_keywords || []).length})</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {(job.matched_keywords || []).map(k => (
                                  <span key={k} style={{ background: '#ecfdf5', border: '1px solid #22c55e22', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', color: '#22c55e88', fontFamily: "'DM Mono', monospace" }}>{k}</span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", marginBottom: '8px' }}>✗ MISSING ({(job.missing_keywords || []).length})</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {(job.missing_keywords || []).map(k => (
                                  <button key={k} onClick={() => handleAddKeyword(k)} style={{ background: addedKeywords.includes(k) ? '#ecfdf5' : '#fef2f2', border: `1px solid ${addedKeywords.includes(k) ? '#22c55e33' : '#ef444422'}`, borderRadius: '4px', padding: '3px 8px', fontSize: '10px', color: addedKeywords.includes(k) ? '#22c55e88' : '#ef444488', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}>
                                    {addedKeywords.includes(k) ? '✓ ' : '+ '}{k}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          <ThinkingSection job={job} />

                          {/* Download + meta row */}
                          <div style={{ padding: '12px', background: '#ffffff', border: '1px solid #d6d3d1', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                              <button onClick={(e) => handleDownload(e, job.job_id, 'docx')} disabled={downloading === `${job.job_id}_docx`} style={{ flex: 1, background: '#f59e0b', color: '#1c1917', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: downloading === `${job.job_id}_docx` ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                                {downloading === `${job.job_id}_docx` ? '...' : '↓ .docx'}
                              </button>
                              <button onClick={(e) => handleDownload(e, job.job_id, 'pdf')} disabled={downloading === `${job.job_id}_pdf`} style={{ flex: 1, background: '#ffffff', color: '#1c1917', border: '1px solid #d6d3d1', padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: downloading === `${job.job_id}_pdf` ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                                {downloading === `${job.job_id}_pdf` ? '...' : '↓ .pdf'}
                              </button>
                            </div>
                            <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>
                              {job.ats_score && <span>ATS: {job.ats_score}</span>}
                              <span>Matched: {(job.matched_keywords || []).length}</span>
                              <span>Missing: {(job.missing_keywords || []).length}</span>
                              {job.improved && <span style={{ color: '#f59e0b' }}>2nd pass</span>}
                            </div>
                          </div>

                          {job.url && <a href={job.url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: '12px', fontSize: '11px', color: '#c4c0bc', fontFamily: "'DM Mono', monospace" }}>→ {job.url}</a>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAILOR RESUME (CHAT) ── */}
          {tab === 'submit' && (
            <div style={{ animation: 'fadeIn 0.3s ease', maxWidth: '700px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>Tailor Resume</h2>
              <p style={{ fontSize: '13px', color: '#78716c', marginBottom: '20px', lineHeight: 1.6 }}>
                Paste a job URL and Arjun will scrape the JD, tailor your resume, calculate ATS score, and deliver it in .docx and .pdf.
              </p>

              <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px', padding: '4px' }}>
                {tailorMessages.map((msg, i) => {
                  if (msg.type === 'progress') {
                    const secs = msg.elapsed || 0;
                    const progressStages = [
                      'Scraping job page...',
                      'Reading job description...',
                      'Tailoring resume with AI...',
                      'Calculating ATS match score...',
                      'Improving resume if needed...',
                    ];
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ maxWidth: '85%', padding: '16px', borderRadius: '12px', background: '#ffffff', border: '1px solid #d6d3d1', fontSize: '13px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace" }}>ARJUN — PROCESSING</div>
                            <div style={{ fontSize: '11px', color: '#78716c', fontFamily: "'DM Mono', monospace" }}>{secs}s</div>
                          </div>
                          {progressStages.map((stage, si) => {
                            const done = si < msg.stage;
                            const active = si === msg.stage;
                            return (
                              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', opacity: si > msg.stage ? 0.3 : 1 }}>
                                <div style={{
                                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: done ? '#22c55e' : active ? '#f59e0b' : '#e7e5e4',
                                  fontSize: '9px', color: done ? '#fff' : '#1c1917', fontWeight: 700,
                                }}>
                                  {done ? '✓' : active ? (
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #fff', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                                  ) : (si + 1)}
                                </div>
                                <span style={{ fontSize: '12px', color: done ? '#22c55e' : active ? '#1c1917' : '#78716c', fontFamily: "'DM Mono', monospace" }}>
                                  {stage}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (msg.type === 'jobResult' && msg.job) {
                    const j = msg.job;
                    const scoreColor = (j.ats_score || 0) >= 90 ? '#22c55e' : (j.ats_score || 0) >= 75 ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ maxWidth: '90%', padding: '16px', borderRadius: '12px', background: '#ffffff', border: '1px solid #d6d3d1', fontSize: '13px' }}>
                          <div style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace", marginBottom: '10px' }}>ARJUN — RESUME READY</div>
                          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>{j.title}</div>
                          <div style={{ fontSize: '12px', color: '#57534e', fontFamily: "'DM Mono', monospace", marginBottom: '14px' }}>{j.company}</div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                            <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: "'DM Mono', monospace", color: scoreColor }}>{j.ats_score || '—'}</div>
                            <div>
                              <div style={{ fontSize: '10px', color: '#57534e', fontFamily: "'DM Mono', monospace" }}>ATS SCORE</div>
                              <div style={{ height: '4px', width: '120px', background: '#e7e5e4', borderRadius: '2px', marginTop: '4px' }}>
                                <div style={{ height: '100%', width: `${j.ats_score || 0}%`, background: scoreColor, borderRadius: '2px', transition: 'width 1s ease' }} />
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                            <div>
                              <div style={{ fontSize: '10px', color: '#22c55e', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>MATCHED ({(j.matched_keywords || []).length})</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                {(j.matched_keywords || []).slice(0, 8).map(k => (
                                  <span key={k} style={{ background: '#ecfdf5', border: '1px solid #22c55e22', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', color: '#22c55e88', fontFamily: "'DM Mono', monospace" }}>{k}</span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>MISSING ({(j.missing_keywords || []).length})</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                {(j.missing_keywords || []).slice(0, 8).map(k => (
                                  <span key={k} style={{ background: '#fef2f2', border: '1px solid #ef444422', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', color: '#ef444488', fontFamily: "'DM Mono', monospace" }}>{k}</span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <ThinkingSection job={j} />

                          <DownloadButtons jobId={j.job_id} downloading={downloading} onDownload={handleDownload} />
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '12px' }}>
                      <div style={{
                        maxWidth: '85%', padding: '12px 16px', borderRadius: '12px',
                        background: msg.role === 'user' ? '#f59e0b' : '#ffffff',
                        color: '#1c1917',
                        border: msg.role === 'user' ? 'none' : '1px solid #d6d3d1',
                        fontSize: '13px', lineHeight: 1.6, whiteSpace: 'pre-line',
                      }}>
                        {msg.role === 'arjun' && (
                          <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>ARJUN</div>
                        )}
                        {msg.text}
                        {msg.role === 'arjun' && (
                          <FeedbackButtons traceId={msg.traceId} feedback={feedbackMap[msg.traceId]} onFeedback={handleFeedback} />
                        )}
                      </div>
                    </div>
                  );
                })}
                {tailorSending && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ padding: '12px 16px', borderRadius: '12px', background: '#ffffff', border: '1px solid #d6d3d1', fontSize: '13px', color: '#78716c' }}>
                      <div style={{ fontSize: '10px', color: '#f59e0b', fontFamily: "'DM Mono', monospace", marginBottom: '6px' }}>ARJUN</div>
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={tailorEndRef} />
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  value={tailorInput}
                  onChange={e => setTailorInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleTailorSend()}
                  placeholder="Paste a job URL here..."
                  disabled={tailorSending}
                  style={{
                    flex: 1, background: '#fafaf9', border: '1px solid #d6d3d1',
                    borderRadius: '8px', color: '#1c1917', fontFamily: "'DM Sans', sans-serif",
                    fontSize: '13px', padding: '12px 16px', outline: 'none',
                  }}
                />
                <button
                  onClick={handleTailorSend}
                  disabled={!tailorInput.trim() || tailorSending}
                  style={{
                    background: tailorInput.trim() ? '#f59e0b' : '#e7e5e4',
                    color: tailorInput.trim() ? '#1c1917' : '#a8a29e',
                    border: 'none', padding: '10px 20px', borderRadius: '8px',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          )}

          {/* ── SKILL GAPS ── */}
          {tab === 'gaps' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', marginBottom: '6px' }}>Skill Gaps</h2>
              <p style={{ fontSize: '13px', color: '#78716c', marginBottom: '28px' }}>
                Keywords appearing in job descriptions but missing from your profile.
              </p>

              {topMissing.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: '#a8a29e' }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '13px' }}>No gap data yet — process some jobs first</div>
                </div>
              ) : (
                <div style={{ background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '24px' }}>
                  <div style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em', marginBottom: '20px' }}>
                    MOST COMMON GAPS — {jobs.length} JOBS ANALYZED
                  </div>
                  {topMissing.map(([keyword, count]) => (
                    <div key={keyword} style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
                      <div style={{ width: '130px', fontSize: '12px', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{keyword}</div>
                      <div style={{ flex: 1, height: '3px', background: '#e7e5e4', borderRadius: '2px' }}>
                        <div style={{ height: '100%', width: `${(count / jobs.length) * 100}%`, background: count >= 3 ? '#ef4444' : '#f59e0b', borderRadius: '2px', transition: 'width 1s ease' }} />
                      </div>
                      <span style={{ fontSize: '10px', color: '#a8a29e', fontFamily: "'DM Mono', monospace", minWidth: 40 }}>{count}/{jobs.length}</span>
                      <button
                        onClick={() => handleAddKeyword(keyword)}
                        style={{
                          background: addedKeywords.includes(keyword) ? '#ecfdf5' : 'transparent',
                          border: `1px solid ${addedKeywords.includes(keyword) ? '#22c55e33' : '#d6d3d1'}`,
                          color: addedKeywords.includes(keyword) ? '#22c55e' : '#555',
                          padding: '4px 12px', borderRadius: '4px',
                          fontSize: '11px', fontFamily: "'DM Mono', monospace",
                          transition: 'all 0.2s',
                        }}
                      >
                        {addedKeywords.includes(keyword) ? '✓ added' : '+ add'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
