'use strict';

const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun } = require('docx');

async function renderCoverLetterDocx(resume, job, paragraphs, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const c = resume.contact || {};
  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: c.name || 'Candidate', bold: true, size: 26 })],
  }));
  const contactLine = [c.email, c.phone, c.location].filter(Boolean).join('  |  ');
  if (contactLine) {
    children.push(new Paragraph({ children: [new TextRun({ text: contactLine, size: 20, color: '444444' })] }));
  }

  children.push(new Paragraph({
    spacing: { before: 240, after: 200 },
    children: [new TextRun({
      text: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      size: 21,
    })],
  }));

  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Dear Hiring Manager,', size: 21 })],
  }));

  for (const paragraph of paragraphs) {
    children.push(new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: paragraph, size: 21 })],
    }));
  }

  children.push(new Paragraph({
    spacing: { before: 200 },
    children: [new TextRun({ text: 'Sincerely,', size: 21 })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: c.name || 'Candidate', size: 21 })],
  }));

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { renderCoverLetterDocx };
