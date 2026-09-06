'use strict';

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
} = require('docx');

// Half-point sizes (docx TextRun `size` is in half-points, i.e. pt * 2) —
// mirrors renderPdf.js's BASE_FONTS point values so a given fontScale/target
// page count produces a visually consistent result across .docx and .pdf.
const BASE_FONTS = {
  name: 36,
  contact: 20,
  sectionHeading: 24,
  roleTitle: 23,
  roleDates: 20,
  tagline: 19,
  bullet: 21,
  skillLabel: 21,
  skillValue: 21,
  projectName: 22,
  eduDegree: 22,
  eduDates: 20,
  eduSchool: 21,
  cert: 21,
  activity: 21,
  interest: 21,
  summary: 21,
};

function scaledFonts(fontScale) {
  const s = {};
  for (const [k, v] of Object.entries(BASE_FONTS)) {
    s[k] = Math.round(v * fontScale);
  }
  return s;
}

// Bold-segment detection for bullet text — mirrors renderPdf.js so the .docx
// and .pdf outputs match: bolds metrics ($1M+, 20%, 10K+) and bold "label"
// prefixes on bullets, either dash-separated ("Root Cause — did X") or
// colon-separated ("Root-Cause Analysis: did X"), the latter being common in
// uploaded resume templates with functional/skill-labeled bullets.
const METRIC_RE = /(\$[\d,.]+[KMB]?\+?|[+~]?\d[\d,.]*[–-]\d[\d,.]*%|[+~]?\d[\d,.]*%\+?|\d[\d,.]*[KMB]\+|\d[\d,.]*\+)/g;
const SUBPOINT_RE = /^([A-Z][A-Za-z0-9-]*(?:\s&\s[A-Z][A-Za-z0-9-]*|\s[A-Z][A-Za-z0-9-]*)+)(\s[—–]\s|:\s)/;

function parseBoldSegments(text) {
  const segments = [];
  const subMatch = text.match(SUBPOINT_RE);
  let startIdx = 0;

  if (subMatch) {
    segments.push({ text: subMatch[1], bold: true });
    segments.push({ text: subMatch[2], bold: false });
    startIdx = subMatch[0].length;
  }

  const rest = text.slice(startIdx);
  let lastIdx = 0;

  for (const m of rest.matchAll(METRIC_RE)) {
    if (m.index > lastIdx) {
      segments.push({ text: rest.slice(lastIdx, m.index), bold: false });
    }
    segments.push({ text: m[0], bold: true });
    lastIdx = m.index + m[0].length;
  }

  if (lastIdx < rest.length) {
    segments.push({ text: rest.slice(lastIdx), bold: false });
  }

  return segments.length ? segments : [{ text, bold: false }];
}

function bulletRuns(text, size) {
  return parseBoldSegments(text).map(seg => new TextRun({ text: seg.text, bold: seg.bold, size }));
}

// tailorResume's LLM output occasionally returns links as {url, name} objects
// instead of plain strings — normalize either shape to a URL string.
function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  return links.map(l => (typeof l === 'string' ? l : (l?.url || l?.href || ''))).filter(Boolean);
}

function heading(text, headingCase, sectionGap) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: Math.round(220 * (sectionGap / 0.6)), after: 60 },
    children: [new TextRun({ text: headingCase === 'title' ? text : text.toUpperCase(), bold: true })],
  });
}

const DEFAULT_SECTION_ORDER = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'activities', 'interests'];

const SECTION_RENDERERS = {
  summary(resume, ctx) {
    if (!resume.summary) return [];
    return [
      heading('Summary', ctx.headingCase, ctx.sectionGap),
      new Paragraph({ children: [new TextRun({ text: resume.summary, size: ctx.f.summary })] }),
    ];
  },

  skills(resume, ctx) {
    const skillGroups = [
      { label: 'Product', items: resume.skills_product },
      { label: 'Technical & Analytics', items: resume.skills_technical },
      { label: 'AI & Tools', items: resume.skills_ai_tools },
    ].filter(g => Array.isArray(g.items) && g.items.length);

    const out = [];
    if (skillGroups.length) {
      out.push(heading('Skills', ctx.headingCase, ctx.sectionGap));
      for (const g of skillGroups) {
        out.push(new Paragraph({ children: [
          new TextRun({ text: `${g.label}: `, bold: true, size: ctx.f.skillLabel }),
          new TextRun({ text: g.items.join('  •  '), size: ctx.f.skillValue }),
        ]}));
      }
    } else if (Array.isArray(resume.skills_ranked) && resume.skills_ranked.length) {
      out.push(heading('Skills', ctx.headingCase, ctx.sectionGap));
      out.push(new Paragraph({ children: [new TextRun({ text: resume.skills_ranked.join('  •  '), size: ctx.f.skillValue })] }));
    }
    return out;
  },

  experience(resume, ctx) {
    if (!Array.isArray(resume.experience) || !resume.experience.length) return [];
    const out = [heading('Experience', ctx.headingCase, ctx.sectionGap)];
    const companyFirst = ctx.roleHeaderStyle === 'company_first_two_line';
    for (const job of resume.experience) {
      if (companyFirst) {
        const companyName = ctx.companyCase === 'upper' ? (job.company || '').toUpperCase() : (job.company || '');
        out.push(new Paragraph({
          spacing: { before: Math.round(120 * (ctx.roleGap / 0.3)) },
          children: [
            new TextRun({ text: `${companyName}${job.location ? '    ' + job.location : ''}`, bold: true, size: ctx.f.roleTitle }),
          ],
        }));
        out.push(new Paragraph({
          children: [
            new TextRun({ text: job.title || '', size: ctx.f.roleTitle }),
            new TextRun({ text: job.dates ? `    ${job.dates}` : '', italics: true, size: ctx.f.roleDates, color: '666666' }),
          ],
        }));
      } else {
        out.push(new Paragraph({
          spacing: { before: Math.round(120 * (ctx.roleGap / 0.3)) },
          children: [
            new TextRun({ text: `${job.title || ''}${job.company ? ', ' + job.company : ''}`, bold: true, size: ctx.f.roleTitle }),
            new TextRun({ text: job.dates ? `    ${job.dates}` : '', italics: true, size: ctx.f.roleDates, color: '666666' }),
          ],
        }));
      }
      if (job.tagline) {
        out.push(new Paragraph({ children: [new TextRun({ text: job.tagline, italics: true, size: ctx.f.tagline, color: '666666' })] }));
      }
      for (const b of job.bullets || []) {
        const text = typeof b === 'string' ? b : (b.text || '');
        out.push(new Paragraph({
          bullet: { level: 0 },
          indent: { left: ctx.bulletIndentTwips },
          spacing: { after: Math.round(40 * (ctx.lineGap / 1.5)) },
          keepLines: true, // prevents a bullet's text from splitting across a page break mid-sentence
          children: bulletRuns(text, ctx.f.bullet),
        }));
      }
    }
    return out;
  },

  projects(resume, ctx) {
    if (!Array.isArray(resume.projects) || !resume.projects.length) return [];
    const out = [heading('Projects', ctx.headingCase, ctx.sectionGap)];
    for (const p of resume.projects) {
      out.push(new Paragraph({
        spacing: { before: Math.round(100 * (ctx.roleGap / 0.3)) },
        children: [new TextRun({ text: p.name || '', bold: true, size: ctx.f.projectName })],
      }));
      if (Array.isArray(p.tags) && p.tags.length) {
        out.push(new Paragraph({ children: [new TextRun({ text: `(${p.tags.join(', ')})`, size: ctx.f.tagline, color: '666666' })] }));
      }
      if (Array.isArray(p.tech_stack) && p.tech_stack.length) {
        out.push(new Paragraph({ children: [new TextRun({ text: p.tech_stack.join('  •  '), bold: true, size: ctx.f.tagline, color: '444444' })] }));
      }
      if (p.url) {
        out.push(new Paragraph({ children: [new TextRun({ text: p.url, size: ctx.f.tagline, color: '1A6ED8' })] }));
      }
      if (p.description) {
        out.push(new Paragraph({ children: [new TextRun({ text: p.description, size: ctx.f.summary })] }));
      }
    }
    return out;
  },

  education(resume, ctx) {
    if (!Array.isArray(resume.education) || !resume.education.length) return [];
    const out = [heading('Education', ctx.headingCase, ctx.sectionGap)];
    const schoolFirst = ctx.roleHeaderStyle === 'company_first_two_line';
    for (const e of resume.education) {
      if (schoolFirst) {
        const schoolName = ctx.companyCase === 'upper' ? (e.school || '').toUpperCase() : (e.school || '');
        if (schoolName) {
          out.push(new Paragraph({
            spacing: { before: Math.round(80 * (ctx.roleGap / 0.3)) },
            children: [new TextRun({ text: schoolName, bold: true, size: ctx.f.eduSchool })],
          }));
        }
        out.push(new Paragraph({
          children: [
            new TextRun({ text: e.degree || '', size: ctx.f.eduDegree }),
            new TextRun({ text: e.dates ? `    ${e.dates}` : '', size: ctx.f.eduDates, color: '666666' }),
          ],
        }));
      } else {
        out.push(new Paragraph({
          spacing: { before: Math.round(80 * (ctx.roleGap / 0.3)) },
          children: [
            new TextRun({ text: e.degree || '', bold: true, size: ctx.f.eduDegree }),
            new TextRun({ text: e.dates ? `    ${e.dates}` : '', size: ctx.f.eduDates, color: '666666' }),
          ],
        }));
        if (e.school) out.push(new Paragraph({ children: [new TextRun({ text: e.school, size: ctx.f.eduSchool })] }));
      }
    }
    return out;
  },

  certifications(resume, ctx) {
    if (!Array.isArray(resume.certifications) || !resume.certifications.length) return [];
    const out = [heading('Certifications', ctx.headingCase, ctx.sectionGap)];
    for (const cert of resume.certifications) {
      const label = cert.issuer ? `${cert.name} — ${cert.issuer}` : (typeof cert === 'string' ? cert : cert.name);
      out.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: label, size: ctx.f.cert })] }));
    }
    return out;
  },

  activities(resume, ctx) {
    if (!Array.isArray(resume.activities) || !resume.activities.length) return [];
    const out = [heading('Activities', ctx.headingCase, ctx.sectionGap)];
    for (const a of resume.activities) {
      out.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: a, size: ctx.f.activity })] }));
    }
    return out;
  },

  interests(resume, ctx) {
    if (!Array.isArray(resume.interests) || !resume.interests.length) return [];
    return [
      heading('Interests', ctx.headingCase, ctx.sectionGap),
      new Paragraph({ children: [new TextRun({ text: resume.interests.join('  •  '), size: ctx.f.interest })] }),
    ];
  },
};

async function renderResumeDocx(resume, outPath, opts = {}) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const fontScale = opts.fontScale || 1.0;
  const lineGap = opts.lineGap || 1.5;
  const sectionGap = opts.sectionGap || 0.6;
  const roleGap = opts.roleGap || 0.3;
  const headingCase = opts.headingCase === 'title' ? 'title' : 'upper';
  // docx indent is in twips (1pt = 20 twips); default matches Word's standard
  // bullet-list indent (~18pt) when no format-derived value is given.
  const bulletIndentTwips = Math.round((opts.bulletIndent || 18) * 20);
  const sectionOrder = (Array.isArray(opts.sectionOrder) && opts.sectionOrder.length)
    ? opts.sectionOrder.filter(s => SECTION_RENDERERS[s])
    : DEFAULT_SECTION_ORDER;
  const roleHeaderStyle = opts.roleHeaderStyle === 'company_first_two_line' ? 'company_first_two_line' : 'title_first_one_line';
  const companyCase = opts.companyCase === 'upper' ? 'upper' : 'as_is';
  const f = scaledFonts(fontScale);
  const ctx = { f, lineGap, sectionGap, roleGap, headingCase, bulletIndentTwips, roleHeaderStyle, companyCase };

  const c = resume.contact || {};
  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: c.name || 'Candidate', bold: true, size: f.name })],
  }));
  const line = [c.email, c.phone, c.location].filter(Boolean).join('  |  ');
  if (line) children.push(new Paragraph({ children: [new TextRun({ text: line, size: f.contact, color: '444444' })] }));
  const links = normalizeLinks(c.links);
  if (links.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: links.join('  |  '), size: f.contact, color: '1A6ED8' })] }));
  }

  for (const section of sectionOrder) {
    children.push(...SECTION_RENDERERS[section](resume, ctx));
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { renderResumeDocx };
