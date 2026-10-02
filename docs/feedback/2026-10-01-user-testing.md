# User testing feedback — 2026-10-01

Raw notes from a tester, followed by where each issue lives in the code.

## Tester notes (verbatim)

- A bit confused by the verification process: once you reload the page after inputting a resume, it clears and does not save on the Arjun website, leaving the user wondering if it worked / when it will be approved.
  - I see now, but the reroute to the status was not fluid / confusing.
- How do you get the Arjun Chrome extension?
  - Found that as well.
- Thoroughly impressed by the job analysis feature integrated through the Chrome extension.
- I appreciate the Arjun skill section allowing for voice tailoring / cover letter formatting.
  - Is a basic writing sample good for the voice cadence / tailoring fit?
- The skill breakdown drawn from just a resume is also very impressive.
- When using the Chrome extension full analysis side tab, maybe add a way to jump from job to job for analysis there as well, similar to the quick analysis?
- Arjun's confidence increases the more you align for the job at hand, but falls as your fit decreases.
- I think it overweights holes in the resume.
  - Example: a low-fit job (premium LinkedIn generation) where I am greatly underqualified still evaluates my fit at 50%, and cites that I am missing 2-7 years of experience, but does not evaluate that I do not have that experience.
- Automatically assumes I require sponsorship or a visa / am not a U.S. citizen?
  - I tried adding U.S. Citizen to my profile and am still getting flagged.
  - May be due to the job mentioning a clearance level despite not requiring one.
- First attempt at adding the SIE certification failed, but it worked the second time.

## What the tester liked

- Job analysis in the Chrome extension.
- Skill breakdown generated from the resume alone.
- Skills section: voice tailoring and cover-letter formatting.

## Triage against the code

| # | Issue | Cause | Where |
|---|-------|-------|-------|
| 1 | U.S. citizen still flagged for visa/sponsorship | `visaVerdict` only reads the posting; the candidate's status is never considered. No citizenship / work-authorization field exists in the profile. | `src/jev.js` (`visaVerdict`, `QUESTIONS.citizenship_or_clearance_required`) |
| 2 | False block on postings that only mention clearance | The clearance criterion counts "holding/**obtaining** a security clearance", so a passing mention trips the block at noul >= 0.5. | `src/jev.js` |
| 3 | Onboarding resets on reload; unclear whether it worked or when approval comes | The step lives only in React state. After upload, `setStep(2)` runs without updating the URL, so a reload returns to an empty step 1 even though the profile was saved. | `resumeai-frontend/src/pages/Onboarding.jsx` |
| 4 | Badly underqualified jobs still score ~50% | `overallFit.percent` is a probability-weighted average over 5 levels, so hedged answers regress to the middle. The `seniority` answer (which catches the years gap) never adjusts the overall percent. | `src/jev.js` (`fitResult`), `src/fitEngine.js` |
| 5 | Side panel can't move job to job | The side panel has no tab-change / URL-change listener; it stays on the job it was opened for. | `extension/sidepanel.js` |
| 6 | Reroute to status page felt confusing | UX: needs a persistent "pending approval" status visible after reload / on the dashboard. | Onboarding / Dashboard |
| 7 | Extension hard to discover | UX: add a visible install link in the web app. | Landing / Dashboard |
| 8 | SIE certification failed on first add, worked on retry | Not reproduced; likely a transient LLM / network failure in profile ingestion. | `src/profile.js` |
| 9 | Is a basic writing sample enough for voice tailoring? | Question for docs / in-app guidance. | Skills section |

## Suggested order

1. Persist onboarding step in the URL (`?step=gmail`) and show pending status after reload. (#3, #6)
2. Add a work-authorization field to the profile and skip the visa block for citizens / green-card holders. (#1)
3. Tighten the clearance criterion to explicit requirements only. (#2)
4. Let an `under_qualified` seniority answer cap or lower the overall fit percent. (#4)
5. Make the side panel follow the active job tab. (#5)
