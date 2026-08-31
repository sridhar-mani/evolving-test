import type { HarnessVersion } from "../../version"

type VersionInfo = HarnessVersion.VersionInfo | null | undefined

export function makeCompactingHook(activeVersion: VersionInfo, domainCategory: string) {
  return async (
    _input: unknown,
    output: { context: string[] },
  ) => {
    if (!activeVersion) return

    if (activeVersion.systemPrompt) {
      output.context.push(`Harness Domain Context (${domainCategory}): ${activeVersion.systemPrompt}`)
    }
  }
}
