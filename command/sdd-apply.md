---
description: Implement the approved spec — dispatch a fresh coder per task
agent: orchestrator
---

Implement the approved spec.

For each task, in dependency order:
1. Dispatch a **fresh** `@coder` with a self-contained brief (goal, files,
   acceptance criteria, AGENTS.md rules). No shared context between tasks.
2. When it lands, run two-stage `@reviewer` (spec, then quality).
3. Send fixes back to the same coder until the reviewer says ship.

Report progress per task. Do not start a dependent task before its prerequisite
passes review.
