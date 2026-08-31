import { Effect } from "effect"
import { LLM, LLMClient } from "@opencode-ai/llm"
import { Database } from "../../database/database"
import { harness_version, harness_task } from "../schema"
import { fetchEmbedding, toVec, rankDomainsBySimilarity } from "../shared/embedding"
import { Classification } from "./schemas"
import { eq, desc, isNotNull } from "drizzle-orm"
import similarity from "compute-cosine-similarity"

function isClearlyActionableTask(prompt: string): boolean {
  const text = prompt.trim()
  if (!text) return false
  return /^(?:please\s+)?(?:write|create|build|add|modify|change|update|fix|debug|refactor|run|test|implement|generate|solve|complete|develop|make)\b/i.test(text)
}

export function makeClassify(
  db: Database.Interface["db"],
  llmClient: InstanceType<typeof LLMClient.Service>,
) {
  return Effect.fn("JudgeAgent.classify")(function* (prompt: string, model: unknown) {
    const activeDomainRows = yield* db
      .select({ domain: harness_version.domain_category })
      .from(harness_version)
      .where(eq(harness_version.is_active, true))
      .orderBy(desc(harness_version.version_id))
      .limit(50)
      .all()
      .pipe(Effect.orElseSucceed(() => []))

    const activeDomainSet = new Set(activeDomainRows.map((r) => r.domain).filter(Boolean))

    let rankedDomains: string[] = []
    const promptEmbedding = yield* fetchEmbedding(prompt).pipe(Effect.orElseSucceed(() => undefined))

    if (promptEmbedding) {
      const tasksWithEmbeddings = yield* db
        .select({ taskType: harness_task.task_type, embedding: harness_task.task_embeddings })
        .from(harness_task)
        .where(isNotNull(harness_task.task_embeddings))
        .all()
        .pipe(Effect.orElseSucceed(() => []))

      rankedDomains = rankDomainsBySimilarity(Array.from(promptEmbedding), tasksWithEmbeddings, activeDomainSet)
    }

    const candidateDomains = Array.from(new Set([...rankedDomains, ...Array.from(activeDomainSet)])).slice(0, 15)

    const existingDomainContext =
      candidateDomains.length > 0
        ? `\n\nExisting Active Domain Niches in Repository (Vector-Ranked):\n${candidateDomains.map((d) => `- ${d}`).join("\n")}\nIf the task matches one of these existing domain niches, reuse that exact domain name. Otherwise, create a new semantic snake_case domain niche for the new technical stack.`
        : ""

    const res = yield* LLM.generateObject({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      model: model as Parameters<typeof LLM.generateObject>[0]["model"],
      system: `You are an Expert Task Classifier and Domain Taxonomy Specialist. Determine if the user request is an actionable task (isTask: true) or a conversation/greeting/explanation (isTask: false). Programming requests are tasks.\n\nWhen isTask is true, classify taskType into a concise, semantic snake_case domain niche describing the primary technical stack or subject (e.g. 'python_coding', 'web_frontend', 'typescript_fullstack', 'systems_backend', 'data_science_ml', 'devops_infra', 'bioinformatics', 'financial_quant', 'cuda_gpu_kernels', etc.).${existingDomainContext}\n\nCRITICAL: Never assign 'general' to language-specific or technical engineering tasks. The 'general' domain is reserved strictly for universal, domain-agnostic meta-coordination where no technical domain applies.`,
      prompt,
      schema: Classification,
      generation: { temperature: 0 },
    }).pipe(Effect.provideService(LLMClient.Service, llmClient))

    const llmClassification = res.object
    const deterministicTask = isClearlyActionableTask(prompt)

    return {
      ...llmClassification,
      isTask: llmClassification.isTask || deterministicTask,
      taskType: llmClassification.taskType || "general",
    }
  })
}
