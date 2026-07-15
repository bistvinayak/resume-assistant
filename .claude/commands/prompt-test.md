# Prompt Tester

Test a prompt against sample inputs and evaluate output quality.

## Instructions
For the prompt specified in $ARGUMENTS:

1. **Read the prompt** from src/llm.js
2. **Design test cases** covering:
   - **Happy path** — typical good input
   - **Minimal input** — shortest valid input that should still produce output
   - **Empty/garbage input** — should fail gracefully, not hallucinate
   - **Adversarial input** — user tries to inject instructions or off-topic content
   - **Long input** — stress test with verbose resume/JD

3. **For each test case, evaluate:**
   - Did the JSON parse correctly?
   - Are all required schema fields present?
   - Is the content factually grounded in the input? (no hallucination)
   - Is the output length reasonable?
   - Are there any schema violations?

4. **Output a test matrix:**

| Test Case | Input Summary | JSON Valid | Schema Complete | Grounded | Issues |
|-----------|--------------|-----------|----------------|----------|--------|
| Happy path | ... | Y/N | Y/N | Y/N | ... |
| Minimal | ... | Y/N | Y/N | Y/N | ... |
| Empty | ... | Y/N | Y/N | Y/N | ... |

5. **If any test fails**, suggest a prompt fix and re-test

## Notes
- Use the actual OpenRouter API via the existing askJson function to run tests
- Compare against Langfuse evaluations (extraction-fields, ats-score, etc.)
- Report token usage per test case
