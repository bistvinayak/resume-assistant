'use strict';

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TabStopType, BorderStyle,
} = require('docx');

// Half-point sizes (docx TextRun `size` is in half-points, i.e. pt * 2) —
// mirrors renderPdf.js's BASE_FONTS point values so a given fontScale/target
// page count produces a visually consistent result across .docx and .pdf.
// Same point sizes as renderPdf.js (x2 for half-points).
const BASE_FONTS = {
  name: 32,
  contact: 18,
  sectionHeading: 20,
  roleTitle: 20,
  roleDates: 19,
  tagline: 18,
  bullet: 19,
  skillLabel: 19,
  skillValue: 19,
  projectName: 19,
  eduDegree: 19,
  eduDates: 19,
  eduSchool: 20,
  cert: 19,
  activity: 19,
  interest: 19,
  summary: 19,
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
// Also matches lowercase words ("Throughput & cycle time: …"), up to 6 words before the colon.
const SUBPOINT_RE = /^([A-Z][A-Za-z0-9/-]*(?:\s(?:&|[A-Za-z0-9/-]+)){0,5})(\s[—–]\s|:\s)/;

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

// US Letter with the approved resume skill's margins: 400 DXA top/bottom, 580 DXA sides.
const PAGE = { width: 12240, height: 15840, marginTB: 400, marginLR: 580 };
const RIGHT_TAB = [{ type: TabStopType.RIGHT, position: PAGE.width - 2 * PAGE.marginLR }];

function heading(text, headingCase, sectionGap) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: Math.round(220 * (sectionGap / 0.6)), after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } },
    children: [new TextRun({ text: headingCase === 'title' ? text : text.toUpperCase(), bold: true, color: '000000' })],
  });
}

// Left text, right-aligned text on the same line (company | location, title | dates).
function splitLine(left, right, leftRun = {}, rightRun = {}, extra = {}) {
  return new Paragraph({
    tabStops: RIGHT_TAB,
    ...extra,
    children: [
      new TextRun({ text: left || '', ...leftRun }),
      ...(right ? [new TextRun({ text: `\t${right}`, ...rightRun })] : []),
    ],
  });
}

// Default layout (owner's reference resume): Education, Experience, Projects, Skills; no summary
// unless an uploaded template's section order asks for one.
const DEFAULT_SECTION_ORDER = ['education', 'experience', 'projects', 'skills', 'certifications', 'activities', 'interests'];

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
        out.push(splitLine(companyName, job.location, { bold: true, size: ctx.f.roleTitle }, { size: ctx.f.roleDates },
          { spacing: { before: Math.round(120 * (ctx.roleGap / 0.3)) } }));
        out.push(splitLine(job.title, job.dates, { italics: true, size: ctx.f.roleTitle }, { size: ctx.f.roleDates }));
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
        out.push(new Paragraph({ children: [new TextRun({ text: job.tagline, italics: true, size: ctx.f.tagline, color: '333333' })] }));
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
      const stack = Array.isArray(p.tech_stack) && p.tech_stack.length ? p.tech_stack.join(', ') : '';
      out.push(splitLine(p.name, stack, { bold: true, size: ctx.f.projectName }, { italics: true, size: ctx.f.tagline },
        { spacing: { before: Math.round(100 * (ctx.roleGap / 0.3)) } }));
      if (p.url) {
        out.push(new Paragraph({ children: [new TextRun({ text: p.url, size: ctx.f.tagline, color: '1A6ED8' })] }));
      }
      if (p.description) {
        out.push(new Paragraph({ bullet: { level: 0 }, indent: { left: ctx.bulletIndentTwips }, keepLines: true, children: bulletRuns(p.description, ctx.f.bullet) }));
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
          out.push(splitLine(schoolName, e.location, { bold: true, size: ctx.f.eduSchool }, { size: ctx.f.eduDates },
            { spacing: { before: Math.round(80 * (ctx.roleGap / 0.3)) } }));
        }
        out.push(splitLine([e.degree, e.major].filter(Boolean).join(', '), e.dates, { italics: true, size: ctx.f.eduDegree }, { size: ctx.f.eduDates }));
        for (const line of [e.honors, e.gpa ? `GPA: ${e.gpa}` : ''].filter(Boolean)) {
          out.push(new Paragraph({ bullet: { level: 0 }, indent: { left: ctx.bulletIndentTwips }, children: bulletRuns(String(line), ctx.f.bullet) }));
        }
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
  const roleHeaderStyle = opts.roleHeaderStyle === 'title_first_one_line' ? 'title_first_one_line' : 'company_first_two_line';
  const companyCase = opts.companyCase === 'as_is' ? 'as_is' : 'upper';
  const f = scaledFonts(fontScale);
  const ctx = { f, lineGap, sectionGap, roleGap, headingCase, bulletIndentTwips, roleHeaderStyle, companyCase };

  const c = resume.contact || {};
  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: (c.name || 'Candidate').toUpperCase(), bold: true, size: f.name })],
  }));
  // One centered line: location | phone | email | links (links shown without https://)
  const links = normalizeLinks(c.links).map(l => l.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
  const line = [c.location, c.phone, c.email, ...links].filter(Boolean).join('  |  ');
  if (line) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: line, size: f.contact, color: '222222' })] }));

  for (const section of sectionOrder) {
    children.push(...SECTION_RENDERERS[section](resume, ctx));
  }

  const doc = new Document({
    // Calibri in Word; the PDF uses Carlito, its metric-compatible twin.
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{
    properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: { top: PAGE.marginTB, bottom: PAGE.marginTB, left: PAGE.marginLR, right: PAGE.marginLR } } },
    children,
  }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { renderResumeDocx };
