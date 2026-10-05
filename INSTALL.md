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
   **planner** (strong; drives `orchestrator`, `reviewer`, `planner`), a
   **builder** (fast; drives `coder`, `explorer`), and a **tester**
   (defaults to the planner model — keep verification on the stronger model);
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
at the top of the file.

Useful flags: `--list` (print numbered models), `PLANNER BUILDER [TESTER]`
(non-interactive; tester defaults to planner), `--render` (re-render from the
saved selection), `--think` / `--no-think` (builder reasoning on/off; off by
default), `--no-link` (don't touch the config symlink).

## Manual install

If you'd rather not run the script: copy `agent/*.md`, replace
`__PLANNER_MODEL__`, `__BUILDER_MODEL__`, `__TESTER_MODEL__`, and
`# __BUILDER_OPTIONS__` by hand, and place the result in
`~/.config/opencode/agent/` (and `command/*.md` in
`~/.config/opencode/command/`, `plugins/*.js` in
`~/.config/opencode/plugins/`).

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
