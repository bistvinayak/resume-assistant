# Product Review

Review a feature or screen from a product perspective.

## Instructions
For the feature/screen specified in $ARGUMENTS:

1. **Open the relevant source files** — read the component, API endpoint, and LLM prompt involved
2. **Evaluate against these dimensions:**

### Usability
- Is the flow intuitive? Can a first-time user complete it without help?
- Are loading, error, and empty states handled?
- Is the copy clear and actionable?

### Completeness
- Does it handle all user intents? (happy path + edge cases)
- Are there dead ends where the user gets stuck?
- Does it degrade gracefully when the LLM fails or returns bad data?

### Value
- Does this feature deliver on its promise?
- Is there unnecessary friction between intent and outcome?
- What's the minimum the user needs to do to get value?

### Consistency
- Does it match the design language of other tabs? (fonts, colors, spacing)
- Are interaction patterns consistent? (confirm/discard, feedback, loading)

### Observability
- Are Langfuse traces capturing the right data?
- Can we tell from traces if this feature is working well?
- Is there user feedback (thumbs up/down) connected?

3. **Output a punch list** — ordered by severity:
   - P0: Blocks usage or causes confusion
   - P1: Degrades experience noticeably
   - P2: Polish items

Be specific — reference line numbers, copy text, and component names.
