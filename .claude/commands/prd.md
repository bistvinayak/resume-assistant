# Product Requirements Document

Write a concise PRD for a new Arjun feature or initiative.

## Context
Arjun is an AI resume assistant that: ingests user profiles (PDF/chat), tailors resumes to job descriptions using LLM, scores against ATS keywords, auto-processes Gmail job alerts via cron, and lets users download .docx/.pdf resumes. Stack: React, Express, PostgreSQL, Firebase Auth, OpenRouter, Langfuse.

## Instructions
For the initiative described in $ARGUMENTS, produce:

### 1. Overview
- One-paragraph summary of what we're building and why

### 2. Goals & Non-Goals
- **Goals:** 3-4 measurable outcomes
- **Non-Goals:** What this explicitly does NOT cover

### 3. Background
- Current state: what exists today and what's broken/missing
- User feedback or data points motivating this (reference Langfuse traces, feedback scores, or ATS score distributions if relevant)

### 4. Detailed Design
- Feature behavior, screen by screen
- API contract (request/response shapes)
- Data model changes (new columns, tables, profile schema fields)
- LLM prompt changes if applicable

### 5. Launch Plan
- Phase 1 (MVP): minimum to ship
- Phase 2: fast-follow improvements
- Rollback plan: how to disable if broken

### 6. Metrics & Monitoring
- Success metrics (with targets)
- Langfuse evaluations to add
- Alerts or dashboards needed

### 7. Open Questions
- Decisions still needed, with recommended answers

Keep it under 2 pages. Bias toward specifics over generalities.
