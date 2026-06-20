# Research notes

This setup is grounded in a multi-source deep-research pass that **adversarially
verified** each claim (3 independent skeptics per claim; a claim needed 2 of 3
to refute it to be dropped). What follows is what survived, what didn't, and
what's still open — so you can trust the config and ignore the hype.

## Verified findings (high confidence)

1. **Context isolation is the reason for delegation.** A subagent runs in its own
   context window and returns a condensed summary, keeping the main thread lean.
2. **The default subagent is a read-only search agent on a small model.** Claude
   Code's `Explore` runs on Haiku with write/edit denied — search is the safe,
   high-value delegation case.
3. **Orchestrator-worker setups win on breadth-first research, not coding.**
   Anthropic reported +90.2% over single-agent on an *internal research* eval —
   a result that does not automatically generalize to tightly-coupled coding.
4. **Multi-agent costs more.** Roughly ~4× the tokens of a single agent and
   ~15× a plain chat, with high variance. Reserve it for high-value work.
5. **OpenCode supports per-agent model routing** via the `agent` config; the
   default agent must be a primary.
6. **`small_model`** routes cheaper internal tasks to a faster model.
7. **Claude Code** does the same via `model` frontmatter and the
   `CLAUDE_CODE_SUBAGENT_MODEL` env var.
8. **`description` is the delegation lever** — "use proactively" style phrasing
   makes the tool delegate more often.
9. **`task` permission (glob) + `task_budget`** gate and bound subagent-to-
   subagent spawning, preventing infinite loops.
10. **gotar/opencode-config** demonstrates an orchestrator plus
    coder/builder/reviewer/tester/analyst specialists, with documented
    delegate-vs-inline heuristics and a `/swarm` parallel dispatch capped at 3.

## Refuted or flagged (do NOT take these at face value)

- ❌ **Specific cost-savings percentages** for model-routing setups (e.g. the
  "~70% reduction" and router "83–92% / 36%" figures seen in some guides) are
  **self-reported simulations, not independent benchmarks.**
- ❌ Some role-mechanics attributed to specific repos were refuted on
  inspection (e.g. a "worker invokes the reviewer" wiring, and a
  "coordinator never edits / 70%" claim) — the repos don't actually work that
  way.
- ⚠️ **The "pantheon" model is uncorroborated** — it appears in one guide and
  could not be independently verified. Treat it as one author's framing, not an
  established pattern.
- ⚠️ **Don't cross-paste Claude Code and OpenCode config** — the formats and
  field names differ.
- ⚠️ **Model IDs date fast.** Any model name in this repo is illustrative.

## What's new here, beyond the orchestration guides

The widely-shared OpenCode agent-orchestration write-up is a good intro, but the
deep research adds / corrects:

- Its headline **~70% cost-reduction** and **"pantheon"** claims are
  **uncorroborated/self-reported** — kept out of this repo's promises.
- The **+90.2%** orchestrator-worker number is a *research* eval and **does not
  transfer to coding** — so SDD's value for coding rests on
  decomposition/review discipline, not on that benchmark.
- Concrete, verifiable mechanics to rely on instead: `description`-driven
  delegation, per-agent `model` + `small_model` routing, and
  `task` permission + `task_budget` guards.

## Open questions

1. Is the OpenCode model-override-for-subagents bug (#22130) still open, and is
   the mode-as-subagent approach the current workaround?
2. Are there any *independent* (non-self-reported) cost benchmarks for OpenCode
   model routing?
3. What exactly is the "pantheon" model, if anything?
4. Does the orchestrator-worker advantage transfer to coding/SDD at all?

## Sources

- https://opencode.ai/docs/agents/
- https://code.claude.com/docs/en/sub-agents
- https://www.anthropic.com/engineering/built-multi-agent-research-system
- https://github.com/gotar/opencode-config
- https://github.com/marco-jardim/opencode-model-router
- https://github.com/ankitmundada/awesome-opencode-subagents

> Method note: findings were merged for semantic duplication and ranked by
> confidence. The synthesis step itself hit a harness serialization bug, so this
> file is hand-assembled from the verified-claim set rather than auto-generated.
