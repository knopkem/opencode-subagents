---
description: Generate a tailored AGENTS.md for this project (explore, then write)
agent: orchestrator
---

Generate a tailored AGENTS.md for this project.

Scope the exploration to this project's own directory — never parent or sibling
directories.

1. Run `ls -A` yourself to check the project. If it lists nothing — or only
   `.git`/`.orchestration` — there is nothing to map: skip `@explorer` and tell
   `@planner` the project is greenfield. Otherwise delegate to `@explorer` to
   map the language/tooling, test setup, style, and conventions of this
   codebase.
2. Delegate to `@planner` with the explorer summary and the project root to
   write a short, factual AGENTS.md — create only; never overwrite an existing
   one.
3. Report the path and a five-line summary of its contents.
