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
5. **Review** — after gates are green, `reviewer` starts from the coder's
   handoff packet and checks spec-compliance, reachability (no dead code), then
   quality; tests get a presence check only (quality is `tester`'s job). One
   resumable reviewer session per phase; fixes go back to the coder session,
   queued behind any in-flight task.
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
| `orchestrator` | primary | own role (default: planner) | Decompose, delegate, integrate. No app code, no shell; may read only the project docs (`PLAN.md`, `AGENTS.md`, `INTEGRATION.md`, `DECISIONS.md`, `COMPLETION.md`) and `.orchestration/` state. |
| `planner` | subagent | own role | Write `PLAN.md` and `AGENTS.md`. Docs only. |
| `explorer` | subagent | own role (default: builder) | Read-only codebase mapping. |
| `coder` | subagent | own role | Implement bounded tasks within one phase's session; may call `tester`. |
| `reviewer` | subagent | own role (default: planner) | Read-only two-stage review; packet-first, tests presence-checked only. |
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
- `plugins/process-gate.js` — turns the review/coverage rules into checks: it
  validates coder briefs against PLAN.md work items (and flags a PLAN.md that
  declares no work items at all, which would otherwise make every check
  vacuous), allows at most one completed coder task per phase without a review,
  records reviewer verdicts, and blocks phase exits / `COMPLETION.md` until
  every work item is covered, reviewed, and the project's VERIFY artifact is
  green at HEAD. A brief rejected three times escalates to an explicit
  stop-and-report error — a rejected call never reaches the loop-breaker's hooks,
  so the gate owns that case. Modes:
  `PROCESS_GATE=warn|enforce|off` (env) or `.orchestration/config.json`
  `{"mode": "warn"}`; default `enforce`. Warn mode logs every violation to
  `.orchestration/violations.log` and proceeds — use it for a first rollout.
  It is stack-blind: it never runs project code itself.

## Gates and evidence

The pipeline keeps its own audit trail in the target project's git root:

- **Work items** — PLAN.md carries `- [ ] P<phase>.<n> …` lines; every coder
  brief and review cites them. `.orchestration/coverage.md` maps item → task →
  commit → verdict. IDs are frozen at the first coder dispatch: a plan that
  renumbers or drops one afterwards is reported (diagnostic — the affected brief
  is rejected anyway, this just names the cause). A PLAN.md that exists but
  declares **no** work items is a gate violation, not a skip: without items every
  coverage check is vacuous and `COMPLETION.md` would pass on an empty plan (an
  absent PLAN.md is still legal — that is greenfield, before planning).
- **VERIFY contract** — AGENTS.md declares `VERIFY: <command>` in the project's
  own toolchain (no language or tool is mandated). That command runs the
  end-to-end check and writes `.orchestration/verify.json`
  (`{"schema":1,"ok":true,"commit":"<revision>","checks":[…],"runner":"…"}`);
  the harness only reads `ok` and `commit`.
- **Reviews** — the reviewer appends one JSON line per review to
  `.orchestration/reviews/log.jsonl`; `rework` blocks the phase.
- **Commits** — the coder commits once per completed task (message
  `P<phase>.<n>: <summary>`), so reviewers diff a fixed revision and any task
  can be rolled back.
- **Ledger** — `.orchestration/run.json` records tasks, commits, reviews and
  testers. Violations land in `.orchestration/violations.log`.

Harness checks are intentionally model-independent: a strong orchestrator runs
faster, a weak one gets caught instead of shipping.

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
  variation loops; `steps` is only a generous backstop (120 coder / 80 reviewer
  / 60 tester).
- **Terse voice** — every agent prompt ends with the same compact voice
  contract (answer-first, 20-word sentences, verbatim paths/errors, no
  tool-call narration) so all models spend fewer output tokens; safety
  warnings and blocked work still get full sentences.
- **Session mode is configurable** — `--sessions persistent` (default) runs one
  resumable coder session per phase; `--sessions fresh` starts a new coder per
  task. Either way, PLAN.md, DECISIONS.md and INTEGRATION.md are the durable
  memory.
- **Wiring ledger** — INTEGRATION.md (module → exports → consumers) is updated
  every task and audited by the reviewer, so features can't land as dead code.
- **One task per model** — the serialize-task plugin reserves the provider and
  the agent type, so a single-model config degenerates to full serialization
  and the same repo runs on one box or many.
- **Gates over goodwill** — the process gate enforces coverage, review pairing,
  phase exits and the VERIFY artifact; RUN the orchestrator on a thinking model
  for real work. A 9B no-think orchestrator can still drive coders, but it will
  pick the wrong trade-offs long before the gate notices.
- **Hard permission graph** — the orchestrator can only read the project docs
  (`PLAN.md`, `AGENTS.md`, `INTEGRATION.md`, `DECISIONS.md`, `COMPLETION.md`) and
  the gate's own state under `.orchestration/` (it must be able to read the
  status it is told to check — `coverage.md`, `run.json`,
  `reviews/log.jsonl`, `verify.json`); the coder may spawn only `tester`.
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
