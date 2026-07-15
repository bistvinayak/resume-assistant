# Feature Spec

Write a product feature specification for the Arjun resume assistant.

## Context
Arjun is an AI-powered resume tailoring platform. Architecture: React+Vite frontend, Express backend, PostgreSQL, Firebase Auth, OpenRouter LLM, Langfuse observability. Deployed on Railway, served via CloudFront at vinayakbist.com/projects/arjun.

Key modules: onboarding (PDF/text ingestion), profile building (chat with Arjun), resume tailoring (job URL → ATS-optimized resume), Gmail cron (auto-process job alerts), admin dashboard.

## Instructions
Given the user's feature idea (passed as $ARGUMENTS), produce:

1. **Problem Statement** — What user pain does this solve? (2-3 sentences)
2. **Target User** — Who benefits and when?
3. **Proposed Solution** — How it works, step by step
4. **User Flow** — Numbered steps from trigger to completion
5. **Acceptance Criteria** — Testable "Given/When/Then" statements (5-8)
6. **Data Model Changes** — Any new DB fields, tables, or profile schema changes
7. **API Changes** — New or modified endpoints
8. **UI Changes** — Which screens change, what components are added
9. **Edge Cases** — What could go wrong, how to handle it
10. **Success Metrics** — How do we know this worked? (2-3 measurable outcomes)
11. **Effort Estimate** — S/M/L with reasoning
12. **Dependencies** — What needs to exist first

Be specific to Arjun's architecture. Reference actual files, endpoints, and components where relevant.
