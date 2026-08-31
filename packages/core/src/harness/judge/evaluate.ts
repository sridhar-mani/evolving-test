import { Effect } from "effect"
import { LLM, LLMClient } from "@opencode-ai/llm"
import { Database } from "../../database/database"
import { SessionTodo } from "../../session/todo"
import { PartTable } from "../../session/sql"
import { SessionSchema } from "../../session/schema"
import { QualityGate } from "../quality-gate"
import { harness_task, harness_subtask_feedback } from "../schema"
import { EvaluateInput, Evaluation } from "./schemas"
import { eq } from "drizzle-orm"

export function makeEvaluate(
  db: Database.Interface["db"],
  todosSvc: SessionTodo.Interface,
  qualityGate: QualityGate.Interface,
  llmClient: InstanceType<typeof LLMClient.Service>,
) {
  return Effect.fn("JudgeAgent.evaluate")(function* (input: EvaluateInput, model: unknown) {
    let subtasks = input.subtasks ?? []

    if (!subtasks.length && input.sessionID) {
      const fetchedTodos = yield* todosSvc
        .get(SessionSchema.ID.make(input.sessionID))
        .pipe(Effect.orElseSucceed(() => []))
      subtasks = fetchedTodos.map((todo) => ({ content: todo.content, status: todo.status }))
    }

    let toolTrace = input.toolTraceSummary ?? ""

    if (!toolTrace && input.sessionID) {
      const toolParts = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.session_id, SessionSchema.ID.make(input.sessionID)))
        .all()
        .pipe(Effect.orElseSucceed(() => []))

      toolTrace = toolParts
        .map((part) => {
          const data = part.data
          if (!data || data.type !== "tool") return null
          const toolData = data as { type: "tool"; tool: string; state: { status: string } }
          return `- Tool: ${toolData.tool} | Status: ${toolData.state.status}`
        })
        .filter(Boolean)
        .join("\n")
    }

    const subtaskSummary = subtasks.length
      ? subtasks.map((st) => `- [${st.status}] ${st.content}`).join("\n")
      : "No explicit subtasks recorded."

    const qualityResult = input.sessionID
      ? yield* qualityGate.evaluateSession(input.sessionID)
      : {
          passed: false,
          score: 0,
          completedTodos: 0,
          totalTodos: 0,
          failedTools: [],
          verificationCommands: [],
          passedVerificationCommands: [],
          failedVerificationCommands: [],
          issues: ["No session ID was provided for Quality Gate evaluation."],
          failureReasons: ["No session ID was provided for Quality Gate evaluation."],
          summary: "Quality Gate could not verify execution evidence.",
        }

    const evalRes = yield* LLM.generateObject({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      model: model as Parameters<typeof LLM.generateObject>[0]["model"],
      system: `You are an uncompromising AI Code Judge & Software Auditor.
Evaluate the code generation trace across 5 Critical Dimensions of Quality & Originality, taking into account user feedback, preferences, and user bias:

1. User Alignment & Feedback Satisfaction (isSatisfied):
   - Prioritize explicit user feedback, user bias, and requested subtask behavior above default heuristics.
   - If the user reported dissatisfaction ("No: ..."), score the result as unsatisfied (isSatisfied: false) regardless of technical completion.

2. Code Quality & Architecture (codeQualityScore: 1-5):
   - Strict TypeScript typing, modular composition, clean file organization, zero lint warnings.

3. Originality & Design Excellence (originalityScore: 1-5):
   - Custom tailored component designs, bespoke SVG icons/graphics, cohesive color token palettes, no generic copy-paste templates.

4. Completeness & Correctness (completenessScore: 1-5):
   - All requested subtasks fulfilled according to user expectations.

5. Performance & Robustness (efficiencyScore: 1-5, robustnessScore: 1-5):
   - Clean DOM structures, minimal re-renders, graceful fallback handling, clean error states.

Scoring Rubric:
- 5 Stars (Flawless): Exceptional quality & originality, zero re-prompts needed, complete alignment with user expectations.
- 4 Stars (Good): Fully functional, but contains minor style non-conformities or derivative component structures.
- 3 Stars (Acceptable): Functional, but uses generic boilerplate templates, missing comments, or suboptimal performance.
- 2 Stars (Flawed): Partially completed; required user steering, contains type warnings, or diverged from user expectation.
- 1 Star (Failed): Unhandled runtime crashes, broken syntax, or failed user requirements.

Do NOT give 5/5 easily. Weight explicit user feedback heavily to ensure the Harness evolves according to the user's bias and standards.`,
      prompt: `
Original Task Prompt:
${input.originalPrompt}

Subtasks Progress:
${subtaskSummary}

Execution & Tool Trace Summary:
${toolTrace || "Standard execution trace"}

User Feedback:
${input.userResponse ?? "None"}
      `.trim(),
      schema: Evaluation,
      generation: { temperature: 0 },
    }).pipe(
      Effect.provideService(LLMClient.Service, llmClient),
      Effect.map((res) => res.object),
    )

    const finalSatisfied = evalRes.isSatisfied && qualityResult.passed
    const finalScore = Math.min(evalRes.score, qualityResult.score)

    const finalEvaluation: Evaluation = {
      ...evalRes,
      isSatisfied: finalSatisfied,
      score: finalScore,
      reasoning: `${evalRes.reasoning} | Quality Gate: ${qualityResult.summary}`,
    }

    const evalSummary = [
      `Overall: ${finalEvaluation.score}/5`,
      `Quality: ${finalEvaluation.codeQualityScore ?? finalEvaluation.score}/5`,
      `Originality: ${finalEvaluation.originalityScore ?? finalEvaluation.score}/5`,
      `Completeness: ${finalEvaluation.completenessScore ?? finalEvaluation.score}/5`,
      `Efficiency: ${finalEvaluation.efficiencyScore ?? finalEvaluation.score}/5`,
      `Robustness: ${finalEvaluation.robustnessScore ?? finalEvaluation.score}/5`,
      `Quality Gate: ${qualityResult.passed ? "PASSED" : "FAILED"}`,
      finalEvaluation.reasoning ? `Reasoning: ${finalEvaluation.reasoning}` : "",
      finalEvaluation.critique ? `Critique: ${finalEvaluation.critique}` : "",
      finalEvaluation.flawsIdentified?.length ? `Flaws: ${finalEvaluation.flawsIdentified.join("; ")}` : "",
      finalEvaluation.originalityHighlights?.length
        ? `Originality Highlights: ${finalEvaluation.originalityHighlights.join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ")

    yield* db
      .update(harness_task)
      .set({
        task_status: finalEvaluation.isSatisfied ? "completed" : "failed",
        task_sub_status: finalEvaluation.isSatisfied ? "satisfied" : "unsatisfied",
        task_error: evalSummary,
      })
      .where(eq(harness_task.task_id, input.taskID))
      .run()
      .pipe(Effect.orDie)

    const hasSubFive =
      finalEvaluation.score < 5 ||
      (finalEvaluation.codeQualityScore ?? 5) < 5 ||
      (finalEvaluation.originalityScore ?? 5) < 5 ||
      (finalEvaluation.completenessScore ?? 5) < 5 ||
      (finalEvaluation.efficiencyScore ?? 5) < 5 ||
      (finalEvaluation.robustnessScore ?? 5) < 5

    if (hasSubFive) {
      const flawNote =
        finalEvaluation.flawsIdentified?.join("; ") ||
        finalEvaluation.critique ||
        finalEvaluation.reasoning ||
        "Sub-optimal score across quality dimensions."

      const subFiveDims = [
        (finalEvaluation.codeQualityScore ?? 5) < 5 ? `Quality (${finalEvaluation.codeQualityScore}/5)` : "",
        (finalEvaluation.originalityScore ?? 5) < 5 ? `Originality (${finalEvaluation.originalityScore}/5)` : "",
        (finalEvaluation.completenessScore ?? 5) < 5 ? `Completeness (${finalEvaluation.completenessScore}/5)` : "",
        (finalEvaluation.efficiencyScore ?? 5) < 5 ? `Efficiency (${finalEvaluation.efficiencyScore}/5)` : "",
        (finalEvaluation.robustnessScore ?? 5) < 5 ? `Robustness (${finalEvaluation.robustnessScore}/5)` : "",
      ]
        .filter(Boolean)
        .join(", ")

      yield* db
        .update(harness_subtask_feedback)
        .set({
          user_feedback: flawNote,
          changes_requested: `Refinement requested to reach 5/5: Improve ${subFiveDims || "general quality"} to meet 5-star rubric.`,
        })
        .where(eq(harness_subtask_feedback.task_id, input.taskID))
        .run()
        .pipe(Effect.orElseSucceed(() => undefined))
    }

    return finalEvaluation
  })
}
