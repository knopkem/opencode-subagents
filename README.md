# opencode-subagents

A spec-driven subagent pipeline for [OpenCode](https://opencode.ai): every role
gets its own model — a strong planner designs, a fast builder implements, a
reviewer and a tester verify (planning/review/test default to the same strong
model, but any roles can share). The repo ships prompts and permission graphs
only — model IDs stay on your machine.

## Workflow

```
Explore → Plan → Decompose → Dispatch → Review → Integrate
```

1. **Explore** — `explorer` maps the code and returns a short summary.
2. **Plan** — `planner` writes `PLAN.md` (file map, interfaces, ordered steps,
   acceptance criteria) and, if missing, a tailored `AGENTS.md`.
3. **Decompose** — the orchestrator splits the plan into independent tasks and
   groups them into phases by integration seam.
4. **Dispatch** — phase-persistent by default (later tasks resume the phase's
   coder session via `task_id`) or a fresh coder per task with `--sessions
   fresh`. Briefs point at `PLAN.md` / `AGENTS.md` / `INTEGRATION.md`.
5. **Review** — `reviewer` checks spec-compliance, reachability (no dead code),
   then quality; fixes go back to the same session.
6. **Integrate** — `tester` runs the suite and reports raw results.

Delegation is serialized per model: one task per provider at a time. On
split-model setups the orchestrator batches `review(N)`/`test(N)` with
`coding(N+1)` in **one message** for file-disjoint tasks, so the builder keeps
working while the reviewer/tester agents read; a lone reviewer would block the
parent. With a single model for everything, nothing overlaps — the plugin
rejects same-model tasks. Two coders can never run in parallel.

## Agents

| Agent | Mode | Model | Role |
|---|---|---|---|
| `orchestrator` | primary | own role (default: planner) | Decompose, delegate, integrate. No app code, no shell; may only read `PLAN.md` / `AGENTS.md`. |
| `planner` | subagent | own role | Write `PLAN.md` and `AGENTS.md`. Docs only. |
| `explorer` | subagent | own role (default: builder) | Read-only codebase mapping. |
| `coder` | subagent | own role | Implement bounded tasks within one phase's session; may call `tester`. |
| `reviewer` | subagent | own role (default: planner) | Read-only two-stage review. |
| `tester` | subagent | own role (default: planner) | Write/run tests, report results verbatim. |

## Commands

| Command | Does |
|---|---|
| `/coding-pipeline <task>` | One task: plan → coder → reviewer → tester. |
| `/init-agents` | Explore the repo and generate a tailored `AGENTS.md`. |
| `/sdd-init <feature>` | Explore + write `PLAN.md`, then stop for approval. |
| `/sdd-apply` | Implement `PLAN.md` task by task, reviewing each. |
| `/sdd-verify` | Full suite + end-to-end check against the plan. |

## Plugins

- `plugins/loop-breaker.js` — aborts near-duplicate tool calls (normalized
  repeats, identical output 3× even when interleaved, 5 consecutive edits to
  one file) so weak builder models cannot loop indefinitely. Thresholds are
  constants at the top of the file.
- `plugins/serialize-task.js` — one task per model: each `task` call reserves
  the subagent's model provider and agent type. A single-model setup stays
  fully serial; two coders can never run in parallel; different providers may
  overlap (pipeline review(N) with coding(N+1)).
- `plugins/compaction-ledger.js` — injects PLAN.md, AGENTS.md, DECISIONS.md and
  INTEGRATION.md into compaction summaries so a resumed coder session re-reads
  its durable memory instead of trusting a lossy summary.

## Install

```bash
git clone https://github.com/knopkem/opencode-subagents
cd opencode-subagents
./scripts/set-models.py                 # pick planner + builder + tester models
ln -s "$PWD/command" ~/.config/opencode/command
mkdir -p ~/.config/opencode/plugins
ln -sf "$PWD/plugins/"*.js ~/.config/opencode/plugins/
```

`set-models.py` lists `opencode models`, saves the choice to gitignored
`models.local.json`, renders `agent.local/`, and links it into
`~/.config/opencode/agent`. Every role gets its own model — `orchestrator`,
`planner`, `reviewer`, `tester`, `builder`, `explorer` — with unset roles
falling back to the planner model (orchestrator, reviewer, tester) or the
builder model (explorer); give several roles the same model to collapse them.
Flags: role pickers `--orchestrator/--planner/--reviewer/--tester/--builder/--explorer`,
`--list`, `--render`, `--think` / `--no-think`, `--sessions persistent|fresh`,
`--no-link`, `--force`. See [INSTALL.md](INSTALL.md) for the manual path.

Session mode is a render-time choice:
- `persistent` (default) — one resumable coder session per phase; continuity
  across tasks, guarded by the compaction ledger.
- `fresh` — a new coder session per task; maximum isolation, no cross-task
  memory beyond the files.

`bench-models.py` benchmarks prefill and decode speed of a shortlist of
models (interactive multi-select, `-n` runs, `-j` parallel jobs, `--json`
output) so you can pick a fast builder before running `set-models.py`.

For a brand-new project, start it with `./scripts/new-project.sh <dir>` — it
makes the target its own git root before OpenCode starts, so `**` globs can't
escape into the parent workspace. In each project, run `/init-agents` once.

## Design notes

- **Placeholders only in git** — agent files carry `__<ROLE>_MODEL__`
  placeholders (orchestrator, planner, reviewer, tester, builder, explorer);
  rendering happens locally into `agent.local/`.
- **Loop guards** — `doom_loop: deny` plus the loop-breaker plugin stop
  variation loops; `steps` is only a generous backstop (120 coder / 60 tester).
- **Session mode is configurable** — `--sessions persistent` (default) runs one
  resumable coder session per phase; `--sessions fresh` starts a new coder per
  task. Either way, PLAN.md, DECISIONS.md and INTEGRATION.md are the durable
  memory.
- **Wiring ledger** — INTEGRATION.md (module → exports → consumers) is updated
  every task and audited by the reviewer, so features can't land as dead code.
- **One task per model** — the serialize-task plugin reserves the provider and
  the agent type, so a single-model config degenerates to full serialization
  and the same repo runs on one box or many.
- **Hard permission graph** — the orchestrator can only read `PLAN.md` /
  `AGENTS.md`; the coder may spawn only `tester`.
- **Anchor the target root** — OpenCode resolves the project at the nearest
  `.git`/`package.json` upward. A new, empty target has no anchor, so the parent
  workspace becomes the project root and `**` globs reach every sibling. Start
  new projects with `scripts/new-project.sh <dir>` (mkdir + `git init`, then
  OpenCode); briefs are scoped to it and never send a subagent outside.
- **Rule order matters** — permission rules are last-match-wins, so
  `"*": "deny"` must come before specific `allow` entries.
- **AGENTS.md** — project conventions are auto-injected into every subagent.

## Caveats

- OpenCode Zen free-tier models don't work with custom agents or denied
  `read` / `shell` tools ([#51241](https://github.com/anomalyco/opencode/issues/51241),
  [#51315](https://github.com/anomalyco/opencode/issues/51315),
  [#50806](https://github.com/anomalyco/opencode/issues/50806)). Use regular
  providers.
- The orchestrator is intentionally blind: when it needs context, it delegates.

## Credits

- Based on [kexinjinnn/opencode-subagents](https://github.com/kexinjinnn/opencode-subagents).
- [OpenCode docs — Agents](https://opencode.ai/docs/agents/)
- [gotar/opencode-config](https://github.com/gotar/opencode-config)
- [marco-jardim/opencode-model-router](https://github.com/marco-jardim/opencode-model-router)
- [awesome-opencode-subagents](https://github.com/ankitmundada/awesome-opencode-subagents)
- [Anthropic — building a multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system)
- Design background and fact-checking: [docs/RESEARCH.md](docs/RESEARCH.md)

## License

MIT — see [LICENSE](LICENSE).
