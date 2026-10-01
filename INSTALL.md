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

1. lists your available models (`opencode models`) and lets you pick a
   **planner** (strong; drives `orchestrator`, `reviewer`, `planner`) and a
   **builder** (fast; drives `coder`, `explorer`, `tester`);
2. saves your selection to gitignored `models.local.json`;
3. renders the `agent/*.md` placeholders into gitignored `agent.local/`;
4. symlinks `~/.config/opencode/agent` to `agent.local/`.

Then expose the commands:

```bash
ln -s "$PWD/command" ~/.config/opencode/command
```

Useful flags: `--list` (print numbered models), `PLANNER BUILDER` (non-interactive),
`--render` (re-render from the saved selection), `--think` / `--no-think`
(builder reasoning on/off; off by default), `--no-link` (don't touch the config
symlink).

## Manual install

If you'd rather not run the script: copy `agent/*.md`, replace
`__PLANNER_MODEL__`, `__BUILDER_MODEL__`, and `# __BUILDER_OPTIONS__` by hand,
and place the result in `~/.config/opencode/agent/` (and `command/*.md` in
`~/.config/opencode/command/`).

## Per project

Run `/init-agents` once inside a project: an explorer maps the codebase and the
planner writes a short, tailored `AGENTS.md` (never overwriting an existing
one). OpenCode injects it into every subagent, so fresh contexts stop
reinventing your conventions.

## Why

Model IDs date fast and differ per machine, so they're the one thing a static
repo can't get right for you — everything else (agent prompts, permission graph,
command sequencing) is static and reviewed. The script and placeholders keep
that separation: repo = behavior, `models.local.json` = environment.
