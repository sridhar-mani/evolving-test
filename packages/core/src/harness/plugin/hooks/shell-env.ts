import type { HarnessVersion } from "../../version"

type VersionInfo = HarnessVersion.VersionInfo | null | undefined
type ResolveActiveVersion = (sessionID?: string) => Promise<VersionInfo>

export function makeShellEnvHook(resolveActiveVersion: ResolveActiveVersion) {
  return async (
    input: { sessionID?: string },
    output: { env: Record<string, string> },
  ) => {
    const currentVersion = await resolveActiveVersion(input.sessionID)
    if (!currentVersion) return

    output.env["HARNESS_DOMAIN"] = currentVersion.domainCategory
    output.env["HARNESS_VERSION_ID"] = currentVersion.versionID
  }
}
