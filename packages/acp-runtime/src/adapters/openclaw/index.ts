import type { AcpAgentAdapter } from "../types";
import { isCommandNamed, resolveDefaultLaunch, resolveUnsupportedCleanup } from "../shared";

export function createOpenClawAcpAdapter(): AcpAgentAdapter {
  return {
    id: "openclaw",
    isMatch: (provider) => provider.id === "openclaw" || isCommandNamed(provider.command, "openclaw"),
    resolveLaunch: resolveDefaultLaunch,
    resolveCapabilities: (_provider, _initializeResult, detected) => detected,
    resolveCleanup: ({ provider }) => resolveUnsupportedCleanup(provider),
  };
}
