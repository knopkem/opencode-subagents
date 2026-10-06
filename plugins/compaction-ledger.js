// Keeps a long-running coder session honest across compaction.
//
// A coder session that spans a whole task (or phase, when the builder runs on
// a separate provider) eventually exceeds the context window and gets
// compacted. The summary is lossy, so this plugin injects the project's
// durable memory files into the compaction prompt: the session then re-reads
// them instead of trusting a degraded summary. Files are only listed when they
// actually exist in the project directory.

import fs from "node:fs"
import path from "node:path"

const LEDGER_FILES = ["PLAN.md", "AGENTS.md", "DECISIONS.md", "INTEGRATION.md"]

export const CompactionLedger = async ({ directory }) => ({
  "experimental.session.compacting": async (input, output) => {
    const present = LEDGER_FILES.filter((name) =>
      fs.existsSync(path.join(directory, name)),
    )
    if (!present.length) return
    output.context.push(
      [
        "## Project memory survives in files",
        "Treat these files as the source of truth over this summary; re-read them before continuing:",
        ...present.map((name) => `- ${name}`),
        "",
        "Preserve in the summary: the current plan task/phase, the coder session's",
        "continuity, every file created or modified, exact exported symbol names and",
        "who imports or mounts them, what is built but not yet wired into the app,",
        "and any verification command still failing.",
      ].join("\n"),
    )
  },
})
