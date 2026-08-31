import type { HarnessVersion } from "../../version"
import { isRecord } from "../../shared/guards"

type VersionInfo = HarnessVersion.VersionInfo | null | undefined
type ResolveActiveVersion = (sessionID?: string) => Promise<VersionInfo>

export function makeToolBeforeHook(resolveActiveVersion: ResolveActiveVersion) {
  return async (
    input: { sessionID?: string; tool: string },
    output: { args?: Record<string, unknown> },
  ) => {
    const currentVersion = await resolveActiveVersion(input.sessionID)
    if (!currentVersion) return

    let toolArgRules: Record<string, unknown> = {}
    if (currentVersion.toolOverrides) {
      try {
        const parsed: unknown = JSON.parse(currentVersion.toolOverrides)
        if (isRecord(parsed)) toolArgRules = parsed
      } catch {
        // ignore
      }
    }

    const toolRule = toolArgRules[input.tool]
    if (isRecord(toolRule) && isRecord(toolRule._args) && isRecord(output.args)) {
      Object.assign(output.args as object, toolRule._args)
    }
  }
}

export function makeToolAfterHook(resolveActiveVersion: ResolveActiveVersion) {
  return async (
    input: { sessionID?: string; tool: string },
    output: { output?: string },
  ) => {
    const currentVersion = await resolveActiveVersion(input.sessionID)
    if (!currentVersion) return

    let toolNotes: Record<string, unknown> = {}
    if (currentVersion.toolOverrides) {
      try {
        const parsed: unknown = JSON.parse(currentVersion.toolOverrides)
        if (isRecord(parsed)) toolNotes = parsed
      } catch {
        // ignore
      }
    }

    const toolNote = toolNotes[input.tool]
    if (isRecord(toolNote) && typeof toolNote.note === "string" && output.output) {
      output.output = `${output.output}\n\n[HARNESS LESSON: ${toolNote.note as string}]`
    }
  }
}
