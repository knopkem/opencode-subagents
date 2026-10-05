# SpriteForge — project rules

## Stack & tooling
- TypeScript (strict) + Vite, vanilla DOM. Dev deps only: `vite`, `typescript`, `vitest`.
- No React/Svelte, no UI framework. No jsdom/canvas in tests.
- Node ≥ 18. App is a single-page 32×32 pixel-art animation editor.

## Commands
- `npm install`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — `vitest run` (node environment)
- `npm run build` — `tsc --noEmit && vite build`
- A change is not done until typecheck, tests, and build are green.

## Module boundaries
- `src/model/` — pure, no `window`/`document`; `Uint8ClampedArray` RGBA buffers.
- `src/state/` — framework-free store, history, tools, playback; no DOM.
- `src/ui/` — DOM glue only; may import model/state, never the reverse.
- `src/main.ts` — wiring only.
- Tests: `*.test.ts` adjacent to the module; cover pure model/state logic.

## Conventions
- Match surrounding code; no new patterns unasked.
- Never swallow errors; wrap with context.
- Fixed 32×32 canvas, ≤64 frames, default document = 4 layers.
- Onion skin is view-only; never stored in the document.
- Shortcuts attach to the focusable canvas container (`tabindex=0`) only; never clobber defaults elsewhere.

## Durable docs
- Keep `INTEGRATION.md` current: module → exported symbols → importer/mount point; flag unreachable code.
- Append decisions to `DECISIONS.md` (one line each: decision + rationale); never rewrite history.
- `PLAN.md` is the contract.

## Delegation norms (for the orchestrator)
- Decompose into independent, bounded tasks before dispatching.
- Each `coder` task brief must be self-contained — assume zero shared context.
- Two-stage review (spec, then quality) before integration.
