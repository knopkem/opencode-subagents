// Process gate: turn the orchestrator's review/coverage rules into checks.
//
// The gate is stack-blind. It knows only:
//   - PLAN.md carries machine-readable work items (`- [ ] P<phase>.<n> …`);
//   - every coder brief cites those IDs in `## Plan coverage`, plus
//     `## Files`, `## Acceptance`, `## Gates`;
//   - every coder task commits and the reviewer brief carries
//     `review-of: <commit>`; the reviewer appends its verdict to
//     `.orchestration/reviews/log.jsonl`;
//   - a phase exits only after every item is implemented, reviewed and the
//     project's declared VERIFY command wrote a green
//     `.orchestration/verify.json` at HEAD;
//   - `COMPLETION.md` is written only after every phase passes.
//
// Nothing here names a language, package manager, or test tool: the VERIFY
// command and its checks are the project's own contract (see AGENTS.md).
//
// Modes, highest precedence first: env PROCESS_GATE, .orchestration/config.json
// `{"mode": "warn"|"enforce"|"off"}`, default "enforce". In warn mode every
// violation is appended to .orchestration/violations.log and the call proceeds;
// in enforce mode the call is rejected. Internal errors fail open with a logged
// violation so a gate bug can never brick a run.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const PLAN_ITEM = /^- \[[ x]\] (P\d+\.\d+)\b(.*)$/gm
const ID_ANYWHERE = /\bP\d+\.\d+\b/g
const REVIEW_OF = /review-of:\s*([0-9a-f]{7,40})/i
const PHASE_GATE = /GATE:\s*phase-(P\d+)-exit/
const REQUIRED_CODER_SECTIONS = ["## Plan coverage", "## Files", "## Acceptance", "## Gates"]

function orchestrationDir(directory) {
  return path.join(directory, ".orchestration")
}

function ledgerPath(directory) {
  return path.join(orchestrationDir(directory), "run.json")
}

function violationsPath(directory) {
  return path.join(orchestrationDir(directory), "violations.log")
}

function reviewsPath(directory) {
  return path.join(orchestrationDir(directory), "reviews", "log.jsonl")
}

function verifyPath(directory) {
  return path.join(orchestrationDir(directory), "verify.json")
}

function ensureDir(directory) {
  fs.mkdirSync(orchestrationDir(directory), { recursive: true })
}

function modeFor(directory) {
  const env = process.env.PROCESS_GATE
  if (env === "off" || env === "warn" || env === "enforce") return env
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(orchestrationDir(directory), "config.json"), "utf8"))
    if (raw && (raw.mode === "off" || raw.mode === "warn" || raw.mode === "enforce")) return raw.mode
  } catch {
    // no config file — fall through
  }
  return "enforce"
}

function report(directory, mode, message, options = {}) {
  const entry = { at: new Date().toISOString(), mode, message, ...options.data }
  try {
    ensureDir(directory)
    fs.appendFileSync(violationsPath(directory), JSON.stringify(entry) + "\n")
  } catch {
    // logging must never take the run down
  }
  if (mode === "enforce" && options.throwInEnforce !== false) {
    throw new Error(`Process gate: ${message}`)
  }
  if (mode !== "off" && options.throwInEnforce === false) {
    console.warn(`[process-gate] ${message}`)
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n")
}

function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function planSnapshot(directory) {
  const file = path.join(directory, "PLAN.md")
  try {
    const text = fs.readFileSync(file, "utf8")
    return { text, hash: hash(text), file }
  } catch {
    return { text: null, hash: null, file }
  }
}

// Work items from PLAN.md: id -> { id, phase, title, raw }
function parsePlan(directory) {
  const { text } = planSnapshot(directory)
  const items = new Map()
  if (text === null) return items
  for (const match of text.matchAll(PLAN_ITEM)) {
    const id = match[1]
    if (!items.has(id)) {
      items.set(id, { id, phase: id.split(".")[0], title: match[2].trim(), raw: match[0] })
    }
  }
  return items
}

function extractIds(prompt) {
  const found = String(prompt ?? "").match(ID_ANYWHERE)
  return found ? [...new Set(found)] : []
}

function phaseOfIds(ids) {
  const phases = new Set()
  for (const id of ids) phases.add(id.split(".")[0])
  return [...phases]
}

function coderBriefViolations(directory, prompt) {
  const violations = []
  for (const section of REQUIRED_CODER_SECTIONS) {
    if (!String(prompt).includes(section)) violations.push(`coder brief missing "${section}"`)
  }
  const ids = extractIds(prompt)
  if (ids.length === 0) violations.push("coder brief cites no work-item IDs (P<phase>.<n>)")
  const plan = parsePlan(directory)
  if (plan.size > 0) {
    for (const id of ids) {
      if (!plan.has(id)) violations.push(`brief cites ${id}, which is not in PLAN.md`)
    }
  }
  return { violations, ids }
}

function filesFromBrief(prompt) {
  const lines = String(prompt).split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === "## Files")
  if (start < 0) return []
  const out = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^##\s/.test(line)) break
    const trimmed = line.trim().replace(/^[-*]\s*/, "")
    if (trimmed) out.push(trimmed)
  }
  return out
}

function emptyLedger() {
  return { schema: 1, tasks: [] }
}

function readLedger(directory) {
  const ledger = readJson(ledgerPath(directory), null)
  if (ledger === null || !Array.isArray(ledger.tasks)) return emptyLedger()
  return ledger
}

function writeLedger(directory, ledger) {
  writeJson(ledgerPath(directory), ledger)
}

function gitHead(directory) {
  try {
    return execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}

function sameCommit(a, b) {
  if (!a || !b) return false
  const x = String(a)
  const y = String(b)
  return x === y || x.startsWith(y) || y.startsWith(x)
}

function reviewVerdicts(directory) {
  const byCommit = new Map()
  let raw = ""
  try {
    raw = fs.readFileSync(reviewsPath(directory), "utf8")
  } catch {
    return byCommit
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const entry = JSON.parse(trimmed)
      if (entry && typeof entry.reviewOf === "string") byCommit.set(entry.reviewOf, entry)
    } catch {
      // malformed line — ignore, the phase gate will flag a missing verdict
    }
  }
  return byCommit
}

function completedCoderTasks(ledger, phase) {
  return ledger.tasks.filter(
    (task) => task.agent === "coder" && task.status === "completed" && (phase === undefined || task.phase === phase),
  )
}

function reviewedBy(ledger, commit) {
  return ledger.tasks.some(
    (task) => task.agent === "reviewer" && task.status === "completed" && sameCommit(task.reviewOf, commit),
  )
}

// A phase is ready when every plan item is claimed by a completed coder task,
// every such task has a completed review, no review says rework, and (when
// required) the project's verify artifact is green at HEAD.
function evaluatePhase(directory, phase, options = {}) {
  const requireVerify = options.requireVerify === true
  const ledger = readLedger(directory)
  const plan = parsePlan(directory)
  const planIds = [...plan.values()].filter((item) => item.phase === phase).map((item) => item.id)
  const tasks = completedCoderTasks(ledger, phase)
  const verdicts = reviewVerdicts(directory)

  const uncovered = planIds.filter((id) => !tasks.some((task) => (task.planIds ?? []).includes(id)))
  const unreviewed = tasks.filter((task) => !reviewedBy(ledger, task.commit)).map((task) => task.commit ?? `seq ${task.seq}`)
  const rework = tasks
    .map((task) => verdicts.get(String(task.commit ?? "")) ?? verdicts.get(String(task.commit ?? "").slice(0, 7)))
    .filter((entry) => entry && entry.verdict === "rework")
    .map((entry) => entry.reviewOf)

  const verify = readJson(verifyPath(directory), null)
  const head = gitHead(directory)
  const verifyOk = verify !== null && verify.ok === true && sameCommit(verify.commit, head)

  const problems = []
  if (planIds.length === 0) problems.push(`no PLAN.md work items found for phase ${phase}`)
  for (const id of uncovered) problems.push(`${id} has no completed coder task`)
  for (const commit of unreviewed) problems.push(`coder commit ${commit} has no completed review`)
  for (const commit of rework) problems.push(`review ${commit} verdict is rework`)
  if (requireVerify && !verifyOk) problems.push("verify.json missing, red, or not at HEAD")

  return { ready: problems.length === 0, problems, planIds, verifyOk, head }
}

function evaluateCompletion(directory) {
  const plan = parsePlan(directory)
  const phases = [...new Set([...plan.values()].map((item) => item.phase))]
  const problems = []
  for (const phase of phases) {
    const result = evaluatePhase(directory, phase, { requireVerify: false })
    for (const problem of result.problems) problems.push(`${phase}: ${problem}`)
  }
  const verify = readJson(verifyPath(directory), null)
  const head = gitHead(directory)
  if (verify === null || verify.ok !== true) problems.push("final verify.json is missing or red")
  else if (!sameCommit(verify.commit, head)) problems.push("verify.json was not produced at HEAD")
  return { ready: problems.length === 0, problems }
}

// Human-readable coverage ledger, regenerated after every task transition.
function writeCoverage(directory) {
  const ledger = readLedger(directory)
  const plan = parsePlan(directory)
  const verdicts = reviewVerdicts(directory)
  const lines = ["# Coverage ledger", "", "| Item | Title | Task | Commit | Review |", "| --- | --- | --- | --- | --- |"]
  for (const item of plan.values()) {
    const task = completedCoderTasks(ledger).find((entry) => (entry.planIds ?? []).includes(item.id))
    const commit = task?.commit ?? ""
    const verdict = commit ? verdicts.get(commit)?.verdict ?? (reviewedBy(ledger, commit) ? "reviewed" : "pending") : "—"
    lines.push(`| ${item.id} | ${item.title || ""} | ${task ? `seq ${task.seq}` : "—"} | ${commit ? commit.slice(0, 8) : "—"} | ${verdict} |`)
  }
  lines.push("")
  fs.writeFileSync(path.join(orchestrationDir(directory), "coverage.md"), lines.join("\n"))
}

function finalizeTask(directory, callID, status, mode) {
  const state = stateFor(directory)
  const call = state.calls.get(callID)
  if (!call) return
  state.calls.delete(callID)
  const ledger = readLedger(directory)
  const task = ledger.tasks.find((entry) => entry.seq === call.seq)
  if (!task) return
  task.status = status
  if (status === "completed" && task.agent === "coder") {
    task.commit = call.commit ?? gitHead(directory)
  }
  writeLedger(directory, ledger)
  try {
    writeCoverage(directory)
  } catch {
    // coverage is a convenience artifact; never fail a run over it
  }
  if (status === "completed" && task.agent === "coder") {
    const snapshot = planSnapshot(directory)
    if (call.planHash !== null && snapshot.hash !== null && snapshot.hash !== call.planHash) {
      report(directory, mode, `PLAN.md changed during coder task seq ${task.seq}`, { throwInEnforce: false })
    }
  }
  if (status === "completed" && task.agent === "reviewer") {
    const verdict = reviewVerdicts(directory).get(task.reviewOf)
    const ledger2 = readLedger(directory)
    const stored = ledger2.tasks.find((entry) => entry.seq === call.seq)
    if (stored) {
      stored.verdict = verdict ? verdict.verdict : null
      writeLedger(directory, ledger2)
    }
    if (!verdict) {
      report(directory, mode, `reviewer task seq ${task.seq} completed without a log.jsonl verdict line`, {
        throwInEnforce: false,
      })
    }
    if (verdict && verdict.verdict === "rework") {
      report(directory, mode, `review of ${task.reviewOf} returned rework`, { throwInEnforce: false })
    }
  }
}

const states = new Map()

function stateFor(directory) {
  let state = states.get(directory)
  if (!state) {
    state = { calls: new Map(), seq: 0 }
    states.set(directory, state)
  }
  return state
}

function nextSeq(directory) {
  const state = stateFor(directory)
  state.seq += 1
  return state.seq
}

export const ProcessGate = async ({ directory }) => {
  const dir = directory
  const mode = () => modeFor(dir)

  function beginCoder(callID, args) {
    const current = mode()
    if (current === "off") return
    const prompt = String(args?.prompt ?? "")
    const { violations, ids } = coderBriefViolations(dir, prompt)
    const ledger = readLedger(dir)
    const phases = phaseOfIds(ids)
    const pending = []
    for (const phase of phases) {
      const pendingInPhase = completedCoderTasks(ledger, phase).filter((task) => !reviewedBy(ledger, task.commit))
      if (pendingInPhase.length >= 1) {
        pending.push(`${phase} has an unreviewed coder commit (${pendingInPhase.map((task) => task.commit).join(", ")})`)
      }
    }
    for (const message of [...violations, ...pending]) report(dir, current, message, { data: { brief: args?.description } })

    const plan = planSnapshot(dir)
    const seq = nextSeq(dir)
    const entry = {
      seq,
      callID,
      agent: "coder",
      phase: phases[0] ?? null,
      planIds: ids,
      files: filesFromBrief(prompt),
      status: "running",
      startedAt: new Date().toISOString(),
    }
    ledger.tasks.push(entry)
    writeLedger(dir, ledger)
    stateFor(dir).calls.set(callID, { seq, commit: null, planHash: plan.hash })
  }

  function beginReviewer(callID, args) {
    const current = mode()
    if (current === "off") return
    const prompt = String(args?.prompt ?? "")
    const match = prompt.match(REVIEW_OF)
    const reviewOf = match ? match[1] : null
    if (reviewOf === null) {
      report(dir, current, "reviewer brief missing `review-of: <commit>`", { data: { brief: args?.description } })
    } else {
      const ledger = readLedger(dir)
      const known = completedCoderTasks(ledger).some((task) => sameCommit(task.commit, reviewOf))
      if (!known) {
        report(dir, current, `review-of ${reviewOf} does not match any completed coder commit`, {
          data: { brief: args?.description },
        })
      }
    }
    const seq = nextSeq(dir)
    const ledger = readLedger(dir)
    ledger.tasks.push({
      seq,
      callID,
      agent: "reviewer",
      phase: phaseOfIds(extractIds(prompt))[0] ?? null,
      reviewOf,
      planIds: extractIds(prompt),
      status: "running",
      startedAt: new Date().toISOString(),
    })
    writeLedger(dir, ledger)
    stateFor(dir).calls.set(callID, { seq, commit: null, planHash: null })
  }

  function beginTester(callID, args) {
    const current = mode()
    if (current === "off") return
    const prompt = String(args?.prompt ?? "")
    const gate = prompt.match(PHASE_GATE)
    if (gate) {
      const result = evaluatePhase(dir, gate[1], { requireVerify: true })
      if (!result.ready) {
        report(dir, current, `phase ${gate[1]} exit gate not met: ${result.problems.join("; ")}`, {
          data: { brief: args?.description },
        })
      }
    }
    const seq = nextSeq(dir)
    const ledger = readLedger(dir)
    ledger.tasks.push({
      seq,
      callID,
      agent: "tester",
      phase: gate ? gate[1] : null,
      gate: gate ? gate[0] : null,
      planIds: extractIds(prompt),
      status: "running",
      startedAt: new Date().toISOString(),
    })
    writeLedger(dir, ledger)
    stateFor(dir).calls.set(callID, { seq, commit: null, planHash: null })
  }

  function dispatch(kind, callID, args) {
    if (kind === "coder") beginCoder(callID, args)
    else if (kind === "reviewer") beginReviewer(callID, args)
    else if (kind === "tester") beginTester(callID, args)
  }

  function finalize(callID, status, currentMode) {
    finalizeTask(dir, callID, status, currentMode)
  }

  function downgrade(callID) {
    const ledger = readLedger(dir)
    const task = ledger.tasks.find((entry) => entry.callID === callID && entry.status === "completed")
    if (!task) return
    task.status = "failed"
    delete task.commit
    writeLedger(dir, ledger)
  }

  function taskKind(input, output) {
    const args = output?.args ?? input?.args ?? {}
    const agent = args.subagent_type ?? args.agent ?? input?.args?.subagent_type
    return { agent, args }
  }

  const handlers = {
    "tool.execute.before": async (input, output) => {
      try {
        const current = mode()
        if (current === "off") return
        if (input?.tool === "task") {
          const { agent, args } = taskKind(input, output)
          if (agent === "coder" || agent === "reviewer" || agent === "tester") {
            dispatch(agent, input.callID, args)
          }
          return
        }
        if (input?.tool === "write" || input?.tool === "edit") {
          const filePath = String(output?.args?.filePath ?? input?.args?.filePath ?? "")
          if (filePath.endsWith(`COMPLETION.md`)) {
            const result = evaluateCompletion(dir)
            if (!result.ready) {
              report(dir, current, `COMPLETION.md blocked: ${result.problems.join("; ")}`, { data: { filePath } })
            }
          }
        }
      } catch (error) {
        if (String(error?.message ?? "").startsWith("Process gate:")) throw error
        report(dir, "warn", `process-gate internal error: ${error?.message ?? String(error)}`, {
          throwInEnforce: false,
        })
      }
    },
    "tool.execute.after": async (input, output) => {
      try {
        const current = mode()
        if (input?.tool !== "task") return
        const call = stateFor(dir).calls.get(input.callID)
        if (!call) return
        finalize(input.callID, "completed", current)
      } catch (error) {
        if (String(error?.message ?? "").startsWith("Process gate:")) throw error
        report(dir, "warn", `process-gate internal error: ${error?.message ?? String(error)}`, {
          throwInEnforce: false,
        })
      }
    },
    event: async ({ event }) => {
      try {
        if (event?.type !== "message.part.updated") return
        const part = event.properties?.part
        if (!part || part.tool !== "task") return
        if (part.state?.status !== "completed" && part.state?.status !== "error") return
        if (!part.callID) return
        if (part.state.status === "error") {
          // The after-hook may already have marked the task completed; correct it.
          if (!stateFor(dir).calls.has(part.callID)) downgrade(part.callID)
          else finalize(part.callID, "failed", mode())
          return
        }
        if (!stateFor(dir).calls.has(part.callID)) return
        finalize(part.callID, "completed", mode())
      } catch {
        // event handlers must never throw
      }
    },
  }

  return handlers
}

// Internal surface for tests, attached to the factory so the module exposes a
// single plugin export (the loader treats every export as a plugin factory).
ProcessGate.__internals = {
  parsePlan,
  extractIds,
  coderBriefViolations,
  filesFromBrief,
  evaluatePhase,
  evaluateCompletion,
  modeFor,
  sameCommit,
  readLedger,
  writeLedger,
  readJson,
  writeJson,
  planSnapshot,
  orchestrationDir,
  reviewsPath,
  verifyPath,
  violationsPath,
  ledgerPath,
  hash,
}
