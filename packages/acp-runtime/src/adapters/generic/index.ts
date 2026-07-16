import type { AcpAgentAdapter } from "../types";
import { resolveDefaultLaunch, resolveUnsupportedCleanup } from "../shared";

export function createGenericAcpAdapter(): AcpAgentAdapter {
  return {
    id: "generic",
    isMatch: () => true,
    resolveLaunch: resolveDefaultLaunch,
    resolveCapabilities: (_provider, _initializeResult, detected) => detected,
    resolveCleanup: ({ provider }) => resolveUnsupportedCleanup(provider),
  };
}
