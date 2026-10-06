# Installing

The repo never stores model IDs — the agent files contain placeholders that are
resolved from a gitignored local file, so your environment (and model churn)
never leaks into git history.

## Scripted install (recommended)

```bash
git clone <your-fork> opencode-subagents
cd opencode-subagents
./scripts/set-models.py
```

The script:

1. lists your available models (`opencode models`) and lets you pick a model
   per role — `orchestrator`, `planner`, `reviewer`, `tester`, `builder`,
   `explorer`. Unset roles fall back to the planner model (orchestrator,
   reviewer, tester) or the builder model (explorer), so any subset can share a
   model;
2. saves your selection to gitignored `models.local.json`;
3. renders the `agent/*.md` placeholders into gitignored `agent.local/`;
4. symlinks `~/.config/opencode/agent` to `agent.local/`.

Then expose the commands and plugins:

```bash
ln -s "$PWD/command" ~/.config/opencode/command
mkdir -p ~/.config/opencode/plugins
ln -sf "$PWD/plugins/"*.js ~/.config/opencode/plugins/
```

`plugins/loop-breaker.js` aborts near-duplicate tool calls (normalized
repeats, identical output 3× even when interleaved, 5 consecutive edits to one
file) so weak builder models cannot loop indefinitely; thresholds are constants
at the top of the file. `plugins/compaction-ledger.js` keeps PLAN.md, AGENTS.md,
DECISIONS.md and INTEGRATION.md in compaction summaries so a resumed coder
session re-reads its durable memory instead of trusting a lossy summary.
`plugins/process-gate.js` enforces the pipeline's review/coverage rules; run the
first real project with `PROCESS_GATE=warn` (or
`.orchestration/config.json` `{"mode":"warn"}`) and inspect
`.orchestration/violations.log` before switching to the default `enforce`.
Regression fixtures live in `plugins/tests/` and run with `npm test` (host Node
only; targets stay stack-free).

Useful flags: `--list` (print numbered models), `--render` (re-render from the
saved selection), role flags `--orchestrator M --planner M --reviewer M
--tester M --builder M --explorer M` (any subset; unset roles keep their saved
value or fall back to planner/builder), `PLANNER BUILDER [TESTER]` (legacy
shorthand), `--think` / `--no-think` (builder reasoning on/off; off by
default), `--sessions persistent|fresh` (one resumable coder session per phase
— the default — or a fresh coder per task), `--no-link` (don't touch the config
symlink).

## Manual install

If you'd rather not run the script: copy `agent/*.md`, replace
`__ORCHESTRATOR_MODEL__`, `__PLANNER_MODEL__`, `__REVIEWER_MODEL__`,
`__TESTER_MODEL__`, `__BUILDER_MODEL__`, `__EXPLORER_MODEL__`, and
`# __BUILDER_OPTIONS__` by hand, and place the result in
`~/.config/opencode/agent/` (and `command/*.md` in
`~/.config/opencode/command/`, `plugins/*.js` in
`~/.config/opencode/plugins/`).

## Per project

Start a brand-new project with `scripts/new-project.sh <dir>`: it creates the
directory, runs `git init`, and starts OpenCode there. That anchor matters — OpenCode resolves the project at the nearest
`.git`/`package.json` upward, and an empty directory has none, so the parent
workspace (and every sibling project) becomes the project root and `**` globs
escape the target. For an existing project, make sure its own root is the
nearest anchor (e.g. `git init` if it has none) before starting.

Then run `/init-agents` once inside a project: an explorer maps the codebase and
the planner writes a short, tailored `AGENTS.md` (never overwriting an existing
one). OpenCode injects it into every subagent, so fresh contexts stop
reinventing your conventions.

## Why

Model IDs date fast and differ per machine, so they're the one thing a static
repo can't get right for you — everything else (agent prompts, permission graph,
command sequencing) is static and reviewed. The script and placeholders keep
that separation: repo = behavior, `models.local.json` = environment.
