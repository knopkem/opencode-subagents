# opencode-subagents

A small, opinionated **spec-driven-development (SDD)** subagent setup for
[OpenCode](https://opencode.ai) — plus a guide explaining *why* it's shaped this
way. Drop it into your config and your tool stops using subagents only for
search and starts using them to plan, build, and review.

> Most of the patterns here transfer directly to Claude Code and other agentic
> coding tools. The config format (`opencode.json`, `agent/*.md`) is
> OpenCode-specific.

---

## Why subagents are "only used for search" by default

This is normal, and it's by design. A subagent runs in its **own context
window** and returns only a condensed summary to the main conversation. That
makes delegation a great fit for verbose, read-heavy, *independent* work — which
is exactly what search is — because the main agent gets the conclusion without
paying for all the tokens it took to get there. OpenCode and Claude Code both
ship a fast, **read-only** search subagent as the default (Claude Code's is
`Explore`, running on a small model with write/edit denied).

Implementation is the opposite: it's sequential and tightly coupled (read →
edit → test → fix), so splitting it across agents risks conflicting edits and
drift. So the tool keeps coding inline and farms out the wide lookups.

**To get more subagent use, you don't wait for the tool to decide — you
*structure the work* so delegation is the obvious move.** That's what SDD does.

## The idea: spec-driven development

1. **Explore** — a read-only agent maps the code and returns a summary.
2. **Plan** — a planner writes a durable `PLAN.md` (and a tailored `AGENTS.md`
   when the project has none), giving every later step a shared spec.
3. **Decompose** — split the plan into *independent, bounded* tasks.
4. **Dispatch fresh** — each task goes to a new subagent with **zero context**
   from the others (no pollution, no drift). Everything it needs is in the brief.
5. **Two-stage review** — one pass for spec-compliance against the plan, a
   separate one for code quality, by an agent that didn't write the code.
6. **Integrate** — run the full suite and validate end to end.

Search is independent by nature; coding isn't — *unless you pre-decompose it*.
SDD is the discipline that makes implementation delegable.

## The roles

| Agent | Mode | Model tier | Job |
|---|---|---|---|
| `orchestrator` | primary | planner | Decompose, delegate, integrate. Writes no app code itself. |
| `planner` | subagent | planner | Write PLAN.md + a tailored AGENTS.md. Docs only. |
| `explorer` | subagent | builder, read-only | Map the codebase, return a tight summary. |
| `coder` | subagent | builder | Implement ONE bounded task from a self-contained brief. |
| `reviewer` | subagent | planner, read-only | Spec-compliance against PLAN.md, then quality. |
| `tester` | subagent | builder | Write/run tests, report failures verbatim. |

One strong model plans and reviews; one fast model does the narrow work. That
tiering is where the speed savings come from.

## Install

See **[INSTALL.md](INSTALL.md)**:

- **Scripted install (recommended)** — `./scripts/set-models.py` picks your
  planner and builder from `opencode models`, saves the selection to gitignored
  `models.local.json`, renders `agent.local/`, and links it into
  `~/.config/opencode/agent`. The repo only ever ships placeholders, so model
  IDs never enter git history.
- **Manual install** — copy the agent files and fill the placeholders yourself.

## Use

```
/init-agents             # explore + generate a tailored AGENTS.md for this project
/sdd-init   <feature>    # explore + write PLAN.md, then stop for approval
/sdd-apply               # dispatch a fresh coder per task, two-stage review each
/sdd-verify              # full suite + end-to-end check
/swarm      <work>       # fan out independent subtasks to parallel coders (cap 3)
/coding-pipeline <task>  # ONE task through plan → coder → reviewer → tester
```

`/coding-pipeline` is the decomposition-free path: when the code can't be split
but you still want a plan and fresh-eyes review, it runs a single task through
the full plan → implement → review → test loop.

Or invoke a specialist directly: `@explorer map the auth module`,
`@reviewer review this diff`.

## How it works (the levers)

- **`description` drives delegation.** OpenCode/Claude Code decide *when* to use
  a subagent largely from its `description`. Phrasing it as a clear trigger
  ("use proactively before any implementation") makes delegation happen more.
- **Per-agent model routing.** Agent files carry `__PLANNER_MODEL__` /
  `__BUILDER_MODEL__` placeholders; `scripts/set-models.py` resolves them into
  gitignored `agent.local/`, keeping the repo environment-agnostic.
- **`task` permission.** Subagents can spawn others only where explicitly
  allowed (the coder may call the tester; everything else is denied) — a
  deny-by-default delegation graph. OpenCode has no per-agent spawn budget; to
  cap an agent's iterations use the `steps` field.
- **AGENTS.md.** Compact project rules injected into every fresh-context
  subagent so they don't reinvent your conventions.

## Honesty about the claims

This repo is built from [deep research](docs/RESEARCH.md) that
**adversarially fact-checked** each claim. A few popular ideas did **not**
survive verification — notably some specific cost-savings percentages and the
"pantheon" role model are self-reported or uncorroborated. See
[`docs/RESEARCH.md`](docs/RESEARCH.md) for the verified findings, the refuted
ones, the open questions, and sources.

## Credits & prior art

- [OpenCode docs — Agents](https://opencode.ai/docs/agents/)
- [gotar/opencode-config](https://github.com/gotar/opencode-config)
- [marco-jardim/opencode-model-router](https://github.com/marco-jardim/opencode-model-router)
- [awesome-opencode-subagents](https://github.com/ankitmundada/awesome-opencode-subagents)
- [Anthropic — building a multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system)

## License

MIT — see [LICENSE](LICENSE).
