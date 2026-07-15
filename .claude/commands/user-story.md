# User Story Generator

Generate user stories with acceptance criteria for Arjun features.

## Instructions
For the feature described in $ARGUMENTS, generate 3-6 user stories in this format:

### Story: [Title]
**As a** [user type]
**I want to** [action]
**So that** [benefit]

**Acceptance Criteria:**
- [ ] Given [context], when [action], then [result]
- [ ] Given [context], when [action], then [result]

**Priority:** P0 (must-have) / P1 (should-have) / P2 (nice-to-have)
**Effort:** S (< 2hrs) / M (2-8hrs) / L (1-2 days)

## Rules
- Stories must be independently deliverable
- Each story should be testable from the UI
- Reference Arjun's actual tabs: Profile Index, Build Profile, Tailor Resume, Job Activity, Skill Gaps
- Consider both the end user and the admin dashboard user
- Include at least one edge case story (error state, empty state)
- Order stories by implementation dependency (build order)
