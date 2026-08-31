import { Effect } from "effect"
import { SessionSchema } from "../../../session/schema"
import { SessionTable, PartTable } from "../../../session/sql"
import { harness_task, harness_subtask_feedback } from "../../schema"
import { generateID } from "../../shared/id"
import { SessionStore } from "../../../session/store"
import { LocationServiceMap } from "../../../location-service-map"
import { SessionRunnerModel } from "../../../session/runner/model"
import { PromptFinalizer } from "../../improving_prompt_finalizer"
import { eq, desc } from "drizzle-orm"
import { Database } from "../../../database/database"

type DB = Database.Interface["db"]

export function makeChatMessageHook(deps: {
  db: DB
  taskDecisions: Map<string, boolean>
  finalizerSvc: PromptFinalizer.Interface
  sessionStore: SessionStore.Interface
  locations: InstanceType<typeof LocationServiceMap.Service>
}) {
  const { db, taskDecisions, finalizerSvc, sessionStore, locations } = deps

  // IMPORTANT:
  // This must be a normal async hook because this function uses await.
  return async (
    input: { sessionID: string; model?: { providerID: string; modelID: string } },
    output: { parts: Array<{ type: string; text?: string }>; message?: unknown },
  ) => {
    try {
      const text = output.parts
        .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim()

      const lower = text.toLowerCase()

      const isYes =
        /^(?:yes|y|yeah|yep|looks good|perfect|satisfied|confirmed|approved|great|good|fine|ok|okay)(?:[!.\s]|$)/i.test(lower)
      const isNo =
        /^(?:no|n|nope|not good|unsatisfied|wrong|different|dislike|failed|needs work)(?:[:!.\s-]|$)/i.test(lower)

      const isFeedback = isYes || isNo

      if (isFeedback) {
        // User is replying with feedback to the previous task, NOT starting a new task
        taskDecisions.set(input.sessionID, false)
        if (output && output.message) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          ;(output.message as any).isFeedback = true
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          ;(output.message as any).isSatisfied = isYes
        }
      } else {
        // Normal user message: mark as task so experimental.text.complete displays the feedback banner
        taskDecisions.set(input.sessionID, true)
        return
      }

      const isSatisfied = isYes
      const explanation = isNo
        ? text.replace(/^(?:no|n|nope|not good|unsatisfied|wrong|different|dislike|failed|needs work)\s*[:\s-]*/i, "").trim() ||
          "User reported dissatisfaction."
        : "User confirmed satisfaction."

      const selectedModel = input.model
        ? `${input.model.providerID}/${input.model.modelID}`
        : "local-tpu/zai-org/GLM-5.2"

      // 1. Find existing harness task for this session
      let recentTask = await Effect.runPromise(
        db
          .select()
          .from(harness_task)
          .where(eq(harness_task.session_id, input.sessionID))
          .orderBy(desc(harness_task.task_id))
          .get()
          .pipe(Effect.orElseSucceed(() => undefined)),
      ).catch(() => undefined)

      // 2. Fall back to most recent task in the database if none found for this session
      if (!recentTask) {
        recentTask = await Effect.runPromise(
          db
            .select()
            .from(harness_task)
            .orderBy(desc(harness_task.task_id))
            .get()
            .pipe(Effect.orElseSucceed(() => undefined)),
        ).catch(() => undefined)
      }

      // 3. If still no task exists anywhere, stop — no dummy tasks
      if (!recentTask) return

      const feedbackID = generateID("feedback")

      // 4. Save user feedback
      await Effect.runPromise(
        db
          .insert(harness_subtask_feedback)
          .values({
            id: feedbackID,
            task_id: recentTask.task_id,
            subtask_content: "Overall task completion",
            subtask_prompt: recentTask.task_prompt ?? "",
            subtask_output: isSatisfied ? "User confirmed satisfaction." : explanation,
            is_reiterated: false,
            is_prompt_changed: false,
            prompt_iteration_count: 1,
            quality_score: isSatisfied ? 5 : 1,
            is_satisfied: isSatisfied,
            user_feedback: isSatisfied ? "Yes" : "No",
            changes_requested: isSatisfied ? null : explanation,
            created_at: Date.now(),
          })
          .run()
          .pipe(Effect.orDie),
      )

      // 5. Update task status
      await Effect.runPromise(
        db
          .update(harness_task)
          .set({
            task_status: isSatisfied ? "completed" : "failed",
            task_sub_status: isSatisfied ? "satisfied" : "unsatisfied",
          })
          .where(eq(harness_task.task_id, recentTask.task_id))
          .run()
          .pipe(Effect.orDie),
      )

      // 6. Store feedback in session metadata
      const typedSessionID = SessionSchema.ID.make(input.sessionID)

      const sessionRow = await Effect.runPromise(
        db
          .select({ metadata: SessionTable.metadata })
          .from(SessionTable)
          .where(eq(SessionTable.id, typedSessionID))
          .get()
          .pipe(Effect.orElseSucceed(() => undefined)),
      ).catch(() => undefined)

      if (sessionRow) {
        await Effect.runPromise(
          db
            .update(SessionTable)
            .set({
              metadata: {
                ...(sessionRow.metadata ?? {}),
                harnessFeedback: {
                  taskID: recentTask.task_id,
                  feedbackID,
                  isSatisfied,
                  score: isSatisfied ? 5 : 1,
                  status: isSatisfied ? "satisfied" : "unsatisfied",
                  userFeedback: isSatisfied ? "Yes" : "No",
                  critique: explanation,
                  evaluatedAt: Date.now(),
                },
              },
            })
            .where(eq(SessionTable.id, typedSessionID))
            .run()
            .pipe(Effect.orDie),
        )
      }

      // 7. Resolve the actual model for the session
      const targetModel = await Effect.runPromise(
        (
          sessionStore
            .get(SessionSchema.ID.make(input.sessionID))
            .pipe(
              Effect.flatMap((session) =>
                session
                  ? Effect.provide(
                      SessionRunnerModel.Service.use((sessionModels) => sessionModels.resolve(session)),
                      locations.get(session.location),
                    )
                  : Effect.die("Session not found"),
              ),
              Effect.orElseSucceed(() => undefined),
            ) as Effect.Effect<unknown, never, never>
        ),
      ).catch(() => undefined)

      if (!targetModel) return

      // 8. Run finalizer on negative feedback to extract lessons and evolve harness
      if (isSatisfied) return

      await Effect.runPromise(finalizerSvc.finalizeAndEvolve(recentTask.task_id, targetModel)).catch(() => undefined)
    } catch {
      // hook errors must never propagate
    }
  }
}
