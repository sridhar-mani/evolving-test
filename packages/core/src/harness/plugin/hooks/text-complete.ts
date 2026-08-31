export function makeTextCompleteHook(taskDecisions: Map<string, boolean>) {
  return async (
    input: { sessionID: string },
    output: { text?: string },
  ) => {
    const isTaskDecision = taskDecisions.get(input.sessionID)
    taskDecisions.delete(input.sessionID)

    // If explicitly marked false (e.g. feedback acknowledgment message), do not show banner
    if (isTaskDecision === false) return

    if (output.text && !output.text.includes("Harness Quality & Evolution Feedback")) {
      output.text +=
        `\n\n---\n` +
        `### 📊 Harness Quality & Evolution Feedback\n` +
        `**Are you satisfied with this subtask result? (Yes/No)**\n` +
        `*Reply ` +
        "`Yes`" +
        ` to confirm or ` +
        "`No: <your explanation of how you expected it>`" +
        ` so the Harness can learn and extract rules for future runs.*`
    }
  }
}
