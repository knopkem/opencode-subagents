const STALE_MS = 60 * 60 * 1000

let taskStartedAt = 0

export const SerializeTask = async () => ({
  "tool.execute.before": async (input) => {
    if (input.tool !== "task") return
    if (taskStartedAt && Date.now() - taskStartedAt < STALE_MS) {
      throw new Error(
        "Task tool is serialized: a subagent is already running. Wait for its result before delegating again.",
      )
    }
    taskStartedAt = Date.now()
  },
  "tool.execute.after": async (input) => {
    if (input.tool === "task") taskStartedAt = 0
  },
})
