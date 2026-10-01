---
description: Implement the approved PLAN.md — dispatch a fresh coder per task
agent: orchestrator
---

Implement the approved PLAN.md.

For each task in the plan, in dependency order:
1. Dispatch a **fresh** `@coder` with a self-contained brief (goal, files,
   acceptance criteria, and the absolute PLAN.md/AGENTS.md paths — it must read
   both first). No shared context between tasks.
2. When it lands, run two-stage `@reviewer` (spec-compliance against PLAN.md,
   then quality).
3. Send fixes back to the same coder until the reviewer says ship.

Report progress per task. Do not start a dependent task before its prerequisite
passes review.
