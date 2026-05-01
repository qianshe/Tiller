import type { AcpAgentAdapter } from "./types";
import { isCommandNamed, resolveDefaultLaunch } from "./shared";

export function createCodexAcpAdapter(): AcpAgentAdapter {
  return {
    id: "codex",
    isMatch: (provider) => provider.id === "codex" || isCommandNamed(provider.command, "codex-acp"),
    resolveLaunch: resolveDefaultLaunch,
    resolveCapabilities: (_provider, _initializeResult, detected) => detected,
    resolveCleanup: ({ provider }) => ({
      kind: "unsupported",
      providerId: provider.id,
      message: "Codex ACP does not expose remote session deletion yet.",
    }),
  };
}
