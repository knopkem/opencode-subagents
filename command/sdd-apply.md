---
description: Implement the approved PLAN.md task by task
agent: orchestrator
---

Implement the approved PLAN.md, following your configured session policy
(fresh per task, or one resumable session per phase — see your dispatch rules).

Group its tasks into phases by integration seam. For each task:
1. Dispatch `@coder` with a self-contained brief: goal, files, acceptance
   criteria, and the absolute PLAN.md/AGENTS.md/INTEGRATION.md paths — it must
   read them first.
2. Each phase's last task is an integration check: wire the phase in, update
   INTEGRATION.md, verify reachability end to end.
3. Run two-stage `@reviewer` (spec-compliance against PLAN.md, then quality and
   reachability/dead code).
4. Send fixes back until the reviewer says ship.
5. Pipeline: when the next task is known, independent, file-disjoint, and
   `@reviewer` and `@coder` run on different models, dispatch both in the SAME
   message — `task` is foreground, so a lone reviewer parks the builder until
   it returns. With one model for everything, stay strictly serial; same-model
   pairs never overlap (review and tester always share a model, and two coders
   never run).

Report progress per task. Never start *dependent* work before the previous
phase passes review — but a file-disjoint next phase starts immediately; its
review and fixes trail and must be clean before that phase's integration gate
and the final end-to-end check.
