# Prompt Writer

Write or rewrite an LLM prompt for Arjun's pipeline.

## Context
Arjun uses these prompts (defined in src/llm.js, synced to Langfuse Prompts):
- `extract_facts` — parse resume/text into structured profile JSON
- `tailor_resume` — rewrite profile into job-tailored resume
- `improve_resume` — rephrase bullets using missing JD keywords
- `ats_score` — score resume against job description keywords
- `chat_enrich` — conversational profile building with extraction + reply

All prompts return JSON. Model: OpenRouter (gpt-4o-mini default), temperature 0.2.

## Instructions
For the prompt task described in $ARGUMENTS:

1. **Read the current prompt** from src/llm.js (the PROMPT_DEFS object)
2. **Identify the issue** — what's wrong or what needs to change
3. **Write the new prompt** following these principles:

### Prompt Engineering Principles
- **Role first** — start with who the model is and its single job
- **Constraints before freedom** — state what NOT to do before what to do
- **Show don't tell** — use examples for ambiguous instructions
- **Structured output** — always specify exact JSON schema with field descriptions
- **Chain of thought** — for complex tasks, break into numbered steps
- **Grounding** — reference the input data explicitly ("from the candidate profile", "from the JD")
- **Anti-hallucination** — explicitly say "do not invent", "only use facts from the input"
- **Deduplication rules** — when merging data, specify how to handle conflicts
- **Edge cases in-prompt** — handle empty inputs, missing fields, ambiguous data

### Output Format
```
PROMPT NAME: [name]

SYSTEM PROMPT:
[the full system prompt text]

VARIABLES: [list any {{mustache}} variables]

EVALUATION CRITERIA:
- [how to score this prompt's output quality]
- [what Langfuse evaluations to add/modify]

TEST CASES:
1. Input: [sample input] → Expected: [what good output looks like]
2. Input: [edge case] → Expected: [how it should handle it]
```

4. **Show the diff** — what changed from the current prompt and why
5. **Update src/llm.js** with the new prompt in the PROMPT_DEFS object
