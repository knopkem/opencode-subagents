# opencode-subagents

A spec-driven subagent pipeline for [OpenCode](https://opencode.ai): one strong
planner model designs, one fast builder model implements, a separate reviewer
verifies. The repo ships prompts and permission graphs only — model IDs stay on
your machine.

## Workflow

```
Explore → Plan → Decompose → Dispatch → Review → Integrate
```

1. **Explore** — `explorer` maps the code and returns a short summary.
2. **Plan** — `planner` writes `PLAN.md` (file map, interfaces, ordered steps,
   acceptance criteria) and, if missing, a tailored `AGENTS.md`.
3. **Decompose** — the orchestrator splits the plan into independent tasks.
4. **Dispatch** — each task goes to a fresh `coder`; the brief is
   self-contained and points at `PLAN.md` / `AGENTS.md`.
5. **Review** — `reviewer` checks spec-compliance against the plan, then
   quality; fixes go back to the same coder.
6. **Integrate** — `tester` runs the suite and reports raw results.

Delegation is serialized on purpose: one subagent at a time.

## Agents

| Agent | Mode | Model | Role |
|---|---|---|---|
| `orchestrator` | primary | planner | Decompose, delegate, integrate. No app code, no shell; may only read `PLAN.md` / `AGENTS.md`. |
| `planner` | subagent | planner | Write `PLAN.md` and `AGENTS.md`. Docs only. |
| `explorer` | subagent | builder | Read-only codebase mapping. |
| `coder` | subagent | builder | Implement one bounded task; may call `tester`. |
| `reviewer` | subagent | planner | Read-only two-stage review. |
| `tester` | subagent | builder | Write/run tests, report results verbatim. |

## Commands

| Command | Does |
|---|---|
| `/coding-pipeline <task>` | One task: plan → coder → reviewer → tester. |
| `/init-agents` | Explore the repo and generate a tailored `AGENTS.md`. |
| `/sdd-init <feature>` | Explore + write `PLAN.md`, then stop for approval. |
| `/sdd-apply` | Implement `PLAN.md` task by task, reviewing each. |
| `/sdd-verify` | Full suite + end-to-end check against the plan. |
| `/swarm <work>` | Parallel coders (cap 3) — for machines that can run them. |

## Install

```bash
git clone https://github.com/knopkem/opencode-subagents
cd opencode-subagents
./scripts/set-models.py                 # pick planner + builder models
ln -s "$PWD/command" ~/.config/opencode/command
```

`set-models.py` lists `opencode models`, saves the choice to gitignored
`models.local.json`, renders `agent.local/`, and links it into
`~/.config/opencode/agent`. Flags: `--list`, `--render`, `--think` /
`--no-think`, `--no-link`, `--force`. See [INSTALL.md](INSTALL.md) for the
manual path.

`bench-models.py` benchmarks prefill and decode speed of a shortlist of
models (interactive multi-select, `-n` runs, `-j` parallel jobs, `--json`
output) so you can pick a fast builder before running `set-models.py`.

In each project, run `/init-agents` once.

## Design notes

- **Placeholders only in git** — agent files carry `__PLANNER_MODEL__` /
  `__BUILDER_MODEL__`; rendering happens locally into `agent.local/`.
- **Fresh context** — every subagent starts blank; `PLAN.md` is the shared spec
  and every brief repeats the paths it needs.
- **Hard permission graph** — the orchestrator can only read `PLAN.md` /
  `AGENTS.md`; the coder may spawn only `tester`.
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
