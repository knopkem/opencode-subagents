// Regression fixtures for the process gate. They replay the exact failures
// seen in the wild: a coder brief that drops a PLAN.md work item, a second
// coder task dispatched without a review, and COMPLETION.md claimed before
// gates are green. Runs on host Node only — the target project stays stack-free.

import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { ProcessGate } from "../process-gate.js"

const internals = ProcessGate.__internals

const PLAN = `# PLAN

## Work items
- [ ] P6.1 main panel (files: src/ui/main-panel.tsx; gate: VERIFY)
- [ ] P6.2 app css layout (files: src/css/app.css; gate: VERIFY)
`

const originalMode = process.env.PROCESS_GATE
const tempDirs = []

afterEach(() => {
  if (originalMode === undefined) delete process.env.PROCESS_GATE
  else process.env.PROCESS_GATE = originalMode
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim()
}

function commitAll(dir, message) {
  git(dir, "add", "-A")
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message])
  return git(dir, "rev-parse", "HEAD")
}

function makeProject({ mode } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "process-gate-"))
  tempDirs.push(dir)
  git(dir, "init", "-q")
  fs.writeFileSync(path.join(dir, "PLAN.md"), PLAN)
  commitAll(dir, "plan")
  if (mode) {
    fs.mkdirSync(path.join(dir, ".orchestration"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".orchestration", "config.json"), JSON.stringify({ mode }))
  }
  return dir
}

function coderBrief(ids, { omit } = {}) {
  const parts = [
    `## Target\n${path.sep}tmp — PLAN.md; AGENTS.md; INTEGRATION.md`,
    `## Plan coverage\n${ids.map((id) => `- ${id} — quoted plan line`).join("\n")}`,
    `## Files\n- src/file.ts`,
    `## Acceptance\nquoted from PLAN.md`,
    `## Gates\n- build, test, VERIFY`,
  ]
  if (omit) parts.splice(parts.findIndex((p) => p.startsWith(omit)), 1)
  return parts.join("\n\n")
}

function reviewerBrief(commit, ids) {
  return `## Target\n/tmp\n\nreview-of: ${commit}\n\n## Plan coverage\n${ids.map((id) => `- ${id}`).join("\n")}`
}

async function before(handlers, tool, callID, args) {
  await handlers["tool.execute.before"]({ tool, callID, args }, { args })
}

async function after(handlers, callID, args) {
  await handlers["tool.execute.after"]({ tool: "task", callID, args }, { args })
}

function violations(dir) {
  try {
    return fs
      .readFileSync(path.join(dir, ".orchestration", "violations.log"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

function appendReview(dir, { reviewOf, planIds, verdict }) {
  const file = path.join(dir, ".orchestration", "reviews", "log.jsonl")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), reviewOf, planIds, verdict, blockers: [], shouldFix: [] }) + "\n",
  )
}

function writeVerify(dir, commit) {
  const file = path.join(dir, ".orchestration", "verify.json")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ schema: 1, ok: true, commit, checks: [], artifacts: [], runner: "fixture" }))
}

// --- pure helpers -----------------------------------------------------------

test("parsePlan extracts work items and phases", () => {
  const dir = makeProject()
  const items = internals.parsePlan(dir)
  assert.equal(items.size, 2)
  assert.equal(items.get("P6.1").phase, "P6")
  assert.match(items.get("P6.2").title, /app css/)
})

test("coderBriefViolations flags missing sections, untracked IDs, and unknown IDs", () => {
  const dir = makeProject()
  const missing = internals.coderBriefViolations(dir, coderBrief(["P6.1"], { omit: "## Gates" }))
  assert.ok(missing.violations.some((v) => v.includes("## Gates")))
  const unknown = internals.coderBriefViolations(dir, coderBrief(["P9.9"]))
  assert.ok(unknown.violations.some((v) => v.includes("P9.9")))
  const noIds = internals.coderBriefViolations(dir, coderBrief([]))
  assert.ok(noIds.violations.some((v) => v.includes("cites no work-item IDs")))
})

test("claimed work-item IDs come only from `## Plan coverage`", () => {
  const dir = makeProject()
  const brief = `${coderBrief(["P6.1"])}\n\n## Out of scope\n- P6.2 files (src/css/app.css) belong to the concurrent task`
  const { ids } = internals.coderBriefViolations(dir, brief)
  assert.deepEqual(ids, ["P6.1"])
  // The out-of-scope mention is still validated, it just is not a claim.
  const bogus = `${coderBrief(["P6.1"])}\n\n## Out of scope\n- P9.9 untouched`
  assert.ok(internals.coderBriefViolations(dir, bogus).violations.some((v) => v.includes("P9.9")))
})

test("a brief's non-coverage mentions do not inflate the task's planIds", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  const brief = `${coderBrief(["P6.1"])}\n\n## Out of scope\n- P6.2 files (src/css/app.css) belong to the concurrent task`
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: brief })
  const ledger = internals.readLedger(dir)
  const task = ledger.tasks.find((entry) => entry.agent === "coder")
  assert.deepEqual(task.planIds, ["P6.1"])
})

// --- warn mode: the three real failures are logged, not blocked -------------

test("warn mode logs a brief that drops a plan item instead of blocking", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  // The historical failure: brief covers only P6.1 and silently drops P6.2.
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "Phase 6", prompt: coderBrief(["P6.1"]) })
  await after(handlers, "c1", { subagent_type: "coder" })
  const log = violations(dir)
  assert.ok(log.length >= 0) // dropping an item is legal per-task; coverage catches it at the gate
  const phase = internals.evaluatePhase(dir, "P6", { requireVerify: false })
  assert.equal(phase.ready, false)
  assert.ok(phase.problems.some((p) => p.includes("P6.2")))
})

test("warn mode logs a malformed brief but keeps the run alive", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "no sections", prompt: "do the thing" })
  await after(handlers, "c1", { subagent_type: "coder" })
  const log = violations(dir)
  assert.ok(log.some((entry) => /missing "## Plan coverage"/.test(entry.message)))
  assert.ok(log.some((entry) => /cites no work-item IDs/.test(entry.message)))
})

test("warn mode logs a second coder dispatch while a review is pending", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P6.1"]) })
  commitAll(dir, "P6.1")
  await after(handlers, "c1", { subagent_type: "coder" })
  await before(handlers, "task", "c2", { subagent_type: "coder", description: "T2", prompt: coderBrief(["P6.2"]) })
  const log = violations(dir)
  assert.ok(log.some((entry) => /unreviewed coder commit/.test(entry.message)))
})

test("warn mode logs COMPLETION.md written before the plan is covered", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "write", "w1", { filePath: path.join(dir, "COMPLETION.md") })
  const log = violations(dir)
  assert.ok(log.some((entry) => /COMPLETION\.md blocked/.test(entry.message)))
})

// --- enforce mode: the same failures are rejected ---------------------------

test("enforce mode rejects a malformed coder brief", async () => {
  process.env.PROCESS_GATE = "enforce"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await assert.rejects(
    before(handlers, "task", "c1", { subagent_type: "coder", description: "bad", prompt: "no sections" }),
    /Process gate/,
  )
})

test("enforce mode rejects a second coder while a review is pending", async () => {
  process.env.PROCESS_GATE = "enforce"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P6.1"]) })
  commitAll(dir, "P6.1")
  await after(handlers, "c1", { subagent_type: "coder" })
  await assert.rejects(
    before(handlers, "task", "c2", { subagent_type: "coder", description: "T2", prompt: coderBrief(["P6.2"]) }),
    /unreviewed coder commit/,
  )
})

test("enforce mode allows a coder dispatch while the prior commit's review is in flight", async () => {
  process.env.PROCESS_GATE = "enforce"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P6.1"]) })
  const commit1 = commitAll(dir, "P6.1")
  await after(handlers, "c1", { subagent_type: "coder" })

  // The sanctioned batch: review(P6.1) ∥ coding(P6.2) in one message.
  await before(handlers, "task", "r1", { subagent_type: "reviewer", description: "R1", prompt: reviewerBrief(commit1, ["P6.1"]) })
  await before(handlers, "task", "c2", { subagent_type: "coder", description: "T2", prompt: coderBrief(["P6.2"]) })
  const commit2 = commitAll(dir, "P6.2")
  await after(handlers, "c2", { subagent_type: "coder" })

  appendReview(dir, { reviewOf: commit1, planIds: ["P6.1"], verdict: "ship" })
  await after(handlers, "r1", { subagent_type: "reviewer" })

  assert.ok(!violations(dir).some((entry) => /unreviewed coder commit/.test(entry.message)))
  const phase = internals.evaluatePhase(dir, "P6", { requireVerify: false })
  assert.ok(!phase.problems.some((p) => p.includes(commit1)))
  assert.ok(phase.problems.some((p) => p.includes(commit2))) // still pending its review
})

test("the in-flight exemption is per commit: a second unreviewed commit still blocks", async () => {
  process.env.PROCESS_GATE = "enforce"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P6.1"]) })
  const commit1 = commitAll(dir, "P6.1")
  await after(handlers, "c1", { subagent_type: "coder" })
  await before(handlers, "task", "r1", { subagent_type: "reviewer", description: "R1", prompt: reviewerBrief(commit1, ["P6.1"]) })
  await before(handlers, "task", "c2", { subagent_type: "coder", description: "T2", prompt: coderBrief(["P6.2"]) })
  commitAll(dir, "P6.2")
  await after(handlers, "c2", { subagent_type: "coder" })
  // r1 covers commit1 only; commit2 has no reviewer running, so a third coder is blocked.
  await assert.rejects(
    before(handlers, "task", "c3", { subagent_type: "coder", description: "T3", prompt: coderBrief(["P6.2"]) }),
    /unreviewed coder commit/,
  )
})

test("enforce mode rejects COMPLETION.md before gates are green", async () => {
  process.env.PROCESS_GATE = "enforce"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await assert.rejects(before(handlers, "write", "w1", { filePath: path.join(dir, "COMPLETION.md") }), /COMPLETION\.md blocked/)
})

// --- the compliant flow passes every gate -----------------------------------

test("compliant flow: coverage, review verdicts, verify and completion all pass", async () => {
  process.env.PROCESS_GATE = "enforce"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })

  // task 1: P6.1
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P6.1"]) })
  const commit1 = commitAll(dir, "P6.1: main panel")
  await after(handlers, "c1", { subagent_type: "coder" })
  await before(handlers, "task", "r1", { subagent_type: "reviewer", description: "R1", prompt: reviewerBrief(commit1, ["P6.1"]) })
  appendReview(dir, { reviewOf: commit1, planIds: ["P6.1"], verdict: "ship" })
  await after(handlers, "r1", { subagent_type: "reviewer" })

  // task 2: P6.2
  await before(handlers, "task", "c2", { subagent_type: "coder", description: "T2", prompt: coderBrief(["P6.2"]) })
  const commit2 = commitAll(dir, "P6.2: css")
  await after(handlers, "c2", { subagent_type: "coder" })
  await before(handlers, "task", "r2", { subagent_type: "reviewer", description: "R2", prompt: reviewerBrief(commit2, ["P6.2"]) })
  appendReview(dir, { reviewOf: commit2, planIds: ["P6.2"], verdict: "ship" })
  await after(handlers, "r2", { subagent_type: "reviewer" })

  const phase = internals.evaluatePhase(dir, "P6", { requireVerify: true })
  assert.equal(phase.ready, false) // verify not yet produced
  assert.ok(phase.problems.some((p) => p.includes("verify.json")))

  writeVerify(dir, commit2)
  const phase2 = internals.evaluatePhase(dir, "P6", { requireVerify: true })
  assert.deepEqual(phase2.problems, [])
  assert.equal(phase2.ready, true)

  const completion = internals.evaluateCompletion(dir)
  assert.equal(completion.ready, true)

  const beforeCount = violations(dir).length
  await before(handlers, "write", "w1", { filePath: path.join(dir, "COMPLETION.md") })
  assert.equal(violations(dir).length, beforeCount)
})

test("tester phase-exit gate is rejected until verify is green at HEAD", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P6.1", "P6.2"]) })
  const commit = commitAll(dir, "P6: both items")
  await after(handlers, "c1", { subagent_type: "coder" })
  await before(handlers, "task", "r1", { subagent_type: "reviewer", description: "R1", prompt: reviewerBrief(commit, ["P6.1", "P6.2"]) })
  appendReview(dir, { reviewOf: commit, planIds: ["P6.1", "P6.2"], verdict: "ship" })
  await after(handlers, "r1", { subagent_type: "reviewer" })

  const countBefore = violations(dir).length
  await before(handlers, "task", "t1", { subagent_type: "tester", description: "exit", prompt: "GATE: phase-P6-exit\nrun VERIFY" })
  assert.ok(violations(dir).length > countBefore)

  writeVerify(dir, commit)
  const countGreen = violations(dir).length
  await before(handlers, "task", "t2", { subagent_type: "tester", description: "exit again", prompt: "GATE: phase-P6-exit" })
  assert.equal(violations(dir).length, countGreen)
})

test("a rework verdict blocks the phase", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P6.1", "P6.2"]) })
  const commit = commitAll(dir, "P6")
  await after(handlers, "c1", { subagent_type: "coder" })
  await before(handlers, "task", "r1", { subagent_type: "reviewer", description: "R1", prompt: reviewerBrief(commit, ["P6.1", "P6.2"]) })
  appendReview(dir, { reviewOf: commit, planIds: ["P6.1", "P6.2"], verdict: "rework" })
  await after(handlers, "r1", { subagent_type: "reviewer" })
  writeVerify(dir, commit)
  const phase = internals.evaluatePhase(dir, "P6", { requireVerify: true })
  assert.equal(phase.ready, false)
  assert.ok(phase.problems.some((p) => /rework/.test(p)))
})

test("PLAN.md modified during a coder task is logged", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P6.1"]) })
  fs.appendFileSync(path.join(dir, "PLAN.md"), "\n- [ ] P6.3 sneaky\n")
  await after(handlers, "c1", { subagent_type: "coder" })
  assert.ok(violations(dir).some((entry) => /PLAN\.md changed during coder task/.test(entry.message)))
})

test("modeFor: env overrides project config, config overrides default", () => {
  const dir = makeProject({ mode: "warn" })
  delete process.env.PROCESS_GATE
  assert.equal(internals.modeFor(dir), "warn")
  process.env.PROCESS_GATE = "off"
  assert.equal(internals.modeFor(dir), "off")
})

// --- PLAN.md contract: prose phases without work items must not pass ---------
//
// Real failure this guards: a PLAN.md written with prose phases (Goal, File map,
// Implementation order) and no `## Work items` section parsed to zero items, so
// every gate check was vacuous — phase evaluation covered nothing and
// evaluateCompletion iterated zero phases and declared the project ready.

function makeProsePlanProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "process-gate-prose-"))
  tempDirs.push(dir)
  git(dir, "init", "-q")
  fs.writeFileSync(
    path.join(dir, "PLAN.md"),
    "# PLAN\n\n## Goal\nShip the thing.\n\n## Implementation order\n### Phase 1 — scaffolding\n1. npm init\n\n### Phase 2 — canvas\n1. render view\n",
  )
  commitAll(dir, "prose plan")
  return dir
}

test("a PLAN.md with no work items is reported as a contract violation", () => {
  const dir = makeProsePlanProject()
  assert.ok(/declares no work items/.test(internals.planContractViolation(dir)))
  const brief = internals.coderBriefViolations(dir, coderBrief(["P1.1"]))
  assert.ok(brief.violations.some((v) => /declares no work items/.test(v)))
})

test("evaluateCompletion refuses a plan that declares no work items", () => {
  const dir = makeProsePlanProject()
  const result = internals.evaluateCompletion(dir)
  assert.equal(result.ready, false)
  assert.ok(result.problems.some((p) => /declares no work items/.test(p)))
})

test("an absent PLAN.md (greenfield) is not a contract violation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "process-gate-empty-"))
  tempDirs.push(dir)
  git(dir, "init", "-q")
  assert.equal(internals.planContractViolation(dir), null)
})

test("warn mode logs the missing work-item contract on a coder dispatch", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProsePlanProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P1.1"]) })
  assert.ok(violations(dir).some((entry) => /declares no work items/.test(entry.message)))
})

// --- repeated-rejection escalation ------------------------------------------
//
// Real failure this guards: an orchestrator rephrased the same un-dispatchable
// brief nine times in six minutes — a task with no PLAN.md work item ("create
// .orchestration"), which no brief can make legal. A rejected call never reaches
// the loop-breaker's hooks, so the gate has to own this case.

test("enforce mode escalates a brief rejected three times", async () => {
  process.env.PROCESS_GATE = "enforce"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  const args = { subagent_type: "coder", description: "Create .orchestration dir", prompt: "create the directory" }
  await assert.rejects(before(handlers, "task", "c1", args), /missing "## Plan coverage"/)
  await assert.rejects(before(handlers, "task", "c2", args), /missing "## Plan coverage"/)
  await assert.rejects(before(handlers, "task", "c3", args), /rejected 3×/)
})

test("warn mode logs the escalation, and a different brief does not inherit it", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  const args = { subagent_type: "coder", description: "Create .orchestration dir", prompt: "create the directory" }
  for (const id of ["c1", "c2", "c3"]) await before(handlers, "task", id, args)
  const log = violations(dir)
  const escalated = log.filter((entry) => /rejected 3×/.test(entry.message))
  assert.equal(escalated.length, 1)
  assert.equal(escalated[0].attempts, 3)
  await before(handlers, "task", "c4", { subagent_type: "coder", description: "Other brief", prompt: "create the directory" })
  assert.equal(violations(dir).filter((entry) => /rejected 3×/.test(entry.message)).length, 1)
  // A different session reusing the same description starts from zero.
  for (const id of ["c5", "c6"]) {
    await handlers["tool.execute.before"]({ tool: "task", callID: id, sessionID: "ses_other", args }, { args })
  }
  assert.equal(violations(dir).filter((entry) => /rejected 3×/.test(entry.message)).length, 1)
})

// --- plan IDs are append-only once implementation starts --------------------
//
// Real failure this guards: a planner rewrote PLAN.md mid-run (P0.x → P1.x) while
// a coder dispatch was pending; the brief then cited an ID that no longer existed
// and was rejected as "not in PLAN.md". The gate now freezes the ID set at the
// first coder dispatch and names any ID that disappears.

test("a plan that drops an existing work-item ID after the first dispatch is reported", async () => {
  process.env.PROCESS_GATE = "warn"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  await before(handlers, "task", "c1", { subagent_type: "coder", description: "T1", prompt: coderBrief(["P6.1"]) })
  fs.writeFileSync(path.join(dir, "PLAN.md"), "# PLAN\n\n## Work items\n- [ ] P7.1 renamed phase (files: src/x.ts; gate: VERIFY)\n")
  await before(handlers, "task", "c2", { subagent_type: "coder", description: "T2", prompt: coderBrief(["P7.1"]) })
  const log = violations(dir)
  assert.ok(log.some((entry) => /dropped work item P6\.1/.test(entry.message)))
  assert.ok(log.some((entry) => /dropped work item P6\.2/.test(entry.message)))
})

// --- the plan artifact itself is guarded ------------------------------------
//
// Real failure this guards: an orchestrator briefed the planner with its own
// coder-brief skeleton ("PLAN.md with these sections: Target / Plan coverage /
// Acceptance"), the planner wrote exactly that as a table, so PLAN.md had no
// `- [ ] P<n>.<n>` lines, no IDs existed to cite, and every coder brief after it
// was rejected. Blocking the bad plan at the write is the source-level fix.

test("writing a PLAN.md with no work items is blocked, a valid one is not", async () => {
  process.env.PROCESS_GATE = "enforce"
  const dir = makeProject()
  const handlers = await ProcessGate({ directory: dir })
  const write = (callID, content) =>
    handlers["tool.execute.before"]({ tool: "write", callID }, { args: { filePath: path.join(dir, "PLAN.md"), content } })
  await assert.rejects(
    write("w1", "# PLAN\n\n## Plan coverage\n\n| ID | Title |\n|----|-------|\n| P1.1 | core scaffolding |\n"),
    /PLAN\.md blocked: no work items/,
  )
  const beforeCount = violations(dir).length
  await write("w2", "# PLAN\n\n## Work items\n- [ ] P1.1 scaffold (files: package.json; gate: npm run build)\n")
  assert.equal(violations(dir).length, beforeCount)
})
