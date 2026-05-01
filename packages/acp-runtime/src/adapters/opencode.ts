import type { AcpAgentAdapter } from "./types";
import { isCommandNamed, resolveDefaultLaunch } from "./shared";

export function createOpenCodeAcpAdapter(): AcpAgentAdapter {
  return {
    id: "opencode",
    isMatch: (provider) => provider.id === "opencode" || isCommandNamed(provider.command, "opencode"),
    resolveLaunch: resolveDefaultLaunch,
    resolveCapabilities: (_provider, _initializeResult, detected) => detected,
    resolveCleanup: ({ provider, runtimeSessionId }) => {
      const pureArgs = provider.args?.includes("--pure") ? ["--pure"] : [];
      return {
        kind: "remote-delete",
        providerId: provider.id,
        runtimeSessionId,
        command: "opencode",
        args: ["session", "delete", runtimeSessionId, ...pureArgs],
      };
    },
  };
}
