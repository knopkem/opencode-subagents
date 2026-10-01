#!/usr/bin/env python3
"""Point the agent definitions at a planner and a builder model.

Planner  -> orchestrator.md + reviewer.md + planner.md (thinking, checking roles)
Builder  -> coder.md + explorer.md + tester.md (the fast, no-thinking roles)

Usage:
    scripts/set-models.py                     interactive picker
    scripts/set-models.py --list              print numbered model list
    scripts/set-models.py PLANNER BUILDER     non-interactive
    scripts/set-models.py --think ...         builder keeps its reasoning
    scripts/set-models.py --force ...         allow ids not in `opencode models`

Builder files default to thinking disabled (reasoningEffort: low,
chat_template_kwargs.enable_thinking: false) since the builder is the fast,
no-reasoning worker; pass --think to drop those options.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AGENT_DIR = ROOT / "agent"
PLANNER_FILES = ["orchestrator.md", "reviewer.md", "planner.md"]
BUILDER_FILES = ["coder.md", "explorer.md", "tester.md"]

ANSI = re.compile(r"\x1b\[[0-9;]*m")
MODEL_LINE = re.compile(r"^model:\s*.+$", re.M)
MODEL_ID = re.compile(r"[A-Za-z0-9_.@-]+/[^\s/]+(?:/[^\s/]+)*")
NO_THINK_LINES = re.compile(r"^(?:reasoningEffort:.*\n|chat_template_kwargs:\n(?:[ \t]+.*\n)*)", re.M)
NO_THINK_BLOCK = "reasoningEffort: low\nchat_template_kwargs:\n  enable_thinking: false"


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


def set_model(path, model, no_think=False):
    text = path.read_text()
    parts = text.split("---", 2)
    if len(parts) < 3 or not MODEL_LINE.search(parts[1]):
        sys.exit(f"error: {path}: no model: line in frontmatter")
    fm = NO_THINK_LINES.sub("", parts[1])
    fm = MODEL_LINE.sub(f"model: {model}", fm, count=1)
    if no_think:
        fm = fm.replace(f"model: {model}", f"model: {model}\n{NO_THINK_BLOCK}", 1)
    fm = re.sub(r"\n{2,}", "\n", fm)
    parts[1] = fm
    path.write_text("---".join(parts))
    print(f"  {path.relative_to(ROOT)} -> {model}{' (no thinking)' if no_think else ''}")


def main():
    args = sys.argv[1:]
    models = list_models()

    if "--list" in args:
        for i, m in enumerate(models, 1):
            print(f"{i:>3}) {m}")
        return

    force = "--force" in args
    think = "--think" in args
    args = [a for a in args if not a.startswith("--")]

    if len(args) == 2:
        planner, builder = args
        for role, model in (("planner", planner), ("builder", builder)):
            if models and model not in models and not force:
                sys.exit(f"error: {role} model '{model}' not in `opencode models` (use --force)")
    elif not args:
        planner = prompt_choice("planner", models)
        builder = prompt_choice("builder", models)
    else:
        sys.exit(__doc__)

    print(f"\nplanner: {planner}\nbuilder: {builder}\n")
    for name in PLANNER_FILES:
        set_model(AGENT_DIR / name, planner)
    for name in BUILDER_FILES:
        set_model(AGENT_DIR / name, builder, no_think=not think)


if __name__ == "__main__":
    main()
