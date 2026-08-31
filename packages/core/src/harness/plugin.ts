export * as HarnessPlugin from "./plugin"

import type { Hooks } from "@opencode-ai/plugin"
import { Context, Effect, Layer, Schema } from "effect"
import { HarnessVersion } from "./version"
import { PromptFinalizer } from "./improving_prompt_finalizer"
import { JudgeAgent } from "./judge"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { LayerNodePlatform } from "../effect/app-node-platform"
import { SessionStore } from "../session/store"
import { LocationServiceMap } from "../location-service-map"
import { makeChatParamsHook } from "./plugin/hooks/chat-params"
import { makeSystemTransformHook } from "./plugin/hooks/system-transform"
import { makeTextCompleteHook } from "./plugin/hooks/text-complete"
import { makeToolBeforeHook, makeToolAfterHook } from "./plugin/hooks/tool-hooks"
import { makePermissionHook } from "./plugin/hooks/permission"
import { makeShellEnvHook } from "./plugin/hooks/shell-env"
import { makeChatMessageHook } from "./plugin/hooks/chat-message"
import { makeCompactingHook } from "./plugin/hooks/compacting"
import { harness_task } from "./schema"
import { eq, desc } from "drizzle-orm"

export const FeedbackClassification = Schema.Struct({
  isFeedback: Schema.Boolean,
  isSatisfied: Schema.Boolean,
  feedbackSummary: Schema.String,
}).annotate({ identifier: "HarnessPlugin.FeedbackClassification" })

export type FeedbackClassification = typeof FeedbackClassification.Type

export interface Interface {
  readonly createHooks: (domainCategory: string) => Effect.Effect<Hooks>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/HarnessPlugin") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const versionSvc = yield* HarnessVersion.Service
    const finalizerSvc = yield* PromptFinalizer.Service
    const { db } = yield* Database.Service
    const sessionStore = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service

    const createHooks = Effect.fn("HarnessPlugin.createHooks")(function* (domainCategory: string) {
      const activeVersion = yield* versionSvc
        .getActiveVersion(domainCategory)
        .pipe(Effect.orElseSucceed(() => undefined))

      const taskDecisions = new Map<string, boolean>()

      const resolveActiveVersion = async (sessionID?: string) => {
        if (!sessionID) return activeVersion

        const task = await Effect.runPromise(
          db
            .select()
            .from(harness_task)
            .where(eq(harness_task.session_id, sessionID))
            .orderBy(desc(harness_task.task_id))
            .get()
            .pipe(Effect.orElseSucceed(() => undefined)),
        ).catch(() => undefined)

        if (task?.task_type) {
          const specificVer = await Effect.runPromise(
            versionSvc.getActiveVersion(task.task_type).pipe(Effect.orElseSucceed(() => null)),
          ).catch(() => null)

          if (specificVer) return specificVer
        }

        return activeVersion
      }

      const hooks: Hooks = {
        "chat.params": makeChatParamsHook(resolveActiveVersion),
        "experimental.chat.system.transform": makeSystemTransformHook(resolveActiveVersion),
        "experimental.text.complete": makeTextCompleteHook(taskDecisions),
        "tool.execute.before": makeToolBeforeHook(resolveActiveVersion),
        "tool.execute.after": makeToolAfterHook(resolveActiveVersion),
        "permission.ask": makePermissionHook(activeVersion),
        "shell.env": makeShellEnvHook(resolveActiveVersion),
        "chat.message": makeChatMessageHook({ db, taskDecisions, finalizerSvc, sessionStore, locations }),
        "experimental.session.compacting": makeCompactingHook(activeVersion, domainCategory),
      }

      return hooks
    })

    return Service.of({ createHooks })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    HarnessVersion.node,
    Database.node,
    PromptFinalizer.node,
    JudgeAgent.node,
    SessionStore.node,
    LocationServiceMap.node,
    LayerNodePlatform.llmClient,
  ],
})