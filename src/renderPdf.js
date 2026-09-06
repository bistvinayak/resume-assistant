'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const pdfParse = require('pdf-parse');

// Single persistent browser for the whole server process — reused across every
// job, not launched per-render. Puppeteer's recommended pattern is one browser,
// many short-lived pages, which keeps memory/CPU bounded regardless of how many
// resumes get rendered or how many measurement iterations one job runs through.
// (This app also uses Puppeteer for job-page scraping in scraper.js, but that
// launches its own short-lived browser per scrape — kept separate on purpose so
// a stuck/slow scrape can never block resume rendering, and vice versa.)
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      // No --single-process here on purpose — this browser is long-lived and
      // reused across every render for the life of the server, and single-
      // process mode is known to be less stable under sustained repeated use.
      // (scraper.js uses it for its own short-lived, one-shot browsers, which
      // is a different stability trade-off.)
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    browserPromise.catch(() => { browserPromise = null; }); // let a failed launch be retried next call
  }
  return browserPromise;
}

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
// Matches a bold "label" prefix on a bullet, either dash-separated ("Root Cause — did X")
// or colon-separated ("Root-Cause Analysis: did X") — the latter is common in
// uploaded resume templates that use functional/skill-labeled bullets.
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

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bulletHtml(text) {
  const segs = parseBoldSegments(text);
  return segs.map(s => (s.bold ? `<strong>${escapeHtml(s.text)}</strong>` : escapeHtml(s.text))).join('');
}

// tailorResume's LLM output occasionally returns links as {url, name} objects
// instead of plain strings — normalize either shape to a URL string.
function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  return links.map(l => (typeof l === 'string' ? l : (l?.url || l?.href || ''))).filter(Boolean);
}

const DEFAULT_SECTION_ORDER = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'activities', 'interests'];

function sectionHeadingHtml(text, headingCase) {
  const label = headingCase === 'title' ? text : text.toUpperCase();
  return `<div class="section-heading">${escapeHtml(label)}</div>`;
}

const SECTION_RENDERERS = {
  summary(resume, ctx) {
    if (!resume.summary) return '';
    return sectionHeadingHtml('Summary', ctx.headingCase) +
      `<p class="summary">${escapeHtml(resume.summary)}</p>`;
  },

  skills(resume, ctx) {
    const skillGroups = [
      { label: 'Product', items: resume.skills_product },
      { label: 'Technical & Analytics', items: resume.skills_technical },
      { label: 'AI & Tools', items: resume.skills_ai_tools },
    ].filter(g => Array.isArray(g.items) && g.items.length);

    if (skillGroups.length) {
      return sectionHeadingHtml('Skills', ctx.headingCase) +
        skillGroups.map(g => `<p class="skill-line"><strong>${escapeHtml(g.label)}:</strong> ${escapeHtml(g.items.join('  •  '))}</p>`).join('');
    }
    if (Array.isArray(resume.skills_ranked) && resume.skills_ranked.length) {
      return sectionHeadingHtml('Skills', ctx.headingCase) +
        `<p class="skill-line">${escapeHtml(resume.skills_ranked.join('  •  '))}</p>`;
    }
    return '';
  },

  experience(resume, ctx) {
    if (!Array.isArray(resume.experience) || !resume.experience.length) return '';
    let html = sectionHeadingHtml('Experience', ctx.headingCase);
    const companyFirst = ctx.roleHeaderStyle === 'company_first_two_line';
    for (const job of resume.experience) {
      html += `<div class="role" style="margin-top:${ctx.roleGap}em">`;
      if (companyFirst) {
        const companyName = ctx.companyCase === 'upper' ? (job.company || '').toUpperCase() : (job.company || '');
        const companyLine = `${companyName}${job.location ? '  ' + job.location : ''}`;
        html += `<div class="entity-line">${escapeHtml(companyLine)}</div>`;
        html += `<div class="role-header"><span class="role-title-plain">${escapeHtml(job.title || '')}</span>${job.dates ? `<span class="role-dates">${escapeHtml(job.dates)}</span>` : ''}</div>`;
      } else {
        const titleLine = `${job.title || ''}${job.company ? ', ' + job.company : ''}`;
        html += `<div class="role-header"><span class="role-title">${escapeHtml(titleLine)}</span>${job.dates ? `<span class="role-dates">${escapeHtml(job.dates)}</span>` : ''}</div>`;
      }
      if (job.tagline) html += `<div class="tagline">${escapeHtml(job.tagline)}</div>`;
      for (const b of job.bullets || []) {
        const text = typeof b === 'string' ? b : (b.text || '');
        html += `<div class="bullet" style="padding-left:${ctx.bulletIndent}pt"><span class="bullet-dot">•</span><span>${bulletHtml(text)}</span></div>`;
      }
      html += `</div>`;
    }
    return html;
  },

  projects(resume, ctx) {
    if (!Array.isArray(resume.projects) || !resume.projects.length) return '';
    let html = sectionHeadingHtml('Projects', ctx.headingCase);
    for (const p of resume.projects) {
      html += `<div class="project" style="margin-top:${ctx.roleGap * 0.7}em">`;
      html += `<div class="project-name">${escapeHtml(p.name || '')}${Array.isArray(p.tags) && p.tags.length ? ` <span class="muted">(${escapeHtml(p.tags.join(', '))})</span>` : ''}</div>`;
      if (Array.isArray(p.tech_stack) && p.tech_stack.length) {
        html += `<div class="tech-stack">${escapeHtml(p.tech_stack.join('  •  '))}</div>`;
      }
      if (p.url) html += `<div class="project-url">${escapeHtml(p.url)}</div>`;
      if (p.description) html += `<p class="project-desc">${escapeHtml(p.description)}</p>`;
      html += `</div>`;
    }
    return html;
  },

  education(resume, ctx) {
    if (!Array.isArray(resume.education) || !resume.education.length) return '';
    let html = sectionHeadingHtml('Education', ctx.headingCase);
    const schoolFirst = ctx.roleHeaderStyle === 'company_first_two_line';
    for (const e of resume.education) {
      html += `<div class="edu" style="margin-top:${ctx.roleGap * 0.7}em">`;
      if (schoolFirst) {
        const schoolName = ctx.companyCase === 'upper' ? (e.school || '').toUpperCase() : (e.school || '');
        if (schoolName) html += `<div class="entity-line">${escapeHtml(schoolName)}</div>`;
        html += `<div class="role-header"><span class="role-title-plain">${escapeHtml(e.degree || '')}</span>${e.dates ? `<span class="role-dates">${escapeHtml(e.dates)}</span>` : ''}</div>`;
      } else {
        html += `<div class="role-header"><span class="role-title">${escapeHtml(e.degree || '')}</span>${e.dates ? `<span class="role-dates">${escapeHtml(e.dates)}</span>` : ''}</div>`;
        if (e.school) html += `<div class="edu-school">${escapeHtml(e.school)}</div>`;
      }
      html += `</div>`;
    }
    return html;
  },

  certifications(resume, ctx) {
    if (!Array.isArray(resume.certifications) || !resume.certifications.length) return '';
    let html = sectionHeadingHtml('Certifications', ctx.headingCase);
    for (const cert of resume.certifications) {
      const label = cert.issuer ? `${cert.name} — ${cert.issuer}` : cert.name;
      html += `<div class="bullet" style="padding-left:12pt"><span class="bullet-dot">•</span><span>${escapeHtml(label)}</span></div>`;
    }
    return html;
  },

  activities(resume, ctx) {
    if (!Array.isArray(resume.activities) || !resume.activities.length) return '';
    let html = sectionHeadingHtml('Activities', ctx.headingCase);
    for (const a of resume.activities) {
      html += `<div class="bullet" style="padding-left:12pt"><span class="bullet-dot">•</span><span>${escapeHtml(a)}</span></div>`;
    }
    return html;
  },

  interests(resume, ctx) {
    if (!Array.isArray(resume.interests) || !resume.interests.length) return '';
    return sectionHeadingHtml('Interests', ctx.headingCase) +
      `<p class="skill-line">${escapeHtml(resume.interests.join('  •  '))}</p>`;
  },
};

function buildResumeHtml(resume, opts = {}) {
  const fontScale = opts.fontScale || 1.0;
  const lineGap = opts.lineGap || 1.5;
  const sectionGap = opts.sectionGap || 0.6;
  const roleGap = opts.roleGap || 0.3;
  const headingCase = opts.headingCase === 'title' ? 'title' : 'upper';
  const bulletIndent = opts.bulletIndent || 12;
  const sectionOrder = (Array.isArray(opts.sectionOrder) && opts.sectionOrder.length)
    ? opts.sectionOrder.filter(s => SECTION_RENDERERS[s])
    : DEFAULT_SECTION_ORDER;
  const roleHeaderStyle = opts.roleHeaderStyle === 'company_first_two_line' ? 'company_first_two_line' : 'title_first_one_line';
  const companyCase = opts.companyCase === 'upper' ? 'upper' : 'as_is';
  const f = scaledFonts(fontScale);
  const c = resume.contact || {};
  const ctx = { f, lineGap, sectionGap, roleGap, headingCase, bulletIndent, roleHeaderStyle, companyCase };

  const contactParts = [c.email, c.phone, c.location].filter(Boolean);
  const links = normalizeLinks(c.links);

  const body = sectionOrder.map(s => SECTION_RENDERERS[s](resume, ctx)).join('');

  // line-height as a unitless multiplier roughly matching pdfkit's point-based
  // lineGap (which added N points between wrapped lines) — 1 + lineGap/fontSize
  // keeps proportions similar across the auto-fit tuning range this app uses.
  const lineHeight = 1 + (lineGap / 10);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #000; margin: 0; font-size: ${f.bullet}pt; line-height: ${lineHeight}; }
  .center { text-align: center; }
  .name { font-size: ${f.name}pt; font-weight: bold; text-align: center; }
  .contact, .links { font-size: ${f.contact}pt; text-align: center; color: #444; }
  .links { color: #1a6ed8; }
  .section-heading {
    margin-top: ${sectionGap}em; font-size: ${f.sectionHeading}pt; font-weight: bold;
    border-bottom: 0.5pt solid #ccc; padding-bottom: 2pt; margin-bottom: 4pt;
    break-after: avoid; /* a heading should never be orphaned alone at page bottom */
  }
  /* Deliberately NOT break-inside:avoid on .role/.project/.edu as a whole block —
     that forces an entire multi-bullet role to jump to the next page rather than
     filling available space, leaving large gaps. A role's bullets flowing across
     a page boundary is normal and looks fine; what looks broken is the role's
     OWN title being orphaned from all its bullets, or a single bullet splitting
     mid-sentence — so only those two narrower things are protected below. */
  .role-header, .tagline { break-after: avoid; }
  .role-header { display: flex; justify-content: space-between; }
  .role-title { font-size: ${f.roleTitle}pt; font-weight: bold; }
  .role-title-plain { font-size: ${f.roleTitle}pt; }
  .entity-line { font-size: ${f.roleTitle}pt; font-weight: bold; break-after: avoid; }
  .role-dates { font-size: ${f.roleDates}pt; font-style: italic; color: #666; }
  .tagline { font-size: ${f.tagline}pt; font-style: italic; color: #666; }
  .bullet { display: flex; gap: 4pt; break-inside: avoid; font-size: ${f.bullet}pt; margin-top: 2pt; }
  .bullet-dot { flex-shrink: 0; }
  .skill-line { font-size: ${f.skillValue}pt; margin: 3pt 0; }
  .project-name { font-size: ${f.projectName}pt; font-weight: bold; break-after: avoid; }
  .project-desc { font-size: ${f.projectDesc}pt; margin: 2pt 0; }
  .tech-stack { font-size: ${f.tagline}pt; font-weight: bold; color: #444; }
  .project-url { font-size: ${f.tagline}pt; color: #1a6ed8; }
  .edu-school { font-size: ${f.eduSchool}pt; }
  .summary { font-size: ${f.summary}pt; }
  .muted { color: #666; font-weight: normal; }
  strong { font-weight: bold; }
</style></head>
<body>
  <div class="name">${escapeHtml(c.name || 'Candidate')}</div>
  ${contactParts.length ? `<div class="contact">${escapeHtml(contactParts.join('  |  '))}</div>` : ''}
  ${links.length ? `<div class="links">${escapeHtml(links.join('  |  '))}</div>` : ''}
  ${body}
</body></html>`;
}

const PAGE_MARGIN_PT = { top: 50, bottom: 50, left: 55, right: 55 };
const PAGE_HEIGHT_PT = 792; // US Letter, 11in * 72pt/in
const PAGE_WIDTH_PT = 612;  // 8.5in * 72pt/in

// puppeteer's page.pdf() margin/width/height only accept in/cm/mm/px, not pt.
const PDF_MARGIN_IN = {
  top: `${(PAGE_MARGIN_PT.top / 72).toFixed(4)}in`,
  bottom: `${(PAGE_MARGIN_PT.bottom / 72).toFixed(4)}in`,
  left: `${(PAGE_MARGIN_PT.left / 72).toFixed(4)}in`,
  right: `${(PAGE_MARGIN_PT.right / 72).toFixed(4)}in`,
};

async function withPage(fn) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function renderResumePdf(resume, outPath, opts = {}) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const html = buildResumeHtml(resume, opts);
  await withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: outPath,
      format: 'Letter',
      margin: PDF_MARGIN_IN,
      printBackground: true,
    });
  });
  return outPath;
}

async function measureResumePdf(resume, opts = {}) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('measureResumePdf timed out after 15s')), 15000)
  );

  const measure = withPage(async (page) => {
    const html = buildResumeHtml(resume, opts);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Real page count from the actual paginated PDF (respects break-inside:avoid,
    // exactly the same render path as the final file) — this is the source of
    // truth, not an estimate.
    const buffer = await page.pdf({
      format: 'Letter',
      margin: PDF_MARGIN_IN,
      printBackground: true,
    });
    const { numpages } = await pdfParse(buffer);
    const pages = numpages || 1;

    // Last-page fill is approximate (continuous DOM height vs. usable page
    // height, modulo page count) — pdf-parse doesn't expose layout geometry.
    // Only used for the auto-fit loop's broad expand/tighten thresholds, which
    // don't need pixel precision.
    const contentHeightPx = await page.evaluate(() => document.body.scrollHeight);
    const contentHeightPt = contentHeightPx * (72 / 96);
    const usablePageHeightPt = PAGE_HEIGHT_PT - PAGE_MARGIN_PT.top - PAGE_MARGIN_PT.bottom;
    const lastPageContentPt = contentHeightPt - (pages - 1) * usablePageHeightPt;
    const lastPageFill = Math.max(0, Math.min(100, Math.round(100 * lastPageContentPt / usablePageHeightPt)));

    return { pages, lastPageFill };
  });

  return Promise.race([timeout, measure]);
}

module.exports = { renderResumePdf, measureResumePdf };
