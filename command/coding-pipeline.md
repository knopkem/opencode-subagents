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
absolute PLAN.md path in every brief, and scope every brief to that directory:
never send a subagent into a parent, sibling, or workspace root, and treat an
empty target as greenfield.

1. **Plan.** Dispatch `@explorer` to map anything that already exists (skip for
   a greenfield task), then `@planner` to write PLAN.md — including its
   `## Work items` section (`- [ ] P<phase>.<n> <title> (files: …; gate: …)`) —
   and, if the project has none, a tailored AGENTS.md. No work items, no
   tracking: the gate treats a plan without them as a violation.
2. **Implement.** Dispatch one `@coder` with a self-contained brief: the goal,
   the relevant files, acceptance criteria, the PLAN.md/AGENTS.md/INTEGRATION.md
   paths, and an instruction to read them before editing.
3. **Review (two-stage).** Pass the diff to `@reviewer` — spec-compliance
   against PLAN.md first, then quality and reachability (no dead code). The
   reviewer did not write this code; it stays skeptical and only reports.
4. **Fix.** Send blockers/should-fixes back per your session policy (resume the
   coder session, or a fresh fix brief); repeat 3–4 until the reviewer says ship.
5. **Verify.** Hand the change to `@tester` to add/run tests and report results
   verbatim.

This path is serial by construction: a single task has no N+1 to overlap, so
review and verification run only after the coder stops. For pipelining
(review(N) ∥ coding(N+1)) use `/sdd-apply` or a multi-phase orchestrator run.

Report a short summary: what changed, the review verdict, and the test result.
This is the decomposition-free path — one task, full plan→implement→review→verify loop.
