# Release Notes

Generate user-facing release notes from recent changes.

## Instructions
1. Read the git log for recent commits on the current branch
2. Group changes by category: New Features, Improvements, Bug Fixes
3. Write each item from the USER's perspective — what they can now do, not what code changed
4. Keep each item to 1-2 sentences
5. If a change is internal-only (refactor, observability, infra), skip it or put it under "Under the Hood" briefly

## Format

```
## Arjun [version/date]

### New
- [Feature description from user perspective]

### Improved
- [What got better and why it matters]

### Fixed
- [What was broken and how it's resolved now]

### Under the Hood
- [Brief internal improvements, optional]
```

## Rules
- No technical jargon (no "endpoint", "middleware", "trace") — speak in user language
- Lead with the benefit, not the mechanism
- If $ARGUMENTS contains a version number or date range, scope to that
- Otherwise, use the last 10 commits
