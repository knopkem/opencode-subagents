---
description: Run one task through the coder → reviewer → tester loop (no decomposition)
agent: orchestrator
---

Run the full coding pipeline on a SINGLE task — use this when the work can't (or
needn't) be split, but you still want fresh-eyes review and verification:

$ARGUMENTS

You have no file or shell tools. Do not attempt reconnaissance yourself — your
first action MUST be a `task` call. Include the target directory in every brief.

1. **Implement.** Dispatch one `@coder` with a self-contained brief: the goal
   above, the relevant files, acceptance criteria, and the AGENTS.md rules.
2. **Review (two-stage).** Pass the diff to `@reviewer` — spec-compliance first,
   then code quality. The reviewer did not write this code; it stays skeptical
   and only reports.
3. **Fix.** Send blockers/should-fixes back to the SAME coder; repeat 2–3 until
   the reviewer says ship.
4. **Verify.** Hand the change to `@tester` to add/run tests and report results
   verbatim.

Report a short summary: what changed, the review verdict, and the test result.
This is the decomposition-free path — one task, full implement→review→verify loop.
