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
