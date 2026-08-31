import { Effect } from "effect"
import similarity from "compute-cosine-similarity"

export function fetchEmbedding(
  text: string,
  options?: { baseURL?: string; model?: string; apiKey?: string },
): Effect.Effect<Float32Array | undefined> {
  const baseURL = options?.baseURL || "http://localhost:11434/api/embed"
  const model = options?.model || "nomic-embed-text"
  const apiKey = options?.apiKey

  return Effect.tryPromise({
    try: async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

      const res = await fetch(baseURL, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: text }),
        signal: AbortSignal.timeout(3000),
      })

      if (!res.ok) return undefined

      const data: unknown = await res.json()

      if (
        typeof data === "object" &&
        data !== null &&
        "embeddings" in data &&
        Array.isArray(data.embeddings) &&
        Array.isArray(data.embeddings[0])
      ) {
        const rawVec = data.embeddings[0] as number[]
        if (rawVec.every((v) => typeof v === "number")) return new Float32Array(rawVec)
      }

      return undefined
    },
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined))
}

export function toVec(embedding: unknown): number[] | undefined {
  if (embedding instanceof Float32Array) return Array.from(embedding)
  if (Array.isArray(embedding)) return embedding as number[]
  return undefined
}

/**
 * Rank candidate domains by maximum cosine similarity to a query vector.
 * Returns domain names sorted descending by score.
 */
export function rankDomainsBySimilarity(
  queryVec: number[],
  tasks: readonly { taskType: string | null | undefined; embedding: unknown }[],
  candidateDomains: Set<string>,
): string[] {
  const scored = new Map<string, number>()
  for (const t of tasks) {
    if (!t.taskType || !candidateDomains.has(t.taskType) || !t.embedding) continue
    const taskVec = toVec(t.embedding)
    if (!taskVec) continue
    const score = similarity(queryVec, taskVec)
    if (typeof score === "number" && !isNaN(score)) {
      const current = scored.get(t.taskType) ?? -1
      if (score > current) scored.set(t.taskType, score)
    }
  }
  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d)
}

/**
 * Find the single best-matching domain above a cosine similarity threshold.
 */
export function bestDomainAboveThreshold(
  queryVec: number[],
  tasks: readonly { taskType: string | null | undefined; embedding: unknown }[],
  candidateDomains: Set<string>,
  threshold: number,
): string | undefined {
  let bestScore = -1
  let bestDomain: string | undefined
  for (const t of tasks) {
    if (!t.taskType || !candidateDomains.has(t.taskType) || !t.embedding) continue
    const taskVec = toVec(t.embedding)
    if (!taskVec) continue
    const score = similarity(queryVec, taskVec)
    if (typeof score === "number" && !isNaN(score) && score > bestScore) {
      bestScore = score
      bestDomain = t.taskType
    }
  }
  return bestScore >= threshold ? bestDomain : undefined
}
