'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const BASE_FONTS = {
  name: 18,
  contact: 9,
  sectionHeading: 11,
  roleTitle: 11,
  roleDates: 9,
  tagline: 9,
  bullet: 10,
  skillLabel: 10,
  skillValue: 10,
  projectName: 10.5,
  projectDesc: 10,
  eduDegree: 10.5,
  eduDates: 9,
  eduSchool: 10,
  cert: 10,
  activity: 10,
  interest: 10,
  summary: 10,
};

function scaledFonts(fontScale) {
  const s = {};
  for (const [k, v] of Object.entries(BASE_FONTS)) {
    s[k] = Math.round(v * fontScale * 10) / 10;
  }
  return s;
}

const METRIC_RE = /(\$[\d,.]+[KMB]?\+?|[+~]?\d[\d,.]*[–-]\d[\d,.]*%|[+~]?\d[\d,.]*%\+?|\d[\d,.]*[KMB]\+|\d[\d,.]*\+)/g;
const SUBPOINT_RE = /^([A-Z][A-Za-z0-9-]*(?:\s&\s[A-Z][A-Za-z0-9-]*|\s[A-Z][A-Za-z0-9-]*)+)\s[—–]\s/;

function parseBoldSegments(text) {
  const segments = [];
  const subMatch = text.match(SUBPOINT_RE);
  let startIdx = 0;

  if (subMatch) {
    segments.push({ text: subMatch[1], bold: true });
    segments.push({ text: ' — ', bold: false });
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

function renderBullet(doc, text, fontSize, indent, lineGap) {
  const segs = parseBoldSegments(text);
  if (segs.length === 1 && !segs[0].bold) {
    doc.fontSize(fontSize).font('Helvetica').text(`•  ${text}`, { indent, lineGap });
    return;
  }

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const prefix = i === 0 ? '•  ' : '';
    const isLast = i === segs.length - 1;
    doc.fontSize(fontSize).font(seg.bold ? 'Helvetica-Bold' : 'Helvetica');
    if (isLast) {
      doc.text(`${prefix}${seg.text}`, { indent: i === 0 ? indent : 0, lineGap });
    } else {
      doc.text(`${prefix}${seg.text}`, { indent: i === 0 ? indent : 0, continued: true });
    }
  }
}

function renderContent(doc, resume, opts = {}) {
  const fontScale = opts.fontScale || 1.0;
  const f = scaledFonts(fontScale);
  const c = resume.contact || {};
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fontSize(f.name).font('Helvetica-Bold').text(c.name || 'Candidate', { align: 'center' });

  const contactParts = [c.email, c.phone, c.location].filter(Boolean);
  if (contactParts.length) {
    doc.fontSize(f.contact).font('Helvetica').fillColor('#444444')
      .text(contactParts.join('  |  '), { align: 'center' });
  }

  if (Array.isArray(c.links) && c.links.length) {
    doc.fontSize(f.contact).font('Helvetica').fillColor('#1a6ed8')
      .text(c.links.join('  |  '), { align: 'center' });
  }

  doc.fillColor('#000000');

  if (resume.summary) {
    sectionHeading(doc, 'SUMMARY', pageWidth, f);
    doc.fontSize(f.summary).font('Helvetica').text(resume.summary, { lineGap: 2 });
  }

  const skillGroups = [
    { label: 'Product', items: resume.skills_product },
    { label: 'Technical & Analytics', items: resume.skills_technical },
    { label: 'AI & Tools', items: resume.skills_ai_tools },
  ].filter(g => Array.isArray(g.items) && g.items.length);

  if (skillGroups.length) {
    sectionHeading(doc, 'SKILLS', pageWidth, f);
    for (const g of skillGroups) {
      doc.fontSize(f.skillLabel).font('Helvetica-Bold').text(`${g.label}: `, { continued: true });
      doc.font('Helvetica').fontSize(f.skillValue).text(g.items.join('  •  '));
    }
  } else if (Array.isArray(resume.skills_ranked) && resume.skills_ranked.length) {
    sectionHeading(doc, 'SKILLS', pageWidth, f);
    doc.fontSize(f.skillValue).font('Helvetica').text(resume.skills_ranked.join('  •  '));
  }

  if (Array.isArray(resume.experience) && resume.experience.length) {
    sectionHeading(doc, 'EXPERIENCE', pageWidth, f);
    for (const job of resume.experience) {
      doc.moveDown(0.3);
      const titleLine = `${job.title || ''}${job.company ? ', ' + job.company : ''}`;
      doc.fontSize(f.roleTitle).font('Helvetica-Bold').text(titleLine, { continued: !!job.dates });
      if (job.dates) {
        doc.font('Helvetica-Oblique').fontSize(f.roleDates).fillColor('#666666')
          .text(`    ${job.dates}`, { align: 'right' });
        doc.fillColor('#000000');
      }
      if (job.tagline) {
        doc.fontSize(f.tagline).font('Helvetica-Oblique').fillColor('#666666')
          .text(job.tagline);
        doc.fillColor('#000000');
      }
      for (const b of job.bullets || []) {
        const text = typeof b === 'string' ? b : (b.text || '');
        renderBullet(doc, text, f.bullet, 12, 1.5);
      }
    }
  }

  if (Array.isArray(resume.projects) && resume.projects.length) {
    sectionHeading(doc, 'PROJECTS', pageWidth, f);
    for (const p of resume.projects) {
      doc.moveDown(0.2);
      doc.fontSize(f.projectName).font('Helvetica-Bold').text(p.name || '', { continued: !!(p.tags && p.tags.length) });
      if (Array.isArray(p.tags) && p.tags.length) {
        doc.font('Helvetica').fontSize(f.tagline).fillColor('#666666')
          .text(`  (${p.tags.join(', ')})`);
        doc.fillColor('#000000');
      }
      if (p.description) {
        doc.fontSize(f.projectDesc).font('Helvetica').text(p.description, { lineGap: 1.5 });
      }
    }
  }

  if (Array.isArray(resume.education) && resume.education.length) {
    sectionHeading(doc, 'EDUCATION', pageWidth, f);
    for (const e of resume.education) {
      doc.moveDown(0.2);
      doc.fontSize(f.eduDegree).font('Helvetica-Bold').text(e.degree || '', { continued: !!e.dates });
      if (e.dates) {
        doc.font('Helvetica').fontSize(f.eduDates).fillColor('#666666')
          .text(`    ${e.dates}`, { align: 'right' });
        doc.fillColor('#000000');
      }
      if (e.school) {
        doc.fontSize(f.eduSchool).font('Helvetica').text(e.school);
      }
    }
  }

  if (Array.isArray(resume.certifications) && resume.certifications.length) {
    sectionHeading(doc, 'CERTIFICATIONS', pageWidth, f);
    for (const cert of resume.certifications) {
      const label = cert.issuer ? `${cert.name} — ${cert.issuer}` : cert.name;
      doc.fontSize(f.cert).font('Helvetica').text(`•  ${label}`, { indent: 12, lineGap: 1.5 });
    }
  }

  if (Array.isArray(resume.activities) && resume.activities.length) {
    sectionHeading(doc, 'ACTIVITIES', pageWidth, f);
    for (const a of resume.activities) {
      doc.fontSize(f.activity).font('Helvetica').text(`•  ${a}`, { indent: 12, lineGap: 1.5 });
    }
  }

  if (Array.isArray(resume.interests) && resume.interests.length) {
    sectionHeading(doc, 'INTERESTS', pageWidth, f);
    doc.fontSize(f.interest).font('Helvetica').text(resume.interests.join('  •  '));
  }
}

async function renderResumePdf(resume, outPath, opts = {}) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 55, right: 55 },
    });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    renderContent(doc, resume, opts);

    doc.end();
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

async function measureResumePdf(resume, opts = {}) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('measureResumePdf timed out after 10s')), 10000)
  );
  return Promise.race([timeout, new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 55, right: 55 },
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    const pageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    let pageCount = 1;
    doc.on('pageAdded', () => { pageCount++; });

    renderContent(doc, resume, opts);

    const lastPageY = doc.y - doc.page.margins.top;
    const lastPageFill = Math.round(100 * lastPageY / pageHeight);

    const result = { pages: pageCount, lastPageFill };

    doc.on('end', () => resolve(result));
    doc.on('error', reject);
    doc.end();
  })]);
}

function sectionHeading(doc, text, pageWidth, f) {
  doc.moveDown(0.6);
  doc.fontSize(f ? f.sectionHeading : 11).font('Helvetica-Bold').text(text);
  doc.moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y)
    .strokeColor('#cccccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
}

module.exports = { renderResumePdf, measureResumePdf };
