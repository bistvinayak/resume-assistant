import { useEffect, useState } from 'react';
import { api } from '../api';
import { auth } from '../firebase';
import { pingExtension } from '../extensionBridge';

// Dashboard "Get started" tab: setup steps that tick themselves off from real data, plus a short
// tour of what Arjun and the Chrome extension do. New users land here until the core steps are
// done or they choose "I'm all set" (remembered in localStorage).

const mono = "'DM Mono', monospace";
const serif = "'DM Serif Display', serif";
const card = { background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '20px 22px' };
const label = { fontSize: '10.5px', fontFamily: mono, letterSpacing: '0.08em', color: '#78716c' };

const readFlag = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const setFlag = (k) => { try { localStorage.setItem(k, '1'); } catch { /* storage blocked */ } };

function Check({ done }) {
  return (
    <div aria-hidden="true" style={{
      width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: done ? '#dcfce7' : '#fff', border: `1.5px solid ${done ? '#16a34a' : '#d6d3d1'}`, color: '#16a34a', fontSize: '13px', fontWeight: 700,
    }}>{done ? '✓' : ''}</div>
  );
}

function Step({ n, done, optional, title, children, action, onAction }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: '14px', alignItems: 'start', padding: '16px 0', borderTop: '1px solid #f5f5f4' }}>
      <Check done={done} />
      <div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: done ? '#78716c' : '#1c1917', marginBottom: '3px' }}>
          <span style={{ fontFamily: mono, fontSize: '11px', color: '#b45309', marginRight: '8px' }}>{n}</span>
          {title}
          {optional && <span style={{ marginLeft: '8px', fontSize: '10.5px', fontWeight: 500, color: '#78716c', background: '#f5f5f4', borderRadius: '999px', padding: '2px 8px' }}>optional</span>}
        </div>
        <div style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.6, maxWidth: '560px' }}>{children}</div>
      </div>
      {/* Filled = required and still to do; outlined = optional; green text = already done. */}
      {done ? (
        <button onClick={onAction} style={{ background: 'none', border: 'none', color: '#16a34a', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', padding: '8px 4px' }}>
          ✓ Done · view
        </button>
      ) : (
        <button onClick={onAction} style={{
          background: optional ? '#fff' : '#f59e0b', color: optional ? '#1c1917' : '#fff', border: optional ? '1px solid #d6d3d1' : 'none',
          borderRadius: '8px', padding: '8px 14px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>{action} →</button>
      )}
    </div>
  );
}

const EXTENSION_FEATURES = [
  { title: 'How well do I fit this job?', where: 'On any job posting', text: 'One click scores how well the job fits your profile (overall, skills, domain, seniority) and flags postings that explicitly rule out visa sponsorship.' },
  { title: 'Full analysis', where: 'Side panel', text: 'Lists what the job asks for and marks each requirement as strong, different wording, partial or not in your profile, with what to do about each.' },
  { title: 'Ask Arjun', where: 'Side panel chat', text: 'Ask anything about the job. Say “make my resume for this job” and refine it with feedback like “shorter summary”. It only uses facts from your profile.' },
  { title: 'Fill this page', where: 'On application forms', text: 'Fills the form by what each field means, outlines what it filled in green, asks you to check unsure answers, and lets you undo everything.' },
];

export default function GettingStarted({ profile, jobs, gmailStatus, goTo }) {
  const [jevKey, setJevKey] = useState(false);
  const [resumeFormat, setResumeFormat] = useState(undefined);
  const [extension, setExtension] = useState(undefined);
  const chatOpened = readFlag('arjun_gs_chat');

  useEffect(() => {
    api.getResumeFormat().then(setResumeFormat).catch(() => setResumeFormat(null));
    pingExtension().then(setExtension);
    Promise.all([api.getJevKey().catch(() => null), api.getOpenRouterKey().catch(() => null)])
      .then(([j, o]) => setJevKey(!!(j?.hasKey || o?.hasKey)));
  }, []);

  const steps = [
    { key: 'resume', core: true, done: (profile?.experience || []).length > 0 },
    { key: 'format', core: false, done: !!resumeFormat },
    { key: 'chat', core: false, done: chatOpened },
    { key: 'apply', core: true, done: (jobs || []).length > 0 },
    { key: 'extension', core: true, done: !!extension },
    { key: 'gmail', core: false, done: gmailStatus?.status === 'approved' },
    { key: 'jev', core: false, done: jevKey },
  ];
  const done = Object.fromEntries(steps.map(s => [s.key, s.done]));
  const doneCount = steps.filter(s => s.done).length;
  const coreDone = steps.filter(s => s.core).every(s => s.done);

  useEffect(() => { if (coreDone) setFlag(`arjun_getting_started_done:${auth.currentUser?.uid}`); }, [coreDone]);

  const finish = () => { setFlag(`arjun_getting_started_done:${auth.currentUser?.uid}`); goTo('profile'); };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'grid', gap: '18px', maxWidth: '780px' }}>
      <div>
        <h2 style={{ fontFamily: serif, fontSize: '26px', marginBottom: '6px' }}>Get started with Arjun</h2>
        <p style={{ fontSize: '13px', color: '#78716c', lineHeight: 1.55, maxWidth: '640px' }}>
          Arjun builds one profile from your resume, then uses it everywhere: tailored resumes for each job, a fit check on any job posting,
          and filling in applications. Everything it writes comes from your real experience.
        </p>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <div style={label}>SETUP · {doneCount} OF {steps.length} DONE</div>
          {!coreDone && <button onClick={finish} style={{ background: 'none', border: 'none', color: '#b45309', fontSize: '12px', cursor: 'pointer', padding: 0 }}>I’m all set, hide this</button>}
        </div>
        <div aria-hidden="true" style={{ height: '5px', background: '#f5f5f4', borderRadius: '3px', overflow: 'hidden', marginBottom: '4px' }}>
          <div style={{ height: '100%', width: `${(doneCount / steps.length) * 100}%`, background: '#f59e0b', transition: 'width .3s' }} />
        </div>

        <Step n="1" done={done.resume} title="Upload your resume" action="Upload" onAction={() => goTo('chat')}>
          Arjun reads it and builds your profile: each role, the impact behind every bullet, projects, skills and education.
          Upload it (PDF or text) in <b>Chat with Arjun</b>. You can upload more files later and Arjun merges them without duplicates.
        </Step>
        <Step n="2" done={done.format} optional title="Match your resume layout" action="Set layout" onAction={() => goTo('profile', 'resume-format')}>
          Want your usual layout and page count? Upload a resume in that format. Only the layout is used; your content comes from step 1.
        </Step>
        <Step n="3" done={done.chat} optional title="Fill in what your resume leaves out" action="Chat with Arjun" onAction={() => goTo('chat')}>
          Tell Arjun about projects, results or tools that aren’t on your resume, in plain words. It proposes the changes and nothing is saved until you confirm.
        </Step>
        <Step n="4" done={done.apply} title="Get a resume tailored to a job" action="Apply to a job" onAction={() => goTo('submit')}>
          Paste a LinkedIn job link in <b>Apply to Job</b>. Arjun rewrites your resume for that job using only your real experience, checks its keyword match,
          and can add a cover letter. It appears in <b>My Applications</b> to download.
        </Step>
        <Step n="5" done={done.extension} title="Add the Chrome extension" action="Install" onAction={() => goTo('extension')}>
          Brings Arjun to the job sites you already use. See what it does below.
          {extension === null && ' Not detected in this browser yet.'}
        </Step>
        <Step n="6" done={done.gmail} optional title="Tailor from LinkedIn job alerts automatically" action="Set up" onAction={() => goTo('profile', 'gmail-forwarding')}>
          Forward your LinkedIn job alert emails and Arjun tailors a resume for each new job every 2 hours and emails it to you.
        </Step>
        <Step n="7" done={done.jev} optional title="Add your own AI keys" action="Add keys" onAction={() => goTo('settings')}>
          Arjun uses free AI models by default. Add an OpenRouter key for stronger resume writing, or a Jev key for job-fit scoring, billed to your own account.
        </Step>
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: '12px' }}>WHAT THE CHROME EXTENSION DOES</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {EXTENSION_FEATURES.map(f => (
            <div key={f.title} style={{ border: '1px solid #f5f5f4', borderRadius: '10px', padding: '14px', background: '#fafaf9' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 600 }}>{f.title}</div>
              <div style={{ fontSize: '10.5px', fontFamily: mono, color: '#b45309', margin: '2px 0 6px' }}>{f.where}</div>
              <div style={{ fontSize: '12.5px', color: '#57534e', lineHeight: 1.55 }}>{f.text}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...card, display: 'grid', gap: '10px' }}>
        <div style={label}>ALSO IN ARJUN</div>
        <div style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.6 }}>
          <b>Skill Gaps</b> shows the keywords that keep coming up in jobs you apply to but aren’t in your profile, so you know what to add (if you have it) or learn.{' '}
          <button onClick={() => goTo('gaps')} style={{ background: 'none', border: 'none', color: '#b45309', cursor: 'pointer', padding: 0, fontSize: '13px' }}>Open Skill Gaps</button>
        </div>
        <div style={{ fontSize: '13px', color: '#57534e', lineHeight: 1.6 }}>
          <b>Arjun Skills</b> holds the writing playbooks Arjun builds from your profile (career story, cover-letter story, writing voice) and your resume format, so tailored resumes sound like you. You can correct them.{' '}
          <button onClick={() => goTo('skills')} style={{ background: 'none', border: 'none', color: '#b45309', cursor: 'pointer', padding: 0, fontSize: '13px' }}>Open Arjun Skills</button>
        </div>
      </div>
    </div>
  );
}
