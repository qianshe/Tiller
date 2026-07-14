import type { AcpAgentAdapter } from "../types";
import { resolveDefaultLaunch, resolveUnsupportedCleanup } from "../shared";
import { normalizeGenericToolCall } from "./tool-calls";

export function createGenericAcpAdapter(): AcpAgentAdapter {
  return {
    id: "generic",
    isMatch: () => true,
    resolveLaunch: resolveDefaultLaunch,
    resolveCapabilities: (_provider, _initializeResult, detected) => detected,
    resolveCleanup: ({ provider }) => resolveUnsupportedCleanup(provider),
    normalizeToolCall: ({ toolCall }) => normalizeGenericToolCall(toolCall),
  };
}
