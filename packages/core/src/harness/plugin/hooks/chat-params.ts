import type { HarnessVersion } from "../../version"
import { isRecord } from "../../shared/guards"

type VersionInfo = HarnessVersion.VersionInfo | null | undefined
type ResolveActiveVersion = (sessionID?: string) => Promise<VersionInfo>

export function makeChatParamsHook(resolveActiveVersion: ResolveActiveVersion) {
  return async (
    input: { sessionID?: string },
    output: { temperature?: number; maxOutputTokens?: number; options: Record<string, unknown> },
  ) => {
    const currentVersion = await resolveActiveVersion(input.sessionID)
    if (!currentVersion) return

    if (typeof currentVersion.temperature === "number") {
      output.temperature = currentVersion.temperature
    }

    if (typeof currentVersion.maxOutputTokens === "number") {
      output.maxOutputTokens = currentVersion.maxOutputTokens
    }

    const extraOptions: Record<string, unknown> = {}
    if (currentVersion.modelOptions) {
      try {
        const parsed: unknown = JSON.parse(currentVersion.modelOptions)
        if (isRecord(parsed)) Object.assign(extraOptions, parsed)
      } catch {
        // ignore malformed modelOptions
      }
    }

    Object.assign(output.options, extraOptions)
  }
}
