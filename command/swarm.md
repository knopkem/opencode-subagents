---
description: Fan out independent subtasks to parallel coders, capped for safety
agent: orchestrator
---

Parallel swarm for: $ARGUMENTS

1. Split the work into independent subtasks (no shared mutable state between
   them — if they'd touch the same files, sequence instead).
2. Dispatch up to **3 coders in parallel**, each with a self-contained brief.
3. Collect results, run `@reviewer` on each diff, then `@tester` on the whole.
4. Report a consolidated summary. If any subtask fails review, fix before
   integrating the rest.

Safety: never exceed the parallel cap; never let subtasks edit overlapping files
concurrently.
