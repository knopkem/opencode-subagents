---
description: Start a spec-driven feature — explore, then write a decomposed spec
agent: orchestrator
---

Begin SDD for: $ARGUMENTS

Scope every brief to the target directory the user named (or the current
working directory): never send a subagent into a parent, sibling, or workspace
root.

1. Run `ls -A` yourself to check the target. If it lists nothing — or only
   `.git`/`.orchestration` — it is greenfield: skip `@explorer`, never look
   around. Otherwise delegate to `@explorer` to map the parts of the codebase
   this touches.
2. Delegate to `@planner` to write PLAN.md: goal, constraints, a `## Work items`
   section with one line per independently reviewable step in the exact form
   `- [ ] P<phase>.<n> <title> (files: <paths>; gate: <command>)`, and
   acceptance criteria that map to those IDs; plus a tailored AGENTS.md if the
   project has none. A plan without work items is not a plan — the process gate
   can track nothing, so verify the section exists before dispatching any coder.
3. Stop and present the plan summary for approval before any implementation.
