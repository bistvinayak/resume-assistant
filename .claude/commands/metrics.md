# Product Metrics

Define success metrics and instrumentation plan for a feature.

## Instructions
For the feature described in $ARGUMENTS:

### 1. North Star Metric
- One metric that best captures whether this feature is working
- How to measure it (Langfuse score, DB query, or new instrumentation)

### 2. Input Metrics (leading indicators)
| Metric | Definition | Target | How to Measure |
|--------|-----------|--------|---------------|
| ... | ... | ... | Langfuse / DB / frontend event |

### 3. Output Metrics (lagging indicators)
| Metric | Definition | Target | How to Measure |
|--------|-----------|--------|---------------|
| ... | ... | ... | Langfuse / DB / frontend event |

### 4. Guardrail Metrics (things that should NOT get worse)
| Metric | Current Baseline | Alert Threshold |
|--------|-----------------|----------------|
| ... | ... | ... |

### 5. Instrumentation Plan
- What Langfuse evaluations to add (scores on traces)
- What frontend events to track
- What DB queries to run for dashboards

### Rules
- Every metric must be measurable with current infra (Langfuse, PostgreSQL, frontend)
- Prefer Langfuse scores over custom analytics — they're already wired
- Reference existing evaluations: ats-score, extraction-fields, skills-extracted, user-feedback, substitutions
- Include at least one qualitative signal (user feedback thumbs up/down rate)
