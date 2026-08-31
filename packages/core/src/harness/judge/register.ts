import { Effect, Option } from "effect"
import { Database } from "../../database/database"
import { Config } from "../../config"
import { harness_task } from "../schema"
import { fetchEmbedding } from "../shared/embedding"
import { generateID } from "../shared/id"
import { RegisterTaskInput } from "./schemas"

export function makeRegisterTask(
  db: Database.Interface["db"],
  configOption: Option.Option<Config.Interface>,
) {
  return Effect.fn("JudgeAgent.registerTask")(function* (input: RegisterTaskInput) {
    const taskID = generateID("task")

    const embeddingVec =
      input.embedding instanceof Float32Array
        ? input.embedding
        : Array.isArray(input.embedding) && input.embedding.every((v) => typeof v === "number")
          ? new Float32Array(input.embedding as number[])
          : yield* fetchEmbedding(input.prompt)

    const subTypes = Array.isArray(input.taskSubTypes)
      ? input.taskSubTypes
      : Array.isArray(input.taskSubType)
        ? input.taskSubType
        : typeof input.taskSubType === "string"
          ? [input.taskSubType]
          : ["general-task"]

    const configEntries = Option.isSome(configOption)
      ? yield* configOption.value.entries().pipe(Effect.orElseSucceed(() => [] as Config.Entry[]))
      : []

    const selectedModel =
      input.taskModel || Config.latest(configEntries, "model") || "local-tpu/zai-org/GLM-5.2"

    yield* db
      .insert(harness_task)
      .values({
        task_id: taskID,
        task_prompt: input.prompt,
        task_type: input.taskType || "general",
        task_model: selectedModel,
        task_sub_type: JSON.stringify(subTypes),
        task_status: "running",
        task_sub_status: "in_progress",
        task_embeddings: embeddingVec,
        session_id: input.sessionID ?? null,
      })
      .run()
      .pipe(Effect.orDie)

    return taskID
  })
}
