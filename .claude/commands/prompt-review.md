# Prompt Review

Audit an existing Arjun prompt for quality, correctness, and robustness.

## Instructions
For the prompt specified in $ARGUMENTS (or all prompts if none specified):

1. **Read the prompt** from src/llm.js PROMPT_DEFS
2. **Score each dimension** (1-5):

| Dimension | Score | Issue |
|-----------|-------|-------|
| **Clarity** — Is the task unambiguous? | | |
| **Grounding** — Does it prevent hallucination? | | |
| **Schema** — Is the output JSON schema complete and correct? | | |
| **Edge cases** — Does it handle empty/malformed input? | | |
| **Efficiency** — Is it concise without losing precision? (token cost) | | |
| **Consistency** — Will it produce similar output across runs? | | |
| **Eval-ready** — Can output quality be scored programmatically? | | |

3. **List specific issues** with line references
4. **Suggest fixes** — rewrite the problematic sections
5. **Estimate token impact** — will the fix increase or decrease prompt tokens?
6. **Cross-prompt check** — are schemas consistent across prompts? (e.g., does extract_facts output match what chat_enrich expects?)

## Common Prompt Anti-Patterns to Check
- Vague instructions ("be helpful", "do your best")
- Contradictory rules
- Missing output fields in the schema
- No examples for ambiguous tasks
- Temperature too high for structured output
- No handling of "I don't know" / empty extraction
- Redundant instructions inflating token count
- Schema mismatch between extraction and downstream consumers
