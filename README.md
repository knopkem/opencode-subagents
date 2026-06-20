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
2. **Decompose** — split the work into *independent, bounded* tasks.
3. **Dispatch fresh** — each task goes to a new subagent with **zero context**
   from the others (no pollution, no drift). Everything it needs is in the brief.
4. **Two-stage review** — one pass for spec-compliance, a separate one for code
   quality, by an agent that didn't write the code.
5. **Integrate** — run the full suite and validate end to end.

Search is independent by nature; coding isn't — *unless you pre-decompose it*.
SDD is the discipline that makes implementation delegable.

## The roles

| Agent | Mode | Model tier | Job |
|---|---|---|---|
| `orchestrator` | primary | premium | Decompose, delegate, integrate. Writes no app code itself. |
| `explorer` | subagent | cheap, read-only | Map the codebase, return a tight summary. |
| `coder` | subagent | mid | Implement ONE bounded task from a self-contained brief. |
| `reviewer` | subagent | mid, read-only | Spec-compliance pass, then quality pass. |
| `tester` | subagent | cheap | Write/run tests, report failures verbatim. |

Cheap models do the narrow, bounded work; premium models are reserved for
planning and judgement. That tiering is where the cost savings come from.

## Install

```bash
# global config
cp -r agent command opencode.json ~/.config/opencode/
# AGENTS.md goes in your PROJECT root (it's per-project rules)
cp AGENTS.md /path/to/your/project/AGENTS.md
```

Then edit:
- **`opencode.json`** / `agent/*.md` — set the `model` fields to models you
  actually have access to (the defaults are illustrative and **model IDs date
  quickly** — check the [OpenCode docs](https://opencode.ai/docs)).
- **`AGENTS.md`** — replace the template with your project's real conventions.

## Use

```
/sdd-init   <feature>   # explore + write a decomposed spec, then stop for approval
/sdd-apply              # dispatch a fresh coder per task, two-stage review each
/sdd-verify             # full suite + end-to-end check
/swarm      <work>      # fan out independent subtasks to parallel coders (cap 3)
```

Or invoke a specialist directly: `@explorer map the auth module`,
`@reviewer review this diff`.

## How it works (the levers)

- **`description` drives delegation.** OpenCode/Claude Code decide *when* to use
  a subagent largely from its `description`. Phrasing it as a clear trigger
  ("use proactively before any implementation") makes delegation happen more.
- **Per-agent model routing.** Each agent sets its own `model`; `small_model` in
  `opencode.json` routes cheap internal tasks to a fast model.
- **`task` permission + `task_budget`.** Subagents can spawn others only where
  explicitly allowed, and `task_budget` caps the loop so an implementer→tester
  cycle can't run away.
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
