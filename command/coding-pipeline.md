---
description: Run one task through plan → coder → reviewer → tester (no decomposition)
agent: orchestrator
---

Run the full coding pipeline on a SINGLE task — use this when the work can't (or
needn't) be split, but you still want planning, fresh-eyes review and
verification:

$ARGUMENTS

You have no file or shell tools. Do not attempt reconnaissance yourself — your
first action MUST be a `task` call. Include the target directory and the
absolute PLAN.md path in every brief.

1. **Plan.** Dispatch `@explorer` to map anything that already exists (skip for
   a greenfield task), then `@planner` to write PLAN.md and, if the project has
   none, a tailored AGENTS.md.
2. **Implement.** Dispatch one `@coder` with a self-contained brief: the goal,
   the relevant files, acceptance criteria, the PLAN.md/AGENTS.md paths, and an
   instruction to read both before editing.
3. **Review (two-stage).** Pass the diff to `@reviewer` — spec-compliance
   against PLAN.md first, then code quality. The reviewer did not write this
   code; it stays skeptical and only reports.
4. **Fix.** Send blockers/should-fixes back to the SAME coder; repeat 3–4 until
   the reviewer says ship.
5. **Verify.** Hand the change to `@tester` to add/run tests and report results
   verbatim.

Report a short summary: what changed, the review verdict, and the test result.
This is the decomposition-free path — one task, full plan→implement→review→verify loop.
