# Prompt Optimizer

Reduce token cost of a prompt without sacrificing output quality.

## Instructions
For the prompt specified in $ARGUMENTS:

1. **Measure current cost** — count the system prompt tokens (rough: words × 1.3)
2. **Identify waste:**
   - Redundant instructions saying the same thing twice
   - Verbose examples that could be shorter
   - Rules that the model already follows by default
   - Schema comments that don't affect output
   - Unnecessary whitespace and formatting

3. **Apply optimizations:**
   - Merge overlapping rules
   - Replace verbose examples with concise ones
   - Remove obvious instructions ("return valid JSON" when response_format is set)
   - Use shorthand for repeated patterns
   - Move rarely-triggered rules to the end (model pays less attention)

4. **Output:**

```
BEFORE: ~[X] tokens
AFTER:  ~[Y] tokens
SAVED:  ~[Z] tokens ([%] reduction)

CHANGES:
1. [What was removed/shortened and why it's safe]
2. ...

RISK ASSESSMENT:
- [What could break with this optimization]
- [How to verify: which Langfuse evaluations to watch]
```

5. **Update src/llm.js** with the optimized prompt
6. **Update Langfuse** — the new version will sync on next deploy via syncPrompts()

## Rules
- Never sacrifice grounding/anti-hallucination rules for token savings
- Never remove the JSON schema — it's critical for parsing
- Test the optimized prompt mentally against edge cases before committing
- Target 15-30% reduction without quality loss
