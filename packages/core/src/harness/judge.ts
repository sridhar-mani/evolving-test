export * as JudgeAgent from "./judge"

import { Context, Effect, Layer } from "effect"
import { LLMClient } from "@opencode-ai/llm"
import { Database } from "../database/database"
import { SessionTodo } from "../session/todo"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { LayerNodePlatform } from "../effect/app-node-platform"
import { QualityGate } from "./quality-gate"
import { PromptFinalizer } from "./improving_prompt_finalizer"
import { makeClassify } from "./judge/classify"
import { makeRegisterTask } from "./judge/register"
import { makeEvaluate } from "./judge/evaluate"

export {
  Classification,
  Evaluation,
  SubtaskItem,
  RegisterTaskInput,
  EvaluateInput,
} from "./judge/schemas"

export type {
  Classification as ClassificationType,
  Evaluation as EvaluationType,
  SubtaskItem as SubtaskItemType,
  RegisterTaskInput as RegisterTaskInputType,
  EvaluateInput as EvaluateInputType,
} from "./judge/schemas"

import type { Classification, Evaluation, RegisterTaskInput, EvaluateInput } from "./judge/schemas"
import type { LLMError } from "@opencode-ai/llm"

export interface Interface {
  readonly classify: (prompt: string, model: unknown) => Effect.Effect<Classification, LLMError>
  readonly registerTask: (input: RegisterTaskInput) => Effect.Effect<string>
  readonly evaluate: (input: EvaluateInput, model: unknown) => Effect.Effect<Evaluation, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/JudgeAgent") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const todosSvc = yield* SessionTodo.Service
    const qualityGate = yield* QualityGate.Service
    const llmClient = yield* LLMClient.Service
    const configOption = yield* Effect.serviceOption(Config.Service)

    return Service.of({
      classify: makeClassify(db, llmClient),
      registerTask: makeRegisterTask(db, configOption),
      evaluate: makeEvaluate(db, todosSvc, qualityGate, llmClient),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    SessionTodo.node,
    QualityGate.node,
    PromptFinalizer.node,
    LayerNodePlatform.llmClient,
  ],
})