#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'src');
const FRONTEND = path.join(ROOT, 'resumeai-frontend', 'src');

function readLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n');
  } catch { return []; }
}

function scanFile(filePath) {
  const lines = readLines(filePath);
  const name = path.basename(filePath);
  const funcs = [];
  const routes = [];
  const requires = [];
  const exports_ = [];
  const calls = {};

  lines.forEach((line, i) => {
    const ln = i + 1;
    const trimmed = line.trim();

    // Function definitions
    const asyncMatch = trimmed.match(/^async function (\w+)\s*\(/);
    const funcMatch = trimmed.match(/^function (\w+)\s*\(/);
    const arrowMatch = trimmed.match(/^const (\w+)\s*=\s*async/);
    if (asyncMatch) funcs.push({ name: asyncMatch[1], line: ln, async: true });
    else if (funcMatch) funcs.push({ name: funcMatch[1], line: ln, async: false });
    else if (arrowMatch) funcs.push({ name: arrowMatch[1], line: ln, async: true });

    // Route definitions
    const routeMatch = trimmed.match(/app\.(get|post|put|patch|delete)\s*\(\s*\[?\s*['"]([^'"]+)['"]/);
    if (routeMatch) {
      routes.push({ method: routeMatch[1].toUpperCase(), path: routeMatch[2], line: ln });
    }

    // Requires
    const reqMatch = trimmed.match(/require\(['"]\.\/([^'"]+)['"]\)/);
    if (reqMatch && !trimmed.startsWith('//')) {
      const destructMatch = trimmed.match(/const \{([^}]+)\}/);
      requires.push({
        module: reqMatch[1],
        imports: destructMatch ? destructMatch[1].split(',').map(s => s.split(':')[0].trim()) : [],
        line: ln,
      });
    }

    // module.exports (may span multiple lines)
    if (trimmed.startsWith('module.exports')) {
      // Collect from this line until closing brace
      let exportBlock = '';
      for (let j = i; j < lines.length; j++) {
        exportBlock += lines[j];
        if (lines[j].includes(';') && exportBlock.includes('}')) break;
      }
      const exMatch = exportBlock.match(/\{([^}]+)\}/);
      if (exMatch) {
        exports_.push(...exMatch[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean));
      }
    }
  });

  return { name, funcs, routes, requires, exports: exports_ };
}

function scanFrontendFile(filePath) {
  const lines = readLines(filePath);
  const name = path.relative(FRONTEND, filePath);
  const apiCalls = [];
  const state = [];
  const imports = [];

  lines.forEach((line, i) => {
    const ln = i + 1;
    const trimmed = line.trim();

    // api.xxx() calls
    const apiMatch = trimmed.match(/api\.(\w+)\s*\(/);
    if (apiMatch && !apiCalls.includes(apiMatch[1])) apiCalls.push(apiMatch[1]);

    // useState
    const stateMatch = trimmed.match(/const \[(\w+),/);
    if (stateMatch && trimmed.includes('useState')) state.push(stateMatch[1]);

    // imports
    const impMatch = trimmed.match(/import .+ from ['"]([^'"]+)['"]/);
    if (impMatch) imports.push(impMatch[1]);
  });

  return { name, apiCalls, state, imports };
}

function findCallsInFunction(lines, startLine, funcName, targetFunctions) {
  const found = [];
  let braceDepth = 0;
  let started = false;

  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i];

    // One-liner route (e.g. app.get(..., handler))  — just scan this one line
    if (i === startLine - 1 && line.includes(');') && !line.includes('{')) {
      for (const target of targetFunctions) {
        if (line.includes(target) && !line.trim().startsWith('//')) {
          if (!found.includes(target)) found.push(target);
        }
      }
      break;
    }

    for (const ch of line) {
      if (ch === '{') { braceDepth++; started = true; }
      if (ch === '}') braceDepth--;
    }
    for (const target of targetFunctions) {
      if (line.includes(target + '(') && !line.trim().startsWith('//') && !line.includes('function ' + target)) {
        if (!found.includes(target)) found.push(target);
      }
    }
    if (started && braceDepth <= 0) break;
  }
  return found;
}

function scanRouteCalls(filePath, allFuncNames) {
  const lines = readLines(filePath);
  const routeHandlers = [];

  lines.forEach((line, i) => {
    const routeMatch = line.trim().match(/app\.(get|post|put|patch|delete)\s*\(\s*\[?\s*['"]([^'"]+)['"]/);
    if (routeMatch) {
      const calls = findCallsInFunction(lines, i + 1, 'route', allFuncNames);
      routeHandlers.push({
        method: routeMatch[1].toUpperCase(),
        path: routeMatch[2],
        line: i + 1,
        calls,
      });
    }
  });
  return routeHandlers;
}

// --- Scan all files ---

const backendFiles = fs.readdirSync(BACKEND).filter(f => f.endsWith('.js')).sort();
const backendScans = {};
const allExportedFuncs = new Set();

for (const f of backendFiles) {
  const scan = scanFile(path.join(BACKEND, f));
  backendScans[f] = scan;
  scan.exports.forEach(e => allExportedFuncs.add(e));
}

const allFuncNames = [...allExportedFuncs];

// Scan route → call chains
const routeCalls = scanRouteCalls(path.join(BACKEND, 'server.js'), allFuncNames);

// Scan frontend
const frontendPages = [];
const frontendScan = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) frontendScan(full);
    else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) {
      frontendPages.push(scanFrontendFile(full));
    }
  }
};
frontendScan(FRONTEND);

// --- Find LLM functions ---
const llmScan = backendScans['llm.js'];
const llmFuncs = llmScan.funcs.filter(f =>
  ['extractFacts', 'classifyIntent', 'chatEnrich', 'smartMerge',
   'tailorResume', 'improveResume', 'calculateAtsScore'].includes(f.name)
);

// --- Find DB functions ---
const dbScan = backendScans['db.js'];
const dbFuncs = dbScan.funcs.filter(f => dbScan.exports.includes(f.name));

// --- Find DB schema ---
const dbLines = readLines(path.join(BACKEND, 'db.js'));
const tables = [];
let currentTable = null;
dbLines.forEach((line, i) => {
  const tableMatch = line.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
  if (tableMatch) {
    currentTable = { name: tableMatch[1], columns: [], line: i + 1 };
    tables.push(currentTable);
  }
  if (currentTable) {
    const colMatch = line.trim().match(/^(\w+)\s+(TEXT|JSONB|SERIAL|INTEGER|BOOLEAN|TIMESTAMPTZ)/);
    if (colMatch) currentTable.columns.push({ name: colMatch[1], type: colMatch[2] });
    if (line.includes(');')) currentTable = null;
  }
});

// --- Build the flow diagrams (architecture-level, stable) ---

const CHAT_FLOW = `\`\`\`
POST /api/chat { message, mode, history }
  │
  ├─ mode=tailor + URL → scrapeLinkedInJob → processJob (background)
  │
  ├─ STEP 1: classifyIntent(message, profile, ctx, history)  [llm.js:${llmFuncs.find(f => f.name === 'classifyIntent')?.line || '?'}]
  │    ├─ URL structural detection (no LLM)
  │    │    ├─ url_job → "switch to Tailor tab" response
  │    │    └─ url_profile → save to contact field → done
  │    │
  │    └─ LLM intent gate (intent_classify prompt)
  │         ├─ out_of_scope/greeting → reply directly, done
  │         ├─ question → reply from intent gate using profile, done
  │         └─ add_info/delete/clarify → in_scope=true, continue ↓
  │
  └─ STEP 2: chatEnrich(message, profile, ctx, history)  [llm.js:${llmFuncs.find(f => f.name === 'chatEnrich')?.line || '?'}]
       └─ Returns { reply, extracted, deletions }
            → frontend shows pendingChanges for confirm/reject
\`\`\``;

const ingestLine = backendScans['profile.js'].funcs.find(f => f.name === 'ingestText')?.line || '?';
const ingestPdfLine = backendScans['profile.js'].funcs.find(f => f.name === 'ingestPdf')?.line || '?';
const ingestFilesLine = backendScans['profile.js'].funcs.find(f => f.name === 'ingestFiles')?.line || '?';
const extractTextLine = backendScans['profile.js'].funcs.find(f => f.name === 'extractTextFromFile')?.line || '?';
const applyPartialLine = backendScans['profile.js'].funcs.find(f => f.name === 'applyPartial')?.line || '?';
const mergeProfileLine = backendScans['profile.js'].funcs.find(f => f.name === 'mergeProfile')?.line || '?';
const detectConflictsLine = backendScans['profile.js'].funcs.find(f => f.name === 'detectConflicts')?.line || '?';
const extractFactsLine = llmFuncs.find(f => f.name === 'extractFacts')?.line || '?';
const smartMergeLine = llmFuncs.find(f => f.name === 'smartMerge')?.line || '?';

const INGEST_FLOW = `\`\`\`
ingestText(text, userId) [profile.js:${ingestLine}]
  → extractFacts(text) [llm.js:${extractFactsLine}]  — LLM extracts structured profile
  → applyPartial(partial, userId) [profile.js:${applyPartialLine}]

ingestPdf(filePath, userId) [profile.js:${ingestPdfLine}]
  → extractTextFromFile(filePath) [profile.js:${extractTextLine}]
       ├─ .pdf → pdf-parse + pdfjs hyperlink extraction
       ├─ .docx/.doc → mammoth (text + HTML hyperlink extraction)
       └─ .txt → fs.readFile
  → extractFacts(text) [llm.js:${extractFactsLine}]
  → applyPartial(partial, userId) [profile.js:${applyPartialLine}]

ingestFiles(files[], userId) [profile.js:${ingestFilesLine}]
  → extractTextFromFile per file → combine → extractFacts → applyPartial

applyPartial(partial, userId) [profile.js:${applyPartialLine}]
  → getProfile(userId)
  → if empty profile: mergeProfile (programmatic)
  → if existing profile: smartMerge (LLM) [llm.js:${smartMergeLine}]
       └─ fallback: mergeProfile + detectConflicts
  → saveProfile(merged, userId)
  → returns merged (with _conflicts if any)
\`\`\``;

const processJobLine = backendScans['pipeline.js'].funcs.find(f => f.name === 'processJob')?.line || '?';
const tailorLine = llmFuncs.find(f => f.name === 'tailorResume')?.line || '?';
const atsLine = llmFuncs.find(f => f.name === 'calculateAtsScore')?.line || '?';
const improveLine = llmFuncs.find(f => f.name === 'improveResume')?.line || '?';
const renderDocxLine = backendScans['renderDocx.js'].funcs.find(f => f.name === 'renderResumeDocx')?.line || '?';

const JOB_FLOW = `\`\`\`
processJob(job, userId) [pipeline.js:${processJobLine}]
  → seenJobBefore(job) [db.js:${dbFuncs.find(f => f.name === 'seenJobBefore')?.line || '?'}]
  → getProfile(userId) [db.js:${dbFuncs.find(f => f.name === 'getProfile')?.line || '?'}]
  → tailorResume(profile, job, trace) [llm.js:${tailorLine}]  — LLM
  → calculateAtsScore(resume, job, trace) [llm.js:${atsLine}]  — LLM
  → if ats < 95:
       → improveResume(resume, job, ats, trace) [llm.js:${improveLine}]  — LLM
       → calculateAtsScore again
  → renderResumeDocx(resume, filePath) [renderDocx.js:${renderDocxLine}]
  → saveTailored(jobId, resume, filePath) [db.js:${dbFuncs.find(f => f.name === 'saveTailored')?.line || '?'}]
  → markDelivered(tailoredId, jobId, atsData) [db.js:${dbFuncs.find(f => f.name === 'markDelivered')?.line || '?'}]
  → sendResumeEmail (if source=cron) [mailer.js:${backendScans['mailer.js'].funcs.find(f => f.name === 'sendResumeEmail')?.line || '?'}]
\`\`\``;

const startCronLine = backendScans['cron.js'].funcs.find(f => f.name === 'startCron')?.line || '?';
const runBatchLine = backendScans['cron.js'].funcs.find(f => f.name === 'runBatch')?.line || '?';
const fetchJobsLine = backendScans['gmail.js'].funcs.find(f => f.name === 'fetchLinkedInJobs')?.line || '?';

const CRON_FLOW = `\`\`\`
startCron() [cron.js:${startCronLine}]  — runs every 2 hours
  → recoverStaleJobs(10) [db.js:${dbFuncs.find(f => f.name === 'recoverStaleJobs')?.line || '?'}]
  → runBatch(userId) [cron.js:${runBatchLine}]
       → fetchLinkedInJobs() [gmail.js:${fetchJobsLine}]  — IMAP fetch
       → per job: scrapeLinkedInJob(url) [scraper.js:${backendScans['scraper.js'].funcs.find(f => f.name === 'scrapeJobPage')?.line || '?'}]
       → per job: processJob(job, userId) [pipeline.js:${processJobLine}]
\`\`\``;

const fuzzyExpLine = backendScans['profile.js'].funcs.find(f => f.name === 'fuzzyMatchExperience')?.line || '?';
const fuzzyEduLine = backendScans['profile.js'].funcs.find(f => f.name === 'fuzzyMatchEducation')?.line || '?';
const upsertExpLine = backendScans['profile.js'].funcs.find(f => f.name === 'upsertExperience')?.line || '?';
const upsertByIdLine = backendScans['profile.js'].funcs.find(f => f.name === 'upsertById')?.line || '?';
const upsertProjLine = backendScans['profile.js'].funcs.find(f => f.name === 'upsertProjects')?.line || '?';
const upsertTechLine = backendScans['profile.js'].funcs.find(f => f.name === 'upsertTechnicalSkills')?.line || '?';
const unionCILine = backendScans['profile.js'].funcs.find(f => f.name === 'unionCI')?.line || '?';

const MERGE_FLOW = `\`\`\`
mergeProfile(base, incoming, conflicts) [profile.js:${mergeProfileLine}]
  ├─ contact: shallow merge
  ├─ experience: upsertExperience [profile.js:${upsertExpLine}]
  │    └─ fuzzyMatchExperience (normCompany) [profile.js:${fuzzyExpLine}]
  ├─ education: upsertById with fuzzyMatchEducation [profile.js:${upsertByIdLine}]
  │    └─ fuzzyMatchEducation (normSchool + normDegree) [profile.js:${fuzzyEduLine}]
  ├─ projects: upsertProjects [profile.js:${upsertProjLine}]
  ├─ certifications: upsertById [profile.js:${upsertByIdLine}]
  ├─ technical_skills: upsertTechnicalSkills [profile.js:${upsertTechLine}]
  ├─ skills/soft_skills: unionCI [profile.js:${unionCILine}]
  └─ cross-array skill dedup (tech > soft > flat)
\`\`\``;

// --- Generate output ---

let out = `# Code Knowledge Graph
<!-- AUTO-GENERATED by scripts/generate-codegraph.js — do not edit manually -->
<!-- Regenerated on every commit via pre-commit hook -->

Quick-lookup graph of the codebase. Check here FIRST before reading files — go straight to the right file:line.

## Routes → Handlers → Downstream

| Method | Route | File:Line | Calls |
|--------|-------|-----------|-------|
`;

for (const r of routeCalls) {
  const callStr = r.calls.length ? r.calls.join(', ') : '—';
  out += `| ${r.method} | ${r.path} | server.js:${r.line} | ${callStr} |\n`;
}

out += `
## Chat Flow (server.js:${routeCalls.find(r => r.path === '/chat')?.line || '?'})

${CHAT_FLOW}

## Ingestion Pipeline (profile.js)

${INGEST_FLOW}

## Job Processing Pipeline (pipeline.js:${processJobLine})

${JOB_FLOW}

## Cron Pipeline (cron.js)

${CRON_FLOW}

## Merge Logic (profile.js:${mergeProfileLine})

${MERGE_FLOW}

## LLM Functions (llm.js)

| Function | Line | Purpose |
|----------|------|---------|
`;

const llmPurpose = {
  extractFacts: 'Parse raw text → structured profile JSON',
  classifyIntent: 'Intent gate: scope check + direct reply for questions',
  chatEnrich: 'Extract profile data from conversation',
  smartMerge: 'LLM-powered merge of existing + new profile',
  tailorResume: 'Rewrite profile into job-tailored resume',
  improveResume: 'Rewrite bullets with missing JD keywords',
  calculateAtsScore: 'Score resume vs JD',
};
for (const f of llmFuncs) {
  out += `| ${f.name} | ${f.line} | ${llmPurpose[f.name] || ''} |\n`;
}

const askJsonLine = backendScans['llm.js'].funcs.find(f => f.name === 'askJson')?.line || '?';
out += `\nAll use \`askJson(system, user, name, trace, prompt, history)\` [llm.js:${askJsonLine}] — OpenRouter (gpt-4o-mini), JSON mode, Langfuse traced.\n`;

out += `
## Database (db.js)

### Tables

| Table | Key Columns |
|-------|-------------|
`;
for (const t of tables) {
  out += `| ${t.name} | ${t.columns.map(c => c.name + ' (' + c.type + ')').join(', ')} |\n`;
}

out += `
### DB Functions

| Function | Line | Purpose |
|----------|------|---------|
`;
const dbPurpose = {
  initSchema: 'Create tables on startup',
  getProfile: 'Get latest profile (adds _onboarded flag)',
  saveProfile: 'Upsert profile, increments version',
  getProfileVersions: 'List profile version history',
  restoreProfileVersion: 'Restore a previous version',
  seenJobBefore: 'Dedup check by job_id',
  insertJobProcessing: 'Insert job with status=processing',
  saveTailored: 'Save rendered resume',
  markDelivered: 'Mark resume delivered + store ATS metadata',
  markJobFailed: 'Mark job as failed with reason',
  getJobByJobId: 'Get single job',
  getJobsForUser: 'List jobs for user',
  recoverStaleJobs: 'Find jobs stuck in processing > N minutes',
};
for (const f of dbFuncs) {
  out += `| ${f.name} | ${f.line} | ${dbPurpose[f.name] || ''} |\n`;
}

out += `
## Frontend Pages

| Page | File | API Calls |
|------|------|-----------|
`;
const pageFiles = frontendPages.filter(p => p.name.includes('pages/'));
for (const p of pageFiles) {
  const apiStr = p.apiCalls.length ? p.apiCalls.map(a => 'api.' + a).join(', ') : '—';
  out += `| ${path.basename(p.name, path.extname(p.name))} | ${p.name} | ${apiStr} |\n`;
}

out += `
## Frontend → Backend API Map

| Frontend Method | Route | Backend Line |
|-----------------|-------|-------------|
`;
const apiFile = frontendPages.find(p => p.name === 'api.js');
const apiLines = readLines(path.join(FRONTEND, 'api.js'));
const apiMethods = [];
apiLines.forEach((line, i) => {
  const methodMatch = line.trim().match(/async (\w+)\s*\(/);
  if (methodMatch && !['getHeaders', 'waitForAuth', 'checkedFetch'].includes(methodMatch[1])) {
    // Find the route in the method body
    for (let j = i; j < Math.min(i + 5, apiLines.length); j++) {
      const routeMatch = apiLines[j].match(/\$\{BASE\}\/([^`'"]+)/);
      if (routeMatch) {
        const route = '/api/' + routeMatch[1].replace(/\$\{[^}]+\}/g, ':id').replace(/\?.*/, '');
        const serverRoute = routeCalls.find(r => r.path === route || r.path === '/' + routeMatch[1].split('/')[0]);
        apiMethods.push({
          method: 'api.' + methodMatch[1] + '()',
          route,
          serverLine: serverRoute ? 'server.js:' + serverRoute.line : '—',
        });
        break;
      }
    }
  }
});
for (const m of apiMethods) {
  out += `| ${m.method} | ${m.route} | ${m.serverLine} |\n`;
}

out += `
## Backend Functions (all files)

`;
for (const f of backendFiles) {
  const scan = backendScans[f];
  if (!scan.funcs.length) continue;
  out += `### ${f}\n\n`;
  out += `| Function | Line | Exported |\n`;
  out += `|----------|------|----------|\n`;
  for (const fn of scan.funcs) {
    out += `| ${fn.name} | ${fn.line} | ${scan.exports.includes(fn.name) ? 'yes' : 'no'} |\n`;
  }
  out += '\n';
}

out += `## File Dependencies

\`\`\`
`;
for (const f of backendFiles) {
  const scan = backendScans[f];
  if (!scan.requires.length) continue;
  out += `${f}\n`;
  for (const r of scan.requires) {
    if (r.module.startsWith('.')) continue;
    if (r.imports.length) out += `  ├── ${r.module}.js (${r.imports.join(', ')})\n`;
    else out += `  ├── ${r.module}.js\n`;
  }
  for (const r of scan.requires) {
    if (!r.module.startsWith('.')) continue;
  }
  const localReqs = scan.requires.filter(r => !r.module.includes('/') || r.module.startsWith('./'));
  for (let i = 0; i < localReqs.length; i++) {
    const r = localReqs[i];
    const connector = i === localReqs.length - 1 ? '└──' : '├──';
    if (r.imports.length) out += `  ${connector} ${r.module}.js (${r.imports.join(', ')})\n`;
    else out += `  ${connector} ${r.module}.js\n`;
  }
  out += '\n';
}
out += '```\n';

// --- Auth flow (static, architecture-level) ---
const authLine = backendScans['auth.js'].funcs.find(f => f.name === 'authMiddleware')?.line || '?';
const adminOnlyLine = backendScans['admin.js'].funcs.find(f => f.name === 'adminOnly')?.line || '?';
out += `
## Auth Flow

\`\`\`
Firebase Auth (Google OAuth) → JWT token
  → Every API request: Authorization: Bearer <token>
  → authMiddleware [auth.js:${authLine}] verifies via firebase-admin
  → Sets req.userId, req.userEmail, req.userName
  → Admin routes: additional adminOnly check [admin.js:${adminOnlyLine}]
\`\`\`
`;

fs.writeFileSync(path.join(ROOT, 'CODEGRAPH.md'), out);
console.log('✓ CODEGRAPH.md regenerated');
