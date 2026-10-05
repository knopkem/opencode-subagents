# Project rules (template)

> OpenCode injects this file into every agent and subagent prompt. Keep it
> **compact** — it is the cheapest, highest-leverage way to stop fresh-context
> subagents from hallucinating your conventions. Replace the examples below with
> your project's real rules and delete this note.

## Conventions
- Language / framework: <e.g. TypeScript, strict mode>
- Validation: <e.g. Zod for all external input>
- Data access: <e.g. repository pattern; no raw queries in handlers>
- Errors: <e.g. never swallow; wrap with context>

## Tests
- Location: <e.g. `*.test.ts` adjacent to source>
- Run: <e.g. `npm test`>
- A change is not done until its tests are green.

## Style
- Match surrounding code; don't introduce new patterns unasked.
- <project-specific naming / formatting rules>

## Delegation norms (for the orchestrator)
- Decompose into independent, bounded tasks before dispatching.
- Each `coder` task brief must be self-contained — assume zero shared context.
- Two-stage review (spec, then quality) before integration.
