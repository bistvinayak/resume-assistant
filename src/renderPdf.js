'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

async function renderResumePdf(resume, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 55, right: 55 },
    });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    const c = resume.contact || {};
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Name
    doc.fontSize(18).font('Helvetica-Bold').text(c.name || 'Candidate', { align: 'center' });

    // Contact line
    const contactParts = [c.email, c.phone, c.location].filter(Boolean);
    if (contactParts.length) {
      doc.fontSize(9).font('Helvetica').fillColor('#444444')
        .text(contactParts.join('  |  '), { align: 'center' });
    }

    // Links
    if (Array.isArray(c.links) && c.links.length) {
      doc.fontSize(9).font('Helvetica').fillColor('#1a6ed8')
        .text(c.links.join('  |  '), { align: 'center' });
    }

    doc.fillColor('#000000');

    // Summary
    if (resume.summary) {
      sectionHeading(doc, 'SUMMARY', pageWidth);
      doc.fontSize(10).font('Helvetica').text(resume.summary, { lineGap: 2 });
    }

    // Skills
    const skillGroups = [
      { label: 'Product', items: resume.skills_product },
      { label: 'Technical & Analytics', items: resume.skills_technical },
      { label: 'AI & Tools', items: resume.skills_ai_tools },
    ].filter(g => Array.isArray(g.items) && g.items.length);

    if (skillGroups.length) {
      sectionHeading(doc, 'SKILLS', pageWidth);
      for (const g of skillGroups) {
        const startX = doc.x;
        doc.fontSize(10).font('Helvetica-Bold').text(`${g.label}: `, { continued: true });
        doc.font('Helvetica').text(g.items.join('  •  '));
      }
    } else if (Array.isArray(resume.skills_ranked) && resume.skills_ranked.length) {
      sectionHeading(doc, 'SKILLS', pageWidth);
      doc.fontSize(10).font('Helvetica').text(resume.skills_ranked.join('  •  '));
    }

    // Experience
    if (Array.isArray(resume.experience) && resume.experience.length) {
      sectionHeading(doc, 'EXPERIENCE', pageWidth);
      for (const job of resume.experience) {
        doc.moveDown(0.3);
        const titleLine = `${job.title || ''}${job.company ? ', ' + job.company : ''}`;
        doc.fontSize(11).font('Helvetica-Bold').text(titleLine, { continued: !!job.dates });
        if (job.dates) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666666')
            .text(`    ${job.dates}`, { align: 'right' });
          doc.fillColor('#000000');
        }
        if (job.tagline) {
          doc.fontSize(9).font('Helvetica-Oblique').fillColor('#666666')
            .text(job.tagline);
          doc.fillColor('#000000');
        }
        for (const b of job.bullets || []) {
          doc.fontSize(10).font('Helvetica')
            .text(`•  ${b}`, { indent: 12, lineGap: 1.5 });
        }
      }
    }

    // Projects
    if (Array.isArray(resume.projects) && resume.projects.length) {
      sectionHeading(doc, 'PROJECTS', pageWidth);
      for (const p of resume.projects) {
        doc.moveDown(0.2);
        doc.fontSize(10.5).font('Helvetica-Bold').text(p.name || '');
        if (p.description) {
          doc.fontSize(10).font('Helvetica').text(p.description, { lineGap: 1.5 });
        }
      }
    }

    // Education
    if (Array.isArray(resume.education) && resume.education.length) {
      sectionHeading(doc, 'EDUCATION', pageWidth);
      for (const e of resume.education) {
        doc.moveDown(0.2);
        doc.fontSize(10.5).font('Helvetica-Bold').text(e.degree || '', { continued: !!e.dates });
        if (e.dates) {
          doc.font('Helvetica').fontSize(9).fillColor('#666666')
            .text(`    ${e.dates}`, { align: 'right' });
          doc.fillColor('#000000');
        }
        if (e.school) {
          doc.fontSize(10).font('Helvetica').text(e.school);
        }
      }
    }

    // Certifications
    if (Array.isArray(resume.certifications) && resume.certifications.length) {
      sectionHeading(doc, 'CERTIFICATIONS', pageWidth);
      for (const cert of resume.certifications) {
        const label = cert.issuer ? `${cert.name} — ${cert.issuer}` : cert.name;
        doc.fontSize(10).font('Helvetica').text(`•  ${label}`, { indent: 12, lineGap: 1.5 });
      }
    }

    // Activities
    if (Array.isArray(resume.activities) && resume.activities.length) {
      sectionHeading(doc, 'ACTIVITIES', pageWidth);
      for (const a of resume.activities) {
        doc.fontSize(10).font('Helvetica').text(`•  ${a}`, { indent: 12, lineGap: 1.5 });
      }
    }

    // Interests
    if (Array.isArray(resume.interests) && resume.interests.length) {
      sectionHeading(doc, 'INTERESTS', pageWidth);
      doc.fontSize(10).font('Helvetica').text(resume.interests.join('  •  '));
    }

    doc.end();
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

function sectionHeading(doc, text, pageWidth) {
  doc.moveDown(0.6);
  doc.fontSize(11).font('Helvetica-Bold').text(text);
  doc.moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y)
    .strokeColor('#cccccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
}

module.exports = { renderResumePdf };
