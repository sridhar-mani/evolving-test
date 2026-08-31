import type { HarnessVersion } from "../../version"
import { isRecord } from "../../shared/guards"

type VersionInfo = HarnessVersion.VersionInfo | null | undefined

export function makePermissionHook(activeVersion: VersionInfo) {
  return async (
    input: unknown,
    output: { status?: "allow" | "deny" | "ask" },
  ) => {
    if (!activeVersion) return

    let permRules: Record<string, unknown> = {}
    if (activeVersion.toolOverrides) {
      try {
        const parsed: unknown = JSON.parse(activeVersion.toolOverrides)
        if (isRecord(parsed)) permRules = parsed
      } catch {
        // ignore
      }
    }

    const permissionKey = isRecord(input)
      ? typeof input.permission === "string"
        ? input.permission
        : typeof input.type === "string"
          ? input.type
          : undefined
      : typeof input === "string"
        ? input
        : undefined

    if (permissionKey && typeof permRules[permissionKey] === "string") {
      const status = permRules[permissionKey]
      if (status === "allow" || status === "deny" || status === "ask") {
        output.status = status
      }
    }
  }
}
