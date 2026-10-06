#!/usr/bin/env python3
"""Assign a model per role, render the agents, and link them.

The repository only ever contains placeholders (`__ORCHESTRATOR_MODEL__`,
`__PLANNER_MODEL__`, `__REVIEWER_MODEL__`, `__TESTER_MODEL__`,
`__BUILDER_MODEL__`, `__EXPLORER_MODEL__`, `# __BUILDER_OPTIONS__`) and choice
blocks (`# __IF sessions|review|test ...__`). Your selection is saved to
gitignored `models.local.json` and rendered into gitignored `agent.local/`,
which is symlinked into `~/.config/opencode/agent`. The `review`, `test` and
`sessions` blocks all resolve from the provider split: `review`/`test` state
which overlaps the current split permits, and the coder session mode is
`persistent` (one resumable coder session per phase) only when the builder does
not share the orchestrator's provider — otherwise `fresh`, one session per task.

Every role is chosen independently, so you can give several roles (or all) the
same model to collapse them. Defaults for unspecified roles:
orchestrator/reviewer/tester -> planner, explorer -> builder.

Roles:
    orchestrator -> orchestrator.md
    planner      -> planner.md
    reviewer     -> reviewer.md
    tester       -> tester.md
    builder      -> coder.md
    explorer     -> explorer.md

Usage:
    scripts/set-models.py                          interactive picker (all roles)
    scripts/set-models.py --list                   print numbered model list
    scripts/set-models.py PLANNER BUILDER [TESTER] legacy shorthand
    scripts/set-models.py --orchestrator M --reviewer M ...
                                                   any subset of role flags
                                                   (--planner M --builder M ...)
    scripts/set-models.py --render                 re-render from models.local.json
    scripts/set-models.py --think ...              builder keeps its reasoning
    scripts/set-models.py --no-think ...           builder reasoning off (default)
    scripts/set-models.py --force ...              allow ids not in `opencode models`
    scripts/set-models.py --no-link ...            don't touch ~/.config/opencode/agent
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

ROLES = ["orchestrator", "planner", "reviewer", "tester", "builder", "explorer"]
ROLE_FILES = {
    "orchestrator": "orchestrator.md",
    "planner": "planner.md",
    "reviewer": "reviewer.md",
    "tester": "tester.md",
    "builder": "coder.md",
    "explorer": "explorer.md",
}
ROLE_TOKENS = {role: f"__{role.upper()}_MODEL__" for role in ROLES}
ROLE_FLAGS = {f"--{role}": role for role in ROLES}
ROLE_DEFAULTS = {
    "orchestrator": "planner",
    "reviewer": "planner",
    "tester": "planner",
    "explorer": "builder",
}
MODEL_TOKEN = re.compile(r"__[A-Z]+_MODEL__")
OPTIONS_MARKER = "# __BUILDER_OPTIONS__"
BUILDER_OPTIONS = "reasoningEffort: low\nchat_template_kwargs:\n  enable_thinking: false"
CHOICE_BLOCK = re.compile(
    r"^# __IF (\w+) (\w+)__\n(.*?)^# __ENDIF__\n",
    re.DOTALL | re.MULTILINE,
)

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


def print_models(models):
    print("\nAvailable models:\n")
    for i, m in enumerate(models, 1):
        print(f"  {i:>3}) {m}")


def prompt_choice(role, models, default=None):
    hint = f", Enter = {default}" if default else ""
    while True:
        ans = input(
            f"\n{role} model (number, substring, or q to quit{hint}): "
        ).strip()
        if not ans and default:
            return default
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


def provider_of(model):
    return model.split("/", 1)[0]


def apply_choices(text, choices):
    def replace(match):
        key, value, body = match.group(1), match.group(2), match.group(3)
        if key not in choices:
            return match.group(0)
        return body if value == choices[key] else ""

    return CHOICE_BLOCK.sub(replace, text)


def session_mode(selection):
    # A resumed coder session competes with the orchestrator's long-running
    # session on the same provider, so it is only safe when the builder runs
    # on a different provider. Collapsed setups get a fresh coder per task.
    roles = resolve_roles(selection)
    if provider_of(roles["builder"]) == provider_of(roles["orchestrator"]):
        return "fresh"
    return "persistent"


def resolve_roles(selection):
    roles = {role: selection.get(role) for role in ROLES}
    for role, source in ROLE_DEFAULTS.items():
        if not roles.get(role):
            roles[role] = roles.get(source)
    return roles


def render_choices(selection):
    roles = resolve_roles(selection)
    builder = roles["builder"]
    return {
        "sessions": session_mode(selection),
        "review": "parallel" if provider_of(roles["reviewer"]) != provider_of(builder) else "serial",
        "test": "parallel" if provider_of(roles["tester"]) != provider_of(builder) else "serial",
    }


def load_selection():
    if not SELECTION.exists():
        return None
    try:
        return json.loads(SELECTION.read_text())
    except json.JSONDecodeError as e:
        sys.exit(f"error: {SELECTION} is not valid JSON: {e}")


def save_selection(selection):
    selection.pop("sessions", None)  # legacy key; session mode is derived
    SELECTION.write_text(json.dumps(selection, indent=2) + "\n")


def render_plan(selection):
    roles = resolve_roles(selection)
    plan = []
    for role in ROLES:
        builder_options = role == "builder" or (role == "explorer" and roles[role] == roles["builder"])
        plan.append((ROLE_FILES[role], roles[role], ROLE_TOKENS[role], builder_options))
    return plan


def render(selection, link=True):
    OUT_DIR.mkdir(exist_ok=True)
    written = []
    choices = render_choices(selection)

    def materialize(name, model, token, builder_options):
        text = (TEMPLATE_DIR / name).read_text()
        if not MODEL_TOKEN.search(text):
            sys.exit(f"error: {TEMPLATE_DIR / name}: no model placeholder")
        text = apply_choices(text, choices)
        if "__IF " in text or "__ENDIF__" in text:
            sys.exit(f"error: {TEMPLATE_DIR / name}: unresolved choice marker")
        text = text.replace(token, model)
        if MODEL_TOKEN.search(text):
            sys.exit(f"error: {TEMPLATE_DIR / name}: unresolved model placeholder")
        if OPTIONS_MARKER in text:
            if builder_options and not selection.get("builder_think"):
                text = text.replace(OPTIONS_MARKER, BUILDER_OPTIONS)
            else:
                text = text.replace(OPTIONS_MARKER + "\n", "")
        elif builder_options:
            sys.exit(f"error: {TEMPLATE_DIR / name}: no {OPTIONS_MARKER}")
        (OUT_DIR / name).write_text(text)
        written.append((name, model))

    for name, model, token, builder_options in render_plan(selection):
        materialize(name, model, token, builder_options)

    print(f"rendered {len(written)} agents -> {OUT_DIR}")
    print(f"coder sessions: {session_mode(selection)} (derived from the provider split)")
    for name, model in written:
        print(f"  {name} -> {model}")

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


def parse_args(argv):
    role_flags = {}
    positional = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ROLE_FLAGS:
            if i + 1 >= len(argv):
                sys.exit(f"error: {arg} needs a model value")
            role_flags[ROLE_FLAGS[arg]] = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--"):
            i += 1
            continue
        positional.append(arg)
        i += 1
    return role_flags, positional


def validate(selection, models, force):
    if not models or force:
        return
    for role in ROLES:
        model = selection.get(role)
        if model and model not in models:
            sys.exit(f"error: {role} model '{model}' not in `opencode models` (use --force)")


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
    role_flags, positional = parse_args(args)

    if render_only:
        selection = load_selection()
        if not selection:
            sys.exit(f"error: {SELECTION} not found; run set-models.py first")
        if think or no_think:
            selection["builder_think"] = bool(think and not no_think)
            save_selection(selection)
        render(selection, link=link)
        return

    selection = load_selection() or {}

    if positional:
        if len(positional) not in (2, 3):
            sys.exit(__doc__)
        selection["planner"] = positional[0]
        selection["builder"] = positional[1]
        if len(positional) == 3:
            selection["tester"] = positional[2]
    selection.update(role_flags)

    if not args:
        print_models(models)
        planner = prompt_choice("planner", models)
        builder = prompt_choice("builder", models)
        selection.update(
            {
                "planner": planner,
                "builder": builder,
                "orchestrator": prompt_choice("orchestrator", models, default=planner),
                "reviewer": prompt_choice("reviewer", models, default=planner),
                "tester": prompt_choice("tester", models, default=planner),
                "explorer": prompt_choice("explorer", models, default=builder),
            }
        )
    else:
        if not selection.get("planner"):
            print_models(models)
            selection["planner"] = prompt_choice("planner", models)
        if not selection.get("builder"):
            selection["builder"] = prompt_choice("builder", models)

    roles = resolve_roles(selection)
    for role in ("planner", "builder"):
        if not roles[role]:
            sys.exit(f"error: {role} model is required")
    selection.update({role: roles[role] for role in ROLES})

    if think or no_think:
        selection["builder_think"] = bool(think and not no_think)
    else:
        selection.setdefault("builder_think", False)

    validate(selection, models, force)

    save_selection(selection)
    print(f"saved {SELECTION}")
    render(selection, link=link)


if __name__ == "__main__":
    main()
