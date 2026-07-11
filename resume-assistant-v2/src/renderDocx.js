'use strict';

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
} = require('docx');

async function renderResumeDocx(resume, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const c = resume.contact || {};
  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: c.name || 'Candidate', bold: true, size: 40 })],
  }));
  const line = [c.email, c.phone, c.location].filter(Boolean).join('  |  ');
  if (line) children.push(new Paragraph({ children: [new TextRun({ text: line, size: 20, color: '444444' })] }));
  if (Array.isArray(c.links) && c.links.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: c.links.join('  |  '), size: 20, color: '1A6ED8' })] }));
  }

  if (resume.summary) {
    children.push(heading('Summary'));
    children.push(new Paragraph({ children: [new TextRun({ text: resume.summary, size: 21 })] }));
  }

  if (Array.isArray(resume.skills_ranked) && resume.skills_ranked.length) {
    children.push(heading('Skills'));
    children.push(new Paragraph({ children: [new TextRun({ text: resume.skills_ranked.join('  •  '), size: 21 })] }));
  }

  if (Array.isArray(resume.experience) && resume.experience.length) {
    children.push(heading('Experience'));
    for (const job of resume.experience) {
      children.push(new Paragraph({
        spacing: { before: 120 },
        children: [
          new TextRun({ text: `${job.title || ''}${job.company ? ', ' + job.company : ''}`, bold: true, size: 23 }),
          new TextRun({ text: job.dates ? `    ${job.dates}` : '', italics: true, size: 20, color: '666666' }),
        ],
      }));
      for (const b of job.bullets || []) {
        children.push(new Paragraph({ text: b, bullet: { level: 0 } }));
      }
    }
  }

  if (Array.isArray(resume.projects) && resume.projects.length) {
    children.push(heading('Projects'));
    for (const p of resume.projects) {
      children.push(new Paragraph({
        spacing: { before: 100 },
        children: [new TextRun({ text: p.name || '', bold: true, size: 22 })],
      }));
      if (p.description) children.push(new Paragraph({ children: [new TextRun({ text: p.description, size: 21 })] }));
    }
  }

  if (Array.isArray(resume.education) && resume.education.length) {
    children.push(heading('Education'));
    for (const e of resume.education) {
      children.push(new Paragraph({
        spacing: { before: 80 },
        children: [
          new TextRun({ text: e.degree || '', bold: true, size: 22 }),
          new TextRun({ text: e.dates ? `    ${e.dates}` : '', size: 20, color: '666666' }),
        ],
      }));
      if (e.school) children.push(new Paragraph({ children: [new TextRun({ text: e.school, size: 21 })] }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

function heading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 60 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 24 })],
  });
}

module.exports = { renderResumeDocx };
