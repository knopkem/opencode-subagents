# Installing

Two ways. The **adaptive install** is recommended because it fixes the one thing
that can't be hardcoded — the model IDs — and validates against *your* installed
OpenCode. The **manual install** is a plain copy if you'd rather not let an agent
touch your config.

---

## Adaptive install (recommended)

Clone the repo, open OpenCode **in the cloned directory**, and paste the prompt
below (or run `@INSTALL.md do the adaptive install`). It is deliberately scoped
to the four environment-specific steps and is told **not** to rewrite the parts
that are already correct.

> **Task: install this OpenCode subagent config, adapting only what's
> environment-specific. Do exactly these four steps and nothing more.**
>
> **1. Copy, don't clobber.**
> - Copy `agent/*.md`, `command/*.md`, and `opencode.json` into
>   `~/.config/opencode/` (global) — or `.opencode/` for project-only.
> - If a file already exists, do **not** overwrite it. For `opencode.json`
>   specifically: *merge* — add the `small_model` key and the five entries under
>   `agent` into the existing file, leaving all other keys untouched. Show me the
>   merged result before writing.
>
> **2. Fix the model IDs (the only values you may change).**
> - The config ships placeholder IDs: `anthropic/claude-opus-4-8` (premium),
>   `anthropic/claude-sonnet-4-6` (mid), `anthropic/claude-haiku-4-5` (cheap).
> - Determine which models are actually available in this OpenCode install (check
>   the configured providers / model picker — do **not** guess IDs).
> - Replace the placeholders preserving the **tiering intent**: `orchestrator`
>   gets the most capable model; `coder` and `reviewer` a mid model; `explorer`,
>   `tester`, and `small_model` a fast/cheap model. If you're unsure of an exact
>   ID, ask me rather than inventing one.
>
> **3. Validate.**
> - Confirm OpenCode loads the config with no schema errors and that all five
>   agents are recognized.
> - Sanity-check that `explorer` and `reviewer` are read-only (they should carry
>   `permission: { edit: deny }` and refuse to edit files).
> - Report anything that didn't validate. Do not "fix" it by changing the agent
>   prompts or permissions — surface it to me.
>
> **4. (Optional) Generate AGENTS.md.**
> - If this is a real project and there's no `AGENTS.md`, draft one from the
>   actual codebase (conventions, test command, structure) using the template in
>   this repo's `AGENTS.md` as the shape. Show it to me before writing.
>
> **Hard guardrails — do NOT:**
> - change any agent's **system prompt / body text**,
> - change the **`permission` graphs**, `mode`, `temperature`, or command logic,
> - add, remove, or rename any field (e.g. don't reintroduce `task_budget` — it
>   isn't a real OpenCode field),
> - touch any of my unrelated existing config.
> You are adapting model IDs and placing files — not redesigning anything.

---

## Manual install

```bash
# global (all projects)
cp -r agent command opencode.json ~/.config/opencode/

# OR project-only
mkdir -p .opencode && cp -r agent command opencode.json .opencode/

# project rules: AGENTS.md goes in your PROJECT root
cp AGENTS.md /path/to/your/project/AGENTS.md
```

Then hand-edit the `model:` fields in `opencode.json` and `agent/*.md` to models
you actually have access to (placeholders are `…opus-4-8` / `…sonnet-4-6` /
`…haiku-4-5`), and fill in `AGENTS.md` with your project's real conventions.

> Why the adaptive path exists: model IDs date fast and differ per account, so
> they're the one thing a static repo can't get right for you. Everything else —
> the agent prompts, the permission graph, the command sequencing — is static and
> reviewed, which is exactly why the adaptive prompt is forbidden from touching it.
