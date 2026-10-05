---
description: Start a spec-driven feature — explore, then write a decomposed spec
agent: orchestrator
---

Begin SDD for: $ARGUMENTS

Scope every brief to the target directory the user named (or the current
working directory): never send a subagent into a parent, sibling, or workspace
root. An empty target is greenfield, not a reason to look around.

1. Delegate to `@explorer` to map the parts of the codebase this touches.
2. Delegate to `@planner` to write PLAN.md: goal, constraints, and a numbered
   list of **independent, bounded tasks** with acceptance criteria for each;
   plus a tailored AGENTS.md if the project has none.
3. Stop and present the plan summary for approval before any implementation.
