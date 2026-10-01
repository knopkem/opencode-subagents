#!/usr/bin/env python3
"""Assign a planner and a builder model, render the agents, and link them.

The repository only ever contains placeholders (`__PLANNER_MODEL__`,
`__BUILDER_MODEL__`, `# __BUILDER_OPTIONS__`). Your selection is saved to
gitignored `models.local.json` and rendered into gitignored `agent.local/`,
which is symlinked into `~/.config/opencode/agent`.

Planner  -> orchestrator.md + reviewer.md + planner.md (thinking, checking roles)
Builder  -> coder.md + explorer.md + tester.md (fast, no-thinking by default)

Usage:
    scripts/set-models.py                     interactive picker
    scripts/set-models.py --list              print numbered model list
    scripts/set-models.py PLANNER BUILDER     non-interactive
    scripts/set-models.py --render            re-render from models.local.json
    scripts/set-models.py --think ...         builder keeps its reasoning
    scripts/set-models.py --no-think ...      builder reasoning off (default)
    scripts/set-models.py --force ...         allow ids not in `opencode models`
    scripts/set-models.py --no-link ...       don't touch ~/.config/opencode/agent
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = ROOT / "agent"
OUT_DIR = ROOT / "agent.local"
SELECTION = ROOT / "models.local.json"
CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "opencode"
LINK = CONFIG_DIR / "agent"

PLANNER_FILES = ["orchestrator.md", "reviewer.md", "planner.md"]
BUILDER_FILES = ["coder.md", "explorer.md", "tester.md"]
PLANNER_TOKEN = "__PLANNER_MODEL__"
BUILDER_TOKEN = "__BUILDER_MODEL__"
OPTIONS_MARKER = "# __BUILDER_OPTIONS__"
BUILDER_OPTIONS = "reasoningEffort: low\nchat_template_kwargs:\n  enable_thinking: false"

ANSI = re.compile(r"\x1b\[[0-9;]*m")
MODEL_ID = re.compile(r"[A-Za-z0-9_.@-]+/[^\s/]+(?:/[^\s/]+)*")


def list_models():
    try:
        out = subprocess.run(
            ["opencode", "models"], capture_output=True, text=True, check=True
        ).stdout
    except FileNotFoundError:
        sys.exit("error: 'opencode' not found on PATH")
    except subprocess.CalledProcessError as e:
        sys.exit(f"error: 'opencode models' failed: {e}")

    models, seen = [], set()
    for line in ANSI.sub("", out).splitlines():
        line = line.strip()
        if MODEL_ID.fullmatch(line) and line not in seen:
            seen.add(line)
            models.append(line)
    return models


def prompt_choice(role, models):
    print("\nAvailable models:\n")
    for i, m in enumerate(models, 1):
        print(f"  {i:>3}) {m}")
    while True:
        ans = input(f"\n{role} model (number, substring, or q to quit): ").strip()
        if ans.lower() in ("q", "quit", "exit"):
            sys.exit("aborted")
        if ans.isdigit() and 1 <= int(ans) <= len(models):
            return models[int(ans) - 1]
        if ans in models:
            return ans
        matches = [m for m in models if ans.lower() in m.lower()]
        if len(matches) == 1:
            return matches[0]
        if matches:
            print("Multiple matches:")
            for m in matches[:10]:
                print(f"    {m}")
        else:
            print("No match, try again.")


def load_selection():
    if not SELECTION.exists():
        return None
    try:
        return json.loads(SELECTION.read_text())
    except json.JSONDecodeError as e:
        sys.exit(f"error: {SELECTION} is not valid JSON: {e}")


def save_selection(selection):
    SELECTION.write_text(json.dumps(selection, indent=2) + "\n")


def render(selection, link=True):
    OUT_DIR.mkdir(exist_ok=True)
    written = []

    def materialize(name, model):
        text = (TEMPLATE_DIR / name).read_text()
        if PLANNER_TOKEN not in text and BUILDER_TOKEN not in text:
            sys.exit(f"error: {TEMPLATE_DIR / name}: no model placeholder")
        text = text.replace(PLANNER_TOKEN, model).replace(BUILDER_TOKEN, model)
        if name in BUILDER_FILES:
            if OPTIONS_MARKER not in text:
                sys.exit(f"error: {TEMPLATE_DIR / name}: no {OPTIONS_MARKER}")
            if selection.get("builder_think"):
                text = text.replace(OPTIONS_MARKER + "\n", "")
            else:
                text = text.replace(OPTIONS_MARKER, BUILDER_OPTIONS)
        (OUT_DIR / name).write_text(text)
        written.append(name)

    for name in PLANNER_FILES:
        materialize(name, selection["planner"])
    for name in BUILDER_FILES:
        materialize(name, selection["builder"])

    print(f"rendered {len(written)} agents -> {OUT_DIR}")
    for name in written:
        role = selection["planner"] if name in PLANNER_FILES else selection["builder"]
        print(f"  {name} -> {role}")

    if link:
        link_config()


def link_config():
    if LINK.is_symlink():
        if LINK.resolve() == OUT_DIR.resolve():
            print(f"link ok: {LINK} -> {OUT_DIR}")
            return
        LINK.unlink()
    elif LINK.exists():
        sys.exit(
            f"error: {LINK} is a real directory, not a symlink; move it aside and re-run"
        )
    LINK.parent.mkdir(parents=True, exist_ok=True)
    LINK.symlink_to(OUT_DIR)
    print(f"linked {LINK} -> {OUT_DIR}")


def main():
    args = sys.argv[1:]
    models = list_models()

    if "--list" in args:
        for i, m in enumerate(models, 1):
            print(f"{i:>3}) {m}")
        return

    force = "--force" in args
    think = "--think" in args
    no_think = "--no-think" in args
    render_only = "--render" in args
    link = "--no-link" not in args
    args = [a for a in args if not a.startswith("--")]

    if render_only:
        selection = load_selection()
        if not selection:
            sys.exit(f"error: {SELECTION} not found; run set-models.py first")
        if think or no_think:
            selection["builder_think"] = bool(think and not no_think)
            save_selection(selection)
        render(selection, link=link)
        return

    if len(args) == 2:
        planner, builder = args
        for role, model in (("planner", planner), ("builder", builder)):
            if models and model not in models and not force:
                sys.exit(
                    f"error: {role} model '{model}' not in `opencode models` (use --force)"
                )
    elif not args:
        planner = prompt_choice("planner", models)
        builder = prompt_choice("builder", models)
    else:
        sys.exit(__doc__)

    selection = {
        "planner": planner,
        "builder": builder,
        "builder_think": think,
    }
    save_selection(selection)
    print(f"saved {SELECTION}")
    render(selection, link=link)


if __name__ == "__main__":
    main()
