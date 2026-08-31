import type { HarnessVersion } from "../../version"

type VersionInfo = HarnessVersion.VersionInfo | null | undefined
type ResolveActiveVersion = (sessionID?: string) => Promise<VersionInfo>

function parseRecord(text: string | null | undefined): Record<string, unknown> {
  if (!text || !text.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function makeSystemTransformHook(resolveActiveVersion: ResolveActiveVersion) {
  return async (
    input: { sessionID?: string },
    output: { system: string[] },
  ) => {
    const currentVersion = await resolveActiveVersion(input.sessionID)
    if (!currentVersion) return

    if (currentVersion.systemPrompt) {
      output.system.push(currentVersion.systemPrompt)
    }

    const modelOpts = parseRecord(currentVersion.modelOptions)

    const hops = Array.isArray(modelOpts.workflowHops)
      ? (modelOpts.workflowHops as unknown[])
          .filter((h): h is string => typeof h === "string")
          .map((h, i) => `Hop ${i + 1}: ${h}`)
          .join(" -> ")
      : ""

    if (hops) {
      output.system.push(`WORKFLOW EXECUTION HOPS (${currentVersion.domainCategory}):\n${hops}`)
    }

    if (typeof modelOpts.communicationContracts === "string" && modelOpts.communicationContracts.trim()) {
      output.system.push(
        `COMMUNICATION CONTRACT (${currentVersion.domainCategory}):\n${modelOpts.communicationContracts}`,
      )
    }

    const rules = Array.isArray(currentVersion.extractedRules)
      ? currentVersion.extractedRules
          .filter((r: unknown): r is string => typeof r === "string")
          .map((r: string) => `- ${r}`)
          .join("\n")
      : ""

    if (rules) {
      output.system.push(`EXTRACTED LESSONS (${currentVersion.domainCategory}):\n${rules}`)
    }
  }
}
